import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../apps/dashboard_backend/src/utils/password.js';
import { signToken, verifyToken } from '../../apps/dashboard_backend/src/utils/jwt.js';
import {
  ROLE_PERMISSIONS,
  toSafeUser,
  type User,
  type UserRole,
} from '../../apps/dashboard_backend/src/models/user.js';

describe('Dashboard Auth and Role Presets', () => {
  const DEMO_PRESETS: Array<{ email: string; pass: string; role: UserRole; name: string }> = [
    {
      email: 'admin@tezvix.internal',
      pass: 'Admin@123456',
      role: 'SUPER_ADMIN',
      name: 'System Super Admin',
    },
    {
      email: 'manager@tezvix.internal',
      pass: 'Manager@123456',
      role: 'ADMIN',
      name: 'Store Manager',
    },
    {
      email: 'operator@tezvix.internal',
      pass: 'Operator@123456',
      role: 'OPERATOR',
      name: 'Operations Lead',
    },
    {
      email: 'viewer@tezvix.internal',
      pass: 'Viewer@123456',
      role: 'VIEWER',
      name: 'Data Analyst',
    },
  ];

  it('hashes and verifies credentials for all demo roles', async () => {
    for (const demo of DEMO_PRESETS) {
      const hash = await hashPassword(demo.pass);
      expect(hash).not.toBe(demo.pass);

      const isValid = await verifyPassword(demo.pass, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('WrongPassword@999', hash);
      expect(isInvalid).toBe(false);
    }
  }, 15000);

  it('signs and verifies JWT tokens with correct role and email claims', () => {
    for (const demo of DEMO_PRESETS) {
      const token = signToken({
        userId: 'usr_' + demo.role.toLowerCase(),
        email: demo.email,
        role: demo.role,
        name: demo.name,
      });

      const payload = verifyToken(token);
      expect(payload.email).toBe(demo.email);
      expect(payload.role).toBe(demo.role);
      expect(payload.name).toBe(demo.name);
    }
  });

  it('enforces RBAC permissions hierarchy across roles', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain('*');
    expect(ROLE_PERMISSIONS.ADMIN).toContain('users:manage');
    expect(ROLE_PERMISSIONS.OPERATOR).toContain('orders:write');
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain('users:manage');
    expect(ROLE_PERMISSIONS.VIEWER).toContain('analytics:read');
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('orders:write');
  });

  it('strips sensitive passwordHash in toSafeUser', () => {
    const rawUser: User = {
      _id: '12345',
      email: 'admin@tezvix.internal',
      name: 'Admin',
      role: 'SUPER_ADMIN',
      passwordHash: 'secret_hash_value',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const safe = toSafeUser(rawUser);
    expect('passwordHash' in safe).toBe(false);
    expect(safe.email).toBe(rawUser.email);
    expect(safe.role).toBe('SUPER_ADMIN');
  });
});
