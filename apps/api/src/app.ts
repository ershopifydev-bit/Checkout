import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  PlaceCodOrderRequestSchema,
  PlaceCodOrderResponseSchema,
  contractSchemas,
} from '@checkout/contracts';
import { createDemoCheckoutSession, placeDemoCodOrder } from './demo-checkout.js';
import { publicError } from './errors.js';
import { openapiDocument } from './openapi.js';
import { readCheckoutAsset } from './static-assets.js';
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
    genReqId: () => randomUUID(),
    logController: new LogController({
      requestIdLogLabel: 'correlationId',
      disableRequestLogging: true,
    }),
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
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
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
  app.after((error) => {
    if (error) throw error;
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

  app.get(
    '/v1/demo/checkout',
    { schema: { response: { 200: contractSchemas.DemoCheckoutSession } } },
    (_request, reply) => reply.send(createDemoCheckoutSession()),
  );

  app.post('/v1/demo/cod-orders', async (request, reply) => {
    const parsed = PlaceCodOrderRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const safe = publicError(400, request.id);
      return reply.code(safe.statusCode).send(safe.body);
    }
    try {
      return reply.send(PlaceCodOrderResponseSchema.parse(placeDemoCodOrder(parsed.data)));
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        const safe = publicError(404, request.id);
        return reply.code(safe.statusCode).send(safe.body);
      }
      throw error;
    }
  });

  app.get('/', async (request, reply) => {
    const asset = await readCheckoutAsset('storefront/index.html');
    if (!asset) {
      const safe = publicError(404, request.id);
      return reply.code(safe.statusCode).send(safe.body);
    }
    return reply.type(asset.contentType).send(asset.body);
  });

  app.get('/storefront/*', async (request, reply) => {
    const suffix = request.url.replace(/^\/storefront\/?/, '').split('?')[0] ?? '';
    const asset = await readCheckoutAsset(`storefront/${suffix}`);
    if (!asset) {
      const safe = publicError(404, request.id);
      return reply.code(safe.statusCode).send(safe.body);
    }
    return reply.type(asset.contentType).send(asset.body);
  });

  // Deep link opens the same-origin storefront and auto-launches the in-page overlay.
  app.get('/checkout', async (_request, reply) => reply.redirect('/?checkout=open'));

  app.get('/checkout/*', async (request, reply) => {
    const suffix = request.url.replace(/^\/checkout\/?/, '').split('?')[0] ?? '';
    const asset = await readCheckoutAsset(`checkout/${suffix}`);
    if (!asset) {
      const safe = publicError(404, request.id);
      return reply.code(safe.statusCode).send(safe.body);
    }
    return reply.type(asset.contentType).send(asset.body);
  });

  return app;
}
