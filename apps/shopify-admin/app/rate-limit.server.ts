import type { Redis } from 'ioredis';
import { getRedis } from './redis.server';

/**
 * Per-IP limits for the public app-proxy routes. Every limit is keyed by
 * shop + route group + client IP, so a brand's traffic never counts against another's.
 */
export type RateLimitName =
  | 'sessionCreate'
  | 'sessionRead'
  | 'sessionWrite'
  | 'placeOrder'
  | 'otpRequest'
  | 'otpVerify'
  | 'customer';

export type RateLimitPolicy = { limit: number; windowSeconds: number };

export const DEFAULT_RATE_LIMITS: Record<RateLimitName, RateLimitPolicy> = {
  sessionCreate: { limit: 10, windowSeconds: 60 },
  sessionRead: { limit: 60, windowSeconds: 60 },
  sessionWrite: { limit: 30, windowSeconds: 60 },
  placeOrder: { limit: 5, windowSeconds: 60 },
  otpRequest: { limit: 5, windowSeconds: 600 },
  otpVerify: { limit: 10, windowSeconds: 600 },
  customer: { limit: 30, windowSeconds: 60 },
};

export type RateLimitPolicyResolver = (input: {
  shop: string;
  name: RateLimitName;
}) => RateLimitPolicy | Promise<RateLimitPolicy>;

function envKey(name: RateLimitName): string {
  return `RATE_LIMIT_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
}

/** Env override format: RATE_LIMIT_PLACE_ORDER="5/60" (requests/windowSeconds). */
function envPolicy(name: RateLimitName): RateLimitPolicy | null {
  const match = /^(\d+)\/(\d+)$/.exec(process.env[envKey(name)] || '');
  if (!match) return null;
  const limit = Number(match[1]);
  const windowSeconds = Number(match[2]);
  return limit > 0 && windowSeconds > 0 ? { limit, windowSeconds } : null;
}

const defaultResolver: RateLimitPolicyResolver = ({ name }) =>
  envPolicy(name) ?? DEFAULT_RATE_LIMITS[name];

let resolvePolicy: RateLimitPolicyResolver = defaultResolver;

/**
 * Extension point for per-brand limits: install a resolver that looks the policy up by
 * `shop` (e.g. from checkoutSettings). Until then every brand uses the env/default policy.
 */
export function setRateLimitPolicyResolver(resolver: RateLimitPolicyResolver | null) {
  resolvePolicy = resolver ?? defaultResolver;
}

export type RateLimiter = {
  hit(key: string, windowSeconds: number): Promise<{ count: number; retryAfterSeconds: number }>;
};

type MemoryBuckets = Map<string, { count: number; resetAt: number }>;

export function createMemoryRateLimiter(buckets: MemoryBuckets = new Map()): RateLimiter {
  return {
    async hit(key, windowSeconds) {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
        buckets.set(key, bucket);
        if (buckets.size > 10_000) {
          for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
        }
      }
      bucket.count += 1;
      return {
        count: bucket.count,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    },
  };
}

// INCR + EXPIRE in one step so a crash can never leave a counter without a TTL.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('TTL', KEYS[1])}
`;

export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    async hit(key, windowSeconds) {
      const [count, ttl] = (await redis.eval(HIT_SCRIPT, 1, key, windowSeconds)) as [
        number,
        number,
      ];
      return { count, retryAfterSeconds: Math.max(1, ttl) };
    },
  };
}

const sharedBuckets: MemoryBuckets = new Map();
let defaultLimiter: RateLimiter | undefined;
function getRateLimiter(): RateLimiter {
  if (defaultLimiter) return defaultLimiter;
  const redis = process.env['NODE_ENV'] === 'test' ? null : getRedis();
  defaultLimiter = redis ? createRedisRateLimiter(redis) : createMemoryRateLimiter(sharedBuckets);
  return defaultLimiter;
}

/**
 * Client IP from X-Forwarded-For. Entries are appended by each proxy, so the left side is
 * client-controlled; we count from the right. TRUSTED_PROXY_HOPS is the number of proxies of
 * our own (load balancer, tunnel) between Shopify and this app; 0 means the last entry
 * is the address Shopify forwarded.
 */
export function clientIp(request: Request): string {
  const hops = Number(process.env['TRUSTED_PROXY_HOPS']);
  const skip = Number.isInteger(hops) && hops > 0 ? hops : 0;
  const parts = (request.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1 - skip] || 'unknown';
}

/** Returns a 429 response when the caller is over limit, otherwise null. Fails open if Redis is down. */
export async function enforceRateLimit(
  request: Request,
  name: RateLimitName,
  shop: string,
  limiter: RateLimiter = getRateLimiter(),
): Promise<Response | null> {
  const policy = await resolvePolicy({ shop, name });
  try {
    const { count, retryAfterSeconds } = await limiter.hit(
      `ec:rl:${shop}:${name}:${clientIp(request)}`,
      policy.windowSeconds,
    );
    if (count <= policy.limit) return null;
    return Response.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } },
      { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
    );
  } catch (error) {
    console.error('[EasyCheckout] rate limiter unavailable', (error as Error).message);
    return null;
  }
}
