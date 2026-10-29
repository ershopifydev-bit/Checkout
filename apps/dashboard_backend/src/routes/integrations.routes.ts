import { requirePermission } from '../middleware/rbac.js';
import { requireStoreAccess, requestStoreFilter } from '../middleware/store-access.js';
import { Router } from 'express';
import { collections } from '../config/database.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { logAuditEvent } from '../services/audit.service.js';

export const integrationsRouter: Router = Router();

integrationsRouter.use(authenticate, requireStoreAccess);

// GET /api/integrations - Fetch all saved connector configurations
integrationsRouter.get('/', requirePermission('settings:read'), async (req, res, next) => {
  try {
    const list = await collections.integrations().find(requestStoreFilter(req)).toArray();
    res.json({
      integrations: list,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/integrations/:name - Save connector configuration and credentials
integrationsRouter.put(
  '/:name',
  requirePermission('settings:write'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const shop = req.query['shop'];
      if (typeof shop !== 'string' || !shop) {
        res.status(400).json({ error: { message: 'Select a store first.' } });
        return;
      }
      const name = req.params['name'] || '';
      const normalizedName = decodeURIComponent(name).trim();
      const connected = req.body['connected'];
      const config = req.body['config'];

      const updateDoc = {
        name: normalizedName,
        connected: Boolean(connected),
        config: config && typeof config === 'object' ? config : {},
        updatedAt: new Date(),
      };

      const updated = await collections.integrations().findOneAndUpdate(
        { name: normalizedName, shop },
        {
          $set: updateDoc,
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, returnDocument: 'after' },
      );

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: connected ? 'CONNECT_INTEGRATION' : 'UPDATE_INTEGRATION',
          resource: `integration:${normalizedName}`,
          details: { connected },
          ipAddress: req.ip || undefined,
        });
      }

      res.json({
        integration: updated || updateDoc,
        message: `${normalizedName} configuration saved.`,
      });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/integrations/:name - Disconnect and clear credentials
integrationsRouter.delete(
  '/:name',
  requirePermission('settings:write'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const shop = req.query['shop'];
      if (typeof shop !== 'string' || !shop) {
        res.status(400).json({ error: { message: 'Select a store first.' } });
        return;
      }
      const name = req.params['name'] || '';
      const normalizedName = decodeURIComponent(name).trim();

      await collections.integrations().updateOne(
        { name: normalizedName, shop },
        {
          $set: {
            connected: false,
            config: {},
            updatedAt: new Date(),
          },
        },
      );

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: 'DISCONNECT_INTEGRATION',
          resource: `integration:${normalizedName}`,
          ipAddress: req.ip || undefined,
        });
      }

      res.json({
        message: `${normalizedName} disconnected successfully.`,
      });
    } catch (error) {
      next(error);
    }
  },
);
