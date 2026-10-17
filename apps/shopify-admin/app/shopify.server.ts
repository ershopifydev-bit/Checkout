import '@shopify/shopify-app-react-router/adapters/node';
import { ApiVersion, AppDistribution, shopifyApp } from '@shopify/shopify-app-react-router/server';
import { LogSeverity } from '@shopify/shopify-api';
import { MongoClient, type Db } from 'mongodb';
import { readAdminConfig } from './config.server';
import { EncryptedMongoSessionStorage } from './session-storage.server';

const config = readAdminConfig(process.env);

type GlobalDatabase = typeof globalThis & {
  checkoutMongoClient?: MongoClient;
  checkoutMongoConnect?: Promise<MongoClient>;
};

const globalDatabase = globalThis as GlobalDatabase;

function isClientUsable(client: MongoClient): boolean {
  // After close(), topology is cleared AND s.hasBeenClosed is true. Treating
  // missing topology as "fresh" incorrectly reused closed HMR clients.
  const internal = client as MongoClient & {
    topology?: { isDestroyed?: () => boolean };
    s?: { hasBeenClosed?: boolean };
  };
  if (internal.s?.hasBeenClosed) return false;
  const topology = internal.topology;
  if (!topology) return true;
  return typeof topology.isDestroyed === 'function' ? !topology.isDestroyed() : true;
}

function createMongoClient(): MongoClient {
  return new MongoClient(config.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });
}

/** Vite HMR can keep a closed client on globalThis — recreate when topology is destroyed. */
export function getMongoClient(): MongoClient {
  const existing = globalDatabase.checkoutMongoClient;
  if (existing && isClientUsable(existing)) return existing;
  globalDatabase.checkoutMongoConnect = undefined;
  const client = createMongoClient();
  globalDatabase.checkoutMongoClient = client;
  return client;
}

export function getMongoDb(): Db {
  return getMongoClient().db(config.MONGODB_DATABASE);
}

async function connectCachedClient(client: MongoClient): Promise<void> {
  globalDatabase.checkoutMongoConnect ??= client.connect().catch((error: unknown) => {
    globalDatabase.checkoutMongoConnect = undefined;
    globalDatabase.checkoutMongoClient = undefined;
    throw error;
  });
  await globalDatabase.checkoutMongoConnect;
}

/** Ensure the pool is connected; resets cache if the topology was closed. */
export async function connectMongo(): Promise<Db> {
  try {
    await connectCachedClient(getMongoClient());
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name !== 'MongoTopologyClosedError' && name !== 'MongoNotConnectedError') throw error;
    globalDatabase.checkoutMongoConnect = undefined;
    globalDatabase.checkoutMongoClient = undefined;
    await connectCachedClient(getMongoClient());
  }
  return getMongoDb();
}

/** @deprecated Prefer getMongoDb() — kept for existing imports. */
export const mongoDb = new Proxy({} as Db, {
  get(_target, property, _receiver) {
    const db = getMongoDb();
    const value = Reflect.get(db, property, db);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(db) : value;
  },
});

export const sessionStorage = new EncryptedMongoSessionStorage(getMongoDb, config.encryptionKey);
export const publicApiKey = config.SHOPIFY_API_KEY;
const shopify = shopifyApp({
  apiKey: config.SHOPIFY_API_KEY,
  apiSecretKey: config.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October26,
  appUrl: config.SHOPIFY_APP_URL,
  authPathPrefix: '/auth',
  scopes: ['read_customers', 'write_customers', 'write_orders', 'read_orders', 'read_discounts'],
  sessionStorage,
  // Standard CLI-managed development installation. Production distribution remains a separate decision.
  distribution: AppDistribution.AppStore,
  future: { expiringOfflineAccessTokens: true },
  logger: {
    level: LogSeverity.Error,
    httpRequests: false,
    log: () => {
      console.error('Shopify authentication request failed.');
    },
  },
});
export const authenticate = {
  ...shopify.authenticate,
  async admin(request: Request) {
    try {
      await connectMongo();
      return await shopify.authenticate.admin(request);
    } catch (error) {
      if (error instanceof Response && error.status >= 400) {
        // Never log URLs, query parameters, response bodies, or session credentials.
        console.error('Shopify admin authentication response:', error.status);
      }
      throw error;
    }
  },
};
export const login = shopify.login;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
