import type {
  CheckoutAddress,
  CheckoutLine,
  CheckoutSession,
  SessionCoupon,
} from './checkout-session.server';

export type CodOrderResult = {
  orderGid: string;
  orderId: string;
  orderName: string;
};

type MoneyAmount = { amount: string; currencyCode: 'INR' };

function moneyFromMinor(amountMinor: number): MoneyAmount {
  return {
    amount: ((Number(amountMinor) || 0) / 100).toFixed(2),
    currencyCode: 'INR',
  };
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || 'Customer';
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

function toVariantGid(variantId: string): string {
  const raw = String(variantId || '').trim();
  if (raw.startsWith('gid://')) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

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

/**
 * Creates a real Shopify COD order (financial status pending) from a checkout session.
 */
export async function createCodOrderInShopify(input: {
  shop: string;
  address: CheckoutAddress;
  lines: CheckoutLine[];
  totals: CheckoutSession['totals'];
  coupon?: SessionCoupon;
  customerId?: string;
}): Promise<CodOrderResult> {
  const shop = input.shop.trim().toLowerCase();
  const token = await offlineAccessToken(shop);
  if (!token) throw new Error('ADMIN_TOKEN_MISSING');

  const { firstName, lastName } = splitName(input.address.fullName);
  const phone = `+91${input.address.phone}`;
  const amount = moneyFromMinor(input.totals.amountMinor);

  const lineItems = input.lines.map((line) => {
    if (line.variantId) {
      return {
        variantId: toVariantGid(line.variantId),
        quantity: line.quantity,
      };
    }
    const unit = moneyFromMinor(line.unitAmount.amountMinor);
    return {
      title: line.variantTitle && line.variantTitle !== 'Default Title'
        ? `${line.title} — ${line.variantTitle}`
        : line.title,
      quantity: line.quantity,
      priceSet: { shopMoney: unit, presentmentMoney: unit },
    };
  });

  if (!lineItems.length) throw new Error('EMPTY_CART');

  const orderInput: Record<string, unknown> = {
    currency: 'INR',
    financialStatus: 'PENDING',
    tags: ['COD', 'EasyCheckout'],
    note: 'Placed via EasyCheckout — Cash on Delivery',
    phone,
    shippingAddress: {
      firstName,
      lastName,
      address1: input.address.addressLine1,
      city: input.address.locality,
      province: input.address.region,
      countryCode: 'IN',
      zip: input.address.postalCode,
      phone,
    },
    billingAddress: {
      firstName,
      lastName,
      address1: input.address.addressLine1,
      city: input.address.locality,
      province: input.address.region,
      countryCode: 'IN',
      zip: input.address.postalCode,
      phone,
    },
    lineItems,
    transactions: [
      {
        kind: 'SALE',
        status: 'PENDING',
        gateway: 'Cash on Delivery (COD)',
        amountSet: { shopMoney: amount, presentmentMoney: amount },
      },
    ],
  };
  if (input.customerId && !input.customerId.startsWith('local_')) {
    orderInput['customer'] = { toAssociate: { id: input.customerId } };
  } else if (input.address.email) {
    orderInput['email'] = input.address.email;
  }

  const coupon = input.coupon;
  if (coupon?.kind === 'percentage' && coupon.value > 0) {
    orderInput['discountCode'] = {
      itemPercentageDiscountCode: {
        code: coupon.code,
        percentage: coupon.value,
      },
    };
  } else if (coupon?.kind === 'fixed' && coupon.discountMinor > 0) {
    const off = moneyFromMinor(coupon.discountMinor);
    orderInput['discountCode'] = {
      itemFixedDiscountCode: {
        code: coupon.code,
        amountSet: { shopMoney: off, presentmentMoney: off },
      },
    };
  } else if (coupon?.kind === 'free_shipping') {
    orderInput['discountCode'] = {
      freeShippingDiscountCode: { code: coupon.code },
    };
  }

  const response = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          order { id name legacyResourceId }
          userErrors { field message }
        }
      }`,
      variables: {
        order: orderInput,
        options: {
          sendReceipt: false,
          sendFulfillmentReceipt: false,
          inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[EasyCheckout] orderCreate HTTP', response.status, detail.slice(0, 300));
    throw new Error('ORDER_CREATE_FAILED');
  }

  const body = (await response.json()) as {
    data?: {
      orderCreate?: {
        order?: { id: string; name: string; legacyResourceId?: string | null } | null;
        userErrors?: Array<{ message?: string; field?: string[] | null }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  const userErrors = body.data?.orderCreate?.userErrors || [];
  if (userErrors.length) {
    console.error(
      '[EasyCheckout] orderCreate userErrors',
      userErrors.map((error) => error.message).slice(0, 5),
    );
    throw new Error('ORDER_CREATE_FAILED');
  }
  if (body.errors?.length) {
    console.error(
      '[EasyCheckout] orderCreate graphql errors',
      body.errors.map((error) => error.message).slice(0, 5),
    );
    throw new Error('ORDER_CREATE_FAILED');
  }

  const order = body.data?.orderCreate?.order;
  if (!order?.id || !order.name) throw new Error('ORDER_CREATE_FAILED');

  console.info('[EasyCheckout] COD order created', {
    shop,
    orderName: order.name,
    orderId: order.legacyResourceId || order.id,
  });

  return {
    orderGid: order.id,
    orderId: String(order.legacyResourceId || order.id),
    orderName: order.name,
  };
}
