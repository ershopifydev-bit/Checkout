import type {
  CheckoutAddress,
  CheckoutLine,
  CheckoutSession,
  SessionCoupon,
} from './checkout-session.server';
import { generateSourceIdentifier } from './checkout-order-attempt.server';
import { decimalStringToMinor, toShopifyMoney, validateMinorUnits } from './money.server';
import { executeShopifyGraphQL, ShopifyValidationError } from './shopify-client.server';

export type CodOrderResult = {
  orderGid: string;
  orderId: string;
  orderName: string;
  totalMinor?: number | undefined;
  statusUrl?: string | undefined;
};

/**
 * Splits a full name cleanly without copying the first name to last name if single word.
 */
export function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/);
  const firstName = parts[0] || 'Customer';
  const lastName = parts.slice(1).join(' '); // Leave empty or provide single space if no surname
  return { firstName, lastName: lastName || '.' };
}

/**
 * Normalizes Indian 10-digit mobile numbers to standard E.164 (+91XXXXXXXXXX).
 * Never produces duplicate country codes like +91+91...
 */
export function normalizeIndianPhone(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  const tenDigits = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(tenDigits)) {
    throw new Error('INVALID_PHONE');
  }
  return `+91${tenDigits}`;
}

export function toVariantGid(variantId: string): string {
  const raw = String(variantId || '').trim();
  if (raw.startsWith('gid://')) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

/**
 * Retrieves ONLY an authentic offline access token for the given shop.
 * Strictly disallows fallback to online tokens or cross-shop sessions.
 */
export async function getShopOfflineAccessToken(shop: string): Promise<string | null> {
  const normShop = shop.trim().toLowerCase();
  if (!normShop) return null;
  try {
    const { sessionStorage } = await import('./shopify.server');
    const sessions = await sessionStorage.findSessionsByShop(normShop);
    const offlineSession = sessions.find(
      (session) =>
        session.id.startsWith('offline_') && session.accessToken && session.shop === normShop,
    );
    if (!offlineSession?.accessToken) return null;

    // Verify required scopes
    const scopeString = String(offlineSession.scope || '');
    if (scopeString && !scopeString.includes('write_orders')) {
      console.warn(`[ShopifyCodOrder] Offline token for ${normShop} lacks write_orders scope`);
    }

    return offlineSession.accessToken;
  } catch (err) {
    console.error(
      `[ShopifyCodOrder] offline token lookup error for ${normShop}:`,
      (err as Error).message,
    );
    return null;
  }
}

const ORDER_CREATE_MUTATION = `
  mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order {
        id
        name
        legacyResourceId
        sourceIdentifier
        statusPageUrl
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        displayFinancialStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Creates a real Shopify COD order with verified amounts, shipping lines,
 * and stable sourceIdentifier for reconciliation.
 */
export async function createCodOrderInShopify(input: {
  shop: string;
  checkoutSessionId?: string | undefined;
  address: CheckoutAddress;
  lines: CheckoutLine[];
  totals: CheckoutSession['totals'];
  coupon?: SessionCoupon | undefined;
  customerId?: string | undefined;
  shippingTitle?: string | undefined;
  token?: string | undefined;
}): Promise<CodOrderResult> {
  const shop = input.shop.trim().toLowerCase();
  const token = input.token || (await getShopOfflineAccessToken(shop));
  if (!token) throw new Error('ADMIN_TOKEN_MISSING');

  // Validate financial amounts strictly
  const totalAmountMinor = validateMinorUnits(input.totals.amountMinor, 'totals.amountMinor');
  const shippingMinor = validateMinorUnits(input.totals.shippingMinor, 'totals.shippingMinor');
  const codFeeMinor = validateMinorUnits(input.totals.codFeeMinor, 'totals.codFeeMinor');
  const totalShippingMinor = shippingMinor + codFeeMinor;

  const { firstName, lastName } = splitCustomerName(input.address.fullName);
  const phone = normalizeIndianPhone(input.address.phone);
  const totalMoney = toShopifyMoney(totalAmountMinor, 'INR', 'totalAmount');

  // Validate and map line items
  if (!input.lines || !input.lines.length) {
    throw new Error('EMPTY_CART');
  }

  const lineItems = input.lines.map((line) => {
    const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
    if (line.variantId) {
      return {
        variantId: toVariantGid(line.variantId),
        quantity,
      };
    }
    const unitMinor = validateMinorUnits(line.unitAmount.amountMinor, 'line.unitAmount');
    const unitMoney = toShopifyMoney(unitMinor, 'INR', 'unitMinor');
    return {
      title:
        line.variantTitle && line.variantTitle !== 'Default Title'
          ? `${line.title} — ${line.variantTitle}`
          : line.title,
      quantity,
      priceSet: { shopMoney: unitMoney, presentmentMoney: unitMoney },
    };
  });

  const sourceIdentifier = input.checkoutSessionId
    ? generateSourceIdentifier(input.checkoutSessionId)
    : `tezvix:${Date.now()}`;

  const orderInput: Record<string, unknown> = {
    currency: 'INR',
    financialStatus: 'PENDING',
    sourceIdentifier,
    sourceName: 'Tezvix',
    tags: ['COD', 'Tezvix'],
    note: 'Placed via Tezvix Checkout — Cash on Delivery',
    phone,
    shippingAddress: {
      firstName,
      lastName,
      address1: input.address.addressLine1.trim(),
      city: input.address.locality.trim(),
      province: input.address.region.trim(),
      countryCode: 'IN',
      zip: input.address.postalCode.trim(),
      phone,
    },
    billingAddress: {
      firstName,
      lastName,
      address1: input.address.addressLine1.trim(),
      city: input.address.locality.trim(),
      province: input.address.region.trim(),
      countryCode: 'IN',
      zip: input.address.postalCode.trim(),
      phone,
    },
    lineItems,
    transactions: [
      {
        kind: 'SALE',
        status: 'PENDING',
        gateway: 'Cash on Delivery (COD)',
        amountSet: { shopMoney: totalMoney, presentmentMoney: totalMoney },
      },
    ],
  };

  // Add explicit shipping line if shipping or COD fee applies
  if (totalShippingMinor > 0) {
    const shippingMoney = toShopifyMoney(totalShippingMinor, 'INR', 'totalShipping');
    const title =
      input.shippingTitle || (codFeeMinor > 0 ? 'Standard Delivery (COD)' : 'Standard Delivery');
    orderInput['shippingLines'] = [
      {
        title,
        priceSet: { shopMoney: shippingMoney, presentmentMoney: shippingMoney },
      },
    ];
  }

  // Customer linkage
  if (input.customerId && !input.customerId.startsWith('local_')) {
    orderInput['customer'] = { toAssociate: { id: input.customerId } };
  } else if (input.address.email) {
    orderInput['email'] = input.address.email.trim();
  }

  // Coupon handling
  const coupon = input.coupon;
  if (coupon?.kind === 'percentage' && coupon.value > 0) {
    orderInput['discountCode'] = {
      itemPercentageDiscountCode: {
        code: coupon.code,
        percentage: coupon.value,
      },
    };
  } else if (coupon?.kind === 'fixed' && coupon.discountMinor > 0) {
    const off = toShopifyMoney(coupon.discountMinor, 'INR', 'coupon.discountMinor');
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

  // Execute mutation via centralized client
  const { data } = await executeShopifyGraphQL<{
    orderCreate?: {
      order?: {
        id: string;
        name: string;
        legacyResourceId?: string | null;
        sourceIdentifier?: string | null;
        statusPageUrl?: string | null;
        currentTotalPriceSet?: {
          shopMoney?: {
            amount?: string;
            currencyCode?: string;
          };
        };
      } | null;
      userErrors?: Array<{ message?: string; field?: string[] | null }>;
    };
  }>(
    shop,
    token,
    ORDER_CREATE_MUTATION,
    {
      order: orderInput,
      options: {
        sendReceipt: false,
        sendFulfillmentReceipt: false,
        inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
      },
    },
    { timeoutMs: 15000, estimatedCost: 15 },
  );

  const userErrors = data.orderCreate?.userErrors || [];
  if (userErrors.length) {
    console.error(
      '[ShopifyCodOrder] orderCreate userErrors:',
      userErrors.map((e) => e.message),
    );
    throw new ShopifyValidationError('Shopify order validation failed', userErrors);
  }

  const order = data.orderCreate?.order;
  if (!order?.id || !order.name) {
    throw new Error('ORDER_CREATE_FAILED');
  }

  // Verify total price returned by Shopify
  const returnedTotalDecimal = order.currentTotalPriceSet?.shopMoney?.amount;
  let returnedTotalMinor: number | undefined;
  if (returnedTotalDecimal) {
    returnedTotalMinor = decimalStringToMinor(returnedTotalDecimal);
    const diff = Math.abs(returnedTotalMinor - totalAmountMinor);
    if (diff > 100) {
      console.warn('[ShopifyCodOrder] Total amount mismatch warning:', {
        expected: totalAmountMinor,
        actual: returnedTotalMinor,
        orderName: order.name,
      });
    }
  }

  console.info('[ShopifyCodOrder] COD order confirmed in Shopify', {
    shop,
    orderName: order.name,
    orderId: order.legacyResourceId || order.id,
    sourceIdentifier,
  });

  return {
    orderGid: order.id,
    orderId: String(order.legacyResourceId || order.id),
    orderName: order.name,
    totalMinor: returnedTotalMinor ?? totalAmountMinor,
    statusUrl: order.statusPageUrl || undefined,
  };
}
