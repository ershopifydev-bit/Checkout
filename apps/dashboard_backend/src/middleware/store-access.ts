import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import type { SafeUser } from '../models/user.js';

export function storeFilter(user: SafeUser, requested?: string): Record<string, unknown> {
  if (requested) return { shop: requested };
  return user.role === 'SUPER_ADMIN' ? {} : { shop: { $in: user.shops || [] } };
}
export function canAssignStores(user: SafeUser, shops: string[]): boolean {
  return user.role === 'SUPER_ADMIN' || shops.every((shop) => user.shops?.includes(shop));
}
export function canManageUser(actor: SafeUser, target: SafeUser): boolean {
  return (
    actor.role === 'SUPER_ADMIN' ||
    (actor.role === 'ADMIN' &&
      ['OPERATOR', 'VIEWER'].includes(target.role) &&
      !!target.shops?.length &&
      canAssignStores(actor, target.shops))
  );
}
export function requireStoreAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: { message: 'Sign in to continue.' } });
    return;
  }
  const shop = req.query['shop'] ?? req.body?.shop;
  if (
    shop !== undefined &&
    (typeof shop !== 'string' || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
  ) {
    res.status(400).json({ error: { message: 'Choose a valid Shopify store.' } });
    return;
  }
  if (shop && !canAssignStores(req.user, [shop])) {
    res.status(403).json({ error: { message: 'You do not have access to this store.' } });
    return;
  }
  next();
}
export function requestStoreFilter(req: AuthenticatedRequest): Record<string, unknown> {
  return storeFilter(
    req.user!,
    typeof req.query['shop'] === 'string' ? req.query['shop'] : undefined,
  );
}
