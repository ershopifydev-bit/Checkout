import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import { type UserRole, type Permission, hasPermission } from '../models/user.js';
import { logger } from '../utils/logger.js';

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
      return;
    }

    if (req.user.role === 'SUPER_ADMIN') {
      next();
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        `Access denied for user ${req.user.email} (role: ${req.user.role}). Required roles: [${allowedRoles.join(', ')}]`,
      );
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Requires one of the following roles: [${allowedRoles.join(', ')}]. Current role: ${req.user.role}`,
        },
      });
      return;
    }

    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
      return;
    }

    if (!hasPermission(req.user.role, permission)) {
      logger.warn(
        `Permission denied for user ${req.user.email} (role: ${req.user.role}). Required permission: ${permission}`,
      );
      res.status(403).json({
        error: {
          code: 'PERMISSION_DENIED',
          message: `Action requires permission: ${permission}. Current role: ${req.user.role}`,
        },
      });
      return;
    }

    next();
  };
}
