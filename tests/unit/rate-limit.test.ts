import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RATE_LIMITS,
  clientIp,
  createMemoryRateLimiter,
  enforceRateLimit,
  setRateLimitPolicyResolver,
} from '../../apps/shopify-admin/app/rate-limit.server';

function req(ip: string) {
  return new Request('https://app.test/proxy/v1/x', { headers: { 'x-forwarded-for': ip } });
}

describe('rate limiting', () => {
  afterEach(() => {
    setRateLimitPolicyResolver(null);
    vi.unstubAllEnvs();
  });

  it('blocks an IP after the placeOrder limit with a 429 and Retry-After', async () => {
    const limiter = createMemoryRateLimiter();
    const { limit } = DEFAULT_RATE_LIMITS.placeOrder;
    for (let i = 0; i < limit; i++) {
      expect(await enforceRateLimit(req('1.1.1.1'), 'placeOrder', 'a.myshopify.com', limiter)).toBe(
        null,
      );
    }
    const blocked = await enforceRateLimit(
      req('1.1.1.1'),
      'placeOrder',
      'a.myshopify.com',
      limiter,
    );
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await blocked?.json()) as { error: { code: string } }).error.code).toBe(
      'RATE_LIMITED',
    );
  });

  it('counts per IP, per route group and per shop', async () => {
    const limiter = createMemoryRateLimiter();
    const { limit } = DEFAULT_RATE_LIMITS.placeOrder;
    for (let i = 0; i <= limit; i++) {
      await enforceRateLimit(req('1.1.1.1'), 'placeOrder', 'a.myshopify.com', limiter);
    }
    expect(await enforceRateLimit(req('2.2.2.2'), 'placeOrder', 'a.myshopify.com', limiter)).toBe(
      null,
    );
    expect(await enforceRateLimit(req('1.1.1.1'), 'sessionRead', 'a.myshopify.com', limiter)).toBe(
      null,
    );
    expect(await enforceRateLimit(req('1.1.1.1'), 'placeOrder', 'b.myshopify.com', limiter)).toBe(
      null,
    );
  });

  it('uses a per-brand policy resolver when installed', async () => {
    const limiter = createMemoryRateLimiter();
    setRateLimitPolicyResolver(({ shop }) =>
      shop === 'strict.myshopify.com'
        ? { limit: 1, windowSeconds: 60 }
        : DEFAULT_RATE_LIMITS.placeOrder,
    );
    expect(
      await enforceRateLimit(req('3.3.3.3'), 'placeOrder', 'strict.myshopify.com', limiter),
    ).toBe(null);
    expect(
      (await enforceRateLimit(req('3.3.3.3'), 'placeOrder', 'strict.myshopify.com', limiter))
        ?.status,
    ).toBe(429);
  });

  it('honours env overrides', async () => {
    vi.stubEnv('RATE_LIMIT_PLACE_ORDER', '1/60');
    const limiter = createMemoryRateLimiter();
    await enforceRateLimit(req('4.4.4.4'), 'placeOrder', 'a.myshopify.com', limiter);
    expect(
      (await enforceRateLimit(req('4.4.4.4'), 'placeOrder', 'a.myshopify.com', limiter))?.status,
    ).toBe(429);
  });

  it('fails open when the limiter backend errors', async () => {
    const limiter = {
      hit: async () => {
        throw new Error('down');
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await enforceRateLimit(req('5.5.5.5'), 'placeOrder', 'a.myshopify.com', limiter)).toBe(
      null,
    );
  });

  it('reads the client IP from the right of X-Forwarded-For, skipping trusted hops', () => {
    expect(clientIp(req('6.6.6.6, 7.7.7.7'))).toBe('7.7.7.7');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
    expect(clientIp(req('6.6.6.6, 7.7.7.7'))).toBe('6.6.6.6');
    expect(clientIp(new Request('https://app.test/'))).toBe('unknown');
  });
});
