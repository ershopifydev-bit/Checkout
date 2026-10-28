import { ObjectId } from 'mongodb';
import { collections } from '../config/database.js';
import type { UserRole } from '../models/user.js';
import { logger } from '../utils/logger.js';

export interface RecordAuditParams {
  userId: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  resource: string;
  details?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export async function logAuditEvent(params: RecordAuditParams): Promise<void> {
  try {
    await collections.auditLogs().insertOne({
      _id: new ObjectId(),
      ...params,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.warn('Failed to record audit log event:', error);
  }
}
