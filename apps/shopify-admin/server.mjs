import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import express from 'express';
import { createRequestHandler } from '@react-router/express';

process.env.NODE_ENV ??= 'production';
try {
  const build = await import('./build/server/index.js');
  const app = express();
  app.disable('x-powered-by');
  app.use(
    express.static(fileURLToPath(new URL('./build/client', import.meta.url)), { index: false }),
  );
  // Do not log URLs: Shopify authentication query strings can contain credentials.
  app.use(createRequestHandler({ build, mode: 'production' }));
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(`Shopify admin listening on port ${port}`);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('error', () => {
    console.error('Shopify admin listener failed.');
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch {
  console.error('Shopify admin startup failed. Check app and database configuration.');
  process.exitCode = 1;
}
