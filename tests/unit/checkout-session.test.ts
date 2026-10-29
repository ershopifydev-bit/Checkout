import { describe, expect, it, vi } from 'vitest';
import {
  createCheckoutSession,
  createMemorySessionStore,
  createMongoSessionStore,
  getCheckoutSession,
  patchCheckoutSession,
  placeCodFromSession,
  publicSessionView,
  quoteCheckoutSession,
  type MongoCheckoutSessionDoc,
  type MongoDatabaseLike,
  type PlacedOrder,
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

  it('retains compatible coupons, avoids duplicates, and preserves them on rejection', async () => {
    const store = createMemorySessionStore();
    const session = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'buy_now',
        lines: [{ title: 'Bag', quantity: 1, amountMinor: 100000 }],
      },
      store,
    );
    const resolveCoupon = async ({ code }: { code: string }) => ({
      code,
      kind: 'fixed' as const,
      value: 10000,
      discountMinor: 10000,
      summary: 'Save ₹100',
      discountClass: 'ORDER' as const,
      combinesWith: {
        orderDiscounts: code !== 'NO',
        productDiscounts: false,
        shippingDiscounts: true,
      },
    });
    await patchCheckoutSession(session.sessionId, { couponCode: 'ONE' }, store, { resolveCoupon });
    const combined = await patchCheckoutSession(session.sessionId, { couponCode: 'TWO' }, store, {
      resolveCoupon,
    });
    expect(combined.totals.discountMinor).toBe(20000);
    expect(publicSessionView(combined).coupons.map((c) => c.code)).toEqual(['ONE', 'TWO']);
    const duplicate = await patchCheckoutSession(session.sessionId, { couponCode: 'one' }, store, {
      resolveCoupon,
    });
    expect(duplicate.totals.discountMinor).toBe(20000);
    await expect(
      patchCheckoutSession(session.sessionId, { couponCode: 'NO' }, store, { resolveCoupon }),
    ).rejects.toThrow('COUPON_COMBINATION_NOT_ALLOWED');
    expect((await getCheckoutSession(session.sessionId, store))?.totals.discountMinor).toBe(20000);
    const cleared = await patchCheckoutSession(session.sessionId, { couponCode: '' }, store);
    expect(publicSessionView(cleared).coupons).toEqual([]);
    expect(cleared.totals.discountMinor).toBe(0);
  });

  it('combines percentage and shipping codes, recalculates quantities, and caps savings', async () => {
    const store = createMemorySessionStore();
    const session = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'buy_now',
        lines: [{ variantId: '123', title: 'Bag', quantity: 1, amountMinor: 100000 }],
      },
      store,
    );
    const resolveCoupon = async ({ code }: { code: string }) => ({
      code,
      kind: code === 'SHIP' ? ('free_shipping' as const) : ('percentage' as const),
      value: code === 'SHIP' ? 0 : 60,
      discountMinor: 0,
      summary: code,
      discountClass: code === 'SHIP' ? ('SHIPPING' as const) : ('ORDER' as const),
      combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
    });
    await patchCheckoutSession(session.sessionId, { couponCode: 'SIXTY' }, store, {
      resolveCoupon,
    });
    const combined = await patchCheckoutSession(session.sessionId, { couponCode: 'SHIP' }, store, {
      resolveCoupon,
    });
    expect(combined.totals.discountMinor).toBe(60000);
    expect(combined.totals.shippingMinor).toBe(0);
    expect(combined.coupon).toMatchObject({
      kind: 'fixed',
      discountMinor: 60000,
      code: 'SIXTY + SHIP',
    });
    const resized = await patchCheckoutSession(
      session.sessionId,
      { lineQuantity: { variantId: '123', quantity: 2 } },
      store,
    );
    expect(resized.totals.discountMinor).toBe(120000);
    const capped = await patchCheckoutSession(session.sessionId, { couponCode: 'MORE' }, store, {
      resolveCoupon,
    });
    expect(capped.totals.discountMinor).toBe(200000);
    expect(capped.totals.amountMinor).toBe(0);
  });

  it('updates line quantity and recomputes totals when patched with lineQuantity', async () => {
    const store = createMemorySessionStore();
    const session = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'buy_now',
        lines: [
          {
            variantId: '12345',
            title: 'Backpack',
            variantTitle: 'Blue',
            quantity: 1,
            amountMinor: 237900,
            compareAtAmountMinor: 400000,
          },
        ],
      },
      store,
    );
    expect(session.lines[0]?.quantity).toBe(1);
    expect(session.totals.subtotalMinor).toBe(237900);

    const patched = await patchCheckoutSession(
      session.sessionId,
      { lineQuantity: { variantId: '12345', quantity: 2 } },
      store,
    );
    expect(patched.lines[0]?.quantity).toBe(2);
    expect(patched.totals.subtotalMinor).toBe(475800);
    expect(patched.totals.amountMinor).toBe(475800);

    // Also handles GID format matching against numeric variantId
    const patchedGid = await patchCheckoutSession(
      session.sessionId,
      { lineQuantity: { variantId: 'gid://shopify/ProductVariant/12345', quantity: 3 } },
      store,
    );
    expect(patchedGid.lines[0]?.quantity).toBe(3);
    expect(patchedGid.totals.subtotalMinor).toBe(713700);
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
          statusUrl: 'https://codemadi.myshopify.com/orders/token123',
        }),
      },
    );
    expect(placed.status).toBe('placed');
    expect(placed.orderName).toBe('#1001');
    expect(placed.statusUrl).toBe('https://codemadi.myshopify.com/orders/token123');
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

  it('invalidates and updates shipping serviceability when address PIN changes', async () => {
    const store = createMemorySessionStore();
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Bag', quantity: 1, price: 1000 }],
      },
      store,
    );

    // Initial address with serviceable PIN
    const patched1 = await patchCheckoutSession(
      created.sessionId,
      {
        address: {
          phone: '9876543210',
          fullName: 'Test User',
          addressLine1: 'Line 1',
          locality: 'Mumbai',
          region: 'Maharashtra',
          postalCode: '400001',
        },
      },
      store,
    );
    expect(patched1.shipping?.codEnabled).toBe(true);
    expect(patched1.shipping?.etdText).toMatch(/quick delivery/i);

    // Update address with unserviceable PIN (starts with 0)
    const patched2 = await patchCheckoutSession(
      created.sessionId,
      {
        address: {
          phone: '9876543210',
          fullName: 'Test User',
          addressLine1: 'Line 1',
          locality: 'Somewhere',
          region: 'State',
          postalCode: '012345',
        },
      },
      store,
    );
    expect(patched2.shipping?.codEnabled).toBe(false);
    expect(patched2.shipping?.etdText).toMatch(/not serviceable/i);
  });

  it('invalidates applied coupon when cart edits drop subtotal below minimum requirement', async () => {
    const store = createMemorySessionStore();
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Shirt', variantId: '101', quantity: 2, price: 1000 }],
      },
      store,
    );

    // Apply coupon requiring ₹1500 minimum spend (subtotal is ₹2000)
    const withCoupon = await patchCheckoutSession(
      created.sessionId,
      { couponCode: 'MIN1500' },
      store,
      {
        resolveCoupon: async () => ({
          code: 'MIN1500',
          kind: 'fixed',
          value: 20000,
          discountMinor: 20000,
          summary: '₹200 off above ₹1500',
          minSubtotalMinor: 150000,
        }),
      },
    );
    expect(withCoupon.coupon?.code).toBe('MIN1500');
    expect(withCoupon.totals.discountMinor).toBe(20000);

    // Reduce quantity to 1 -> new subtotal is ₹1000, below ₹1500 threshold
    const reduced = await patchCheckoutSession(
      created.sessionId,
      { lineQuantity: { variantId: '101', quantity: 1 } },
      store,
    );
    expect(reduced.totals.subtotalMinor).toBe(100000);
    expect(reduced.coupon).toBeUndefined();
    expect(reduced.totals.discountMinor).toBe(0);
  });

  describe('MongoDB session store durability', () => {
    interface MockDoc {
      _id: string;
      shop?: string;
      session?: unknown;
      expiresAt?: Date;
      updatedAt?: Date;
      orderLockUntil?: Date;
      placedOrder?: unknown;
      placedExpiresAt?: Date;
    }

    function createMockMongoDb(): MongoDatabaseLike {
      const docs = new Map<string, MockDoc>();
      const col = {
        createIndex: vi.fn(async () => 'idx'),
        updateOne: vi.fn(
          async (
            filter: Record<string, unknown>,
            update: Record<string, unknown>,
            options?: { upsert?: boolean },
          ) => {
            const id = typeof filter['_id'] === 'string' ? filter['_id'] : '';
            let doc = docs.get(id);
            if (!doc && options?.upsert) {
              doc = { _id: id };
              docs.set(id, doc);
            }
            if (!doc) return { matchedCount: 0, modifiedCount: 0 };

            const orConds = filter['$or'] as
              Array<{ orderLockUntil?: { $exists?: boolean; $lte?: Date } }> | undefined;
            if (orConds) {
              const matches = orConds.some((cond) => {
                if (cond.orderLockUntil?.$exists === false)
                  return doc?.orderLockUntil === undefined;
                if (cond.orderLockUntil?.$lte)
                  return !!doc?.orderLockUntil && doc.orderLockUntil <= cond.orderLockUntil.$lte;
                return false;
              });
              if (!matches) return { matchedCount: 0, modifiedCount: 0 };
            }

            const setFields = update['$set'] as Partial<MockDoc> | undefined;
            if (setFields) Object.assign(doc, setFields);
            const unsetFields = update['$unset'] as Record<string, string> | undefined;
            if (unsetFields) {
              for (const k of Object.keys(unsetFields)) {
                delete (doc as unknown as Record<string, unknown>)[k];
              }
            }
            return { matchedCount: 1, modifiedCount: 1 };
          },
        ),
        findOne: vi.fn(async (filter: Record<string, unknown>) => {
          const id = typeof filter['_id'] === 'string' ? filter['_id'] : '';
          const doc = docs.get(id);
          if (!doc) return null;
          const expGt = (filter['expiresAt'] as { $gt?: Date } | undefined)?.$gt;
          if (expGt && doc.expiresAt && doc.expiresAt <= expGt) return null;
          const placedGt = (filter['placedExpiresAt'] as { $gt?: Date } | undefined)?.$gt;
          if (placedGt && doc.placedExpiresAt && doc.placedExpiresAt <= placedGt) return null;
          return doc as unknown as MongoCheckoutSessionDoc;
        }),
        deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
          const id = typeof filter['_id'] === 'string' ? filter['_id'] : '';
          docs.delete(id);
          return { deletedCount: 1 };
        }),
      };
      return {
        collection: vi.fn(() => col),
      };
    }

    it('persists, retrieves, and deletes sessions in MongoDB', async () => {
      const db = createMockMongoDb();
      const mongoStore = createMongoSessionStore(db);

      const session = await createCheckoutSession(
        {
          shop: 'test.myshopify.com',
          source: 'cart',
          lines: [{ title: 'Shirt', quantity: 2, price: 500 }],
        },
        mongoStore,
      );

      const retrieved = await mongoStore.get(session.sessionId);
      expect(retrieved?.sessionId).toBe(session.sessionId);
      expect(retrieved?.lines[0]?.title).toBe('Shirt');

      await mongoStore.delete(session.sessionId);
      expect(await mongoStore.get(session.sessionId)).toBeNull();
    });

    it('handles atomic claim locking, preventing concurrent double orders, and release', async () => {
      const db = createMockMongoDb();
      const mongoStore = createMongoSessionStore(db);

      const session = await createCheckoutSession(
        {
          shop: 'test.myshopify.com',
          source: 'buy_now',
          lines: [{ title: 'Shoes', quantity: 1, price: 1999 }],
        },
        mongoStore,
      );

      // First claim succeeds
      const claimed1 = await mongoStore.claim(session.sessionId);
      expect(claimed1).toBe(true);

      // Concurrent second claim while locked fails
      const claimed2 = await mongoStore.claim(session.sessionId);
      expect(claimed2).toBe(false);

      // After release, claim succeeds again
      await mongoStore.release(session.sessionId);
      const claimed3 = await mongoStore.claim(session.sessionId);
      expect(claimed3).toBe(true);
    });

    it('stores and retrieves placed orders with TTL expiry', async () => {
      const db = createMockMongoDb();
      const mongoStore = createMongoSessionStore(db);

      const placedOrder: PlacedOrder = {
        sessionId: 'sess_123',
        status: 'placed',
        paymentMethod: 'cod',
        orderGid: 'gid://shopify/Order/999',
        orderId: '999',
        orderName: '#1999',
        source: 'cart',
        totals: {
          currency: 'INR',
          subtotalMinor: 100000,
          discountMinor: 0,
          shippingMinor: 0,
          codFeeMinor: 0,
          amountMinor: 100000,
        },
        lines: [],
        message: 'Order created',
      };

      await mongoStore.setPlaced('sess_123', placedOrder);
      const retrieved = await mongoStore.getPlaced('sess_123');
      expect(retrieved?.orderName).toBe('#1999');
    });
  });
});
