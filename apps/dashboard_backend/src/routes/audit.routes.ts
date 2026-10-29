import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { collections } from '../config/database.js';

export const auditRouter: Router = Router();

auditRouter.use(authenticate);
auditRouter.use(requireRole('SUPER_ADMIN'));

// GET /api/audit-logs
auditRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50));
    const skip = Math.max(0, Number(req.query['skip']) || 0);

    const [logs, total] = await Promise.all([
      collections.auditLogs().find({}).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
      collections.auditLogs().countDocuments(),
    ]);

    res.json({
      logs,
      total,
      limit,
      skip,
    });
  } catch (error) {
    next(error);
  }
});
