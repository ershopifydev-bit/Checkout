import { MongoClient, type Db, type Collection, ObjectId } from 'mongodb';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import type { User, UserRole } from '../models/user.js';
import type { AuditLog } from '../models/audit-log.js';
import { hashPassword } from '../utils/password.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) {
    return { client, db };
  }

  logger.info(`Connecting to MongoDB at ${env.MONGODB_URI} (db: ${env.MONGODB_DATABASE})...`);
  const newClient = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

  await newClient.connect();
  const newDb = newClient.db(env.MONGODB_DATABASE);

  client = newClient;
  db = newDb;

  logger.info(`Successfully connected to MongoDB database: ${env.MONGODB_DATABASE}`);

  // Ensure necessary indexes
  await ensureIndexes(newDb);

  // Seed default demo & role accounts if not present
  await seedInitialUsers(newDb);

  return { client: newClient, db: newDb };
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error('MongoClient not initialized. Call connectToDatabase() first.');
  }
  return client;
}

export const collections = {
  users(): Collection<User> {
    return getDb().collection<User>('dashboard_users');
  },
  auditLogs(): Collection<AuditLog> {
    return getDb().collection<AuditLog>('dashboard_audit_logs');
  },
  checkoutOrderAttempts(): Collection<Record<string, unknown>> {
    return getDb().collection<Record<string, unknown>>('checkoutOrderAttempts');
  },
  checkoutFunnels(): Collection<Record<string, unknown>> {
    return getDb().collection<Record<string, unknown>>('checkoutFunnels');
  },
  checkoutEvents(): Collection<Record<string, unknown>> {
    return getDb().collection<Record<string, unknown>>('checkoutEvents');
  },
  checkoutSettings(): Collection<Record<string, unknown>> {
    return getDb().collection<Record<string, unknown>>('checkoutSettings');
  },
  shopifySessions(): Collection<Record<string, unknown>> {
    return getDb().collection<Record<string, unknown>>('shopifySessions');
  },
  integrations(): Collection<Record<string, unknown>> {
    return getDb().collection<Record<string, unknown>>('dashboard_integrations');
  },
};

async function ensureIndexes(database: Db): Promise<void> {
  try {
    const usersCol = database.collection('dashboard_users');
    await usersCol.createIndex({ email: 1 }, { unique: true });

    const auditCol = database.collection('dashboard_audit_logs');
    await auditCol.createIndex({ timestamp: -1 });
    await auditCol.createIndex({ userId: 1, timestamp: -1 });

    const attemptsCol = database.collection('checkoutOrderAttempts');
    await attemptsCol.createIndex({ createdAt: -1 });
    await attemptsCol.createIndex({ status: 1 });
    await attemptsCol.createIndex({ shop: 1 });

    const funnelsCol = database.collection('checkoutFunnels');
    await funnelsCol.createIndex({ updatedAt: -1 });
    await funnelsCol.createIndex({ status: 1 });

    const eventsCol = database.collection('checkoutEvents');
    await eventsCol.createIndex({ timestamp: -1 });
    await eventsCol.createIndex({ event: 1 });

    logger.debug('Database indexes verified');
  } catch (error) {
    logger.warn('Index verification warning:', error);
  }
}

interface SeedAccount {
  email: string;
  name: string;
  role: UserRole;
  password: string;
}

const DEFAULT_SEED_ACCOUNTS: SeedAccount[] = [
  {
    email: env.INITIAL_ADMIN_EMAIL.toLowerCase().trim(),
    name: 'System Super Admin',
    role: 'SUPER_ADMIN',
    password: env.INITIAL_ADMIN_PASSWORD,
  },
  {
    email: 'manager@tezvix.internal',
    name: 'Store Manager',
    role: 'ADMIN',
    password: 'Manager@123456',
  },
  {
    email: 'operator@tezvix.internal',
    name: 'Operations Lead',
    role: 'OPERATOR',
    password: 'Operator@123456',
  },
  {
    email: 'viewer@tezvix.internal',
    name: 'Data Analyst',
    role: 'VIEWER',
    password: 'Viewer@123456',
  },
];

async function seedInitialUsers(database: Db): Promise<void> {
  try {
    const usersCol = database.collection<User>('dashboard_users');

    for (const acc of DEFAULT_SEED_ACCOUNTS) {
      const existing = await usersCol.findOne({ email: acc.email });
      if (!existing) {
        const passwordHash = await hashPassword(acc.password);
        const newUser: User = {
          _id: new ObjectId(),
          email: acc.email,
          name: acc.name,
          role: acc.role,
          isActive: true,
          passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await usersCol.insertOne(newUser);
        logger.info(`Seeded demo ${acc.role} user: ${acc.email}`);
      }
    }
  } catch (error) {
    logger.error('Failed to seed initial demo accounts:', error);
  }
}

export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await getDb().command({ ping: 1 });
    return { ok: res['ok'] === 1, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed.');
  }
}
