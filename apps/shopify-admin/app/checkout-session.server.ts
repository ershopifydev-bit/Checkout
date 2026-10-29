import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Collection, Db } from 'mongodb';
import {
  claimAttemptForCreation,
  createOrGetOrderAttempt,
  findAttemptBySessionId,
  markAttemptConfirmed,
  markAttemptFailed,
  markAttemptUnknown,
  OrderInProgressError,
  OrderReconciliationRequiredError,
} from './checkout-order-attempt.server';
import { reconcileCheckoutAttempt } from './checkout-order-reconciliation.server';
import { AmbiguousShopifyError } from './shopify-client.server';
import { getRedis } from './redis.server';
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

export type SessionCoupon = ResolvedCoupon;

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
  coupons?: SessionCoupon[];
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

/** Result returned to the shopper once an order exists; replayed on retries of the same session. */
export type PlacedOrder = {
  orderId: string;
  orderName: string;
  orderGid: string;
  status: 'placed';
  paymentMethod: 'cod';
  sessionId: string;
  source: CheckoutSession['source'];
  totals: CheckoutSession['totals'];
  lines: CheckoutLine[];
  message: string;
  statusUrl?: string | undefined;
};

export type SessionStore = {
  put(session: CheckoutSession): Promise<void>;
  get(sessionId: string): Promise<CheckoutSession | null>;
  /** Removes the session and its order lock. */
  delete(sessionId: string): Promise<void>;
  /** Atomically takes the one-order-per-session lock. False when another request holds it. */
  claim(sessionId: string): Promise<boolean>;
  release(sessionId: string): Promise<void>;
  getPlaced(sessionId: string): Promise<PlacedOrder | null>;
  setPlaced(sessionId: string, order: PlacedOrder): Promise<void>;
};

/** Sessions expire this long after their last write; override with CHECKOUT_SESSION_TTL_SECONDS. */
function sessionTtlSeconds(): number {
  const raw = Number(process.env['CHECKOUT_SESSION_TTL_SECONDS']);
  return Number.isFinite(raw) && raw >= 60 ? Math.floor(raw) : 30 * 60;
}

const ORDER_LOCK_TTL_SECONDS = 60;
const PLACED_ORDER_TTL_SECONDS = 15 * 60;

type MemorySessionState = {
  sessions: Map<string, { value: CheckoutSession; expiresAt: number }>;
  locks: Map<string, number>;
  placed: Map<string, { value: PlacedOrder; expiresAt: number }>;
};

function newMemoryState(): MemorySessionState {
  return { sessions: new Map(), locks: new Map(), placed: new Map() };
}

/**
 * Dev/test fallback used when REDIS_URL is unset. Survives Vite HMR via globalThis so
 * sessions are not wiped while a checkout modal is open.
 */
const sharedMemoryState: MemorySessionState =
  (globalThis as typeof globalThis & { __ecSessionState?: MemorySessionState }).__ecSessionState ??
  newMemoryState();
(globalThis as typeof globalThis & { __ecSessionState?: MemorySessionState }).__ecSessionState =
  sharedMemoryState;

export function createMemorySessionStore(
  state: MemorySessionState = newMemoryState(),
): SessionStore {
  const live = <T extends { expiresAt: number }>(entry: T | undefined) =>
    entry && entry.expiresAt > Date.now() ? entry : undefined;
  return {
    async put(session) {
      state.sessions.set(session.sessionId, {
        value: session,
        expiresAt: Date.now() + sessionTtlSeconds() * 1000,
      });
    },
    async get(sessionId) {
      return live(state.sessions.get(sessionId))?.value ?? null;
    },
    async delete(sessionId) {
      state.sessions.delete(sessionId);
      state.locks.delete(sessionId);
    },
    async claim(sessionId) {
      const lockedUntil = state.locks.get(sessionId) ?? 0;
      if (lockedUntil > Date.now()) return false;
      state.locks.set(sessionId, Date.now() + ORDER_LOCK_TTL_SECONDS * 1000);
      return true;
    },
    async release(sessionId) {
      state.locks.delete(sessionId);
    },
    async getPlaced(sessionId) {
      return live(state.placed.get(sessionId))?.value ?? null;
    },
    async setPlaced(sessionId, order) {
      state.placed.set(sessionId, {
        value: order,
        expiresAt: Date.now() + PLACED_ORDER_TTL_SECONDS * 1000,
      });
    },
  };
}

const SESSION_KEY = 'ec:sess:';
const LOCK_KEY = 'ec:sess-lock:';
const PLACED_KEY = 'ec:sess-placed:';

/** Redis-backed store: the source of truth for live checkout sessions. */
export function createRedisSessionStore(redis: Redis): SessionStore {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      console.error('[EasyCheckout] session store error', (error as Error).message);
      throw new Error('SESSION_STORE_UNAVAILABLE');
    }
  };
  return {
    put: (session) =>
      guard(async () => {
        await redis.set(
          SESSION_KEY + session.sessionId,
          JSON.stringify(session),
          'EX',
          sessionTtlSeconds(),
        );
      }),
    get: (sessionId) =>
      guard(async () => {
        const raw = await redis.get(SESSION_KEY + sessionId);
        return raw ? (JSON.parse(raw) as CheckoutSession) : null;
      }),
    delete: (sessionId) =>
      guard(async () => {
        await redis.del(SESSION_KEY + sessionId, LOCK_KEY + sessionId);
      }),
    claim: (sessionId) =>
      guard(async () => {
        const result = await redis.set(
          LOCK_KEY + sessionId,
          '1',
          'EX',
          ORDER_LOCK_TTL_SECONDS,
          'NX',
        );
        return result === 'OK';
      }),
    release: (sessionId) =>
      guard(async () => {
        await redis.del(LOCK_KEY + sessionId);
      }),
    getPlaced: (sessionId) =>
      guard(async () => {
        const raw = await redis.get(PLACED_KEY + sessionId);
        return raw ? (JSON.parse(raw) as PlacedOrder) : null;
      }),
    setPlaced: (sessionId, order) =>
      guard(async () => {
        await redis.set(
          PLACED_KEY + sessionId,
          JSON.stringify(order),
          'EX',
          PLACED_ORDER_TTL_SECONDS,
        );
      }),
  };
}

export interface MongoCheckoutSessionDoc {
  _id: string; // sessionId
  shop: string;
  session: CheckoutSession;
  expiresAt: Date;
  updatedAt: Date;
  orderLockUntil?: Date | undefined;
  placedOrder?: PlacedOrder | undefined;
  placedExpiresAt?: Date | undefined;
}

export type MongoDatabaseLike = {
  collection(name: string): {
    createIndex(spec: Record<string, unknown>, options?: Record<string, unknown>): Promise<string>;
    updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: { upsert?: boolean },
    ): Promise<{ matchedCount: number; modifiedCount?: number }>;
    findOne(filter: Record<string, unknown>): Promise<MongoCheckoutSessionDoc | null>;
    deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  };
};

let mongoSessionIndexesEnsured = false;
async function ensureMongoSessionIndexes(
  col: ReturnType<MongoDatabaseLike['collection']>,
): Promise<void> {
  if (mongoSessionIndexesEnsured) return;
  mongoSessionIndexesEnsured = true;
  try {
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_sessions' });
    await col.createIndex({ shop: 1, _id: 1 }, { name: 'idx_shop_sessionId' });
  } catch (err) {
    console.warn('[MongoSessionStore] Index creation note:', (err as Error).message);
  }
}

/** MongoDB-backed store: durable session storage across application restarts and cluster nodes. */
export function createMongoSessionStore(db: MongoDatabaseLike): SessionStore {
  const col = db.collection('checkoutSessions');
  void ensureMongoSessionIndexes(col);

  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      console.error('[EasyCheckout] mongo session store error', (error as Error).message);
      throw new Error('SESSION_STORE_UNAVAILABLE');
    }
  };

  return {
    put: (session) =>
      guard(async () => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + sessionTtlSeconds() * 1000);
        await col.updateOne(
          { _id: session.sessionId },
          {
            $set: {
              shop: session.shop,
              session,
              expiresAt,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }),
    get: (sessionId) =>
      guard(async () => {
        const now = new Date();
        const doc = await col.findOne({ _id: sessionId, expiresAt: { $gt: now } });
        return doc ? doc.session : null;
      }),
    delete: (sessionId) =>
      guard(async () => {
        await col.deleteOne({ _id: sessionId });
      }),
    claim: (sessionId) =>
      guard(async () => {
        const now = new Date();
        const lockUntil = new Date(now.getTime() + ORDER_LOCK_TTL_SECONDS * 1000);
        const res = await col.updateOne(
          {
            _id: sessionId,
            $or: [{ orderLockUntil: { $exists: false } }, { orderLockUntil: { $lte: now } }],
          },
          { $set: { orderLockUntil: lockUntil } },
        );
        return res.matchedCount > 0;
      }),
    release: (sessionId) =>
      guard(async () => {
        await col.updateOne({ _id: sessionId }, { $unset: { orderLockUntil: '' } });
      }),
    getPlaced: (sessionId) =>
      guard(async () => {
        const now = new Date();
        const doc = await col.findOne({
          _id: sessionId,
          placedExpiresAt: { $gt: now },
        });
        return doc?.placedOrder ?? null;
      }),
    setPlaced: (sessionId, order) =>
      guard(async () => {
        const now = new Date();
        const placedExpiresAt = new Date(now.getTime() + PLACED_ORDER_TTL_SECONDS * 1000);
        await col.updateOne(
          { _id: sessionId },
          {
            $set: {
              placedOrder: order,
              placedExpiresAt,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }),
  };
}

let defaultStore: SessionStore | undefined;
export function getCheckoutSessionStore(): SessionStore {
  if (defaultStore) return defaultStore;
  const redis = process.env['NODE_ENV'] === 'test' ? null : getRedis();
  if (redis) {
    defaultStore = createRedisSessionStore(redis);
  } else {
    if (process.env['NODE_ENV'] !== 'test') {
      console.warn('[EasyCheckout] REDIS_URL unset: using in-memory checkout sessions (dev only)');
    }
    defaultStore = createMemorySessionStore(sharedMemoryState);
  }
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
    if (
      typeof item.compareAtAmountMinor === 'number' &&
      Number.isFinite(item.compareAtAmountMinor)
    ) {
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
  const subtotal = subtotalOf(session);
  const totalQty = session.lines.reduce((sum, l) => sum + (l.quantity || 1), 0);

  if (!session.coupons?.length) {
    if (session.coupon) {
      if (
        (session.coupon.minSubtotalMinor && subtotal < session.coupon.minSubtotalMinor) ||
        (session.coupon.minQuantity && totalQty < session.coupon.minQuantity)
      ) {
        delete session.coupon;
        delete session.couponCode;
        return;
      }
      session.coupon.discountMinor = computeCouponDiscountMinor(session.coupon, subtotal);
    }
    return;
  }

  // Filter out any coupons whose minimum requirement is no longer met
  session.coupons = session.coupons.filter((c) => {
    if (c.minSubtotalMinor && subtotal < c.minSubtotalMinor) return false;
    if (c.minQuantity && totalQty < c.minQuantity) return false;
    return true;
  });

  if (!session.coupons.length) {
    delete session.couponCode;
    delete session.coupon;
    delete session.coupons;
    return;
  }

  let remaining = subtotal;
  for (const coupon of session.coupons) {
    coupon.discountMinor = Math.min(remaining, computeCouponDiscountMinor(coupon, subtotal));
    remaining -= coupon.discountMinor;
  }
  const discountMinor = subtotal - remaining;
  session.couponCode = session.coupons.map((c) => c.code).join(' + ');
  session.coupon =
    session.coupons.length === 1
      ? { ...session.coupons[0]! }
      : {
          code: session.couponCode,
          kind: 'fixed',
          value: discountMinor,
          discountMinor,
          summary: session.coupons.map((c) => c.summary).join(' + '),
        };
}

function couponsCombine(a: SessionCoupon, b: SessionCoupon): boolean {
  const keys = {
    ORDER: 'orderDiscounts',
    PRODUCT: 'productDiscounts',
    SHIPPING: 'shippingDiscounts',
  } as const;
  if (!a.discountClass || !b.discountClass) return false;
  // Product combinations need line-level eligibility/allocation support.
  if (a.discountClass === 'PRODUCT' || b.discountClass === 'PRODUCT') return false;
  if (a.discountClass === 'SHIPPING' && b.discountClass === 'SHIPPING') return false;
  return !!a.combinesWith?.[keys[b.discountClass]] && !!b.combinesWith?.[keys[a.discountClass]];
}

function recomputeTotals(session: CheckoutSession): CheckoutSession['totals'] {
  const subtotalMinor = subtotalOf(session);
  refreshCouponAmount(session);
  const cartDiscount = Math.max(0, Math.round(session.cartDiscountMinor || 0));
  const couponDiscount = Math.max(0, Math.round(session.coupon?.discountMinor || 0));
  const discountMinor = Math.min(subtotalMinor, cartDiscount + couponDiscount);
  let shippingMinor = session.shipping?.priceMinor ?? 0;
  if (
    session.coupon?.kind === 'free_shipping' ||
    session.coupons?.some((c) => c.kind === 'free_shipping')
  )
    shippingMinor = 0;
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
    coupons: (session.coupons || (session.coupon ? [session.coupon] : [])).map(
      ({ code, kind, summary, discountMinor }) => ({ code, kind, summary, discountMinor }),
    ),
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
    lineQuantity?: {
      variantId?: string;
      lineKey?: string;
      quantity: number;
    };
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
    const pinChanged = !session.address || session.address.postalCode !== patch.address.postalCode;
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

    // Invalidate prior shipping quote and re-evaluate COD delivery serviceability if PIN changed
    if (pinChanged && nextAddress.postalCode) {
      const pin = nextAddress.postalCode;
      const serviceable = /^[1-9]\d{5}$/.test(pin);
      session.shipping = {
        id: 'standard',
        handleName: 'Standard',
        priceMinor: 0,
        codEnabled: serviceable,
        codExtraMinor: 0,
        selected: true,
        etdText: serviceable ? 'Quick delivery to your PIN' : 'Not serviceable for COD',
      };
    }
  }
  if (typeof patch.couponCode === 'string') {
    const code = patch.couponCode.trim().slice(0, 40);
    if (!code) {
      delete session.couponCode;
      delete session.coupon;
      delete session.coupons;
    } else {
      const resolve = options.resolveCoupon || resolveShopifyCoupon;
      const resolved = await resolve({
        shop: session.shop,
        code,
        subtotalMinor: subtotalOf(session),
      });
      const existing = session.coupons || (session.coupon ? [session.coupon] : []);
      const others = existing.filter((c) => c.code.toUpperCase() !== resolved.code.toUpperCase());
      // Refresh the saved rules too, so merchant changes are respected on the next apply.
      const refreshed = await Promise.all(
        others.map((c) =>
          resolve({
            shop: session.shop,
            code: c.code,
            subtotalMinor: subtotalOf(session),
          }),
        ),
      );
      if (refreshed.some((c) => !couponsCombine(c, resolved))) {
        throw new Error('COUPON_COMBINATION_NOT_ALLOWED');
      }
      if ([...refreshed, resolved].filter((c) => c.kind !== 'free_shipping').length > 5) {
        throw new Error('COUPON_LIMIT_REACHED');
      }
      session.coupons = [...refreshed, resolved];
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
    delete session.coupons;
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
    delete session.coupons;
    session.couponCode = 'LOYALTY';
    session.coupon = {
      code: 'LOYALTY',
      kind: 'fixed',
      value: discountMinor,
      discountMinor,
      summary: `${points} loyalty points`,
    };
  }

  if (patch.lineQuantity) {
    const { variantId, lineKey, quantity } = patch.lineQuantity;
    const match = session.lines.find(
      (l) =>
        (lineKey && l.lineKey === lineKey) ||
        (variantId && String(l.variantId) === String(variantId)) ||
        (variantId &&
          l.variantId &&
          String(l.variantId).replace(/\D/g, '') !== '' &&
          String(l.variantId).replace(/\D/g, '') === String(variantId).replace(/\D/g, '')),
    );
    if (match) {
      if (quantity <= 0) {
        if (session.lines.length > 1) {
          session.lines = session.lines.filter((l) => l !== match);
        }
      } else {
        match.quantity = Math.max(1, Math.min(99, quantity));
      }
    }
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

function logStoreError(error: unknown) {
  console.error('[EasyCheckout] post-order session cleanup failed', (error as Error).message);
}

export type PlaceCodOrderOptions = {
  /** Shop from the verified app-proxy request; the session must belong to it. */
  shop?: string;
  customerId?: string;
  /** Injected in tests — defaults to Shopify Admin orderCreate. */
  createOrder?: typeof import('./shopify-cod-order.server').createCodOrderInShopify;
};

export async function placeCodFromSession(
  sessionId: string,
  address: CheckoutAddress,
  store: SessionStore = getCheckoutSessionStore(),
  options: PlaceCodOrderOptions = {},
): Promise<PlacedOrder> {
  const existing = await store.get(sessionId);
  if (!existing || (options.shop && existing.shop !== options.shop)) {
    // Check if it was already placed in a previous session
    const attempt = await findAttemptBySessionId(options.shop || '', sessionId);
    if (
      attempt?.status === 'CONFIRMED' &&
      attempt.shopifyOrderId &&
      attempt.shopifyOrderName &&
      attempt.shopifyOrderGid
    ) {
      return {
        orderId: attempt.shopifyOrderId,
        orderName: attempt.shopifyOrderName,
        orderGid: attempt.shopifyOrderGid,
        status: 'placed',
        paymentMethod: 'cod',
        sessionId,
        source: 'cart',
        totals: {
          currency: 'INR',
          subtotalMinor: attempt.expectedAmountMinor,
          discountMinor: 0,
          shippingMinor: 0,
          codFeeMinor: 0,
          amountMinor: attempt.expectedAmountMinor,
        },
        lines: [],
        statusUrl: attempt.shopifyOrderStatusUrl || undefined,
        message: `Order ${attempt.shopifyOrderName} placed. Pay cash on delivery.`,
      };
    }
    const alreadyPlaced = await store.getPlaced(sessionId);
    if (alreadyPlaced) return alreadyPlaced;
    throw new Error('SESSION_NOT_FOUND');
  }

  // Resolve merchant, brand & store context
  const { resolveMerchantStoreContext } = await import('./merchant-hierarchy.server');
  const context = await resolveMerchantStoreContext(existing.shop);

  // Validate customer store-specific risk flags if customer identified
  if (options.customerId) {
    const { getStoreCustomerProfile } = await import('./universal-customer.server');
    const storeProfile = await getStoreCustomerProfile(
      options.customerId,
      context.store._id,
      context.merchant._id,
      context.brand._id,
    );
    if (storeProfile.flags.blocked) {
      throw new Error('CUSTOMER_BLOCKED');
    }
    if (storeProfile.flags.codDisabled || storeProfile.flags.prepaidOnly) {
      throw new Error('NOT_SERVICEABLE');
    }
  }

  // Create or retrieve persistent order attempt record
  const { attempt } = await createOrGetOrderAttempt({
    shop: existing.shop,
    checkoutSessionId: sessionId,
    expectedAmountMinor: existing.totals.amountMinor,
    customerId: options.customerId,
    merchantId: context.merchant._id,
    brandId: context.brand._id,
    storeId: context.store._id,
    payload: {
      shop: existing.shop,
      address,
      lines: existing.lines,
      totals: existing.totals,
      coupon: existing.coupon,
    },
  });

  // If already confirmed in MongoDB, return the confirmed order immediately!
  if (
    attempt.status === 'CONFIRMED' &&
    attempt.shopifyOrderId &&
    attempt.shopifyOrderName &&
    attempt.shopifyOrderGid
  ) {
    const placed: PlacedOrder = {
      orderId: attempt.shopifyOrderId,
      orderName: attempt.shopifyOrderName,
      orderGid: attempt.shopifyOrderGid,
      status: 'placed',
      paymentMethod: 'cod',
      sessionId,
      source: existing.source,
      totals: existing.totals,
      lines: existing.lines,
      statusUrl: attempt.shopifyOrderStatusUrl || undefined,
      message: `Order ${attempt.shopifyOrderName} placed. Pay cash on delivery.`,
    };
    await store.setPlaced(sessionId, placed).catch(logStoreError);
    return placed;
  }

  // If attempt is currently in an unknown/ambiguous state, reconcile against Shopify first!
  if (attempt.status === 'UNKNOWN' || attempt.status === 'RECONCILING') {
    const { getShopOfflineAccessToken } = await import('./shopify-cod-order.server');
    const token = await getShopOfflineAccessToken(existing.shop);
    if (token) {
      const recon = await reconcileCheckoutAttempt(existing.shop, token, sessionId);
      if (recon.status === 'CONFIRMED') {
        const placed: PlacedOrder = {
          orderId: recon.order.orderId,
          orderName: recon.order.orderName,
          orderGid: recon.order.orderGid,
          status: 'placed',
          paymentMethod: 'cod',
          sessionId,
          source: existing.source,
          totals: existing.totals,
          lines: existing.lines,
          statusUrl: recon.order.statusUrl || attempt.shopifyOrderStatusUrl || undefined,
          message: `Order ${recon.order.orderName} placed. Pay cash on delivery.`,
        };
        await store.setPlaced(sessionId, placed).catch(logStoreError);
        return placed;
      }
    }
    throw new OrderReconciliationRequiredError(
      'Order creation status is ambiguous. Verifying with Shopify.',
      attempt,
    );
  }

  // Atomically claim the attempt in MongoDB (and temp Redis claim)
  await claimAttemptForCreation(attempt._id);
  if (!(await store.claim(sessionId))) {
    throw new OrderInProgressError('ORDER_IN_PROGRESS', 'CREATING');
  }

  try {
    const session = await patchCheckoutSession(sessionId, { address }, store);
    if (!session.shipping?.codEnabled) {
      await markAttemptFailed(attempt._id, {
        code: 'NOT_SERVICEABLE',
        message: 'COD is not serviceable for this address',
      });
      throw new Error('NOT_SERVICEABLE');
    }

    const createOrder =
      options.createOrder || (await import('./shopify-cod-order.server')).createCodOrderInShopify;

    let shopifyOrder;
    try {
      shopifyOrder = await createOrder({
        shop: session.shop,
        checkoutSessionId: sessionId,
        address,
        lines: session.lines,
        totals: session.totals,
        ...(session.coupon ? { coupon: session.coupon } : {}),
        ...(options.customerId ? { customerId: options.customerId } : {}),
        shippingTitle: session.shipping?.handleName,
      });
    } catch (error) {
      if (error instanceof AmbiguousShopifyError) {
        // Ambiguous failure: network timeout / socket drop. Mark UNKNOWN. Do NOT retry!
        await markAttemptUnknown(attempt._id, {
          code: 'AMBIGUOUS_EXECUTION',
          message: error.message,
        });
        // Try immediate inline reconciliation
        const { getShopOfflineAccessToken } = await import('./shopify-cod-order.server');
        const token = await getShopOfflineAccessToken(session.shop);
        if (token) {
          const recon = await reconcileCheckoutAttempt(session.shop, token, sessionId);
          if (recon.status === 'CONFIRMED') {
            shopifyOrder = {
              orderId: recon.order.orderId,
              orderName: recon.order.orderName,
              orderGid: recon.order.orderGid,
            };
          } else {
            throw new OrderReconciliationRequiredError(
              'Order confirmation in progress with Shopify.',
              attempt,
            );
          }
        } else {
          throw new OrderReconciliationRequiredError(
            'Order confirmation in progress with Shopify.',
            attempt,
          );
        }
      } else {
        const code = error instanceof Error ? error.message : 'ORDER_CREATE_FAILED';
        await markAttemptFailed(attempt._id, {
          code,
          message: error instanceof Error ? error.message : 'Order create failed',
        });
        throw error;
      }
    }

    // Mark attempt CONFIRMED durably in MongoDB
    await markAttemptConfirmed(attempt._id, {
      shopifyOrderGid: shopifyOrder.orderGid,
      shopifyOrderId: shopifyOrder.orderId,
      shopifyOrderName: shopifyOrder.orderName,
      shopifyOrderTotalMinor: session.totals.amountMinor,
      shopifyOrderStatusUrl: shopifyOrder.statusUrl,
    });

    const placed: PlacedOrder = {
      orderId: shopifyOrder.orderId,
      orderName: shopifyOrder.orderName,
      orderGid: shopifyOrder.orderGid,
      status: 'placed',
      paymentMethod: 'cod',
      sessionId,
      source: session.source,
      totals: session.totals,
      lines: session.lines,
      statusUrl: shopifyOrder.statusUrl,
      message: `Order ${shopifyOrder.orderName} placed. Pay cash on delivery.`,
    };

    await store.setPlaced(sessionId, placed).catch(logStoreError);
    await store.delete(sessionId).catch(logStoreError);
    return placed;
  } catch (error) {
    if (!(error instanceof OrderReconciliationRequiredError)) {
      await store.release(sessionId).catch(() => undefined);
    }
    throw error;
  }
}
