import { describe, expect, it, vi } from 'vitest';
import {
  createCheckoutSession,
  createMemorySessionStore,
  getCheckoutSession,
  patchCheckoutSession,
  placeCodFromSession,
  publicSessionView,
  quoteCheckoutSession,
} from '../../apps/shopify-admin/app/checkout-session.server';
import { computeCouponDiscountMinor } from '../../apps/shopify-admin/app/shopify-discount.server';

describe('checkout sessions', () => {
  it('creates a buy_now session from variant lines and recomputes totals', async () => {
    const store = createMemorySessionStore();
    const session = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'buy_now',
        lines: [
          {
            variantId: '123',
            title: 'Echo Dot',
            variantTitle: 'Default',
            quantity: 2,
            price: 4499,
          },
        ],
      },
      store,
    );
    expect(session.sessionId.startsWith('sess_')).toBe(true);
    expect(session.lines[0]?.unitAmount.amountMinor).toBe(449900);
    expect(session.totals.amountMinor).toBe(899800);
    expect(publicSessionView(session).paymentMethod).toBe('cod');
  });

  it('rejects empty merchandise', async () => {
    const store = createMemorySessionStore();
    await expect(
      createCheckoutSession({ shop: 'codemadi.myshopify.com', source: 'cart', lines: [] }, store),
    ).rejects.toThrow('EMPTY_CART');
  });

  it('computes percentage and fixed coupon amounts', () => {
    expect(computeCouponDiscountMinor({ kind: 'percentage', value: 10 }, 100000)).toBe(10000);
    expect(computeCouponDiscountMinor({ kind: 'fixed', value: 25000 }, 100000)).toBe(25000);
    expect(computeCouponDiscountMinor({ kind: 'fixed', value: 25000 }, 10000)).toBe(10000);
    expect(computeCouponDiscountMinor({ kind: 'free_shipping', value: 0 }, 100000)).toBe(0);
  });

  it('applies a coupon on top of cart discounts', async () => {
    const store = createMemorySessionStore();
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        discountMinor: 10000,
        lines: [{ title: 'Bag', variantTitle: 'Default', quantity: 1, amountMinor: 100000 }],
      },
      store,
    );
    const patched = await patchCheckoutSession(created.sessionId, { couponCode: 'SAVE10' }, store, {
      resolveCoupon: async () => ({
        code: 'SAVE10',
        kind: 'percentage',
        value: 10,
        discountMinor: 10000,
        summary: '10% off',
      }),
    });
    expect(patched.coupon?.code).toBe('SAVE10');
    expect(patched.totals.discountMinor).toBe(20000);
    expect(patched.totals.amountMinor).toBe(80000);
    expect(publicSessionView(patched).coupon?.summary).toBe('10% off');

    const cleared = await patchCheckoutSession(created.sessionId, { couponCode: '' }, store);
    expect(cleared.coupon).toBeUndefined();
    expect(cleared.totals.discountMinor).toBe(10000);
    expect(cleared.totals.amountMinor).toBe(90000);
  });

  it('keeps cart discounts, sku, and line savings on the session', async () => {
    const store = createMemorySessionStore();
    const session = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        discountMinor: 50000,
        lines: [
          {
            title: 'Echo Dot',
            variantTitle: 'Black',
            sku: 'ECHO-3',
            quantity: 2,
            amountMinor: 449900,
            compareAtAmountMinor: 499900,
            lineDiscountMinor: 20000,
            imageUrl: 'https://cdn.example/echo.jpg',
          },
        ],
      },
      store,
    );
    expect(session.lines[0]?.sku).toBe('ECHO-3');
    expect(session.lines[0]?.lineDiscountMinor).toBe(20000);
    expect(session.lines[0]?.compareAtAmountMinor).toBe(499900);
    expect(session.totals.subtotalMinor).toBe(899800);
    expect(session.totals.discountMinor).toBe(50000);
    expect(session.totals.amountMinor).toBe(849800);
  });

  it('quotes serviceability from PIN and places COD from the same session', async () => {
    const store = createMemorySessionStore();
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Chair', variantTitle: 'Black', quantity: 1, price: 14999 }],
      },
      store,
    );
    const quoted = await quoteCheckoutSession(created.sessionId, { postalCode: '401105' }, store);
    expect(quoted.shipping?.codEnabled).toBe(true);
    expect(quoted.shipping?.etdText).toMatch(/PIN/i);

    const placed = await placeCodFromSession(
      created.sessionId,
      {
        phone: '8268195957',
        fullName: 'Ada Lovelace',
        addressLine1: '1 Test Street',
        locality: 'Mumbai',
        region: 'Maharashtra',
        postalCode: '401105',
      },
      store,
      {
        createOrder: async () => ({
          orderGid: 'gid://shopify/Order/1',
          orderId: '1',
          orderName: '#1001',
        }),
      },
    );
    expect(placed.status).toBe('placed');
    expect(placed.orderName).toBe('#1001');
    expect(placed.totals.amountMinor).toBe(1499900);
    expect(await store.get(created.sessionId)).toBeNull();
  });

  it('keeps the session when Shopify orderCreate fails', async () => {
    const store = createMemorySessionStore();
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Chair', variantTitle: 'Black', quantity: 1, price: 14999 }],
      },
      store,
    );
    await quoteCheckoutSession(created.sessionId, { postalCode: '401105' }, store);
    await expect(
      placeCodFromSession(
        created.sessionId,
        {
          phone: '8268195957',
          fullName: 'Ada Lovelace',
          addressLine1: '1 Test Street',
          locality: 'Mumbai',
          region: 'Maharashtra',
          postalCode: '401105',
        },
        store,
        {
          createOrder: async () => {
            throw new Error('ORDER_CREATE_FAILED');
          },
        },
      ),
    ).rejects.toThrow('ORDER_CREATE_FAILED');
    expect(await store.get(created.sessionId)).not.toBeNull();
  });

  it('isolates memory sessions per created store instance', async () => {
    const storeA = createMemorySessionStore();
    const storeB = createMemorySessionStore();
    const session = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Chair', variantTitle: 'Black', quantity: 1, price: 14999 }],
      },
      storeA,
    );
    expect(await storeA.get(session.sessionId)).not.toBeNull();
    expect(await storeB.get(session.sessionId)).toBeNull();
  });

  it('stores and retrieves sessions using default store', async () => {
    const session = await createCheckoutSession({
      shop: 'codemadi.myshopify.com',
      source: 'buy_now',
      lines: [{ variantId: '123', title: 'Chair', quantity: 1, price: 14999 }],
    });
    const retrieved = await getCheckoutSession(session.sessionId);
    expect(retrieved?.sessionId).toBe(session.sessionId);
    expect(retrieved?.lines[0]?.title).toBe('Chair');
  });
});

describe('place COD safety', () => {
  const address = {
    phone: '8268195957',
    fullName: 'Ada Lovelace',
    addressLine1: '1 Test Street',
    locality: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '401105',
  };
  const shopifyOrder = { orderGid: 'gid://shopify/Order/1', orderId: '1', orderName: '#1001' };

  async function quotedSession(store = createMemorySessionStore()) {
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Chair', variantTitle: 'Black', quantity: 1, price: 14999 }],
      },
      store,
    );
    await quoteCheckoutSession(created.sessionId, { postalCode: '401105' }, store);
    return { store, sessionId: created.sessionId };
  }

  it('errors without creating an order when the session does not exist', async () => {
    const createOrder = vi.fn(async () => shopifyOrder);
    await expect(
      placeCodFromSession('sess_missing', address, createMemorySessionStore(), { createOrder }),
    ).rejects.toThrow('SESSION_NOT_FOUND');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects a session that belongs to another shop', async () => {
    const { store, sessionId } = await quotedSession();
    const createOrder = vi.fn(async () => shopifyOrder);
    await expect(
      placeCodFromSession(sessionId, address, store, { createOrder, shop: 'other.myshopify.com' }),
    ).rejects.toThrow('SESSION_NOT_FOUND');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('creates exactly one order for concurrent requests on the same session', async () => {
    const { store, sessionId } = await quotedSession();
    const createOrder = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return shopifyOrder;
    });
    const results = await Promise.allSettled([
      placeCodFromSession(sessionId, address, store, { createOrder }),
      placeCodFromSession(sessionId, address, store, { createOrder }),
      placeCodFromSession(sessionId, address, store, { createOrder }),
    ]);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason.message === 'ORDER_IN_PROGRESS'),
    ).toHaveLength(2);
  });

  it('replays the placed order on retry instead of creating another', async () => {
    const { store, sessionId } = await quotedSession();
    const createOrder = vi.fn(async () => shopifyOrder);
    const first = await placeCodFromSession(sessionId, address, store, { createOrder });
    const second = await placeCodFromSession(sessionId, address, store, { createOrder });
    expect(second).toEqual(first);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after Shopify orderCreate fails', async () => {
    const { store, sessionId } = await quotedSession();
    await expect(
      placeCodFromSession(sessionId, address, store, {
        createOrder: async () => {
          throw new Error('ORDER_CREATE_FAILED');
        },
      }),
    ).rejects.toThrow('ORDER_CREATE_FAILED');
    const placed = await placeCodFromSession(sessionId, address, store, {
      createOrder: async () => shopifyOrder,
    });
    expect(placed.orderName).toBe('#1001');
  });

  it('expires sessions after the configured TTL', async () => {
    vi.stubEnv('CHECKOUT_SESSION_TTL_SECONDS', '60');
    vi.useFakeTimers();
    try {
      const { store, sessionId } = await quotedSession();
      expect(await store.get(sessionId)).not.toBeNull();
      vi.advanceTimersByTime(61_000);
      expect(await store.get(sessionId)).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
