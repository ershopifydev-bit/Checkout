import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type TokenPayload } from '../utils/jwt.js';
import { collections } from '../config/database.js';
import { toSafeUser, type SafeUser } from '../models/user.js';
import { ObjectId } from 'mongodb';

export interface AuthenticatedRequest extends Request {
  user?: SafeUser | undefined;
  tokenPayload?: TokenPayload | undefined;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'] || req.headers['x-access-token'];

    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required. Missing token.' },
      });
      return;
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();

    if (!token) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid Bearer token format.' },
      });
      return;
    }

    let payload: TokenPayload;
    try {
      payload = verifyToken(token);
    } catch {
      res.status(401).json({
        error: { code: 'TOKEN_EXPIRED_OR_INVALID', message: 'Token is invalid or expired.' },
      });
      return;
    }

    let queryId: ObjectId | string;
    try {
      queryId = new ObjectId(payload.userId);
    } catch {
      queryId = payload.userId;
    }

    const user = await collections.users().findOne({ _id: queryId });

    if (!user) {
      res.status(401).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User account associated with token no longer exists.',
        },
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        error: { code: 'ACCOUNT_DISABLED', message: 'This account has been deactivated.' },
      });
      return;
    }

    req.user = toSafeUser(user);
    req.tokenPayload = payload;
    next();
  } catch (error) {
    next(error);
  }
}
