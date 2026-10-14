import { buildApp } from './app.js';
import { readConfig } from './config.js';

async function main() {
  const config = readConfig(process.env);
  const app = buildApp({ logLevel: config.LOG_LEVEL });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      app.log.fatal('Graceful shutdown timed out');
      process.exit(1);
    }, 10_000);
    deadline.unref();
    void app.close().then(
      () => {
        clearTimeout(deadline);
        process.exitCode = 0;
      },
      () => {
        clearTimeout(deadline);
        process.exitCode = 1;
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch {
    app.log.error('API listener failed to start');
    await app.close();
    process.exitCode = 1;
  }
}

void main().catch(() => {
  // Configuration or startup failures may contain credentials; never print their raw values.
  process.stderr.write('API startup failed. Check configuration and listener availability.\n');
  process.exitCode = 1;
});
