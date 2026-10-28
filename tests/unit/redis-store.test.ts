import { afterAll, describe, expect, it } from 'vitest';
import {
  createCheckoutSession,
  createRedisSessionStore,
  placeCodFromSession,
  quoteCheckoutSession,
} from '../../apps/shopify-admin/app/checkout-session.server';
import { createRedisRateLimiter } from '../../apps/shopify-admin/app/rate-limit.server';
import { getRedis } from '../../apps/shopify-admin/app/redis.server';

// Runs only when a Redis is available: REDIS_TEST_URL=redis://127.0.0.1:6379 pnpm test
const url = process.env['REDIS_TEST_URL'];

describe.skipIf(!url)('redis session store and rate limiter', () => {
  const redis = url ? getRedis()! : (null as never);
  afterAll(() => redis?.quit());

  it('stores sessions with a TTL and creates one order for concurrent placements', async () => {
    const store = createRedisSessionStore(redis);
    const created = await createCheckoutSession(
      {
        shop: 'codemadi.myshopify.com',
        source: 'cart',
        lines: [{ title: 'Chair', variantTitle: 'Black', quantity: 1, price: 14999 }],
      },
      store,
    );
    expect(await redis.ttl(`ec:sess:${created.sessionId}`)).toBeGreaterThan(0);
    await quoteCheckoutSession(created.sessionId, { postalCode: '401105' }, store);

    let orders = 0;
    const createOrder = async () => {
      orders += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { orderGid: 'gid://shopify/Order/1', orderId: '1', orderName: '#1001' };
    };
    const address = {
      phone: '8268195957',
      fullName: 'Ada Lovelace',
      addressLine1: '1 Test Street',
      locality: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '401105',
    };
    await Promise.allSettled([
      placeCodFromSession(created.sessionId, address, store, { createOrder }),
      placeCodFromSession(created.sessionId, address, store, { createOrder }),
    ]);
    expect(orders).toBe(1);
    expect(await store.get(created.sessionId)).toBeNull();
    expect((await store.getPlaced(created.sessionId))?.orderName).toBe('#1001');
  });

  it('counts hits and sets an expiry on the counter', async () => {
    const limiter = createRedisRateLimiter(redis);
    const key = `ec:rl:test:${Date.now()}`;
    expect((await limiter.hit(key, 30)).count).toBe(1);
    const second = await limiter.hit(key, 30);
    expect(second.count).toBe(2);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(30);
    await redis.del(key);
  });
});
