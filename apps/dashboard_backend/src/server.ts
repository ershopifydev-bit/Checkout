import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase, closeDatabase } from './config/database.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  try {
    // 1. Connect to MongoDB
    await connectToDatabase();

    // 2. Initialize Express application
    const app = createApp();

    // 3. Start HTTP server
    const server = app.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`========================================================`);
      logger.info(`Tezvix OS Dashboard Backend is running!`);
      logger.info(`Port:            http://localhost:${env.PORT}`);
      logger.info(`Health check:    http://localhost:${env.PORT}/api/health`);
      logger.info(`DB Monitor API:  http://localhost:${env.PORT}/api/monitor/overview`);
      logger.info(`Default Admin:   ${env.INITIAL_ADMIN_EMAIL}`);
      logger.info(`Environment:     ${env.NODE_ENV}`);
      logger.info(`========================================================`);
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        logger.info('HTTP server closed.');
        await closeDatabase();
        process.exit(0);
      });

      // Force exit after 10s if shutdown hangs
      setTimeout(() => {
        logger.error('Forceful shutdown timeout exceeded.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start Dashboard Backend server:', error);
    process.exit(1);
  }
}

bootstrap();
