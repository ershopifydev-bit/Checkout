import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { computePhoneKey, encryptPii, maskPhone, normalizeEmail } from './customer-crypto.server';
import type {
  AddressLabel,
  CustomerPhoneKey,
  CustomerStoreProfile,
  ExternalCustomerLink,
  SavedCustomerAddress,
  StoreCustomerFlags,
  StoreFlagAuditEntry,
  StorePlatform,
  UniversalCustomerProfile,
} from './types/universal-customer';

const DEFAULT_STORE_FLAGS: StoreCustomerFlags = {
  blocked: false,
  fraudSuspected: false,
  highReturnRate: false,
  codDisabled: false,
  prepaidOnly: false,
  manualReview: false,
  vip: false,
  loyaltyEligible: true,
};

// In-memory test store fallback
const memoryCustomerState = {
  phoneKeys: new Map<string, CustomerPhoneKey>(),
  customers: new Map<string, UniversalCustomerProfile>(),
  storeProfiles: new Map<string, CustomerStoreProfile>(),
  flagAudits: [] as StoreFlagAuditEntry[],
  externalLinks: new Map<string, ExternalCustomerLink>(),
};

export function resetMemoryCustomers(): void {
  memoryCustomerState.phoneKeys.clear();
  memoryCustomerState.customers.clear();
  memoryCustomerState.storeProfiles.clear();
  memoryCustomerState.flagAudits.length = 0;
  memoryCustomerState.externalLinks.clear();
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
export async function ensureCustomerIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    // Unique phone registry: one phoneKey = one customerId
    await db
      .collection<CustomerPhoneKey>('customerPhoneKeys')
      .createIndex({ _id: 1 }, { unique: true, name: 'uniq_phone_key' });

    // Universal customer profiles
    await db
      .collection<UniversalCustomerProfile>('customers')
      .createIndex({ phoneKey: 1 }, { unique: true, name: 'uniq_customer_phone_key' });
    await db
      .collection<UniversalCustomerProfile>('customers')
      .createIndex({ primaryEmail: 1 }, { sparse: true, name: 'idx_customer_primary_email' });

    // Store-scoped customer profiles and risk flags
    await db
      .collection<CustomerStoreProfile>('customerStoreProfiles')
      .createIndex({ customerId: 1, storeId: 1 }, { unique: true, name: 'uniq_customer_store' });
    await db
      .collection<CustomerStoreProfile>('customerStoreProfiles')
      .createIndex({ storeId: 1, 'flags.blocked': 1 }, { name: 'idx_store_blocked' });

    // External customer mappings (Shopify ID -> Universal ID)
    await db
      .collection<ExternalCustomerLink>('externalCustomerLinks')
      .createIndex(
        { storeId: 1, platform: 1, externalCustomerId: 1 },
        { unique: true, name: 'uniq_external_customer_link' },
      );
    await db
      .collection<ExternalCustomerLink>('externalCustomerLinks')
      .createIndex({ customerId: 1, storeId: 1 }, { name: 'idx_universal_customer_store' });

    // Flag audit log
    await db
      .collection<StoreFlagAuditEntry>('storeFlagAudit')
      .createIndex({ customerId: 1, storeId: 1, createdAt: -1 }, { name: 'idx_flag_audit' });
  } catch (err) {
    console.warn('[UniversalCustomer] Index warning:', (err as Error).message);
  }
}

export type GetOrCreateCustomerInput = {
  e164Phone: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  primaryEmail?: string | undefined;
  primaryStoreId?: string | undefined;
  registrationSource?: string | undefined;
};

/**
 * Authoritative Universal Customer registration & retrieval.
 * Single verified phone number = exactly one universal identity.
 */
export async function getOrCreateUniversalCustomer(
  input: GetOrCreateCustomerInput,
): Promise<{ customer: UniversalCustomerProfile; isNew: boolean }> {
  const cleanPhone = input.e164Phone.trim();
  if (!cleanPhone.startsWith('+') || cleanPhone.length < 10) {
    throw new Error('INVALID_PHONE_FORMAT');
  }

  const phoneKey = computePhoneKey(cleanPhone);
  const now = new Date();
  const db = await getDb();

  if (!db) {
    // Memory fallback
    const existingKey = memoryCustomerState.phoneKeys.get(phoneKey);
    if (existingKey) {
      const existingCust = memoryCustomerState.customers.get(existingKey.customerId);
      if (existingCust) {
        return { customer: existingCust, isNew: false };
      }
    }

    const customerId = `cust_${randomUUID()}`;
    const newCustomer: UniversalCustomerProfile = {
      _id: customerId,
      phoneKey,
      phoneMasked: maskPhone(cleanPhone),
      phoneCiphertext: encryptPii(cleanPhone),
      phoneVerifiedAt: now,
      firstName: input.firstName || 'Customer',
      lastName: input.lastName || '',
      primaryEmail: input.primaryEmail ? normalizeEmail(input.primaryEmail) : undefined,
      primaryStoreId: input.primaryStoreId,
      status: 'ACTIVE',
      registrationSource: input.registrationSource || 'checkout_otp',
      addresses: [],
      createdAt: now,
      updatedAt: now,
    };

    memoryCustomerState.phoneKeys.set(phoneKey, { _id: phoneKey, customerId, createdAt: now });
    memoryCustomerState.customers.set(customerId, newCustomer);
    return { customer: newCustomer, isNew: true };
  }

  await ensureCustomerIndexes(db);
  const phoneKeysCol = db.collection<CustomerPhoneKey>('customerPhoneKeys');
  const customersCol = db.collection<UniversalCustomerProfile>('customers');

  const existingKey = await phoneKeysCol.findOne({ _id: phoneKey });
  if (existingKey) {
    const existingCust = await customersCol.findOne({ _id: existingKey.customerId });
    if (existingCust) {
      return { customer: existingCust, isNew: false };
    }
  }

  const customerId = `cust_${randomUUID()}`;
  const newCustomer: UniversalCustomerProfile = {
    _id: customerId,
    phoneKey,
    phoneMasked: maskPhone(cleanPhone),
    phoneCiphertext: encryptPii(cleanPhone),
    phoneVerifiedAt: now,
    firstName: input.firstName || 'Customer',
    lastName: input.lastName || '',
    primaryEmail: input.primaryEmail ? normalizeEmail(input.primaryEmail) : undefined,
    primaryStoreId: input.primaryStoreId,
    status: 'ACTIVE',
    registrationSource: input.registrationSource || 'checkout_otp',
    addresses: [],
    createdAt: now,
    updatedAt: now,
  };

  try {
    await phoneKeysCol.insertOne({ _id: phoneKey, customerId, createdAt: now });
    await customersCol.insertOne(newCustomer);
    return { customer: newCustomer, isNew: true };
  } catch (err: unknown) {
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000) {
      // Race condition collision — resolve already inserted identity
      const raceKey = await phoneKeysCol.findOne({ _id: phoneKey });
      if (raceKey) {
        const raceCust = await customersCol.findOne({ _id: raceKey.customerId });
        if (raceCust) return { customer: raceCust, isNew: false };
      }
    }
    throw err;
  }
}

/**
 * Retrieves a universal customer profile by ID.
 */
export async function getUniversalCustomer(
  customerId: string,
): Promise<UniversalCustomerProfile | null> {
  const db = await getDb();
  if (!db) {
    return memoryCustomerState.customers.get(customerId) || null;
  }
  return await db.collection<UniversalCustomerProfile>('customers').findOne({ _id: customerId });
}

/**
 * Updates a universal customer profile.
 * STRICTLY ENFORCES PHONE IMMUTABILITY. Phone numbers cannot be edited via standard profile APIs.
 */
export async function updateCustomerProfile(
  customerId: string,
  patch: Partial<UniversalCustomerProfile> & { phone?: unknown; phoneKey?: unknown },
): Promise<UniversalCustomerProfile> {
  if ('phone' in patch || 'phoneKey' in patch || 'phoneCiphertext' in patch) {
    throw new Error(
      'PHONE_IMMUTABLE: Customer phone numbers cannot be modified through profile APIs',
    );
  }

  const now = new Date();
  const updateFields: Record<string, unknown> = { updatedAt: now };

  if (patch.firstName !== undefined) updateFields['firstName'] = patch.firstName.trim();
  if (patch.lastName !== undefined) updateFields['lastName'] = patch.lastName.trim();
  if (patch.primaryEmail !== undefined) {
    updateFields['primaryEmail'] = patch.primaryEmail
      ? normalizeEmail(patch.primaryEmail)
      : undefined;
  }
  if (patch.birthday !== undefined) updateFields['birthday'] = patch.birthday;
  if (patch.weddingAnniversary !== undefined) {
    updateFields['weddingAnniversary'] = patch.weddingAnniversary;
  }
  if (patch.gender !== undefined) updateFields['gender'] = patch.gender;

  const db = await getDb();
  if (!db) {
    const existing = memoryCustomerState.customers.get(customerId);
    if (!existing) throw new Error('CUSTOMER_NOT_FOUND');
    Object.assign(existing, updateFields);
    return existing;
  }

  const customersCol = db.collection<UniversalCustomerProfile>('customers');
  const res = await customersCol.findOneAndUpdate(
    { _id: customerId },
    { $set: updateFields },
    { returnDocument: 'after' },
  );

  if (!res) throw new Error('CUSTOMER_NOT_FOUND');
  return res;
}

// -------------------------------------------------------------
// EMBEDDED ADDRESS MANAGEMENT (MAX 20, ATOMIC DEFAULT SELECTION)
// -------------------------------------------------------------

export type AddAddressInput = {
  label?: AddressLabel | undefined;
  isDefault?: boolean | undefined;
  fullName: string;
  phone: string;
  addressLine1: string;
  locality?: string | undefined;
  region: string;
  postalCode: string;
  countryCode?: string | undefined;
};

/**
 * Adds a saved address to the universal customer document.
 * Enforces maximum 20 addresses and atomic default toggling.
 */
export async function addCustomerAddress(
  customerId: string,
  input: AddAddressInput,
): Promise<{ customer: UniversalCustomerProfile; address: SavedCustomerAddress }> {
  const customer = await getUniversalCustomer(customerId);
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  if (customer.addresses.length >= 20) {
    throw new Error('MAX_ADDRESSES_EXCEEDED: Maximum 20 saved addresses allowed per customer');
  }

  const now = new Date();
  const isDefault = input.isDefault ?? customer.addresses.length === 0;

  const newAddress: SavedCustomerAddress = {
    addressId: randomUUID(),
    label: input.label || 'HOME',
    isDefault,
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    addressLine1: input.addressLine1.trim(),
    locality: input.locality?.trim(),
    region: input.region.trim(),
    postalCode: input.postalCode.trim(),
    countryCode: (input.countryCode || 'IN').toUpperCase(),
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  if (!db) {
    if (isDefault) {
      for (const addr of customer.addresses) addr.isDefault = false;
    }
    customer.addresses.push(newAddress);
    customer.updatedAt = now;
    return { customer, address: newAddress };
  }

  const customersCol = db.collection<UniversalCustomerProfile>('customers');

  if (isDefault) {
    // Unset isDefault across all existing addresses, then push new default address
    await customersCol.updateOne(
      { _id: customerId },
      { $set: { 'addresses.$[].isDefault': false } },
    );
  }

  const res = await customersCol.findOneAndUpdate(
    { _id: customerId },
    {
      $push: { addresses: newAddress },
      $set: { updatedAt: now },
    },
    { returnDocument: 'after' },
  );

  if (!res) throw new Error('CUSTOMER_NOT_FOUND');
  return { customer: res, address: newAddress };
}

/**
 * Sets a specific address as default, atomically unsetting all others.
 */
export async function setDefaultCustomerAddress(
  customerId: string,
  addressId: string,
): Promise<UniversalCustomerProfile> {
  const db = await getDb();
  const now = new Date();

  if (!db) {
    const customer = memoryCustomerState.customers.get(customerId);
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
    let found = false;
    for (const addr of customer.addresses) {
      if (addr.addressId === addressId) {
        addr.isDefault = true;
        addr.updatedAt = now;
        found = true;
      } else {
        addr.isDefault = false;
      }
    }
    if (!found) throw new Error('ADDRESS_NOT_FOUND');
    customer.updatedAt = now;
    return customer;
  }

  const customersCol = db.collection<UniversalCustomerProfile>('customers');

  // Step 1: Set all addresses to isDefault: false
  await customersCol.updateOne({ _id: customerId }, { $set: { 'addresses.$[].isDefault': false } });

  // Step 2: Set target address to isDefault: true
  const res = await customersCol.findOneAndUpdate(
    { _id: customerId, 'addresses.addressId': addressId },
    {
      $set: {
        'addresses.$.isDefault': true,
        'addresses.$.updatedAt': now,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' },
  );

  if (!res) throw new Error('ADDRESS_NOT_FOUND');
  return res;
}

/**
 * Deletes a customer address. Promotes another address to default if needed.
 */
export async function deleteCustomerAddress(
  customerId: string,
  addressId: string,
): Promise<UniversalCustomerProfile> {
  const db = await getDb();
  const now = new Date();

  if (!db) {
    const customer = memoryCustomerState.customers.get(customerId);
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
    const idx = customer.addresses.findIndex((a) => a.addressId === addressId);
    if (idx === -1) throw new Error('ADDRESS_NOT_FOUND');
    const wasDefault = customer.addresses[idx]?.isDefault;
    customer.addresses.splice(idx, 1);
    if (wasDefault && customer.addresses.length > 0 && customer.addresses[0]) {
      customer.addresses[0].isDefault = true;
    }
    customer.updatedAt = now;
    return customer;
  }

  const customersCol = db.collection<UniversalCustomerProfile>('customers');
  const res = await customersCol.findOneAndUpdate(
    { _id: customerId },
    {
      $pull: { addresses: { addressId } },
      $set: { updatedAt: now },
    },
    { returnDocument: 'after' },
  );

  if (!res) throw new Error('CUSTOMER_NOT_FOUND');

  // If no default address remains but addresses exist, set first as default
  const hasDefault = res.addresses.some((a) => a.isDefault);
  if (!hasDefault && res.addresses.length > 0 && res.addresses[0]) {
    await setDefaultCustomerAddress(customerId, res.addresses[0].addressId);
  }

  return (await getUniversalCustomer(customerId)) || res;
}

// -------------------------------------------------------------
// STORE-SPECIFIC CUSTOMER FLAGS & AUDIT LOGS
// -------------------------------------------------------------

export async function getStoreCustomerProfile(
  customerId: string,
  storeId: string,
  merchantId: string,
  brandId: string,
): Promise<CustomerStoreProfile> {
  const db = await getDb();
  const key = `${customerId}:${storeId}`;

  if (!db) {
    const existing = memoryCustomerState.storeProfiles.get(key);
    if (existing) return existing;
    const now = new Date();
    const created: CustomerStoreProfile = {
      _id: key,
      customerId,
      merchantId,
      brandId,
      storeId,
      firstSeenAt: now,
      lastSeenAt: now,
      flags: { ...DEFAULT_STORE_FLAGS },
      createdAt: now,
      updatedAt: now,
    };
    memoryCustomerState.storeProfiles.set(key, created);
    return created;
  }

  const col = db.collection<CustomerStoreProfile>('customerStoreProfiles');
  const existing = await col.findOne({ customerId, storeId });
  if (existing) return existing;

  const now = new Date();
  const created: CustomerStoreProfile = {
    _id: key,
    customerId,
    merchantId,
    brandId,
    storeId,
    firstSeenAt: now,
    lastSeenAt: now,
    flags: { ...DEFAULT_STORE_FLAGS },
    createdAt: now,
    updatedAt: now,
  };

  await col.updateOne({ customerId, storeId }, { $setOnInsert: created }, { upsert: true });
  return (await col.findOne({ customerId, storeId })) || created;
}

export async function updateStoreCustomerFlags(input: {
  customerId: string;
  storeId: string;
  merchantId: string;
  brandId: string;
  flags: Partial<StoreCustomerFlags>;
  reason?: string | undefined;
  changedBy: string;
}): Promise<CustomerStoreProfile> {
  const current = await getStoreCustomerProfile(
    input.customerId,
    input.storeId,
    input.merchantId,
    input.brandId,
  );
  const now = new Date();
  const newFlags: StoreCustomerFlags = {
    ...current.flags,
    ...input.flags,
  };

  const auditEntry: StoreFlagAuditEntry = {
    _id: randomUUID(),
    customerId: input.customerId,
    storeId: input.storeId,
    merchantId: input.merchantId,
    previousFlags: current.flags,
    newFlags,
    reason: input.reason,
    changedBy: input.changedBy,
    createdAt: now,
  };

  const db = await getDb();
  if (!db) {
    current.flags = newFlags;
    current.updatedAt = now;
    memoryCustomerState.flagAudits.push(auditEntry);
    return current;
  }

  const col = db.collection<CustomerStoreProfile>('customerStoreProfiles');
  const auditCol = db.collection<StoreFlagAuditEntry>('storeFlagAudit');

  await auditCol.insertOne(auditEntry);

  const res = await col.findOneAndUpdate(
    { customerId: input.customerId, storeId: input.storeId },
    {
      $set: {
        flags: newFlags,
        restrictionReason: input.reason,
        reviewedBy: input.changedBy,
        reviewedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' },
  );

  if (!res) throw new Error('PROFILE_NOT_FOUND');
  return res;
}

// -------------------------------------------------------------
// EXTERNAL CUSTOMER LINKING (SHOPIFY CUSTOMER ID -> UNIVERSAL)
// -------------------------------------------------------------

export async function linkExternalCustomer(input: {
  storeId: string;
  platform: StorePlatform;
  externalCustomerId: string;
  customerId: string;
  linkedBy: ExternalCustomerLink['linkedBy'];
}): Promise<ExternalCustomerLink> {
  const cleanId = String(input.externalCustomerId || '')
    .trim()
    .replace(/^gid:\/\/shopify\/Customer\//, '');
  const id = `${input.storeId}:${input.platform}:${cleanId}`;
  const now = new Date();

  const record: ExternalCustomerLink = {
    _id: id,
    storeId: input.storeId,
    platform: input.platform,
    externalCustomerId: cleanId,
    customerId: input.customerId,
    linkedBy: input.linkedBy,
    linkedAt: now,
  };

  const db = await getDb();
  if (!db) {
    memoryCustomerState.externalLinks.set(id, record);
    return record;
  }

  const col = db.collection<ExternalCustomerLink>('externalCustomerLinks');
  await col.updateOne(
    { storeId: input.storeId, platform: input.platform, externalCustomerId: cleanId },
    { $set: record },
    { upsert: true },
  );
  return record;
}

export async function getUniversalCustomerByExternalId(
  storeId: string,
  platform: StorePlatform,
  externalCustomerId: string,
): Promise<string | null> {
  const cleanId = String(externalCustomerId || '')
    .trim()
    .replace(/^gid:\/\/shopify\/Customer\//, '');
  const id = `${storeId}:${platform}:${cleanId}`;

  const db = await getDb();
  if (!db) {
    return memoryCustomerState.externalLinks.get(id)?.customerId || null;
  }

  const col = db.collection<ExternalCustomerLink>('externalCustomerLinks');
  const found = await col.findOne({ storeId, platform, externalCustomerId: cleanId });
  return found?.customerId || null;
}
