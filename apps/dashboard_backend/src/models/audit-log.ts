import type { ObjectId } from 'mongodb';
import type { UserRole } from './user.js';

export interface AuditLog {
  _id?: ObjectId | string | undefined;
  userId: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  resource: string;
  details?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  timestamp: Date;
}
