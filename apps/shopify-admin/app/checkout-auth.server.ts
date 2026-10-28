import { createHash, randomUUID } from 'node:crypto';

export type ShopperAddress = {
  phone: string;
  fullName: string;
  addressLine1: string;
  locality: string;
  region: string;
  postalCode: string;
  email?: string;
};

export type Shopper = {
  token: string;
  shop: string;
  phone: string;
  customerId?: string;
  universalCustomerId?: string;
  isNew: boolean;
  fullName?: string;
  address?: ShopperAddress;
  createdAt: string;
  /** Absolute ms timestamp; getShopper drops the token after this. */
  expiresAt: number;
};

type OtpRecord = {
  shop: string;
  phone: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

type MailingAddressNode = {
  address1?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type CustomerNode = {
  id: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  defaultAddress?: MailingAddressNode | null;
  /** Deprecated flat list (still returned by some API versions). */
  addresses?: MailingAddressNode[] | null;
  addressesV2?: { nodes?: MailingAddressNode[] | null } | null;
};

type PhoneProfile = { fullName?: string; address?: ShopperAddress; customerId?: string };

type AuthMemory = {
  otpByKey: Map<string, OtpRecord>;
  shoppers: Map<string, Shopper>;
  profilesByPhone: Map<string, PhoneProfile>;
};

/**
 * ponytail: process-local until Redis/Mongo. Survives Vite HMR via globalThis so OTP login
 * and saved addresses are not wiped on every public/checkout edit.
 */
const authMemory = (globalThis as typeof globalThis & { __ecAuthMemory?: AuthMemory })
  .__ecAuthMemory ?? {
  otpByKey: new Map<string, OtpRecord>(),
  shoppers: new Map<string, Shopper>(),
  profilesByPhone: new Map<string, PhoneProfile>(),
};
if (process.env['NODE_ENV'] !== 'production') {
  (globalThis as typeof globalThis & { __ecAuthMemory?: AuthMemory }).__ecAuthMemory = authMemory;
}
const otpByKey = authMemory.otpByKey;
const shoppers = authMemory.shoppers;
const profilesByPhone = authMemory.profilesByPhone;

/** OTP code validity after request. */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** Shopper login token validity after successful OTP verify. */
export const SHOPPER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Fixed OTP in non-production (no SMS provider yet). */
export const DEV_OTP = '0000';

function phoneKey(shop: string, phone: string) {
  return `${shop}::${phone}`;
}

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

function normalizePhone(phone: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

function phonesMatch(candidate: string | null | undefined, tenDigit: string): boolean {
  const normalized = normalizePhone(candidate || '');
  return normalized === tenDigit;
}

async function offlineAccessToken(shop: string): Promise<string | null> {
  try {
    const { sessionStorage } = await import('./shopify.server');
    const sessions = await sessionStorage.findSessionsByShop(shop);
    const offline =
      sessions.find((session) => session.id.startsWith('offline_') && session.accessToken) ||
      sessions.find((session) => session.accessToken);
    return offline?.accessToken || null;
  } catch {
    return null;
  }
}

async function adminGraphql<T>(
  shop: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data: T | null; userErrors: string[] }> {
  try {
    const token = await offlineAccessToken(shop);
    if (!token) return { data: null, userErrors: [] };
    const response = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) return { data: null, userErrors: [`http_${response.status}`] };
    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };
    const gqlErrors = (body.errors || []).map((error) => error.message || 'graphql_error');
    return { data: body.data ?? null, userErrors: gqlErrors };
  } catch {
    return { data: null, userErrors: [] };
  }
}

export async function requestOtp(shop: string, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error('INVALID_PHONE');
  const shopNorm = shop.trim().toLowerCase();
  if (!shopNorm.includes('.')) throw new Error('INVALID_SHOP');
  const isProd = process.env['NODE_ENV'] === 'production';
  const code = isProd ? String(Math.floor(1000 + Math.random() * 9000)) : DEV_OTP;
  otpByKey.set(phoneKey(shopNorm, phone), {
    shop: shopNorm,
    phone,
    codeHash: hashCode(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });
  return {
    phone,
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    otpLength: 4,
    ...(isProd ? {} : { devCode: DEV_OTP }),
  };
}

type CustomerLookup = {
  customerId?: string;
  fullName?: string;
  address?: ShopperAddress;
};

/** Exported for unit tests — maps Shopify mailing address → checkout address. */
export function addressFromNode(
  phone: string,
  fullName: string,
  addr: MailingAddressNode | null | undefined,
): ShopperAddress | undefined {
  if (!addr?.address1 || !addr.city || !addr.zip) return undefined;
  const postalCode = String(addr.zip).replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(postalCode)) return undefined;
  const nameFromAddr = [addr.firstName, addr.lastName].filter(Boolean).join(' ').trim();
  // Many India addresses omit province in Admin; provinceCode / fallback keeps them usable.
  const region = (addr.province || addr.provinceCode || '').trim() || 'India';
  return {
    phone,
    fullName: fullName || nameFromAddr || 'Customer',
    addressLine1: addr.address1,
    locality: addr.city,
    region,
    postalCode,
  };
}

function mailingAddresses(node: CustomerNode): MailingAddressNode[] {
  const fromV2 = node.addressesV2?.nodes || [];
  const fromFlat = node.addresses || [];
  return [...fromV2, ...fromFlat].filter(Boolean);
}

function lookupFromNode(phone: string, node: CustomerNode): CustomerLookup {
  const fullName = [node.firstName, node.lastName].filter(Boolean).join(' ').trim();
  const result: CustomerLookup = { customerId: node.id };
  if (fullName) result.fullName = fullName;
  const address =
    addressFromNode(phone, fullName, node.defaultAddress) ||
    mailingAddresses(node)
      .map((addr) => addressFromNode(phone, fullName, addr))
      .find(Boolean);
  if (address) result.address = address;
  return result;
}

const ADDRESS_FIELDS = `address1 city province provinceCode zip phone firstName lastName`;
const CUSTOMER_FIELDS = `
  id
  phone
  firstName
  lastName
  defaultAddress { ${ADDRESS_FIELDS} }
  addressesV2(first: 8) { nodes { ${ADDRESS_FIELDS} } }
`;

type RestCustomer = {
  id: number;
  first_name?: string;
  last_name?: string;
  phone?: string;
  default_address?: {
    address1?: string;
    city?: string;
    province?: string;
    province_code?: string;
    zip?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
  };
  addresses?: Array<{
    address1?: string;
    city?: string;
    province?: string;
    province_code?: string;
    zip?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    default?: boolean;
  }>;
};

function restAddressToNode(
  addr:
    | {
        address1?: string;
        city?: string;
        province?: string;
        province_code?: string;
        zip?: string;
        phone?: string;
        first_name?: string;
        last_name?: string;
      }
    | undefined,
): MailingAddressNode | null {
  if (!addr) return null;
  return {
    address1: addr.address1 ?? null,
    city: addr.city ?? null,
    province: addr.province ?? null,
    provinceCode: addr.province_code ?? null,
    zip: addr.zip ?? null,
    phone: addr.phone ?? null,
    firstName: addr.first_name ?? null,
    lastName: addr.last_name ?? null,
  };
}

function restCustomerToNode(customer: RestCustomer): CustomerNode {
  const addresses = (customer.addresses || [])
    .map((addr) => restAddressToNode(addr))
    .filter((addr): addr is MailingAddressNode => !!addr);
  const defaultFromList = (customer.addresses || []).find((addr) => addr.default);
  return {
    id: `gid://shopify/Customer/${customer.id}`,
    phone: customer.phone ?? null,
    firstName: customer.first_name ?? null,
    lastName: customer.last_name ?? null,
    defaultAddress:
      restAddressToNode(customer.default_address) ||
      restAddressToNode(defaultFromList) ||
      addresses[0] ||
      null,
    addresses,
  };
}

async function fetchRestCustomer(
  shop: string,
  token: string,
  customerId: number,
): Promise<RestCustomer | null> {
  const response = await fetch(`https://${shop}/admin/api/2026-10/customers/${customerId}.json`, {
    headers: { 'X-Shopify-Access-Token': token, accept: 'application/json' },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { customer?: RestCustomer };
  return body.customer || null;
}

async function lookupCustomer(shop: string, phone: string): Promise<CustomerLookup> {
  const e164 = `+91${phone}`;
  let protectedBlocked = false;

  // Preferred: exact identifier match (Admin API 2025-10+).
  const byId = await adminGraphql<{ customer: CustomerNode | null }>(
    shop,
    `query CustomerByPhoneNumber($identifier: CustomerIdentifierInput!) {
      customer: customerByIdentifier(identifier: $identifier) { ${CUSTOMER_FIELDS} }
    }`,
    { identifier: { phoneNumber: e164 } },
  );
  if (byId.userErrors.some((error) => /protected customer data/i.test(error))) {
    protectedBlocked = true;
  }
  if (byId.userErrors.length) {
    console.warn('[EasyCheckout] customerByIdentifier errors', byId.userErrors.slice(0, 3));
  }
  if (byId.data?.customer) {
    const found = lookupFromNode(phone, byId.data.customer);
    console.info('[EasyCheckout] customer lookup', {
      via: 'customerByIdentifier',
      phone,
      customerId: found.customerId,
      hasAddress: !!found.address,
    });
    return found;
  }

  // REST search is more tolerant of formatting (+91 82681 95957).
  try {
    const token = await offlineAccessToken(shop);
    if (token) {
      const url = new URL(`https://${shop}/admin/api/2026-10/customers/search.json`);
      url.searchParams.set('query', `phone:${phone} OR phone:${e164}`);
      const response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': token, accept: 'application/json' },
      });
      if (response.ok) {
        const body = (await response.json()) as { customers?: RestCustomer[] };
        const hit =
          (body.customers || []).find(
            (customer) =>
              phonesMatch(customer.phone, phone) ||
              phonesMatch(customer.default_address?.phone, phone) ||
              (customer.addresses || []).some((addr) => phonesMatch(addr.phone, phone)),
          ) || body.customers?.[0];
        if (hit?.id) {
          // Search payload often omits full address book — load the customer record.
          const full = (await fetchRestCustomer(shop, token, hit.id)) || hit;
          const found = lookupFromNode(phone, restCustomerToNode(full));
          console.info('[EasyCheckout] customer lookup', {
            via: 'rest_search',
            phone,
            customerId: found.customerId,
            hasAddress: !!found.address,
            addressCount: full.addresses?.length || 0,
          });
          return found;
        }
      } else if (response.status === 401 || response.status === 403) {
        const detail = await response.text().catch(() => '');
        protectedBlocked = true;
        console.error(
          '[EasyCheckout] customer REST search blocked',
          response.status,
          detail.slice(0, 300) ||
            'Enable Protected customer data (name, phone, address) in Partner Dashboard → API access, then reinstall the app on the dev store.',
        );
      }
    } else {
      console.error('[EasyCheckout] no offline Admin token — cannot look up customers');
    }
  } catch (error) {
    console.error('[EasyCheckout] customer REST lookup failed', error);
  }

  const queries = [`phone:${e164}`, `phone:${phone}`, phone];
  for (const q of queries) {
    const { data, userErrors } = await adminGraphql<{
      customers: { edges: Array<{ node: CustomerNode }> };
    }>(
      shop,
      `query CustomerSearch($q: String!) {
        customers(first: 10, query: $q) { edges { node { ${CUSTOMER_FIELDS} } } }
      }`,
      { q },
    );
    if (userErrors.some((error) => /protected customer data/i.test(error))) {
      protectedBlocked = true;
    }
    const nodes = data?.customers?.edges?.map((edge) => edge.node) || [];
    const match =
      nodes.find(
        (node) =>
          phonesMatch(node.phone, phone) ||
          phonesMatch(node.defaultAddress?.phone, phone) ||
          mailingAddresses(node).some((addr) => phonesMatch(addr.phone, phone)),
      ) || nodes[0];
    if (match) {
      const found = lookupFromNode(phone, match);
      console.info('[EasyCheckout] customer lookup', {
        via: 'graphql_search',
        phone,
        q,
        customerId: found.customerId,
        hasAddress: !!found.address,
      });
      return found;
    }
  }
  if (protectedBlocked) {
    console.error(
      '[EasyCheckout] Customer Admin reads blocked — enable Protected Customer Data for this app in Partner Dashboard.',
    );
  } else {
    console.info('[EasyCheckout] customer lookup miss', { phone });
  }
  return {};
}

export async function verifyOtp(shop: string, rawPhone: string, code: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error('INVALID_PHONE');
  const shopNorm = shop.trim().toLowerCase();
  const key = phoneKey(shopNorm, phone);
  const record = otpByKey.get(key);
  if (!record || record.expiresAt < Date.now()) {
    otpByKey.delete(key);
    throw new Error('OTP_EXPIRED');
  }
  record.attempts += 1;
  if (record.attempts > MAX_ATTEMPTS) {
    otpByKey.delete(key);
    throw new Error('OTP_LOCKED');
  }
  const trimmed = String(code || '')
    .replace(/\D/g, '')
    .trim();
  if (record.codeHash !== hashCode(trimmed)) {
    throw new Error('OTP_INVALID');
  }
  otpByKey.delete(key);

  const found = await lookupCustomer(shopNorm, phone);
  const local = profilesByPhone.get(phoneKey(shopNorm, phone));
  const customerId = found.customerId || local?.customerId;
  let fullName = found.fullName || local?.fullName;
  let address = found.address || local?.address;

  // Resolve Universal Customer Identity & Multi-Brand Context
  let universalCustomerId: string | undefined;
  try {
    const { resolveMerchantStoreContext } = await import('./merchant-hierarchy.server');
    const { getOrCreateUniversalCustomer, getStoreCustomerProfile, linkExternalCustomer } =
      await import('./universal-customer.server');

    const context = await resolveMerchantStoreContext(shopNorm);
    const { customer: universalCustomer } = await getOrCreateUniversalCustomer({
      e164Phone: `+91${phone}`,
      firstName: fullName?.split(' ')[0],
      lastName: fullName?.split(' ').slice(1).join(' '),
      primaryStoreId: context.store._id,
      registrationSource: 'checkout_otp',
    });
    universalCustomerId = universalCustomer._id;

    await getStoreCustomerProfile(
      universalCustomer._id,
      context.store._id,
      context.merchant._id,
      context.brand._id,
    );

    if (customerId) {
      await linkExternalCustomer({
        storeId: context.store._id,
        platform: 'SHOPIFY',
        externalCustomerId: customerId,
        customerId: universalCustomer._id,
        linkedBy: 'PHONE_VERIFIED',
      });
    }

    if (!address && universalCustomer.addresses.length > 0) {
      const def =
        universalCustomer.addresses.find((a) => a.isDefault) || universalCustomer.addresses[0];
      if (def) {
        address = {
          phone: def.phone,
          fullName: def.fullName,
          addressLine1: def.addressLine1,
          locality: def.locality || '',
          region: def.region,
          postalCode: def.postalCode,
        };
        if (!fullName) fullName = def.fullName;
      }
    }
  } catch (err) {
    console.warn('[EasyCheckout] Universal customer identity sync note:', (err as Error).message);
  }

  const isNew = !customerId && !address;
  const token = `shopper_${randomUUID().replaceAll('-', '')}`;
  const now = Date.now();
  const shopper: Shopper = {
    token,
    shop: shopNorm,
    phone,
    isNew,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SHOPPER_TTL_MS,
  };
  if (customerId) shopper.customerId = customerId;
  if (universalCustomerId) shopper.universalCustomerId = universalCustomerId;
  if (fullName) shopper.fullName = fullName;
  if (address) shopper.address = address;
  shoppers.set(token, shopper);

  // Keep a phone-keyed profile so return visits still work if Admin PCD is blocked.
  if (address || customerId || fullName) {
    const profile: PhoneProfile = {};
    if (fullName) profile.fullName = fullName;
    if (address) profile.address = address;
    if (customerId) profile.customerId = customerId;
    profilesByPhone.set(phoneKey(shopNorm, phone), profile);
  }

  console.info('[EasyCheckout] OTP verified', {
    phone,
    customerId: shopper.customerId,
    hasAddress: !!shopper.address,
    isNew,
    expiresInDays: Math.floor(SHOPPER_TTL_MS / (24 * 60 * 60 * 1000)),
  });

  return {
    token,
    phone,
    isNew,
    customerId: shopper.customerId,
    universalCustomerId: shopper.universalCustomerId,
    fullName: shopper.fullName,
    address: shopper.address,
    needsAddress: !shopper.address,
    expiresAt: shopper.expiresAt,
    expiresInSec: Math.floor(SHOPPER_TTL_MS / 1000),
  };
}

export function getShopper(token: string | null | undefined): Shopper | null {
  if (!token) return null;
  const shopper = shoppers.get(token);
  if (!shopper) return null;
  // Legacy in-memory tokens created before expiresAt existed.
  if (typeof shopper.expiresAt === 'number' && shopper.expiresAt < Date.now()) {
    shoppers.delete(token);
    return null;
  }
  return shopper;
}

export function logoutShopper(token: string | null | undefined) {
  if (token) shoppers.delete(token);
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || 'Customer';
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

function applyAddress(shopper: Shopper, phone: string, address: ShopperAddress) {
  shopper.isNew = false;
  shopper.fullName = address.fullName.slice(0, 80);
  shopper.address = {
    phone,
    fullName: shopper.fullName,
    addressLine1: address.addressLine1.slice(0, 120),
    locality: address.locality.slice(0, 80),
    region: address.region.slice(0, 80),
    postalCode: address.postalCode,
  };
  if (address.email) shopper.address.email = address.email.slice(0, 120);
  const profile: PhoneProfile = {
    fullName: shopper.fullName,
    address: shopper.address,
  };
  if (shopper.customerId) profile.customerId = shopper.customerId;
  profilesByPhone.set(phoneKey(shopper.shop, phone), profile);

  if (shopper.universalCustomerId) {
    void import('./universal-customer.server').then(({ addCustomerAddress }) => {
      void addCustomerAddress(shopper.universalCustomerId!, {
        fullName: shopper.fullName || address.fullName,
        phone: `+91${phone}`,
        addressLine1: address.addressLine1,
        locality: address.locality,
        region: address.region,
        postalCode: address.postalCode,
        countryCode: 'IN',
        isDefault: true,
      }).catch(() => null);
    });
  }
}

export async function createCustomerWithAddress(
  token: string,
  address: ShopperAddress,
): Promise<Shopper> {
  const shopper = shoppers.get(token);
  if (!shopper) throw new Error('SHOPPER_NOT_FOUND');
  const phone = normalizePhone(address.phone) || shopper.phone;
  if (
    !/^[6-9]\d{9}$/.test(phone) ||
    !/^\d{6}$/.test(address.postalCode) ||
    !address.fullName ||
    !address.addressLine1 ||
    !address.locality ||
    !address.region
  ) {
    throw new Error('INVALID_ADDRESS');
  }

  const { firstName, lastName } = splitName(address.fullName);
  const e164 = `+91${phone}`;

  // Already linked to a Shopify customer — just persist checkout address.
  if (shopper.customerId && !shopper.customerId.startsWith('local_')) {
    applyAddress(shopper, phone, address);
    shoppers.set(token, shopper);
    return shopper;
  }

  const input: Record<string, unknown> = {
    firstName,
    lastName,
    phone: e164,
    addresses: [
      {
        address1: address.addressLine1.slice(0, 120),
        city: address.locality.slice(0, 80),
        province: address.region.slice(0, 80),
        zip: address.postalCode,
        countryCode: 'IN',
        phone: e164,
        firstName,
        lastName,
      },
    ],
  };
  if (address.email) input['email'] = address.email.slice(0, 120);

  const { data } = await adminGraphql<{
    customerCreate: {
      customer?: { id: string } | null;
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(
    shopper.shop,
    `mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`,
    { input },
  );

  const createdId = data?.customerCreate?.customer?.id;
  const errors = data?.customerCreate?.userErrors || [];
  const alreadyExists = errors.some((error) => /already|taken|exist/i.test(error.message || ''));

  if (createdId) {
    shopper.customerId = createdId;
    applyAddress(shopper, phone, address);
    shoppers.set(token, shopper);
    return shopper;
  }

  // Phone already on a customer (or lookup missed at OTP time) — recover instead of 500.
  if (alreadyExists || errors.length > 0) {
    const existing = await lookupCustomer(shopper.shop, phone);
    if (existing.customerId) {
      shopper.customerId = existing.customerId;
      if (existing.fullName && !address.fullName) shopper.fullName = existing.fullName;
      applyAddress(shopper, phone, address);
      // Prefer newly entered address for this checkout; keep Shopify id linked.
      shoppers.set(token, shopper);
      return shopper;
    }
  }

  // Admin unavailable — local shopper so COD path still works in dev.
  shopper.customerId = shopper.customerId || `local_${phone}`;
  applyAddress(shopper, phone, address);
  shoppers.set(token, shopper);
  return shopper;
}

export function publicShopperView(shopper: Shopper) {
  return {
    token: shopper.token,
    phone: shopper.phone,
    isNew: shopper.isNew,
    customerId: shopper.customerId,
    fullName: shopper.fullName,
    address: shopper.address,
    needsAddress: shopper.isNew || !shopper.address,
  };
}
