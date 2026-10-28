import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { collections } from '../config/database.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { toSafeUser, type User } from '../models/user.js';
import { logAuditEvent } from '../services/audit.service.js';
import { ObjectId } from 'mongodb';

export const authRouter: Router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']).default('VIEWER'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// POST /api/auth/login
authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await collections.users().findOne({ email: normalizedEmail });

    if (!user) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        error: { code: 'ACCOUNT_DISABLED', message: 'This account has been deactivated.' },
      });
      return;
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
      return;
    }

    // Update lastLoginAt
    await collections
      .users()
      .updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } });

    const safeUser = toSafeUser(user);
    const token = signToken({
      userId: String(user._id),
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await logAuditEvent({
      userId: String(user._id),
      userEmail: user.email,
      userRole: user.role,
      action: 'LOGIN',
      resource: 'auth',
      ipAddress: req.ip || undefined,
      userAgent: req.get('user-agent') || undefined,
    });

    res.json({
      token,
      user: safeUser,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/register (Bootstrap or Admin action)
authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if any users exist in the system
    const userCount = await collections.users().countDocuments();

    // If users exist, this route requires SUPER_ADMIN or ADMIN role
    if (userCount > 0) {
      // Must have valid token with ADMIN role
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        res.status(401).json({
          error: {
            code: 'REGISTRATION_RESTRICTED',
            message: 'Public registration is disabled. An administrator must create accounts.',
          },
        });
        return;
      }
    }

    const existing = await collections.users().findOne({ email: normalizedEmail });
    if (existing) {
      res.status(409).json({
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'User with this email already exists.' },
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    // If it's the very first user, promote automatically to SUPER_ADMIN
    const assignedRole = userCount === 0 ? 'SUPER_ADMIN' : role;

    const newUser: User = {
      _id: new ObjectId(),
      email: normalizedEmail,
      name: name.trim(),
      role: assignedRole,
      passwordHash,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await collections.users().insertOne(newUser);

    const safeUser = toSafeUser(newUser);
    const token = signToken({
      userId: String(newUser._id),
      email: newUser.email,
      role: newUser.role,
      name: newUser.name,
    });

    res.status(201).json({
      token,
      user: safeUser,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res) => {
  res.json({
    user: req.user,
  });
});

// POST /api/auth/change-password
authRouter.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) return;
      const { currentPassword, newPassword } = req.body;

      const user = await collections.users().findOne({
        email: req.user.email,
      });

      if (!user) {
        res.status(404).json({ error: { message: 'User not found.' } });
        return;
      }

      const isMatch = await verifyPassword(currentPassword, user.passwordHash);
      if (!isMatch) {
        res.status(400).json({
          error: { code: 'INVALID_PASSWORD', message: 'Current password does not match.' },
        });
        return;
      }

      const newHash = await hashPassword(newPassword);
      await collections
        .users()
        .updateOne({ _id: user._id }, { $set: { passwordHash: newHash, updatedAt: new Date() } });

      await logAuditEvent({
        userId: String(user._id),
        userEmail: user.email,
        userRole: user.role,
        action: 'CHANGE_PASSWORD',
        resource: 'auth',
        ipAddress: req.ip || undefined,
      });

      res.json({ message: 'Password updated successfully.' });
    } catch (error) {
      next(error);
    }
  },
);
