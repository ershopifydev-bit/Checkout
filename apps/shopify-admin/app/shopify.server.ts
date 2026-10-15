import '@shopify/shopify-app-react-router/adapters/node';
import { ApiVersion, AppDistribution, shopifyApp } from '@shopify/shopify-app-react-router/server';
import { LogSeverity } from '@shopify/shopify-api';
import { MongoClient } from 'mongodb';
import { readAdminConfig } from './config.server';
import { EncryptedMongoSessionStorage } from './session-storage.server';

const config = readAdminConfig(process.env);
// Vite reloads server modules during development; retain one bounded connection pool.
const globalDatabase = globalThis as typeof globalThis & { checkoutMongoClient?: MongoClient };
const client =
  globalDatabase.checkoutMongoClient ??
  new MongoClient(config.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });
if (process.env['NODE_ENV'] !== 'production') globalDatabase.checkoutMongoClient = client;
export const sessionStorage = new EncryptedMongoSessionStorage(
  client.db(config.MONGODB_DATABASE),
  config.encryptionKey,
);
export const publicApiKey = config.SHOPIFY_API_KEY;
const shopify = shopifyApp({
  apiKey: config.SHOPIFY_API_KEY,
  apiSecretKey: config.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October26,
  appUrl: config.SHOPIFY_APP_URL,
  authPathPrefix: '/auth',
  scopes: [],
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
export const authenticate = shopify.authenticate;
export const login = shopify.login;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
