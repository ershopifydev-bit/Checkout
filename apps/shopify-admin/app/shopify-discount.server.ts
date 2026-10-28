export type DiscountCombination = {
  discountClass?: 'ORDER' | 'PRODUCT' | 'SHIPPING';
  combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
};

export type ResolvedCoupon = DiscountCombination & {
  code: string;
  kind: 'percentage' | 'fixed' | 'free_shipping';
  /** Percentage 0–100, or fixed amount in minor units. */
  value: number;
  /** Applied product discount in minor units (0 for free-shipping-only). */
  discountMinor: number;
  summary: string;
};

type DiscountLookup = DiscountCombination & {
  kind: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  summary: string;
  status: string;
};

async function offlineAccessToken(shop: string): Promise<string | null> {
  try {
    const { sessionStorage } = await import('./shopify.server');
    const sessions = await sessionStorage.findSessionsByShop(shop);
    const offline =
      sessions.find((session) => session.id.startsWith('offline_') && session.accessToken) ||
      sessions.find((session) => session.accessToken);
    return offline?.accessToken || null;
  } catch {
    return null;
  }
}

function moneyToMinor(amount: string | number | null | undefined): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function computeCouponDiscountMinor(
  lookup: Pick<DiscountLookup, 'kind' | 'value'>,
  subtotalMinor: number,
): number {
  const sub = Math.max(0, Math.round(subtotalMinor) || 0);
  if (lookup.kind === 'percentage') {
    const pct = Math.min(100, Math.max(0, lookup.value));
    return Math.min(sub, Math.round((sub * pct) / 100));
  }
  if (lookup.kind === 'fixed') {
    return Math.min(sub, Math.max(0, Math.round(lookup.value)));
  }
  return 0;
}

async function lookupDiscountCode(shop: string, code: string): Promise<DiscountLookup> {
  const token = await offlineAccessToken(shop);
  if (!token) throw new Error('ADMIN_TOKEN_MISSING');

  const response = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `query CodeDiscount($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              status
              shortSummary
              discountClasses
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount } }
                }
              }
            }
            ... on DiscountCodeFreeShipping {
              status
              shortSummary
              discountClasses
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            }
          }
        }
      }`,
      variables: { code },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[EasyCheckout] discount lookup HTTP', response.status, detail.slice(0, 200));
    throw new Error('DISCOUNT_LOOKUP_FAILED');
  }

  const body = (await response.json()) as {
    data?: {
      codeDiscountNodeByCode?: {
        codeDiscount?: {
          __typename?: string;
          status?: string;
          shortSummary?: string | null;
          discountClasses?: Array<'ORDER' | 'PRODUCT' | 'SHIPPING'>;
          combinesWith?: NonNullable<DiscountCombination['combinesWith']>;
          customerGets?: {
            value?: {
              percentage?: number | null;
              amount?: { amount?: string | null } | null;
            } | null;
          } | null;
        } | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join('; ');
    if (/access|scope|permission/i.test(msg)) throw new Error('DISCOUNT_SCOPE_MISSING');
    console.error('[EasyCheckout] discount lookup graphql', msg.slice(0, 200));
    throw new Error('DISCOUNT_LOOKUP_FAILED');
  }

  const discount = body.data?.codeDiscountNodeByCode?.codeDiscount;
  if (!discount) throw new Error('INVALID_COUPON');

  const status = String(discount.status || '').toUpperCase();
  if (status && status !== 'ACTIVE') throw new Error('COUPON_INACTIVE');

  const combination: DiscountCombination = {
    ...(discount.discountClasses?.[0] ? { discountClass: discount.discountClasses[0] } : {}),
    ...(discount.combinesWith ? { combinesWith: discount.combinesWith } : {}),
  };
  const typename = discount.__typename || '';
  if (typename === 'DiscountCodeFreeShipping') {
    return {
      ...combination,
      kind: 'free_shipping',
      value: 0,
      summary: discount.shortSummary || 'Free shipping',
      status,
    };
  }

  if (typename !== 'DiscountCodeBasic') {
    throw new Error('COUPON_UNSUPPORTED');
  }

  const value = discount.customerGets?.value;
  if (value && typeof value.percentage === 'number' && value.percentage > 0) {
    return {
      ...combination,
      kind: 'percentage',
      value: value.percentage * 100,
      summary: discount.shortSummary || `${value.percentage * 100}% off`,
      status,
    };
  }
  if (value?.amount?.amount != null) {
    const minor = moneyToMinor(value.amount.amount);
    if (minor <= 0) throw new Error('INVALID_COUPON');
    return {
      ...combination,
      kind: 'fixed',
      value: minor,
      summary: discount.shortSummary || `₹${(minor / 100).toFixed(0)} off`,
      status,
    };
  }

  throw new Error('COUPON_UNSUPPORTED');
}

export async function resolveShopifyCoupon(input: {
  shop: string;
  code: string;
  subtotalMinor: number;
}): Promise<ResolvedCoupon> {
  const code = input.code.trim().slice(0, 40);
  if (!code) throw new Error('INVALID_COUPON');
  const lookup = await lookupDiscountCode(input.shop.trim().toLowerCase(), code);
  const discountMinor = computeCouponDiscountMinor(lookup, input.subtotalMinor);
  return {
    ...lookup,
    code,
    kind: lookup.kind,
    value: lookup.value,
    discountMinor,
    summary: lookup.summary,
  };
}

export type ListedCoupon = ResolvedCoupon & { recommended?: boolean };

/** Active code discounts ranked by savings for this cart (basic + free shipping only). */
export async function listShopifyCoupons(input: {
  shop: string;
  subtotalMinor: number;
  limit?: number;
}): Promise<ListedCoupon[]> {
  const shop = input.shop.trim().toLowerCase();
  const token = await offlineAccessToken(shop);
  if (!token) throw new Error('ADMIN_TOKEN_MISSING');

  const response = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `query ActiveCodeDiscounts {
        codeDiscountNodes(first: 25, query: "status:active") {
          nodes {
            codeDiscount {
              __typename
              ... on DiscountCodeBasic {
                status
                shortSummary
              discountClasses
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                codes(first: 1) { nodes { code } }
                customerGets {
                  value {
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount } }
                  }
                }
              }
              ... on DiscountCodeFreeShipping {
                status
                shortSummary
              discountClasses
              combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                codes(first: 1) { nodes { code } }
              }
            }
          }
        }
      }`,
    }),
  });

  if (!response.ok) throw new Error('DISCOUNT_LOOKUP_FAILED');
  const body = (await response.json()) as {
    data?: {
      codeDiscountNodes?: {
        nodes?: Array<{
          codeDiscount?: {
            __typename?: string;
            status?: string;
            shortSummary?: string | null;
            discountClasses?: Array<'ORDER' | 'PRODUCT' | 'SHIPPING'>;
            combinesWith?: NonNullable<DiscountCombination['combinesWith']>;
            codes?: { nodes?: Array<{ code?: string | null }> | null } | null;
            customerGets?: {
              value?: {
                percentage?: number | null;
                amount?: { amount?: string | null } | null;
              } | null;
            } | null;
          } | null;
        } | null>;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join('; ');
    if (/access|scope|permission/i.test(msg)) throw new Error('DISCOUNT_SCOPE_MISSING');
    throw new Error('DISCOUNT_LOOKUP_FAILED');
  }

  const listed: ListedCoupon[] = [];
  for (const node of body.data?.codeDiscountNodes?.nodes || []) {
    const discount = node?.codeDiscount;
    if (!discount) continue;
    const status = String(discount.status || '').toUpperCase();
    if (status && status !== 'ACTIVE') continue;
    const code = String(discount.codes?.nodes?.[0]?.code || '').trim();
    if (!code) continue;

    let kind: DiscountLookup['kind'] | null = null;
    let value = 0;
    if (discount.__typename === 'DiscountCodeFreeShipping') {
      kind = 'free_shipping';
    } else if (discount.__typename === 'DiscountCodeBasic') {
      const v = discount.customerGets?.value;
      if (v && typeof v.percentage === 'number' && v.percentage > 0) {
        kind = 'percentage';
        value = v.percentage * 100;
      } else if (v?.amount?.amount != null) {
        kind = 'fixed';
        value = moneyToMinor(v.amount.amount);
      }
    }
    if (!kind) continue;
    const discountMinor = computeCouponDiscountMinor({ kind, value }, input.subtotalMinor);
    listed.push({
      code,
      kind,
      value,
      discountMinor,
      summary: discount.shortSummary || code,
    });
  }

  listed.sort((a, b) => b.discountMinor - a.discountMinor || a.code.localeCompare(b.code));
  const limit = Math.max(1, Math.min(50, input.limit || 25));
  const sliced = listed.slice(0, limit);
  if (sliced[0]) sliced[0].recommended = true;
  return sliced;
}
