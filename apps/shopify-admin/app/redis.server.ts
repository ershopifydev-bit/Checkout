import { Redis } from 'ioredis';

type RedisGlobal = typeof globalThis & { __ecRedis?: Redis };

/**
 * Shared Redis client. Returns null only outside production when REDIS_URL is unset
 * (callers then fall back to in-process memory). Production without REDIS_URL throws,
 * so checkout fails closed instead of silently using per-process state.
 */
export function getRedis(): Redis | null {
  const url = process.env['REDIS_URL'];
  if (!url) {
    if (process.env['NODE_ENV'] === 'production') throw new Error('SESSION_STORE_UNAVAILABLE');
    return null;
  }
  const globals = globalThis as RedisGlobal;
  if (!globals.__ecRedis) {
    const client = new Redis(url, { maxRetriesPerRequest: 2 });
    client.on('error', (error: Error) => {
      console.error('[EasyCheckout] redis error', error.message);
    });
    globals.__ecRedis = client;
  }
  return globals.__ecRedis;
}
