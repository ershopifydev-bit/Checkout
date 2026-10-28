import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { UserRole } from '../models/user.js';

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

export function signToken(payload: TokenPayload): string {
  // Pass explicit expiresIn as string to satisfy exactOptionalPropertyTypes
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: '24h',
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
