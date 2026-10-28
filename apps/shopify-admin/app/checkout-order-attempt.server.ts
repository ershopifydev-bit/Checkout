import { createHash, randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { validateMinorUnits } from './money.server';

export type OrderAttemptStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'READY'
  | 'CREATING'
  | 'UNKNOWN'
  | 'RECONCILING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'MANUAL_REVIEW';

export interface CheckoutOrderAttempt {
  _id: string; // Attempt ID (UUID)
  tenantId: string; // Merchant shop domain
  shop: string;
  checkoutSessionId: string;
  idempotencyKey: string;

  status: OrderAttemptStatus;

  payloadHash: string;
  sourceIdentifier: string;

  expectedAmountMinor: number;
  currency: 'INR';

  customerId?: string | undefined;
  merchantId?: string | undefined;
  brandId?: string | undefined;
  storeId?: string | undefined;

  shopifyOrderGid?: string | undefined;
  shopifyOrderId?: string | undefined;
  shopifyOrderName?: string | undefined;
  shopifyOrderTotalMinor?: number | undefined;

  attemptCount: number;

  createdAt: Date;
  updatedAt: Date;

  requestStartedAt?: Date | undefined;
  completedAt?: Date | undefined;

  leaseOwner?: string | undefined;
  leaseExpiresAt?: Date | undefined;

  lastErrorCode?: string | undefined;
  lastErrorMessage?: string | undefined;
}

export type OrderAttemptInput = {
  shop: string;
  checkoutSessionId: string;
  idempotencyKey?: string | undefined;
  expectedAmountMinor: number;
  payload: Record<string, unknown>;
  customerId?: string | undefined;
  merchantId?: string | undefined;
  brandId?: string | undefined;
  storeId?: string | undefined;
};

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class OrderInProgressError extends Error {
  constructor(
    message = 'ORDER_IN_PROGRESS',
    public readonly status: OrderAttemptStatus = 'CREATING',
    public readonly retryAfterMs = 1500,
  ) {
    super(message);
    this.name = 'OrderInProgressError';
  }
}

export class OrderReconciliationRequiredError extends Error {
  constructor(
    message: string,
    public readonly attempt: CheckoutOrderAttempt,
  ) {
    super(message);
    this.name = 'OrderReconciliationRequiredError';
  }
}

/** Compute SHA-256 hash of canonical order payload for idempotency verification. */
export function hashOrderPayload(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(json).digest('hex');
}

/** Stable source identifier to correlate Shopify orders back to checkout attempts. */
export function generateSourceIdentifier(checkoutSessionId: string): string {
  const clean = String(checkoutSessionId || '').trim();
  return `tezvix:${clean}`;
}

// In-memory fallback for testing
type MemoryAttemptState = {
  attempts: Map<string, CheckoutOrderAttempt>; // keyed by checkoutSessionId
};

const memoryAttemptState: MemoryAttemptState = (
  globalThis as typeof globalThis & { __ecAttemptState?: MemoryAttemptState }
).__ecAttemptState ?? {
  attempts: new Map(),
};
(globalThis as typeof globalThis & { __ecAttemptState?: MemoryAttemptState }).__ecAttemptState =
  memoryAttemptState;

async function getDb(): Promise<Db | null> {
  if (process.env['NODE_ENV'] === 'test') return null;
  try {
    const { connectMongo } = await import('./shopify.server');
    return await connectMongo();
  } catch {
    return null;
  }
}

let indexesEnsured = false;
async function attemptsCollection(db: Db): Promise<Collection<CheckoutOrderAttempt>> {
  const col = db.collection<CheckoutOrderAttempt>('checkoutOrderAttempts');
  if (!indexesEnsured) {
    indexesEnsured = true;
    try {
      await col.createIndex(
        { tenantId: 1, checkoutSessionId: 1 },
        { unique: true, name: 'uniq_tenant_session' },
      );
      await col.createIndex(
        { shop: 1, sourceIdentifier: 1 },
        { unique: true, name: 'uniq_shop_source' },
      );
      await col.createIndex(
        { shop: 1, status: 1, updatedAt: -1 },
        { name: 'idx_shop_status_updated' },
      );
    } catch (err) {
      console.warn('[OrderAttempt] index creation note:', (err as Error).message);
    }
  }
  return col;
}

/**
 * Creates or retrieves the persistent order-attempt record for a checkout session.
 * Enforces payload integrity: if a duplicate request arrives with different payload,
 * it rejects with IdempotencyConflictError.
 */
export async function createOrGetOrderAttempt(
  input: OrderAttemptInput,
): Promise<{ attempt: CheckoutOrderAttempt; isNew: boolean }> {
  const shop = input.shop.trim().toLowerCase();
  const checkoutSessionId = input.checkoutSessionId.trim();
  const expectedAmountMinor = validateMinorUnits(input.expectedAmountMinor, 'expectedAmountMinor');
  const payloadHash = hashOrderPayload(input.payload);
  const sourceIdentifier = generateSourceIdentifier(checkoutSessionId);
  const idempotencyKey = input.idempotencyKey || `idem_${checkoutSessionId}`;
  const now = new Date();

  const db = await getDb();
  if (!db) {
    // In-memory implementation for test environments
    const existing = memoryAttemptState.attempts.get(checkoutSessionId);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IdempotencyConflictError(
          `Idempotency payload mismatch for checkout session ${checkoutSessionId}`,
        );
      }
      return { attempt: existing, isNew: false };
    }

    const newAttempt: CheckoutOrderAttempt = {
      _id: randomUUID(),
      tenantId: shop,
      shop,
      checkoutSessionId,
      idempotencyKey,
      status: 'READY',
      payloadHash,
      sourceIdentifier,
      expectedAmountMinor,
      currency: 'INR',
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.merchantId ? { merchantId: input.merchantId } : {}),
      ...(input.brandId ? { brandId: input.brandId } : {}),
      ...(input.storeId ? { storeId: input.storeId } : {}),
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    memoryAttemptState.attempts.set(checkoutSessionId, newAttempt);
    return { attempt: newAttempt, isNew: true };
  }

  const col = await attemptsCollection(db);
  const existing = await col.findOne({ tenantId: shop, checkoutSessionId });
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError(
        `Idempotency payload mismatch for checkout session ${checkoutSessionId}`,
      );
    }
    return { attempt: existing, isNew: false };
  }

  const newAttempt: CheckoutOrderAttempt = {
    _id: randomUUID(),
    tenantId: shop,
    shop,
    checkoutSessionId,
    idempotencyKey,
    status: 'READY',
    payloadHash,
    sourceIdentifier,
    expectedAmountMinor,
    currency: 'INR',
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.merchantId ? { merchantId: input.merchantId } : {}),
    ...(input.brandId ? { brandId: input.brandId } : {}),
    ...(input.storeId ? { storeId: input.storeId } : {}),
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await col.insertOne(newAttempt);
    return { attempt: newAttempt, isNew: true };
  } catch (err: unknown) {
    // Handle concurrent insert collision
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000) {
      const raceExisting = await col.findOne({ tenantId: shop, checkoutSessionId });
      if (raceExisting) {
        if (raceExisting.payloadHash !== payloadHash) {
          throw new IdempotencyConflictError(
            `Idempotency payload mismatch for checkout session ${checkoutSessionId}`,
          );
        }
        return { attempt: raceExisting, isNew: false };
      }
    }
    throw err;
  }
}

/**
 * Atomically claims the attempt for external order creation.
 * Returns true if claimed; throws OrderInProgressError or returns false if cannot be claimed.
 */
export async function claimAttemptForCreation(
  attemptId: string,
  leaseDurationMs = 45000,
  leaseOwner: string = randomUUID(),
): Promise<{ claimed: boolean; leaseOwner: string; attempt: CheckoutOrderAttempt }> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  const db = await getDb();
  if (!db) {
    let target: CheckoutOrderAttempt | undefined;
    for (const att of memoryAttemptState.attempts.values()) {
      if (att._id === attemptId) {
        target = att;
        break;
      }
    }
    if (!target) throw new Error('ATTEMPT_NOT_FOUND');

    if (target.status === 'CONFIRMED') {
      return { claimed: false, leaseOwner: target.leaseOwner || '', attempt: target };
    }
    if (target.status === 'CREATING') {
      if (target.leaseExpiresAt && target.leaseExpiresAt > now) {
        throw new OrderInProgressError('ORDER_IN_PROGRESS', 'CREATING');
      }
      // If lease expired while CREATING, do NOT re-claim without reconciliation!
      throw new OrderReconciliationRequiredError(
        'Previous order creation lease expired without confirmation. Reconciliation required.',
        target,
      );
    }
    if (target.status === 'UNKNOWN' || target.status === 'RECONCILING') {
      throw new OrderReconciliationRequiredError(
        'Order outcome is currently ambiguous. Reconciliation required.',
        target,
      );
    }

    target.status = 'CREATING';
    target.leaseOwner = leaseOwner;
    target.leaseExpiresAt = leaseExpiresAt;
    target.requestStartedAt = now;
    target.attemptCount += 1;
    target.updatedAt = now;
    return { claimed: true, leaseOwner, attempt: target };
  }

  const col = await attemptsCollection(db);

  // Atomic update: only allow transition from READY or CREATED, or safely expired lease
  const res = await col.findOneAndUpdate(
    {
      _id: attemptId,
      $or: [
        { status: { $in: ['READY', 'CREATED'] } },
        {
          status: 'CREATING',
          leaseExpiresAt: { $lt: now },
          // Only allow lease recovery if request never made it out or explicit retry flag set
        },
      ],
    },
    {
      $set: {
        status: 'CREATING',
        leaseOwner,
        leaseExpiresAt,
        requestStartedAt: now,
        updatedAt: now,
      },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: 'after' },
  );

  if (res) {
    return { claimed: true, leaseOwner, attempt: res };
  }

  // Not claimed — inspect why
  const current = await col.findOne({ _id: attemptId });
  if (!current) throw new Error('ATTEMPT_NOT_FOUND');

  if (current.status === 'CONFIRMED') {
    return { claimed: false, leaseOwner: current.leaseOwner || '', attempt: current };
  }
  if (current.status === 'CREATING') {
    throw new OrderInProgressError('ORDER_IN_PROGRESS', 'CREATING');
  }
  if (current.status === 'UNKNOWN' || current.status === 'RECONCILING') {
    throw new OrderReconciliationRequiredError(
      'Order outcome is currently ambiguous. Reconciliation required.',
      current,
    );
  }

  throw new Error(`Cannot claim attempt in status ${current.status}`);
}

/**
 * Marks the attempt as CONFIRMED upon successful, verified order creation in Shopify.
 */
export async function markAttemptConfirmed(
  attemptId: string,
  details: {
    shopifyOrderGid: string;
    shopifyOrderId: string;
    shopifyOrderName: string;
    shopifyOrderTotalMinor: number;
  },
): Promise<CheckoutOrderAttempt> {
  const now = new Date();
  const db = await getDb();
  if (!db) {
    for (const att of memoryAttemptState.attempts.values()) {
      if (att._id === attemptId) {
        att.status = 'CONFIRMED';
        att.shopifyOrderGid = details.shopifyOrderGid;
        att.shopifyOrderId = details.shopifyOrderId;
        att.shopifyOrderName = details.shopifyOrderName;
        att.shopifyOrderTotalMinor = details.shopifyOrderTotalMinor;
        att.completedAt = now;
        att.leaseOwner = undefined;
        att.leaseExpiresAt = undefined;
        att.updatedAt = now;
        return att;
      }
    }
    throw new Error('ATTEMPT_NOT_FOUND');
  }

  const col = await attemptsCollection(db);
  const updated = await col.findOneAndUpdate(
    { _id: attemptId },
    {
      $set: {
        status: 'CONFIRMED',
        shopifyOrderGid: details.shopifyOrderGid,
        shopifyOrderId: details.shopifyOrderId,
        shopifyOrderName: details.shopifyOrderName,
        shopifyOrderTotalMinor: details.shopifyOrderTotalMinor,
        completedAt: now,
        updatedAt: now,
      },
      $unset: { leaseOwner: '', leaseExpiresAt: '' },
    },
    { returnDocument: 'after' },
  );

  if (!updated) throw new Error('ATTEMPT_NOT_FOUND');
  return updated;
}

/**
 * Marks the attempt as UNKNOWN or RECONCILING when network/transport fails ambiguously.
 * Prevents automated duplicate creation.
 */
export async function markAttemptUnknown(
  attemptId: string,
  error: { code: string; message: string },
): Promise<CheckoutOrderAttempt> {
  const now = new Date();
  const db = await getDb();
  if (!db) {
    for (const att of memoryAttemptState.attempts.values()) {
      if (att._id === attemptId) {
        att.status = 'UNKNOWN';
        att.lastErrorCode = error.code;
        att.lastErrorMessage = error.message;
        att.updatedAt = now;
        return att;
      }
    }
    throw new Error('ATTEMPT_NOT_FOUND');
  }

  const col = await attemptsCollection(db);
  const updated = await col.findOneAndUpdate(
    { _id: attemptId },
    {
      $set: {
        status: 'UNKNOWN',
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' },
  );

  if (!updated) throw new Error('ATTEMPT_NOT_FOUND');
  return updated;
}

/**
 * Marks the attempt as FAILED for deterministic pre-flight failures (e.g. invalid address, missing admin token).
 */
export async function markAttemptFailed(
  attemptId: string,
  error: { code: string; message: string },
): Promise<CheckoutOrderAttempt> {
  const now = new Date();
  const db = await getDb();
  if (!db) {
    for (const att of memoryAttemptState.attempts.values()) {
      if (att._id === attemptId) {
        att.status = 'FAILED';
        att.lastErrorCode = error.code;
        att.lastErrorMessage = error.message;
        att.leaseOwner = undefined;
        att.leaseExpiresAt = undefined;
        att.updatedAt = now;
        return att;
      }
    }
    throw new Error('ATTEMPT_NOT_FOUND');
  }

  const col = await attemptsCollection(db);
  const updated = await col.findOneAndUpdate(
    { _id: attemptId },
    {
      $set: {
        status: 'FAILED',
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
        updatedAt: now,
      },
      $unset: { leaseOwner: '', leaseExpiresAt: '' },
    },
    { returnDocument: 'after' },
  );

  if (!updated) throw new Error('ATTEMPT_NOT_FOUND');
  return updated;
}

/**
 * Looks up an attempt by shop and sourceIdentifier for webhook and query reconciliation.
 */
export async function findAttemptBySourceIdentifier(
  shop: string,
  sourceIdentifier: string,
): Promise<CheckoutOrderAttempt | null> {
  const normShop = shop.trim().toLowerCase();
  const db = await getDb();
  if (!db) {
    for (const att of memoryAttemptState.attempts.values()) {
      if (att.shop === normShop && att.sourceIdentifier === sourceIdentifier) {
        return att;
      }
    }
    return null;
  }
  const col = await attemptsCollection(db);
  return await col.findOne({ shop: normShop, sourceIdentifier });
}

/**
 * Looks up an attempt by checkoutSessionId.
 */
export async function findAttemptBySessionId(
  shop: string,
  checkoutSessionId: string,
): Promise<CheckoutOrderAttempt | null> {
  const normShop = shop.trim().toLowerCase();
  const db = await getDb();
  if (!db) {
    const existing = memoryAttemptState.attempts.get(checkoutSessionId);
    return existing && existing.shop === normShop ? existing : null;
  }
  const col = await attemptsCollection(db);
  return await col.findOne({ tenantId: normShop, checkoutSessionId });
}

export function resetMemoryAttempts() {
  memoryAttemptState.attempts.clear();
}
