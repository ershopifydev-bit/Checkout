import { requireStoreAccess, requestStoreFilter } from '../middleware/store-access.js';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { collections } from '../config/database.js';
import { logAuditEvent } from '../services/audit.service.js';

export const ordersRouter: Router = Router();

ordersRouter.use(authenticate, requireStoreAccess);

// GET /api/orders - List order attempts with filtering and pagination
ordersRouter.get('/', requirePermission('orders:read'), async (req, res, next) => {
  try {
    const { status, shop } = req.query;
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 25));
    const skip = Math.max(0, Number(req.query['skip']) || 0);

    const filter = requestStoreFilter(req);
    if (typeof status === 'string' && status.trim() && status.trim().toUpperCase() !== 'ALL') {
      filter['status'] = status.trim().toUpperCase();
    }

    const [attempts, total] = await Promise.all([
      collections
        .checkoutOrderAttempts()
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      collections.checkoutOrderAttempts().countDocuments(filter),
    ]);

    const formatted = attempts.map((rawDoc) => {
      const doc = rawDoc as Record<string, unknown>;
      const amountMinor = Number(doc['expectedAmountMinor'] || 0);
      return {
        ...doc,
        formattedAmount: `₹${(amountMinor / 100).toFixed(2)}`,
      };
    });

    res.json({
      orders: formatted,
      total,
      limit,
      skip,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/orders/:id - Get detailed order attempt
ordersRouter.get('/:id', requirePermission('orders:read'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const queryConditions: Record<string, unknown>[] = [
      { checkoutSessionId: id },
      { shopifyOrderId: id },
    ];
    if (id && ObjectId.isValid(id)) {
      queryConditions.push({ _id: new ObjectId(id) });
    }
    const attempt = await collections.checkoutOrderAttempts().findOne({
      ...requestStoreFilter(req),
      $or: queryConditions,
    });

    if (!attempt) {
      res.status(404).json({ error: { message: 'Order attempt not found.' } });
      return;
    }

    res.json({ order: attempt });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders/:id/flag-review - Flag attempt for manual review
ordersRouter.post(
  '/:id/flag-review',
  requirePermission('orders:write'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const filter: Record<string, unknown> =
        id && ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { checkoutSessionId: id };
      const result = await collections.checkoutOrderAttempts().updateOne(
        { ...filter, ...requestStoreFilter(req) },
        {
          $set: {
            status: 'MANUAL_REVIEW',
            updatedAt: new Date(),
            flaggedBy: req.user?.email,
          },
        },
      );

      if (result.matchedCount === 0) {
        res.status(404).json({ error: { message: 'Order attempt not found.' } });
        return;
      }

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: 'FLAG_ORDER_MANUAL_REVIEW',
          resource: `order:${id}`,
          ipAddress: req.ip,
        });
      }

      res.json({ message: 'Order attempt flagged for manual review.' });
    } catch (error) {
      next(error);
    }
  },
);
