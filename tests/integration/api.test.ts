import { afterEach, describe, expect, it } from 'vitest';
import { ErrorResponseSchema, HealthResponseSchema } from '@checkout/contracts';
import { buildApp } from '../../apps/api/src/app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function createApp(options: Parameters<typeof buildApp>[0] = {}) {
  const app = buildApp({ logLevel: 'silent', ...options });
  apps.push(app);
  return app;
}

describe('API foundation', () => {
  it.each([
    ['/health/live', 'alive'],
    ['/health/ready', 'ready'],
  ])('reports process scope at %s', async (url, status) => {
    const app = createApp();
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json())).toEqual({ status, scope: 'foundation' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('generates correlation IDs instead of trusting supplied IDs', async () => {
    const app = createApp();
    const first = await app.inject({
      url: '/missing',
      headers: { 'x-correlation-id': 'forged-private-value', 'request-id': 'forged-private-value' },
    });
    const second = await app.inject('/missing');
    const body = ErrorResponseSchema.parse(first.json());
    expect(first.statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(first.headers['x-correlation-id']).toBe(body.correlationId);
    expect(second.headers['x-correlation-id']).not.toBe(body.correlationId);
    expect(first.body).not.toContain('forged-private-value');
  });

  it('exposes only implemented paths in OpenAPI', async () => {
    const app = createApp();
    const response = await app.inject('/openapi.json');
    expect(response.statusCode).toBe(200);
    const spec = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).sort()).toEqual(['/health/live', '/health/ready']);
    expect((await app.inject('/v1/merchant/capabilities?shopId=other-shop')).statusCode).toBe(404);
  });

  it('bounds payloads and uses a safe error envelope for parser failures', async () => {
    const app = createApp();
    app.post('/test-input', (_request, reply) => reply.send({ ok: true }));
    for (const [payload, expectedStatus, code] of [
      ['{broken', 400, 'INVALID_REQUEST'],
      [JSON.stringify({ value: 'x'.repeat(65536) }), 413, 'PAYLOAD_TOO_LARGE'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/test-input',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(response.statusCode).toBe(expectedStatus);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe(code);
    }
  });

  it('does not leak request data or internal exception messages in responses or logs', async () => {
    const lines: string[] = [];
    const app = createApp({
      logLevel: 'info',
      logStream: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    });
    app.post('/test-failure', () => {
      throw new Error('private-error-secret');
    });
    const response = await app.inject({
      method: 'POST',
      url: '/test-failure?email=private@example.com',
      headers: { authorization: 'Bearer private-token', cookie: 'session=private-cookie' },
      payload: { phone: 'private-phone' },
    });
    expect(response.statusCode).toBe(500);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('INTERNAL_ERROR');
    const output = response.body + lines.join('\n');
    for (const value of [
      'private-error-secret',
      'private@example.com',
      'private-token',
      'private-cookie',
      'private-phone',
    ])
      expect(output).not.toContain(value);
    expect(lines.join('\n')).toContain('correlationId');
  });

  it('rate limits unknown routes without trusting forwarded IP headers', async () => {
    const app = createApp();
    let response = await app.inject('/unknown');
    for (let index = 1; index <= 100; index++)
      response = await app.inject({
        url: '/unknown',
        headers: { 'x-forwarded-for': `10.0.0.${index}` },
      });
    expect(response.statusCode).toBe(429);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });
});
