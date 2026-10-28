import type { Collection, Db } from 'mongodb';

export type CheckoutEventType =
  | 'started'
  | 'logged_in'
  | 'address_added'
  | 'discount_applied'
  | 'payment_selected'
  | 'checkout_completed'
  | 'checkout_abandoned'
  | 'step_viewed';

export type CheckoutFunnelStep =
  'started' | 'login' | 'address' | 'discounts' | 'payment' | 'complete';

export type CheckoutEventRecord = {
  _id?: string | undefined;
  shop: string;
  sessionId: string;
  event: CheckoutEventType;
  step: CheckoutFunnelStep;
  timestamp: string; // ISO 8601
  shopperPhone?: string | undefined;
  customerId?: string | undefined;
  cartValueMinor?: number | undefined;
  itemCount?: number | undefined;
  discountMinor?: number | undefined;
  couponCode?: string | undefined;
  paymentMethod?: string | undefined;
  orderId?: string | undefined;
  orderName?: string | undefined;
  orderGid?: string | undefined;
  device?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type CheckoutFunnelRecord = {
  _id: string; // sessionId
  shop: string;
  sessionId: string;
  source: 'buy_now' | 'cart';
  status: CheckoutEventType;
  currentStep: CheckoutFunnelStep;
  cartValueMinor: number;
  currency: string;
  itemCount: number;
  items: Array<{ title: string; quantity: number; amountMinor: number }>;
  shopperPhone?: string | undefined;
  customerId?: string | undefined;
  shopperName?: string | undefined;
  address?:
    | {
        locality?: string | undefined;
        region?: string | undefined;
        postalCode?: string | undefined;
      }
    | undefined;
  couponCode?: string | undefined;
  discountMinor?: number | undefined;
  paymentMethod?: string | undefined;
  orderId?: string | undefined;
  orderName?: string | undefined;
  completed: boolean;
  completedAt?: string | undefined;
  abandonedAt?: string | undefined;
  droppedAt?: string | undefined; // 'Login' | 'Address' | 'Discounts' | 'Payment'
  device?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type RecordEventInput = {
  shop: string;
  sessionId: string;
  event: CheckoutEventType;
  step?: CheckoutFunnelStep | undefined;
  shopperPhone?: string | undefined;
  customerId?: string | undefined;
  cartValueMinor?: number | undefined;
  itemCount?: number | undefined;
  items?: Array<{ title: string; quantity: number; amountMinor: number }> | undefined;
  discountMinor?: number | undefined;
  couponCode?: string | undefined;
  paymentMethod?: string | undefined;
  orderId?: string | undefined;
  orderName?: string | undefined;
  orderGid?: string | undefined;
  device?: string | undefined;
  source?: ('buy_now' | 'cart') | undefined;
  address?:
    | {
        locality?: string | undefined;
        region?: string | undefined;
        postalCode?: string | undefined;
      }
    | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type FunnelStats = {
  shop: string;
  totalStarted: number;
  totalLoggedIn: number;
  totalAddressAdded: number;
  totalDiscountApplied: number;
  totalCompleted: number;
  totalAbandoned: number;
  conversionRatePercent: number;
  dropOffByStep: {
    login: number;
    address: number;
    discounts: number;
    payment: number;
  };
};

export type AbandonedCheckoutSummary = {
  sessionId: string;
  shopperPhone?: string | undefined;
  shopperName?: string | undefined;
  cartValueMinor: number;
  itemCount: number;
  items: Array<{ title: string; quantity: number; amountMinor: number }>;
  droppedAt: string;
  updatedAt: string;
  createdAt: string;
};

function normalizeShop(shop: string): string {
  return shop.trim().toLowerCase();
}

function mapEventToStep(event: CheckoutEventType): CheckoutFunnelStep {
  switch (event) {
    case 'started':
      return 'started';
    case 'logged_in':
      return 'login';
    case 'address_added':
      return 'address';
    case 'discount_applied':
      return 'discounts';
    case 'payment_selected':
      return 'payment';
    case 'checkout_completed':
      return 'complete';
    case 'checkout_abandoned':
      return 'payment';
    case 'step_viewed':
      return 'started';
  }
}

function mapStepToDroppedAt(step: CheckoutFunnelStep): string {
  switch (step) {
    case 'started':
    case 'login':
      return 'Login';
    case 'address':
      return 'Address';
    case 'discounts':
      return 'Discounts';
    case 'payment':
      return 'Payment';
    case 'complete':
      return 'Complete';
  }
}

// In-memory fallback for test environment and when MongoDB is not connected
type MemoryAnalyticsState = {
  events: CheckoutEventRecord[];
  funnels: Map<string, CheckoutFunnelRecord>;
};

function newMemoryState(): MemoryAnalyticsState {
  return {
    events: [],
    funnels: new Map(),
  };
}

const sharedMemoryAnalytics: MemoryAnalyticsState =
  (globalThis as typeof globalThis & { __ecAnalyticsState?: MemoryAnalyticsState })
    .__ecAnalyticsState ?? newMemoryState();
(
  globalThis as typeof globalThis & { __ecAnalyticsState?: MemoryAnalyticsState }
).__ecAnalyticsState = sharedMemoryAnalytics;

async function mongoDb(): Promise<Db | null> {
  if (process.env['NODE_ENV'] === 'test') return null;
  try {
    const { connectMongo } = await import('./shopify.server');
    return await connectMongo();
  } catch {
    return null;
  }
}

async function eventsCollection(db: Db): Promise<Collection<CheckoutEventRecord>> {
  const col = db.collection<CheckoutEventRecord>('checkoutEvents');
  try {
    void col.createIndex({ shop: 1, sessionId: 1, timestamp: -1 });
    void col.createIndex({ shop: 1, event: 1, timestamp: -1 });
  } catch (_) {}
  return col;
}

async function funnelsCollection(db: Db): Promise<Collection<CheckoutFunnelRecord>> {
  const col = db.collection<CheckoutFunnelRecord>('checkoutFunnels');
  try {
    void col.createIndex({ shop: 1, updatedAt: -1 });
    void col.createIndex({ shop: 1, completed: 1, updatedAt: -1 });
  } catch (_) {}
  return col;
}

/**
 * Records a checkout event and updates the funnel state for conversion/abandonment tracking.
 */
export async function recordCheckoutEvent(input: RecordEventInput): Promise<CheckoutEventRecord> {
  const shop = normalizeShop(input.shop);
  const sessionId = String(input.sessionId || '').trim();
  const timestamp = new Date().toISOString();
  const step = input.step || mapEventToStep(input.event);

  const record: CheckoutEventRecord = {
    shop,
    sessionId,
    event: input.event,
    step,
    timestamp,
    ...(input.shopperPhone ? { shopperPhone: input.shopperPhone } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(typeof input.cartValueMinor === 'number' ? { cartValueMinor: input.cartValueMinor } : {}),
    ...(typeof input.itemCount === 'number' ? { itemCount: input.itemCount } : {}),
    ...(typeof input.discountMinor === 'number' ? { discountMinor: input.discountMinor } : {}),
    ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    ...(input.orderId ? { orderId: input.orderId } : {}),
    ...(input.orderName ? { orderName: input.orderName } : {}),
    ...(input.orderGid ? { orderGid: input.orderGid } : {}),
    ...(input.device ? { device: input.device } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  const isComplete = input.event === 'checkout_completed';
  const isAbandoned = input.event === 'checkout_abandoned';

  // Update in-memory state
  sharedMemoryAnalytics.events.push(record);
  if (sharedMemoryAnalytics.events.length > 2000) {
    sharedMemoryAnalytics.events.splice(0, sharedMemoryAnalytics.events.length - 2000);
  }

  if (sessionId) {
    const existing = sharedMemoryAnalytics.funnels.get(sessionId);
    const updatedFunnel: CheckoutFunnelRecord = {
      _id: sessionId,
      shop,
      sessionId,
      source: input.source || existing?.source || 'cart',
      status: input.event,
      currentStep: step,
      cartValueMinor: input.cartValueMinor ?? existing?.cartValueMinor ?? 0,
      currency: 'INR',
      itemCount: input.itemCount ?? existing?.itemCount ?? 1,
      items: input.items ?? existing?.items ?? [],
      shopperPhone: input.shopperPhone || existing?.shopperPhone,
      customerId: input.customerId || existing?.customerId,
      shopperName: (input.metadata?.['fullName'] as string) || existing?.shopperName,
      address: input.address || existing?.address,
      couponCode: input.couponCode || existing?.couponCode,
      discountMinor: input.discountMinor ?? existing?.discountMinor,
      paymentMethod: input.paymentMethod || existing?.paymentMethod,
      orderId: input.orderId || existing?.orderId,
      orderName: input.orderName || existing?.orderName,
      completed: isComplete || (existing?.completed ?? false),
      completedAt: isComplete ? timestamp : existing?.completedAt,
      abandonedAt: isAbandoned ? timestamp : existing?.abandonedAt,
      droppedAt: isComplete ? undefined : mapStepToDroppedAt(step),
      device: input.device || existing?.device,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    sharedMemoryAnalytics.funnels.set(sessionId, updatedFunnel);
  }

  // Persist to MongoDB if connected
  try {
    const db = await mongoDb();
    if (db) {
      const eventsCol = await eventsCollection(db);
      await eventsCol.insertOne({ ...record });

      if (sessionId) {
        const funnelsCol = await funnelsCollection(db);
        const updateFields: Record<string, unknown> = {
          shop,
          sessionId,
          status: input.event,
          currentStep: step,
          updatedAt: timestamp,
        };
        if (input.source) updateFields['source'] = input.source;
        if (typeof input.cartValueMinor === 'number')
          updateFields['cartValueMinor'] = input.cartValueMinor;
        if (typeof input.itemCount === 'number') updateFields['itemCount'] = input.itemCount;
        if (input.items) updateFields['items'] = input.items;
        if (input.shopperPhone) updateFields['shopperPhone'] = input.shopperPhone;
        if (input.customerId) updateFields['customerId'] = input.customerId;
        if (input.address) updateFields['address'] = input.address;
        if (input.couponCode) updateFields['couponCode'] = input.couponCode;
        if (typeof input.discountMinor === 'number')
          updateFields['discountMinor'] = input.discountMinor;
        if (input.paymentMethod) updateFields['paymentMethod'] = input.paymentMethod;
        if (input.orderId) updateFields['orderId'] = input.orderId;
        if (input.orderName) updateFields['orderName'] = input.orderName;
        if (input.device) updateFields['device'] = input.device;

        if (isComplete) {
          updateFields['completed'] = true;
          updateFields['completedAt'] = timestamp;
          updateFields['droppedAt'] = null;
        } else if (isAbandoned) {
          updateFields['abandonedAt'] = timestamp;
          updateFields['droppedAt'] = mapStepToDroppedAt(step);
        } else {
          updateFields['droppedAt'] = mapStepToDroppedAt(step);
        }

        await funnelsCol.updateOne(
          { _id: sessionId },
          {
            $set: updateFields,
            $setOnInsert: {
              _id: sessionId,
              currency: 'INR',
              completed: false,
              createdAt: timestamp,
            },
          },
          { upsert: true },
        );
      }
    }
  } catch (err) {
    console.warn('[CheckoutEvents] mongo write error', (err as Error).message);
  }

  return record;
}

/**
 * Computes high-level conversion rate and funnel drop-off stats.
 */
export async function getCheckoutFunnelStats(shop: string): Promise<FunnelStats> {
  const normShop = normalizeShop(shop);

  try {
    const db = await mongoDb();
    if (db) {
      const funnelsCol = await funnelsCollection(db);
      const query = normShop ? { shop: normShop } : {};
      const allFunnels = await funnelsCol.find(query).toArray();

      const totalStarted = allFunnels.length;
      let totalLoggedIn = 0;
      let totalAddressAdded = 0;
      let totalDiscountApplied = 0;
      let totalCompleted = 0;
      let totalAbandoned = 0;
      const dropOffByStep = { login: 0, address: 0, discounts: 0, payment: 0 };

      for (const f of allFunnels) {
        if (f.shopperPhone) totalLoggedIn++;
        if (f.address?.postalCode) totalAddressAdded++;
        if (f.couponCode || (f.discountMinor ?? 0) > 0) totalDiscountApplied++;
        if (f.completed) {
          totalCompleted++;
        } else {
          totalAbandoned++;
          const dropped = f.droppedAt?.toLowerCase() || 'login';
          if (dropped.includes('login')) dropOffByStep.login++;
          else if (dropped.includes('address')) dropOffByStep.address++;
          else if (dropped.includes('discount')) dropOffByStep.discounts++;
          else dropOffByStep.payment++;
        }
      }

      const conversionRatePercent =
        totalStarted > 0 ? Number(((totalCompleted / totalStarted) * 100).toFixed(1)) : 0;

      return {
        shop: normShop,
        totalStarted,
        totalLoggedIn,
        totalAddressAdded,
        totalDiscountApplied,
        totalCompleted,
        totalAbandoned,
        conversionRatePercent,
        dropOffByStep,
      };
    }
  } catch (err) {
    console.warn('[CheckoutEvents] mongo query error', (err as Error).message);
  }

  // Memory fallback
  const list = Array.from(sharedMemoryAnalytics.funnels.values()).filter(
    (f) => !normShop || f.shop === normShop,
  );
  const totalStarted = list.length;
  let totalLoggedIn = 0;
  let totalAddressAdded = 0;
  let totalDiscountApplied = 0;
  let totalCompleted = 0;
  let totalAbandoned = 0;
  const dropOffByStep = { login: 0, address: 0, discounts: 0, payment: 0 };

  for (const f of list) {
    if (f.shopperPhone) totalLoggedIn++;
    if (f.address?.postalCode) totalAddressAdded++;
    if (f.couponCode || (f.discountMinor ?? 0) > 0) totalDiscountApplied++;
    if (f.completed) {
      totalCompleted++;
    } else {
      totalAbandoned++;
      const dropped = f.droppedAt?.toLowerCase() || 'login';
      if (dropped.includes('login')) dropOffByStep.login++;
      else if (dropped.includes('address')) dropOffByStep.address++;
      else if (dropped.includes('discount')) dropOffByStep.discounts++;
      else dropOffByStep.payment++;
    }
  }

  const conversionRatePercent =
    totalStarted > 0 ? Number(((totalCompleted / totalStarted) * 100).toFixed(1)) : 0;

  return {
    shop: normShop,
    totalStarted,
    totalLoggedIn,
    totalAddressAdded,
    totalDiscountApplied,
    totalCompleted,
    totalAbandoned,
    conversionRatePercent,
    dropOffByStep,
  };
}

/**
 * Returns recent abandoned checkout sessions with customer, cart value, and drop-off stage.
 */
export async function getAbandonedCheckouts(
  shop: string,
  limit = 50,
): Promise<AbandonedCheckoutSummary[]> {
  const normShop = normalizeShop(shop);

  try {
    const db = await mongoDb();
    if (db) {
      const funnelsCol = await funnelsCollection(db);
      const query: Record<string, unknown> = { completed: false };
      if (normShop) query['shop'] = normShop;
      const records = await funnelsCol
        .find(query)
        .sort({ updatedAt: -1 })
        .limit(Math.min(100, Math.max(1, limit)))
        .toArray();

      return records.map((r) => ({
        sessionId: r.sessionId,
        shopperPhone: r.shopperPhone,
        shopperName: r.shopperName,
        cartValueMinor: r.cartValueMinor || 0,
        itemCount: r.itemCount || 1,
        items: r.items || [],
        droppedAt: r.droppedAt || 'Payment',
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
    }
  } catch (err) {
    console.warn('[CheckoutEvents] mongo query error', (err as Error).message);
  }

  // Memory fallback
  return Array.from(sharedMemoryAnalytics.funnels.values())
    .filter((f) => (!normShop || f.shop === normShop) && !f.completed)
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({
      sessionId: r.sessionId,
      shopperPhone: r.shopperPhone,
      shopperName: r.shopperName,
      cartValueMinor: r.cartValueMinor || 0,
      itemCount: r.itemCount || 1,
      items: r.items || [],
      droppedAt: r.droppedAt || 'Payment',
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    }));
}

/**
 * Returns recent raw checkout events for debugging and audit logs.
 */
export async function getRecentCheckoutEvents(
  shop: string,
  sessionId?: string,
  limit = 50,
): Promise<CheckoutEventRecord[]> {
  const normShop = normalizeShop(shop);

  try {
    const db = await mongoDb();
    if (db) {
      const eventsCol = await eventsCollection(db);
      const query: Record<string, unknown> = {};
      if (normShop) query['shop'] = normShop;
      if (sessionId) query['sessionId'] = sessionId;
      return await eventsCol
        .find(query)
        .sort({ timestamp: -1 })
        .limit(Math.min(100, Math.max(1, limit)))
        .toArray();
    }
  } catch (err) {
    console.warn('[CheckoutEvents] mongo query error', (err as Error).message);
  }

  return sharedMemoryAnalytics.events
    .filter((e) => (!normShop || e.shop === normShop) && (!sessionId || e.sessionId === sessionId))
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, limit);
}

/** Clears in-memory analytics store (used in tests). */
export function resetMemoryAnalytics() {
  sharedMemoryAnalytics.events = [];
  sharedMemoryAnalytics.funnels.clear();
}
