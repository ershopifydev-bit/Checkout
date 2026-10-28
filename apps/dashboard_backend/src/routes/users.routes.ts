import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { collections } from '../config/database.js';
import { hashPassword } from '../utils/password.js';
import { toSafeUser, type User } from '../models/user.js';
import { logAuditEvent } from '../services/audit.service.js';
import { ObjectId } from 'mongodb';

export const usersRouter: Router = Router();

usersRouter.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']),
});

const updateRoleSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']),
});

const updateStatusSchema = z.object({
  isActive: z.boolean(),
});

// GET /api/users - List users
usersRouter.get('/', requirePermission('users:read'), async (_req, res, next) => {
  try {
    const users = await collections
      .users()
      .find({}, { sort: { createdAt: -1 } })
      .toArray();

    res.json({
      users: users.map(toSafeUser),
      total: users.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/users - Create new team user
usersRouter.post(
  '/',
  requirePermission('users:manage'),
  validateBody(createUserSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { email, name, password, role } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      // Only SUPER_ADMIN can create another SUPER_ADMIN
      if (role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: { message: 'Only a Super Admin can create another Super Admin account.' },
        });
        return;
      }

      const existing = await collections.users().findOne({ email: normalizedEmail });
      if (existing) {
        res.status(409).json({
          error: { code: 'USER_EXISTS', message: 'User with this email already exists.' },
        });
        return;
      }

      const passwordHash = await hashPassword(password);
      const newUser: User = {
        _id: new ObjectId(),
        email: normalizedEmail,
        name: name.trim(),
        role,
        passwordHash,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await collections.users().insertOne(newUser);

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: 'CREATE_USER',
          resource: `user:${newUser.email}`,
          details: { createdRole: role },
          ipAddress: req.ip || undefined,
        });
      }

      res.status(201).json({
        user: toSafeUser(newUser),
      });
    } catch (error) {
      next(error);
    }
  },
);

// PATCH /api/users/:id/role - Update user role (SUPER_ADMIN only)
usersRouter.patch(
  '/:id/role',
  requireRole('SUPER_ADMIN'),
  validateBody(updateRoleSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      let targetId: ObjectId | string;
      try {
        targetId = new ObjectId(id);
      } catch {
        targetId = id as string;
      }

      const targetUser = await collections.users().findOne({ _id: targetId });
      if (!targetUser) {
        res.status(404).json({ error: { message: 'User not found.' } });
        return;
      }

      await collections
        .users()
        .updateOne({ _id: targetId }, { $set: { role, updatedAt: new Date() } });

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: 'UPDATE_USER_ROLE',
          resource: `user:${targetUser.email}`,
          details: { oldRole: targetUser.role, newRole: role },
          ipAddress: req.ip || undefined,
        });
      }

      res.json({ message: 'User role updated successfully.', role });
    } catch (error) {
      next(error);
    }
  },
);

// PATCH /api/users/:id/status - Enable/Disable user
usersRouter.patch(
  '/:id/status',
  requirePermission('users:manage'),
  validateBody(updateStatusSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      let targetId: ObjectId | string;
      try {
        targetId = new ObjectId(id);
      } catch {
        targetId = id as string;
      }

      const targetUser = await collections.users().findOne({ _id: targetId });
      if (!targetUser) {
        res.status(404).json({ error: { message: 'User not found.' } });
        return;
      }

      // Cannot deactivate oneself
      if (String(targetUser._id) === String(req.user?._id)) {
        res.status(400).json({ error: { message: 'You cannot deactivate your own account.' } });
        return;
      }

      await collections
        .users()
        .updateOne({ _id: targetId }, { $set: { isActive, updatedAt: new Date() } });

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: isActive ? 'ENABLE_USER' : 'DISABLE_USER',
          resource: `user:${targetUser.email}`,
          ipAddress: req.ip || undefined,
        });
      }

      res.json({ message: `User account ${isActive ? 'activated' : 'deactivated'}.`, isActive });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/users/:id - Delete user (SUPER_ADMIN only)
usersRouter.delete(
  '/:id',
  requireRole('SUPER_ADMIN'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      let targetId: ObjectId | string;
      try {
        targetId = new ObjectId(id);
      } catch {
        targetId = id as string;
      }

      const targetUser = await collections.users().findOne({ _id: targetId });
      if (!targetUser) {
        res.status(404).json({ error: { message: 'User not found.' } });
        return;
      }

      if (String(targetUser._id) === String(req.user?._id)) {
        res.status(400).json({ error: { message: 'You cannot delete your own account.' } });
        return;
      }

      await collections.users().deleteOne({ _id: targetId });

      if (req.user) {
        await logAuditEvent({
          userId: String(req.user._id),
          userEmail: req.user.email,
          userRole: req.user.role,
          action: 'DELETE_USER',
          resource: `user:${targetUser.email}`,
          ipAddress: req.ip || undefined,
        });
      }

      res.json({ message: 'User deleted successfully.' });
    } catch (error) {
      next(error);
    }
  },
);
