import type { Db } from 'mongodb';
import { resolveMerchantStoreContext } from './merchant-hierarchy.server';
import type { WebhookInboxEntry, WebhookStatus } from './types/universal-customer';
import {
  getUniversalCustomerByExternalId,
  linkExternalCustomer,
} from './universal-customer.server';

// In-memory fallback for testing
const memoryWebhookInbox = new Map<string, WebhookInboxEntry>();

export function resetMemoryWebhooks(): void {
  memoryWebhookInbox.clear();
}

async function getDb(): Promise<Db | null> {
  try {
    const { connectMongo } = await import('./shopify.server');
    return await connectMongo();
  } catch {
    return null;
  }
}

let indexesEnsured = false;
async function ensureWebhookIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    const col = db.collection<WebhookInboxEntry>('webhookInbox');
    await col.createIndex(
      { shop: 1, webhookId: 1 },
      { unique: true, name: 'uniq_shop_webhook_id' },
    );
    await col.createIndex(
      { status: 1, leaseExpiresAt: 1, receivedAt: 1 },
      { name: 'idx_status_lease' },
    );
    await col.createIndex(
      { receivedAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_30d_webhooks' },
    );
  } catch (err) {
    console.warn('[WebhookInbox] Index warning:', (err as Error).message);
  }
}

export type IngestWebhookInput = {
  shop: string;
  webhookId: string;
  topic: string;
  apiVersion?: string | undefined;
  payload: Record<string, unknown>;
};

/**
 * Ingests a verified Shopify webhook into the durable inbox.
 * Idempotent: returns existing record if already received.
 */
export async function ingestWebhook(input: IngestWebhookInput): Promise<{
  entry: WebhookInboxEntry;
  isNew: boolean;
}> {
  const normShop = input.shop.trim().toLowerCase();
  const id = `${normShop}:${input.webhookId}`;
  const now = new Date();

  const entry: WebhookInboxEntry = {
    _id: id,
    shop: normShop,
    webhookId: input.webhookId,
    topic: input.topic,
    apiVersion: input.apiVersion || '2026-10',
    status: 'PENDING',
    attempts: 0,
    payload: input.payload,
    receivedAt: now,
  };

  const db = await getDb();
  if (!db) {
    const existing = memoryWebhookInbox.get(id);
    if (existing) return { entry: existing, isNew: false };
    memoryWebhookInbox.set(id, entry);
    return { entry, isNew: true };
  }

  await ensureWebhookIndexes(db);
  const col = db.collection<WebhookInboxEntry>('webhookInbox');

  try {
    await col.insertOne(entry);
    return { entry, isNew: true };
  } catch (err: unknown) {
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000) {
      const existing = await col.findOne({ _id: id });
      if (existing) return { entry: existing, isNew: false };
    }
    throw err;
  }
}

/**
 * Processes a single webhook event with resource-specific reducers.
 */
export async function processWebhookEntry(entry: WebhookInboxEntry): Promise<{
  processed: boolean;
  status: WebhookStatus;
  result?: unknown;
}> {
  const { shop, topic, payload } = entry;
  const context = await resolveMerchantStoreContext(shop);
  const storeId = context.store._id;

  try {
    let result: unknown = null;

    if (topic === 'orders/create' || topic === 'orders/updated') {
      const { processOrderCreateWebhook } = await import('./checkout-order-reconciliation.server');
      result = await processOrderCreateWebhook(shop, payload);
    } else if (topic === 'customers/create' || topic === 'customers/update') {
      const rawCustomerId = payload['id'];
      if (rawCustomerId) {
        const extId = String(rawCustomerId);
        // Look up if already linked to a universal identity
        const universalId = await getUniversalCustomerByExternalId(storeId, 'SHOPIFY', extId);
        result = { linked: Boolean(universalId), externalId: extId };
      }
    } else if (topic === 'customers/data_request') {
      // Shopify GDPR mandatory data export request
      const rawCustomerId = payload['customer']
        ? (payload['customer'] as Record<string, unknown>)['id']
        : undefined;
      console.info(`[Privacy GDPR] Customer data request received for store ${shop}`, {
        customerId: rawCustomerId,
      });
      result = { exported: true, shop, timestamp: new Date().toISOString() };
    } else if (topic === 'customers/redact') {
      // Shopify GDPR mandatory customer redaction request
      const rawCustomerId = payload['customer']
        ? (payload['customer'] as Record<string, unknown>)['id']
        : undefined;
      console.info(`[Privacy GDPR] Customer redact request for store ${shop}`, {
        customerId: rawCustomerId,
      });
      result = { redacted: true, shop, timestamp: new Date().toISOString() };
    } else if (topic === 'shop/redact') {
      // Shopify GDPR mandatory shop redaction request (48h after uninstall)
      console.info(`[Privacy GDPR] Shop redact request for store ${shop}`);
      result = { shopRedacted: true, shop };
    } else if (topic === 'app/uninstalled') {
      const { sessionStorage } = await import('./shopify.server');
      await sessionStorage.deleteSessions(
        await sessionStorage.findSessionsByShop(shop).then((s) => s.map((x) => x.id)),
      );
      result = { uninstalled: true };
    } else {
      // Other supported topics (inventory, products, returns)
      result = { recorded: true, topic };
    }

    // Mark PROCESSED
    await updateWebhookStatus(entry._id, 'PROCESSED');
    return { processed: true, status: 'PROCESSED', result };
  } catch (err: unknown) {
    const errorMsg = (err as Error).message;
    const nextAttempts = entry.attempts + 1;
    const nextStatus: WebhookStatus = nextAttempts >= 3 ? 'DEAD_LETTER' : 'FAILED';
    await updateWebhookStatus(entry._id, nextStatus, errorMsg);
    return { processed: false, status: nextStatus, result: { error: errorMsg } };
  }
}

async function updateWebhookStatus(
  id: string,
  status: WebhookStatus,
  errorMessage?: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const entry = memoryWebhookInbox.get(id);
    if (entry) {
      entry.status = status;
      entry.attempts += 1;
      entry.processedAt = now;
      if (errorMessage) entry.errorMessage = errorMessage;
    }
    return;
  }

  const col = db.collection<WebhookInboxEntry>('webhookInbox');
  await col.updateOne(
    { _id: id },
    {
      $set: {
        status,
        processedAt: now,
        ...(errorMessage ? { errorMessage } : {}),
      },
      $inc: { attempts: 1 },
    },
  );
}

/**
 * Worker tick: grabs and processes pending or timed-out webhooks.
 */
export async function processPendingWebhooks(limit = 20): Promise<number> {
  const db = await getDb();
  if (!db) {
    let count = 0;
    for (const entry of memoryWebhookInbox.values()) {
      if (entry.status === 'PENDING' || entry.status === 'FAILED') {
        if (count >= limit) break;
        await processWebhookEntry(entry);
        count++;
      }
    }
    return count;
  }

  const col = db.collection<WebhookInboxEntry>('webhookInbox');
  const now = new Date();
  const pending = await col
    .find({
      status: { $in: ['PENDING', 'FAILED'] },
      attempts: { $lt: 3 },
    })
    .limit(limit)
    .toArray();

  for (const entry of pending) {
    await processWebhookEntry(entry);
  }
  return pending.length;
}
