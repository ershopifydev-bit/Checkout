import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { pingDatabase } from './config/database.js';
import { errorHandler } from './middleware/error.js';

import { authRouter } from './routes/auth.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { monitorRouter } from './routes/monitor.routes.js';
import { ordersRouter } from './routes/orders.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { auditRouter } from './routes/audit.routes.js';

export function createApp(): express.Application {
  const app = express();

  // Basic security settings
  app.disable('x-powered-by');

  // CORS configuration
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, true); // Dev convenience
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-dashboard-token'],
    }),
  );

  // Body parser
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Basic request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  // Health check endpoint
  app.get('/api/health', async (_req, res) => {
    const dbPing = await pingDatabase();
    res.json({
      status: dbPing.ok ? 'HEALTHY' : 'DEGRADED',
      database: dbPing.ok ? 'CONNECTED' : 'DISCONNECTED',
      latencyMs: dbPing.latencyMs,
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
    });
  });

  // API Route Mounts
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/monitor', monitorRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/audit-logs', auditRouter);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Endpoint ${req.method} ${req.originalUrl} not found`,
      },
    });
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
