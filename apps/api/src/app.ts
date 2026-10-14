import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { contractSchemas } from '@checkout/contracts';
import { publicError } from './errors.js';
import { openapiDocument } from './openapi.js';
import type { readConfig } from './config.js';

interface AppOptions {
  logLevel?: ReturnType<typeof readConfig>['LOG_LEVEL'];
  logStream?: { write: (line: string) => void };
}

// https://fastify.dev/docs/latest/Guides/Testing/ — keep construction separate from listen().
export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    requestTimeout: 10_000,
    connectionTimeout: 10_000,
    keepAliveTimeout: 5_000,
    trustProxy: false,
    requestIdHeader: false,
    requestIdLogLabel: 'correlationId',
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
    logger: {
      level: options.logLevel ?? 'info',
      ...(options.logStream ? { stream: options.logStream } : {}),
      // Allowlist serializers also cover framework-generated errors and messages.
      serializers: {
        req: () => ({}),
        res: () => ({}),
        err: () => ({ type: 'Error', message: 'Redacted', stack: '' }),
      },
      redact: ['authorization', 'cookie', 'token', 'password'],
    },
  });
  app.register(helmet);
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id).header('cache-control', 'no-store');
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed',
    );
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const safe = publicError(status, request.id);
    if (safe.statusCode >= 500)
      request.log.error({ statusCode: safe.statusCode }, 'Request failed');
    return reply.code(safe.statusCode).send(safe.body);
  });
  app.after(() => {
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) => {
      const safe = publicError(404, request.id);
      return reply.code(safe.statusCode).send(safe.body);
    });
  });
  for (const [path, status] of [
    ['live', 'alive'],
    ['ready', 'ready'],
  ] as const) {
    app.get(
      `/health/${path}`,
      {
        config: { rateLimit: false },
        schema: { response: { 200: contractSchemas.HealthResponse } },
      },
      (_request, reply) => reply.send({ status, scope: 'foundation' }),
    );
  }
  app.get('/openapi.json', (_request, reply) => reply.send(openapiDocument));
  return app;
}
