import { Router } from 'express';
import { collections } from '../config/database.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { logAuditEvent } from '../services/audit.service.js';

export const integrationsRouter: Router = Router();

integrationsRouter.use(authenticate);

// GET /api/integrations - Fetch all saved connector configurations
integrationsRouter.get('/', async (_req, res, next) => {
  try {
    const list = await collections.integrations().find({}).toArray();
    res.json({
      integrations: list,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/integrations/:name - Save connector configuration and credentials
integrationsRouter.put('/:name', async (req: AuthenticatedRequest, res, next) => {
  try {
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
      { name: normalizedName },
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
});

// DELETE /api/integrations/:name - Disconnect and clear credentials
integrationsRouter.delete('/:name', async (req: AuthenticatedRequest, res, next) => {
  try {
    const name = req.params['name'] || '';
    const normalizedName = decodeURIComponent(name).trim();

    await collections.integrations().updateOne(
      { name: normalizedName },
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
});
