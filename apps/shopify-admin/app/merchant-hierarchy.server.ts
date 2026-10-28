import type { Db } from 'mongodb';
import type { Brand, Merchant, Store } from './types/universal-customer';

// In-memory fallback for testing
const memoryHierarchy = {
  merchants: new Map<string, Merchant>(),
  brands: new Map<string, Brand>(),
  stores: new Map<string, Store>(),
};

export function resetMemoryHierarchy(): void {
  memoryHierarchy.merchants.clear();
  memoryHierarchy.brands.clear();
  memoryHierarchy.stores.clear();
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
async function ensureHierarchyIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    const storesCol = db.collection<Store>('stores');
    await storesCol.createIndex(
      { shopifyDomain: 1 },
      { unique: true, sparse: true, name: 'uniq_shopify_domain' },
    );
    await storesCol.createIndex({ merchantId: 1, brandId: 1 }, { name: 'idx_merchant_brand' });

    const brandsCol = db.collection<Brand>('brands');
    await brandsCol.createIndex({ merchantId: 1 }, { name: 'idx_merchant_id' });

    const merchantsCol = db.collection<Merchant>('merchants');
    await merchantsCol.createIndex({ status: 1 }, { name: 'idx_merchant_status' });
  } catch (err) {
    console.warn('[MerchantHierarchy] Index warning:', (err as Error).message);
  }
}

/**
 * Resolves or auto-provisions Merchant, Brand, and Store context for a Shopify domain.
 */
export async function resolveMerchantStoreContext(shopifyDomain: string): Promise<{
  merchant: Merchant;
  brand: Brand;
  store: Store;
}> {
  const normShop = shopifyDomain.trim().toLowerCase();
  const db = await getDb();

  if (!db) {
    // Memory fallback
    let matchedStore: Store | undefined;
    for (const s of memoryHierarchy.stores.values()) {
      if (s.shopifyDomain === normShop) {
        matchedStore = s;
        break;
      }
    }

    if (matchedStore) {
      const brand = memoryHierarchy.brands.get(matchedStore.brandId);
      const merchant = memoryHierarchy.merchants.get(matchedStore.merchantId);
      if (brand && merchant) {
        return { merchant, brand, store: matchedStore };
      }
    }

    // Provision default memory hierarchy
    const merchantId = `merch_${normShop.replace(/[^a-z0-9]/g, '_')}`;
    const brandId = `brand_${normShop.replace(/[^a-z0-9]/g, '_')}`;
    const storeId = `store_${normShop.replace(/[^a-z0-9]/g, '_')}`;
    const now = new Date();

    const merchant: Merchant = {
      _id: merchantId,
      name: normShop.split('.')[0] || normShop,
      legalEntityName: `${normShop} Retail Pvt Ltd`,
      country: 'IN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    const brand: Brand = {
      _id: brandId,
      merchantId,
      name: merchant.name,
      code: merchant.name.toUpperCase(),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    const store: Store = {
      _id: storeId,
      merchantId,
      brandId,
      name: `${brand.name} Online`,
      channel: 'ONLINE',
      platform: 'SHOPIFY',
      shopifyDomain: normShop,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    memoryHierarchy.merchants.set(merchantId, merchant);
    memoryHierarchy.brands.set(brandId, brand);
    memoryHierarchy.stores.set(storeId, store);

    return { merchant, brand, store };
  }

  await ensureHierarchyIndexes(db);
  const storesCol = db.collection<Store>('stores');
  const existingStore = await storesCol.findOne({ shopifyDomain: normShop });

  if (existingStore) {
    const brandsCol = db.collection<Brand>('brands');
    const merchantsCol = db.collection<Merchant>('merchants');

    const brand = await brandsCol.findOne({ _id: existingStore.brandId });
    const merchant = await merchantsCol.findOne({ _id: existingStore.merchantId });

    if (brand && merchant) {
      return { merchant, brand, store: existingStore };
    }
  }

  // Provision new default merchant/brand/store for new Shopify shop
  const merchantId = `merch_${normShop.replace(/[^a-z0-9]/g, '_')}`;
  const brandId = `brand_${normShop.replace(/[^a-z0-9]/g, '_')}`;
  const storeId = `store_${normShop.replace(/[^a-z0-9]/g, '_')}`;
  const now = new Date();

  const merchant: Merchant = {
    _id: merchantId,
    name: normShop.split('.')[0] || normShop,
    legalEntityName: `${normShop} Retail Pvt Ltd`,
    country: 'IN',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
  const brand: Brand = {
    _id: brandId,
    merchantId,
    name: merchant.name,
    code: merchant.name.toUpperCase(),
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
  const store: Store = {
    _id: storeId,
    merchantId,
    brandId,
    name: `${brand.name} Online`,
    channel: 'ONLINE',
    platform: 'SHOPIFY',
    shopifyDomain: normShop,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };

  const merchantsCol = db.collection<Merchant>('merchants');
  const brandsCol = db.collection<Brand>('brands');

  await merchantsCol.updateOne({ _id: merchantId }, { $setOnInsert: merchant }, { upsert: true });
  await brandsCol.updateOne({ _id: brandId }, { $setOnInsert: brand }, { upsert: true });
  await storesCol.updateOne({ _id: storeId }, { $setOnInsert: store }, { upsert: true });

  return { merchant, brand, store };
}

/**
 * Creates an offline or online store record explicitly.
 */
export async function createStore(input: Omit<Store, 'createdAt' | 'updatedAt'>): Promise<Store> {
  const now = new Date();
  const store: Store = {
    ...input,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  if (!db) {
    memoryHierarchy.stores.set(store._id, store);
    return store;
  }

  await ensureHierarchyIndexes(db);
  await db.collection<Store>('stores').insertOne(store);
  return store;
}

export async function getStore(storeId: string): Promise<Store | null> {
  const db = await getDb();
  if (!db) {
    return memoryHierarchy.stores.get(storeId) || null;
  }
  return await db.collection<Store>('stores').findOne({ _id: storeId });
}
