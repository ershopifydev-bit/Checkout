/**
 * TEZVIX UNIVERSAL CUSTOMER IDENTITY, MULTI-BRAND HIERARCHY & STORE RISK CONTROL
 * Types and schema contracts for 100M+ scale.
 */

export type StoreChannel = 'ONLINE' | 'OFFLINE';
export type StorePlatform = 'SHOPIFY' | 'POS' | 'CUSTOM';

export interface Merchant {
  _id: string; // e.g. "merch_walmart_india"
  name: string;
  legalEntityName: string;
  country: string; // "IN"
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: Date;
  updatedAt: Date;
}

export interface Brand {
  _id: string; // e.g. "brand_myntra"
  merchantId: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

export interface Store {
  _id: string; // e.g. "store_myntra_shopify_online"
  merchantId: string;
  brandId: string;
  name: string;
  channel: StoreChannel;
  platform: StorePlatform;
  shopifyDomain?: string | undefined; // Normalized myshopify.com domain if platform === SHOPIFY
  externalLocationId?: string | undefined;
  status: 'ACTIVE' | 'INACTIVE';
  settings?: Record<string, unknown> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export type AddressLabel = 'HOME' | 'WORK' | 'OTHER';

export interface SavedCustomerAddress {
  addressId: string; // UUID v4
  label: AddressLabel;
  isDefault: boolean;
  fullName: string;
  phone: string;
  addressLine1: string;
  locality?: string | undefined;
  region: string; // State / Province
  postalCode: string; // 6-digit PIN for India
  countryCode: string; // "IN"
  createdAt: Date;
  updatedAt: Date;
}

export interface UniversalCustomerProfile {
  _id: string; // Universal Customer ID, e.g. "cust_01h..."
  phoneKey: string; // Keyed HMAC-SHA256 fingerprint of verified E.164 phone
  phoneMasked: string; // e.g. "+91 ****** 43210" for display without decrypting
  phoneCiphertext: string; // AES-256-GCM encrypted E.164 phone
  phoneVerifiedAt: Date;

  firstName: string;
  lastName: string;
  primaryEmail?: string | undefined; // Exactly ONE primary email address
  primaryEmailVerified?: boolean | undefined;

  birthday?: string | undefined; // YYYY-MM-DD
  weddingAnniversary?: string | undefined; // YYYY-MM-DD
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | undefined;

  primaryStoreId?: string | undefined;
  status: 'ACTIVE' | 'LOCKED' | 'PENDING_VERIFICATION' | 'DELETED';
  registrationSource: string; // e.g. "checkout_otp", "storefront_embed"

  addresses: SavedCustomerAddress[]; // Max 20 embedded saved addresses

  metadata?: Record<string, unknown> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerPhoneKey {
  _id: string; // Keyed HMAC-SHA256 of E.164 phone (Authoritative Uniqueness Gate)
  customerId: string; // References UniversalCustomerProfile._id
  createdAt: Date;
}

export interface StoreCustomerFlags {
  blocked: boolean;
  fraudSuspected: boolean;
  highReturnRate: boolean;
  codDisabled: boolean;
  prepaidOnly: boolean;
  manualReview: boolean;
  vip: boolean;
  loyaltyEligible: boolean;
}

export interface CustomerStoreProfile {
  _id: string; // `${customerId}:${storeId}`
  customerId: string;
  merchantId: string;
  brandId: string;
  storeId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  flags: StoreCustomerFlags;
  restrictionReason?: string | undefined;
  reviewedBy?: string | undefined;
  reviewedAt?: Date | undefined;
  restrictionExpiresAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreFlagAuditEntry {
  _id: string;
  customerId: string;
  storeId: string;
  merchantId: string;
  previousFlags: StoreCustomerFlags;
  newFlags: StoreCustomerFlags;
  reason?: string | undefined;
  changedBy: string; // User ID / Staff ID
  createdAt: Date;
}

export interface ExternalCustomerLink {
  _id: string; // `${storeId}:${platform}:${externalCustomerId}`
  storeId: string;
  platform: StorePlatform;
  externalCustomerId: string; // e.g. Shopify Admin Customer ID "gid://shopify/Customer/12345" or "12345"
  customerId: string; // References UniversalCustomerProfile._id
  linkedBy: 'PHONE_VERIFIED' | 'SHOPPER_MATCH' | 'STAFF_MANUAL' | 'SYSTEM';
  linkedAt: Date;
}

export type WebhookStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DEAD_LETTER';

export interface WebhookInboxEntry {
  _id: string; // `${shop}:${webhookId}`
  shop: string;
  webhookId: string; // X-Shopify-Webhook-Id header
  topic: string; // e.g. "orders/create", "customers/redact"
  apiVersion: string;
  status: WebhookStatus;
  attempts: number;
  payload: Record<string, unknown>;
  errorMessage?: string | undefined;
  leaseExpiresAt?: Date | undefined;
  receivedAt: Date;
  processedAt?: Date | undefined;
}
