import type { ObjectId } from 'mongodb';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type Permission =
  | '*'
  | 'monitor:read'
  | 'orders:read'
  | 'orders:write'
  | 'analytics:read'
  | 'settings:read'
  | 'settings:write'
  | 'users:read'
  | 'users:manage'
  | 'audit:read';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'monitor:read',
    'orders:read',
    'orders:write',
    'analytics:read',
    'settings:read',
    'settings:write',
    'users:read',
    'users:manage',
    'audit:read',
  ],
  OPERATOR: ['monitor:read', 'orders:read', 'orders:write', 'analytics:read', 'settings:read'],
  VIEWER: ['monitor:read', 'orders:read', 'analytics:read', 'settings:read'],
};

export interface User {
  _id?: ObjectId | string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _hash, ...safe } = user;
  return safe;
}

export function hasPermission(userRole: UserRole, requiredPermission: Permission): boolean {
  if (userRole === 'SUPER_ADMIN') return true;
  const permissions = ROLE_PERMISSIONS[userRole] || [];
  return permissions.includes('*') || permissions.includes(requiredPermission);
}
