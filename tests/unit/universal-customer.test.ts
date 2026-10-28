import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computePhoneKey,
  decryptPii,
  encryptPii,
  maskPhone,
  normalizeEmail,
} from '../../apps/shopify-admin/app/customer-crypto.server';
import {
  createStore,
  getStore,
  resetMemoryHierarchy,
  resolveMerchantStoreContext,
} from '../../apps/shopify-admin/app/merchant-hierarchy.server';
import {
  addCustomerAddress,
  deleteCustomerAddress,
  getOrCreateUniversalCustomer,
  getStoreCustomerProfile,
  getUniversalCustomer,
  getUniversalCustomerByExternalId,
  linkExternalCustomer,
  resetMemoryCustomers,
  setDefaultCustomerAddress,
  updateCustomerProfile,
  updateStoreCustomerFlags,
} from '../../apps/shopify-admin/app/universal-customer.server';
import {
  ingestWebhook,
  processWebhookEntry,
  resetMemoryWebhooks,
} from '../../apps/shopify-admin/app/webhook-inbox.server';
import {
  placeCodFromSession,
  type SessionStore,
} from '../../apps/shopify-admin/app/checkout-session.server';
import { resetMemoryAttempts } from '../../apps/shopify-admin/app/checkout-order-attempt.server';

describe('Tezvix Universal Customer Identity & Multi-Brand Architecture', () => {
  beforeEach(() => {
    resetMemoryCustomers();
    resetMemoryHierarchy();
    resetMemoryWebhooks();
    resetMemoryAttempts();
  });

  describe('Section 4 & 5: Universal Customer Identity, Phone Immutability & Single Email', () => {
    const validPhone = '+919876543210';

    it('computes keyed HMAC-SHA256 fingerprint and masks phone securely', () => {
      const key1 = computePhoneKey(validPhone);
      const key2 = computePhoneKey(validPhone);
      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64);

      const masked = maskPhone(validPhone);
      expect(masked).toBe('+91 ****** 3210');
    });

    it('encrypts and decrypts PII using AES-256-GCM', () => {
      const plain = '+919876543210';
      const ciphertext = encryptPii(plain);
      expect(ciphertext).not.toBe(plain);
      expect(ciphertext).toContain(':');

      const decrypted = decryptPii(ciphertext);
      expect(decrypted).toBe(plain);
    });

    it('normalizes single primary email and rejects invalid formats', () => {
      expect(normalizeEmail('  Customer.One@Example.COM ')).toBe('customer.one@example.com');
      expect(() => normalizeEmail('not-an-email')).toThrow('INVALID_EMAIL');
    });

    it('registers a new universal customer from verified phone', async () => {
      const res = await getOrCreateUniversalCustomer({
        e164Phone: validPhone,
        firstName: 'Aditya',
        lastName: 'Singh',
        primaryEmail: 'aditya@example.com',
      });

      expect(res.isNew).toBe(true);
      expect(res.customer._id).toMatch(/^cust_/);
      expect(res.customer.phoneMasked).toBe('+91 ****** 3210');
      expect(res.customer.primaryEmail).toBe('aditya@example.com');
      expect(res.customer.firstName).toBe('Aditya');
      expect(res.customer.addresses).toHaveLength(0);

      // Verify decrypted phone
      expect(decryptPii(res.customer.phoneCiphertext)).toBe(validPhone);
    });

    it('reuses existing universal customer on repeated registration with same phone', async () => {
      const res1 = await getOrCreateUniversalCustomer({
        e164Phone: validPhone,
        firstName: 'Aditya',
      });
      expect(res1.isNew).toBe(true);

      const res2 = await getOrCreateUniversalCustomer({
        e164Phone: validPhone,
        firstName: 'Aditya Different',
      });
      expect(res2.isNew).toBe(false);
      expect(res2.customer._id).toBe(res1.customer._id);
    });

    it('strictly enforces phone immutability on customer profile updates', async () => {
      const { customer } = await getOrCreateUniversalCustomer({ e164Phone: validPhone });

      // Updating name or email succeeds
      const updated = await updateCustomerProfile(customer._id, {
        firstName: 'Aditya Updated',
        primaryEmail: 'updated@example.com',
      });
      expect(updated.firstName).toBe('Aditya Updated');
      expect(updated.primaryEmail).toBe('updated@example.com');

      // Attempting to modify phone or phoneKey throws PHONE_IMMUTABLE error
      await expect(
        updateCustomerProfile(customer._id, {
          phone: '+919999999999',
        }),
      ).rejects.toThrow('PHONE_IMMUTABLE');

      await expect(
        updateCustomerProfile(customer._id, {
          phoneKey: 'tampered-key',
        }),
      ).rejects.toThrow('PHONE_IMMUTABLE');
    });
  });

  describe('Section 6: Embedded Customer Addresses (Max 20, Atomic Default)', () => {
    it('manages saved addresses in the same customer document with atomic default selection', async () => {
      const { customer } = await getOrCreateUniversalCustomer({ e164Phone: '+919876543210' });

      // Add first address: becomes default automatically
      const res1 = await addCustomerAddress(customer._id, {
        fullName: 'Aditya Home',
        phone: '+919876543210',
        addressLine1: 'Plot 42, Sector 14',
        locality: 'DLF Phase 1',
        region: 'Haryana',
        postalCode: '122002',
        label: 'HOME',
      });
      expect(res1.address.isDefault).toBe(true);

      // Add second address with isDefault: true -> flips default and unsets first
      const res2 = await addCustomerAddress(customer._id, {
        fullName: 'Aditya Office',
        phone: '+919876543210',
        addressLine1: 'Cyber City, Tower B',
        locality: 'Sector 24',
        region: 'Haryana',
        postalCode: '122002',
        label: 'WORK',
        isDefault: true,
      });
      expect(res2.address.isDefault).toBe(true);

      const refreshed = await getUniversalCustomer(customer._id);
      expect(refreshed?.addresses).toHaveLength(2);

      const homeAddr = refreshed?.addresses.find((a) => a.label === 'HOME');
      const workAddr = refreshed?.addresses.find((a) => a.label === 'WORK');
      expect(homeAddr?.isDefault).toBe(false);
      expect(workAddr?.isDefault).toBe(true);

      // Explicitly set home back to default
      const flipped = await setDefaultCustomerAddress(customer._id, homeAddr!.addressId);
      expect(flipped.addresses.find((a) => a.label === 'HOME')?.isDefault).toBe(true);
      expect(flipped.addresses.find((a) => a.label === 'WORK')?.isDefault).toBe(false);

      // Delete default address: promotes remaining address to default
      const afterDelete = await deleteCustomerAddress(customer._id, homeAddr!.addressId);
      expect(afterDelete.addresses).toHaveLength(1);
      expect(afterDelete.addresses[0]?.isDefault).toBe(true);
    });

    it('enforces maximum 20 saved addresses per customer', async () => {
      const { customer } = await getOrCreateUniversalCustomer({ e164Phone: '+919876543210' });

      // Add 20 addresses
      for (let i = 0; i < 20; i++) {
        await addCustomerAddress(customer._id, {
          fullName: `Recipient ${i}`,
          phone: '+919876543210',
          addressLine1: `Address Line ${i}`,
          region: 'Delhi',
          postalCode: '110001',
        });
      }

      // 21st address must be rejected
      await expect(
        addCustomerAddress(customer._id, {
          fullName: '21st Recipient',
          phone: '+919876543210',
          addressLine1: 'Excess Address',
          region: 'Delhi',
          postalCode: '110001',
        }),
      ).rejects.toThrow('MAX_ADDRESSES_EXCEEDED');
    });
  });

  describe('Section 3: Merchant → Brand → Store Hierarchy', () => {
    it('resolves and auto-provisions hierarchy for a Shopify shop', async () => {
      const shop = 'brand-shoes.myshopify.com';
      const context = await resolveMerchantStoreContext(shop);

      expect(context.merchant.name).toBe('brand-shoes');
      expect(context.brand.name).toBe('brand-shoes');
      expect(context.store.shopifyDomain).toBe(shop);
      expect(context.store.channel).toBe('ONLINE');
      expect(context.store.platform).toBe('SHOPIFY');

      // Subsequent resolution returns identical context
      const context2 = await resolveMerchantStoreContext(shop);
      expect(context2.store._id).toBe(context.store._id);
    });

    it('supports creating and retrieving offline stores under a brand', async () => {
      const shopContext = await resolveMerchantStoreContext('retail-hub.myshopify.com');

      const offlineStore = await createStore({
        _id: 'store_retail_hub_pos_mumbai',
        merchantId: shopContext.merchant._id,
        brandId: shopContext.brand._id,
        name: 'Retail Hub Mumbai Flagship',
        channel: 'OFFLINE',
        platform: 'POS',
        externalLocationId: 'loc_mum_001',
        status: 'ACTIVE',
      });

      expect(offlineStore.channel).toBe('OFFLINE');
      expect(offlineStore.platform).toBe('POS');

      const fetched = await getStore('store_retail_hub_pos_mumbai');
      expect(fetched?.name).toBe('Retail Hub Mumbai Flagship');
    });
  });

  describe('Section 7: Store-Specific Customer Risk Flags & Checkout Integration', () => {
    it('isolates risk flags between different stores for the same universal customer', async () => {
      const { customer } = await getOrCreateUniversalCustomer({ e164Phone: '+919876543210' });

      const storeA = 'store_alpha';
      const storeB = 'store_beta';
      const merchantId = 'merch_test';
      const brandId = 'brand_test';

      // Store A blocks customer for high return rate
      await updateStoreCustomerFlags({
        customerId: customer._id,
        storeId: storeA,
        merchantId,
        brandId,
        flags: { blocked: true, highReturnRate: true, codDisabled: true },
        reason: 'Excessive COD returns',
        changedBy: 'staff_alpha_1',
      });

      // Customer flags in Store A are restricted
      const profileA = await getStoreCustomerProfile(customer._id, storeA, merchantId, brandId);
      expect(profileA.flags.blocked).toBe(true);
      expect(profileA.flags.codDisabled).toBe(true);

      // Customer flags in Store B remain clean and unaffected!
      const profileB = await getStoreCustomerProfile(customer._id, storeB, merchantId, brandId);
      expect(profileB.flags.blocked).toBe(false);
      expect(profileB.flags.codDisabled).toBe(false);
    });

    it('enforces store customer flags during checkout COD order placement', async () => {
      const shop = 'flag-test.myshopify.com';
      const context = await resolveMerchantStoreContext(shop);
      const { customer } = await getOrCreateUniversalCustomer({ e164Phone: '+919876543210' });

      // Mock session store
      const mockStore = {
        get: vi.fn().mockResolvedValue({
          shop,
          source: 'cart',
          totals: {
            amountMinor: 1000,
            subtotalMinor: 1000,
            discountMinor: 0,
            shippingMinor: 0,
            codFeeMinor: 0,
            currency: 'INR',
          },
          lines: [
            { variantId: '123', quantity: 1, unitAmount: { amountMinor: 1000, currency: 'INR' } },
          ],
          shipping: { codEnabled: true, handleName: 'Standard' },
        }),
        put: vi.fn().mockResolvedValue(undefined),
        claim: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
        getPlaced: vi.fn().mockResolvedValue(null),
        setPlaced: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const address = {
        phone: '9876543210',
        fullName: 'Aditya Singh',
        addressLine1: 'Road 1',
        locality: 'Area',
        region: 'Delhi',
        postalCode: '110001',
      };

      // Case 1: Customer blocked in store -> throws CUSTOMER_BLOCKED
      await updateStoreCustomerFlags({
        customerId: customer._id,
        storeId: context.store._id,
        merchantId: context.merchant._id,
        brandId: context.brand._id,
        flags: { blocked: true },
        changedBy: 'admin',
      });

      await expect(
        placeCodFromSession('sess_1', address, mockStore as unknown as SessionStore, {
          shop,
          customerId: customer._id,
        }),
      ).rejects.toThrow('CUSTOMER_BLOCKED');

      // Case 2: Customer COD disabled -> throws NOT_SERVICEABLE
      await updateStoreCustomerFlags({
        customerId: customer._id,
        storeId: context.store._id,
        merchantId: context.merchant._id,
        brandId: context.brand._id,
        flags: { blocked: false, codDisabled: true },
        changedBy: 'admin',
      });

      await expect(
        placeCodFromSession('sess_2', address, mockStore as unknown as SessionStore, {
          shop,
          customerId: customer._id,
        }),
      ).rejects.toThrow('NOT_SERVICEABLE');
    });
  });

  describe('Section 8: External Customer Mapping', () => {
    it('links external Shopify customer ID to universal customer', async () => {
      const { customer } = await getOrCreateUniversalCustomer({ e164Phone: '+919876543210' });
      const storeId = 'store_shopify_brand';
      const shopifyCustId = 'gid://shopify/Customer/7891234';

      await linkExternalCustomer({
        storeId,
        platform: 'SHOPIFY',
        externalCustomerId: shopifyCustId,
        customerId: customer._id,
        linkedBy: 'PHONE_VERIFIED',
      });

      const resolved = await getUniversalCustomerByExternalId(storeId, 'SHOPIFY', '7891234');
      expect(resolved).toBe(customer._id);
    });
  });

  describe('Section 11 & 12: Shopify Webhook Ingestion & Privacy Deduplication', () => {
    it('ingests webhooks idempotently and deduplicates on shop + webhookId', async () => {
      const shop = 'webhook-test.myshopify.com';
      const webhookId = 'wh_unique_999';

      const res1 = await ingestWebhook({
        shop,
        webhookId,
        topic: 'orders/create',
        payload: { id: 12345 },
      });
      expect(res1.isNew).toBe(true);
      expect(res1.entry.status).toBe('PENDING');

      // Replay of same delivery ID is deduplicated
      const res2 = await ingestWebhook({
        shop,
        webhookId,
        topic: 'orders/create',
        payload: { id: 12345 },
      });
      expect(res2.isNew).toBe(false);
      expect(res2.entry._id).toBe(res1.entry._id);
    });

    it('processes mandatory Shopify GDPR privacy webhooks', async () => {
      const shop = 'gdpr-test.myshopify.com';

      const dataReq = await ingestWebhook({
        shop,
        webhookId: 'wh_gdpr_data',
        topic: 'customers/data_request',
        payload: { customer: { id: 111 } },
      });
      const dataReqRes = await processWebhookEntry(dataReq.entry);
      expect(dataReqRes.processed).toBe(true);
      expect(dataReqRes.status).toBe('PROCESSED');

      const redactReq = await ingestWebhook({
        shop,
        webhookId: 'wh_gdpr_redact',
        topic: 'customers/redact',
        payload: { customer: { id: 111 } },
      });
      const redactReqRes = await processWebhookEntry(redactReq.entry);
      expect(redactReqRes.processed).toBe(true);
      expect(redactReqRes.status).toBe('PROCESSED');
    });
  });
});
