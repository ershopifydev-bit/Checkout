import { randomUUID } from 'node:crypto';
import {
  computeCouponDiscountMinor,
  resolveShopifyCoupon,
  type ResolvedCoupon,
} from './shopify-discount.server';

export type Money = { currency: 'INR'; amountMinor: number };

export type CheckoutLine = {
  variantId?: string;
  productId?: string;
  /** Shopify cart line key — used for /cart/change.js quantity updates. */
  lineKey?: string;
  sku?: string;
  title: string;
  variantTitle: string;
  quantity: number;
  unitAmount: Money;
  imageUrl?: string;
  compareAtAmountMinor?: number;
  /** Line-level discount in minor units (already × quantity). */
  lineDiscountMinor?: number;
};

export type CheckoutAddress = {
  phone: string;
  fullName: string;
  addressLine1: string;
  locality: string;
  region: string;
  postalCode: string;
  email?: string;
};

export type ShippingHandle = {
  id: string;
  handleName: string;
  priceMinor: number;
  codEnabled: boolean;
  codExtraMinor: number;
  selected: boolean;
  etdText?: string;
};

export type SessionCoupon = {
  code: string;
  kind: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  discountMinor: number;
  summary: string;
};

export type CheckoutSession = {
  sessionId: string;
  shop: string;
  source: 'buy_now' | 'cart';
  currency: 'INR';
  paymentMethod: 'cod';
  lines: CheckoutLine[];
  totals: {
    currency: 'INR';
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    codFeeMinor: number;
    amountMinor: number;
  };
  address?: CheckoutAddress;
  shipping?: ShippingHandle;
  /** Cart.js / line discounts captured at session create (before coupon). */
  cartDiscountMinor: number;
  couponCode?: string;
  coupon?: SessionCoupon;
  createdAt: string;
  updatedAt: string;
};

export type CreateSessionInput = {
  shop: string;
  source: 'buy_now' | 'cart';
  /** Cart-level + line discounts from Shopify cart.js `total_discount` (minor). */
  discountMinor?: number;
  lines: Array<{
    variantId?: string;
    productId?: string;
    lineKey?: string;
    sku?: string;
    title?: string;
    variantTitle?: string;
    quantity: number;
    /** Client-reported unit price in major INR; converted to minor. Untrusted until Storefront revalidation. */
    price?: number;
    amountMinor?: number;
    imageUrl?: string;
    compareAtPrice?: number;
    /** Already minor; when set from cart.js original_price use compareAtAmountMinor instead. */
    compareAtAmountMinor?: number;
    lineDiscountMinor?: number;
  }>;
};

export type SessionStore = {
  put(session: CheckoutSession): Promise<void>;
  get(sessionId: string): Promise<CheckoutSession | null>;
  delete(sessionId: string): Promise<void>;
};

/** ponytail: process-local until Mongo checkout_sessions collection is wired; fine for single-replica pnpm dev. */
const memory = new Map<string, CheckoutSession>();

export function createMemorySessionStore(): SessionStore {
  return {
    async put(session) {
      memory.set(session.sessionId, session);
    },
    async get(sessionId) {
      return memory.get(sessionId) ?? null;
    },
    async delete(sessionId) {
      memory.delete(sessionId);
    },
  };
}

let defaultStore: SessionStore | undefined;
export function getCheckoutSessionStore(): SessionStore {
  defaultStore ??= createMemorySessionStore();
  return defaultStore;
}

function toMinorFromMajor(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100);
}

function normalizeLines(raw: CreateSessionInput['lines']): CheckoutLine[] {
  const lines: CheckoutLine[] = [];
  for (const item of raw) {
    const quantity = Math.min(99, Math.max(1, Math.floor(Number(item.quantity) || 1)));
    const amountMinor =
      typeof item.amountMinor === 'number' && Number.isFinite(item.amountMinor)
        ? Math.max(0, Math.round(item.amountMinor))
        : toMinorFromMajor(Number(item.price) || 0);
    if (amountMinor <= 0) continue;
    const title = String(item.title || 'Item').slice(0, 200);
    const variantTitle = String(item.variantTitle || '').slice(0, 200);
    const line: CheckoutLine = {
      title,
      variantTitle,
      quantity,
      unitAmount: { currency: 'INR', amountMinor },
    };
    if (item.variantId) line.variantId = String(item.variantId);
    if (item.productId) line.productId = String(item.productId);
    if (item.lineKey) line.lineKey = String(item.lineKey).slice(0, 200);
    if (item.sku) line.sku = String(item.sku).slice(0, 80);
    if (item.imageUrl) line.imageUrl = String(item.imageUrl).slice(0, 500);
    if (typeof item.compareAtAmountMinor === 'number' && Number.isFinite(item.compareAtAmountMinor)) {
      line.compareAtAmountMinor = Math.max(0, Math.round(item.compareAtAmountMinor));
    } else if (typeof item.compareAtPrice === 'number') {
      line.compareAtAmountMinor = toMinorFromMajor(item.compareAtPrice);
    }
    if (typeof item.lineDiscountMinor === 'number' && item.lineDiscountMinor > 0) {
      line.lineDiscountMinor = Math.round(item.lineDiscountMinor);
    }
    lines.push(line);
  }
  return lines;
}

function subtotalOf(session: CheckoutSession): number {
  return session.lines.reduce((sum, line) => sum + line.unitAmount.amountMinor * line.quantity, 0);
}

function refreshCouponAmount(session: CheckoutSession) {
  if (!session.coupon) return;
  session.coupon.discountMinor = computeCouponDiscountMinor(session.coupon, subtotalOf(session));
}

function recomputeTotals(session: CheckoutSession): CheckoutSession['totals'] {
  const subtotalMinor = subtotalOf(session);
  refreshCouponAmount(session);
  const cartDiscount = Math.max(0, Math.round(session.cartDiscountMinor || 0));
  const couponDiscount = Math.max(0, Math.round(session.coupon?.discountMinor || 0));
  const discountMinor = Math.min(subtotalMinor, cartDiscount + couponDiscount);
  let shippingMinor = session.shipping?.priceMinor ?? 0;
  if (session.coupon?.kind === 'free_shipping') shippingMinor = 0;
  const codFeeMinor = session.shipping?.codExtraMinor ?? 0;
  return {
    currency: 'INR',
    subtotalMinor,
    discountMinor,
    shippingMinor,
    codFeeMinor,
    amountMinor: Math.max(0, subtotalMinor - discountMinor + shippingMinor + codFeeMinor),
  };
}

export function publicSessionView(session: CheckoutSession) {
  return {
    sessionId: session.sessionId,
    source: session.source,
    currency: session.currency,
    paymentMethod: session.paymentMethod,
    lines: session.lines,
    totals: session.totals,
    address: session.address,
    shipping: session.shipping,
    couponCode: session.couponCode || session.coupon?.code || '',
    coupon: session.coupon
      ? {
          code: session.coupon.code,
          kind: session.coupon.kind,
          summary: session.coupon.summary,
          discountMinor: session.coupon.discountMinor,
        }
      : null,
  };
}

export async function createCheckoutSession(
  input: CreateSessionInput,
  store: SessionStore = getCheckoutSessionStore(),
): Promise<CheckoutSession> {
  const shop = String(input.shop || '')
    .trim()
    .toLowerCase();
  if (!shop.includes('.')) throw new Error('INVALID_SHOP');
  const source = input.source === 'buy_now' ? 'buy_now' : 'cart';
  const lines = normalizeLines(input.lines || []);
  if (lines.length === 0) throw new Error('EMPTY_CART');
  const lineDiscountSum = lines.reduce((sum, line) => sum + (line.lineDiscountMinor || 0), 0);
  const discountMinor = Math.max(
    0,
    Math.round(
      typeof input.discountMinor === 'number' && Number.isFinite(input.discountMinor)
        ? input.discountMinor
        : lineDiscountSum,
    ),
  );
  const now = new Date().toISOString();
  const session: CheckoutSession = {
    sessionId: `sess_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    shop,
    source,
    currency: 'INR',
    paymentMethod: 'cod',
    lines,
    cartDiscountMinor: discountMinor,
    totals: {
      currency: 'INR',
      subtotalMinor: 0,
      discountMinor,
      shippingMinor: 0,
      codFeeMinor: 0,
      amountMinor: 0,
    },
    shipping: {
      id: 'standard',
      handleName: 'Standard',
      priceMinor: 0,
      codEnabled: true,
      codExtraMinor: 0,
      selected: true,
      etdText: 'Delivery estimate after PIN check',
    },
    createdAt: now,
    updatedAt: now,
  };
  session.totals = recomputeTotals(session);
  await store.put(session);
  return session;
}

export async function getCheckoutSession(
  sessionId: string,
  store: SessionStore = getCheckoutSessionStore(),
) {
  if (!sessionId) return null;
  return store.get(sessionId);
}

export type PatchCheckoutSessionOptions = {
  /** Injected in tests — defaults to Shopify Admin discount lookup. */
  resolveCoupon?: (input: {
    shop: string;
    code: string;
    subtotalMinor: number;
  }) => Promise<ResolvedCoupon>;
};

export async function patchCheckoutSession(
  sessionId: string,
  patch: {
    address?: CheckoutAddress;
    couponCode?: string;
    /** ponytail: demo gift card until Shopify Gift Card API. */
    giftVoucher?: { code?: string; pin?: string };
    /** ponytail: points→INR until loyalty partner API drives conversion (10 pts = ₹1). */
    loyaltyRedeemPoints?: number;
  },
  store: SessionStore = getCheckoutSessionStore(),
  options: PatchCheckoutSessionOptions = {},
): Promise<CheckoutSession> {
  const session = await store.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.cartDiscountMinor == null) {
    session.cartDiscountMinor = Math.max(0, Math.round(session.totals.discountMinor || 0));
  }
  if (patch.address) {
    if (
      !/^[6-9]\d{9}$/.test(patch.address.phone) ||
      !/^\d{6}$/.test(patch.address.postalCode) ||
      !patch.address.fullName ||
      !patch.address.addressLine1 ||
      !patch.address.locality ||
      !patch.address.region
    ) {
      throw new Error('INVALID_ADDRESS');
    }
    const nextAddress: CheckoutAddress = {
      phone: patch.address.phone,
      fullName: patch.address.fullName.slice(0, 80),
      addressLine1: patch.address.addressLine1.slice(0, 120),
      locality: patch.address.locality.slice(0, 80),
      region: patch.address.region.slice(0, 80),
      postalCode: patch.address.postalCode,
    };
    if (patch.address.email) nextAddress.email = patch.address.email.slice(0, 120);
    session.address = nextAddress;
  }
  if (typeof patch.couponCode === 'string') {
    const code = patch.couponCode.trim().slice(0, 40);
    if (!code) {
      delete session.couponCode;
      delete session.coupon;
    } else {
      const resolve = options.resolveCoupon || resolveShopifyCoupon;
      const resolved = await resolve({
        shop: session.shop,
        code,
        subtotalMinor: subtotalOf(session),
      });
      session.couponCode = resolved.code;
      session.coupon = {
        code: resolved.code,
        kind: resolved.kind,
        value: resolved.value,
        discountMinor: resolved.discountMinor,
        summary: resolved.summary,
      };
    }
  }

  if (patch.giftVoucher) {
    const code = String(patch.giftVoucher.code || '')
      .trim()
      .toUpperCase()
      .slice(0, 40);
    const pin = String(patch.giftVoucher.pin || '').replace(/\D/g, '');
    if (!code || code.length < 4) throw new Error('INVALID_GIFT_CODE');
    if (!/^\d{4,6}$/.test(pin)) throw new Error('INVALID_GIFT_PIN');
    // ponytail: demo balance ₹500 until Gift Card Admin API is wired.
    const balanceMinor = 50000;
    const discountMinor = Math.min(subtotalOf(session), balanceMinor);
    session.couponCode = `GIFT:${code}`;
    session.coupon = {
      code: `GIFT:${code}`,
      kind: 'fixed',
      value: discountMinor,
      discountMinor,
      summary: 'Gift voucher applied',
    };
  }

  if (typeof patch.loyaltyRedeemPoints === 'number') {
    const points = Math.max(0, Math.round(patch.loyaltyRedeemPoints));
    if (points < 10) throw new Error('INVALID_LOYALTY_POINTS');
    const discountMinor = Math.min(subtotalOf(session), Math.floor(points / 10) * 100);
    if (discountMinor <= 0) throw new Error('INVALID_LOYALTY_POINTS');
    session.couponCode = 'LOYALTY';
    session.coupon = {
      code: 'LOYALTY',
      kind: 'fixed',
      value: discountMinor,
      discountMinor,
      summary: `${points} loyalty points`,
    };
  }

  session.updatedAt = new Date().toISOString();
  session.totals = recomputeTotals(session);
  await store.put(session);
  return session;
}

export async function quoteCheckoutSession(
  sessionId: string,
  input: { postalCode?: string },
  store: SessionStore = getCheckoutSessionStore(),
): Promise<CheckoutSession> {
  const session = await store.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const pin = String(input.postalCode || session.address?.postalCode || '');
  if (pin && !/^\d{6}$/.test(pin)) throw new Error('INVALID_PIN');
  const serviceable = !pin || /^[1-9]\d{5}$/.test(pin);
  session.shipping = {
    id: 'standard',
    handleName: 'Standard',
    priceMinor: 0,
    codEnabled: serviceable,
    codExtraMinor: 0,
    selected: true,
    etdText: serviceable
      ? pin
        ? 'Quick delivery to your PIN'
        : 'Delivery estimate after PIN check'
      : 'Not serviceable for COD',
  };
  session.updatedAt = new Date().toISOString();
  session.totals = recomputeTotals(session);
  await store.put(session);
  return session;
}

export type PlaceCodOrderOptions = {
  customerId?: string;
  /** Injected in tests — defaults to Shopify Admin orderCreate. */
  createOrder?: typeof import('./shopify-cod-order.server').createCodOrderInShopify;
};

export async function placeCodFromSession(
  sessionId: string,
  address: CheckoutAddress,
  store: SessionStore = getCheckoutSessionStore(),
  options: PlaceCodOrderOptions = {},
) {
  const session = await patchCheckoutSession(sessionId, { address }, store);
  if (!session.shipping?.codEnabled) throw new Error('NOT_SERVICEABLE');

  const createOrder =
    options.createOrder ||
    (await import('./shopify-cod-order.server')).createCodOrderInShopify;

  let shopifyOrder;
  try {
    shopifyOrder = await createOrder({
      shop: session.shop,
      address,
      lines: session.lines,
      totals: session.totals,
      coupon: session.coupon,
      ...(options.customerId ? { customerId: options.customerId } : {}),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'ORDER_CREATE_FAILED';
    if (code === 'ADMIN_TOKEN_MISSING' || code === 'ORDER_CREATE_FAILED' || code === 'EMPTY_CART') {
      throw new Error(code);
    }
    console.error('[EasyCheckout] place COD unexpected error', error);
    throw new Error('ORDER_CREATE_FAILED');
  }

  await store.delete(sessionId);
  return {
    orderId: shopifyOrder.orderId,
    orderName: shopifyOrder.orderName,
    orderGid: shopifyOrder.orderGid,
    status: 'placed' as const,
    paymentMethod: 'cod' as const,
    sessionId,
    source: session.source,
    totals: session.totals,
    lines: session.lines,
    message: `Order ${shopifyOrder.orderName} placed. Pay cash on delivery.`,
  };
}
