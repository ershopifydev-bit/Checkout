import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const errorMessage = err instanceof Error ? err.message : 'Internal Server Error';
  const errorStack = err instanceof Error ? err.stack : undefined;

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${errorMessage}`, {
    stack: errorStack,
  });

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : errorMessage,
      ...(env.NODE_ENV !== 'production' && errorStack ? { stack: errorStack } : {}),
    },
  });
}
