import { describe, expect, it, vi } from 'vitest';
import {
  addMinor,
  decimalStringToMinor,
  formatInrDisplay,
  InvalidMoneyError,
  minorToDecimalString,
  subMinor,
  toShopifyMoney,
  validateMinorUnits,
} from '../../apps/shopify-admin/app/money.server';
import {
  claimAttemptForCreation,
  createOrGetOrderAttempt,
  generateSourceIdentifier,
  hashOrderPayload,
  IdempotencyConflictError,
  markAttemptConfirmed,
  markAttemptFailed,
  markAttemptUnknown,
  OrderInProgressError,
  OrderReconciliationRequiredError,
  resetMemoryAttempts,
} from '../../apps/shopify-admin/app/checkout-order-attempt.server';
import {
  processOrderCreateWebhook,
  reconcileCheckoutAttempt,
} from '../../apps/shopify-admin/app/checkout-order-reconciliation.server';
import {
  AmbiguousShopifyError,
  classifyGraphQLError,
  getShopifyCostTracker,
  recordShopifyCost,
  ShopifyThrottledError,
  ShopifyValidationError,
} from '../../apps/shopify-admin/app/shopify-client.server';
import {
  normalizeIndianPhone,
  splitCustomerName,
} from '../../apps/shopify-admin/app/shopify-cod-order.server';

describe('Tezvix COD Order Creation Hardening', () => {
  describe('Phase 2: Money Handling and Financial Precision', () => {
    it('validates minor units strictly and rejects invalid numbers', () => {
      expect(validateMinorUnits(0)).toBe(0);
      expect(validateMinorUnits(100)).toBe(100);
      expect(validateMinorUnits(349900)).toBe(349900);

      expect(() => validateMinorUnits(-1)).toThrow('cannot be negative');
      expect(() => validateMinorUnits(NaN)).toThrow(InvalidMoneyError);
      expect(() => validateMinorUnits(Infinity)).toThrow(InvalidMoneyError);
      expect(() => validateMinorUnits(10.5)).toThrow(InvalidMoneyError);
      expect(() => validateMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyError);
    });

    it('converts minor units to exact decimal strings without float drift', () => {
      expect(minorToDecimalString(0)).toBe('0.00');
      expect(minorToDecimalString(50)).toBe('0.50');
      expect(minorToDecimalString(100)).toBe('1.00');
      expect(minorToDecimalString(349900)).toBe('3499.00');
      expect(minorToDecimalString(99)).toBe('0.99');
    });

    it('converts decimal strings back to minor units', () => {
      expect(decimalStringToMinor('0.00')).toBe(0);
      expect(decimalStringToMinor('0.50')).toBe(50);
      expect(decimalStringToMinor('1.00')).toBe(100);
      expect(decimalStringToMinor('3499.00')).toBe(349900);
      expect(decimalStringToMinor('99.99')).toBe(9999);

      expect(() => decimalStringToMinor('invalid')).toThrow(
        'must be a valid positive decimal string',
      );
      expect(() => decimalStringToMinor('-10.00')).toThrow(
        'must be a valid positive decimal string',
      );
    });

    it('performs exact minor unit addition and subtraction', () => {
      expect(addMinor(100, 200)).toBe(300);
      expect(subMinor(300, 100)).toBe(200);
      expect(subMinor(100, 200)).toBe(0); // Floor at zero
    });

    it('creates compliant Shopify MoneyV2 objects', () => {
      const money = toShopifyMoney(349900, 'INR');
      expect(money).toEqual({
        amount: '3499.00',
        currencyCode: 'INR',
      });
    });

    it('formats display INR strings', () => {
      expect(formatInrDisplay(349900)).toBe('₹3,499.00');
      expect(formatInrDisplay(5000)).toBe('₹50.00');
    });
  });

  describe('Phase 1: Durable Order Idempotency and State Machine', () => {
    const shop = 'test-merchant.myshopify.com';
    const sessionId = 'session_test_12345';
    const payload = {
      shop,
      items: [{ variantId: '123', quantity: 2, priceMinor: 1000 }],
      address: { phone: '9876543210', postalCode: '110001' },
    };

    it('creates stable source identifier and payload hash', () => {
      const sourceId = generateSourceIdentifier(sessionId);
      expect(sourceId).toBe('tezvix:session_test_12345');

      const hash1 = hashOrderPayload(payload);
      const hash2 = hashOrderPayload(payload);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('creates and retrieves order attempt safely', async () => {
      resetMemoryAttempts();
      const res1 = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });
      expect(res1.isNew).toBe(true);
      expect(res1.attempt.status).toBe('READY');
      expect(res1.attempt.sourceIdentifier).toBe('tezvix:session_test_12345');

      // Second retrieval returns existing attempt
      const res2 = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });
      expect(res2.isNew).toBe(false);
      expect(res2.attempt._id).toBe(res1.attempt._id);
    });

    it('detects payload conflict if checkout parameters change for same session', async () => {
      resetMemoryAttempts();
      await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });

      const conflictingPayload = { ...payload, items: [] };
      await expect(
        createOrGetOrderAttempt({
          shop,
          checkoutSessionId: sessionId,
          expectedAmountMinor: 2000,
          payload: conflictingPayload,
        }),
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it('claims attempt atomically and prevents concurrent order creation', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });

      // First claim succeeds
      const claimResult = await claimAttemptForCreation(attempt._id, 30000, 'worker-1');
      expect(claimResult.claimed).toBe(true);
      expect(claimResult.attempt.status).toBe('CREATING');

      // Concurrent claim throws OrderInProgressError
      await expect(claimAttemptForCreation(attempt._id, 30000, 'worker-2')).rejects.toThrow(
        OrderInProgressError,
      );
    });

    it('transitions attempt from CREATING to CONFIRMED with Shopify order details', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });
      await claimAttemptForCreation(attempt._id);

      const confirmed = await markAttemptConfirmed(attempt._id, {
        shopifyOrderGid: 'gid://shopify/Order/99999',
        shopifyOrderId: '99999',
        shopifyOrderName: '#1001',
        shopifyOrderTotalMinor: 2000,
      });

      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.shopifyOrderId).toBe('99999');
      expect(confirmed.shopifyOrderName).toBe('#1001');

      // Subsequent claim returns claimed: false without throwing
      const subsequent = await claimAttemptForCreation(attempt._id);
      expect(subsequent.claimed).toBe(false);
      expect(subsequent.attempt.status).toBe('CONFIRMED');
    });

    it('transitions to UNKNOWN on ambiguous network timeout and requires reconciliation', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });
      await claimAttemptForCreation(attempt._id);

      const unknown = await markAttemptUnknown(attempt._id, {
        code: 'NETWORK_TIMEOUT',
        message: 'Socket timeout after 15000ms',
      });
      expect(unknown.status).toBe('UNKNOWN');

      // Trying to claim again requires reconciliation
      await expect(claimAttemptForCreation(attempt._id)).rejects.toThrow(
        OrderReconciliationRequiredError,
      );
    });

    it('transitions to FAILED on definite errors allowing safe retry', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 2000,
        payload,
      });
      await claimAttemptForCreation(attempt._id);

      const failed = await markAttemptFailed(attempt._id, {
        code: 'INVENTORY_UNAVAILABLE',
        message: 'Selected variant is out of stock',
      });
      expect(failed.status).toBe('FAILED');

      // Can be claimed again for retry if shopper updates cart
      const retried = await claimAttemptForCreation(attempt._id);
      expect(retried.claimed).toBe(true);
      expect(retried.attempt.status).toBe('CREATING');
    });
  });

  describe('Phase 4: Shopify Phone and Name Normalization', () => {
    it('normalizes customer full names safely without duplicating single names', () => {
      expect(splitCustomerName('Aditya Singh')).toEqual({
        firstName: 'Aditya',
        lastName: 'Singh',
      });
      expect(splitCustomerName('Aditya')).toEqual({
        firstName: 'Aditya',
        lastName: '.',
      });
      expect(splitCustomerName('')).toEqual({
        firstName: 'Customer',
        lastName: '.',
      });
    });

    it('normalizes Indian phone numbers and prevents double prefixing', () => {
      expect(normalizeIndianPhone('9876543210')).toBe('+919876543210');
      expect(normalizeIndianPhone('+919876543210')).toBe('+919876543210');
      expect(normalizeIndianPhone('09876543210')).toBe('+919876543210');
      expect(normalizeIndianPhone('+91 98765 43210')).toBe('+919876543210');
      expect(() => normalizeIndianPhone('invalid')).toThrow('INVALID_PHONE');
    });
  });

  describe('Phase 3 & 5: Shopify Client, Rate Limiting, and Error Classification', () => {
    const shop = 'rate-test.myshopify.com';

    it('tracks per-shop GraphQL cost budget and throttles when depleted', () => {
      const tracker = getShopifyCostTracker(shop);
      expect(tracker.availableBudget).toBe(1000);

      // Simulate heavy query cost
      recordShopifyCost(shop, {
        requestedQueryCost: 950,
        actualQueryCost: 950,
        currentlyAvailable: 50,
        restoreRate: 50,
      });

      const updated = getShopifyCostTracker(shop);
      expect(updated.availableBudget).toBe(50);

      // Exceed remaining budget
      recordShopifyCost(shop, {
        requestedQueryCost: 100,
        actualQueryCost: 100,
        currentlyAvailable: 0,
        restoreRate: 50,
      });

      const depleted = getShopifyCostTracker(shop);
      expect(depleted.availableBudget).toBe(0);
    });

    it('classifies network abort/timeout as AmbiguousShopifyError', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const classified = classifyGraphQLError(abortError, 0);
      expect(classified).toBeInstanceOf(AmbiguousShopifyError);
    });

    it('classifies HTTP 429 as ShopifyThrottledError', () => {
      const classified = classifyGraphQLError(new Error('Throttled'), 429);
      expect(classified).toBeInstanceOf(ShopifyThrottledError);
      expect((classified as ShopifyThrottledError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it('classifies userErrors as ShopifyValidationError', () => {
      const userErrors = [{ field: ['lines', '0'], message: 'Variant out of stock' }];
      const classified = classifyGraphQLError(new Error('Validation failed'), 200, userErrors);
      expect(classified).toBeInstanceOf(ShopifyValidationError);
      expect((classified as ShopifyValidationError).userErrors).toHaveLength(1);
    });
  });

  describe('Phase 6: Order Reconciliation and Webhook Handling', () => {
    const shop = 'recon-test.myshopify.com';
    const sessionId = 'session_recon_999';
    const sourceId = `tezvix:${sessionId}`;

    it('reconciles order via source_identifier query when Shopify already created it', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 150000,
        payload: { shop, items: [] },
      });
      await claimAttemptForCreation(attempt._id);
      await markAttemptUnknown(attempt._id, { code: 'NETWORK_TIMEOUT', message: 'Timeout' });

      // Mock executeShopifyGraphQL to return matched order in nodes
      const client = await import('../../apps/shopify-admin/app/shopify-client.server');
      const spy = vi.spyOn(client, 'executeShopifyGraphQL').mockResolvedValueOnce({
        data: {
          orders: {
            nodes: [
              {
                id: 'gid://shopify/Order/88888',
                name: '#1088',
                createdAt: new Date().toISOString(),
                sourceIdentifier: sourceId,
                currentTotalPriceSet: {
                  shopMoney: {
                    amount: '1500.00',
                    currencyCode: 'INR',
                  },
                },
              },
            ],
          },
        },
      });

      const recon = await reconcileCheckoutAttempt(shop, 'dummy-offline-token', sessionId);
      expect(recon.status).toBe('CONFIRMED');
      if (recon.status === 'CONFIRMED') {
        expect(recon.order.orderId).toBe('88888');
        expect(recon.order.orderName).toBe('#1088');
      }

      spy.mockRestore();
    });

    it('flags MANUAL_REVIEW if multiple orders are found with same source identifier', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 150000,
        payload: { shop, items: [] },
      });
      await claimAttemptForCreation(attempt._id);
      await markAttemptUnknown(attempt._id, { code: 'NETWORK_TIMEOUT', message: 'Timeout' });

      const client = await import('../../apps/shopify-admin/app/shopify-client.server');
      const spy = vi.spyOn(client, 'executeShopifyGraphQL').mockResolvedValueOnce({
        data: {
          orders: {
            nodes: [
              {
                id: 'gid://shopify/Order/1',
                name: '#1001',
                createdAt: new Date().toISOString(),
                sourceIdentifier: sourceId,
                currentTotalPriceSet: { shopMoney: { amount: '1500.00', currencyCode: 'INR' } },
              },
              {
                id: 'gid://shopify/Order/2',
                name: '#1002',
                createdAt: new Date().toISOString(),
                sourceIdentifier: sourceId,
                currentTotalPriceSet: { shopMoney: { amount: '1500.00', currencyCode: 'INR' } },
              },
            ],
          },
        },
      });

      const recon = await reconcileCheckoutAttempt(shop, 'dummy-offline-token', sessionId);
      expect(recon.status).toBe('MANUAL_REVIEW');

      spy.mockRestore();
    });

    it('processes orders/create webhook idempotently and updates attempt to CONFIRMED', async () => {
      resetMemoryAttempts();
      const { attempt } = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 150000,
        payload: { shop, items: [] },
      });
      await claimAttemptForCreation(attempt._id);
      await markAttemptUnknown(attempt._id, { code: 'NETWORK_TIMEOUT', message: 'Timeout' });

      const webhookPayload = {
        id: 77777,
        name: '#1077',
        source_identifier: sourceId,
        total_price: '1500.00',
        currency: 'INR',
      };

      const result = await processOrderCreateWebhook(shop, webhookPayload);
      expect(result).toBe(true);

      // Verify status is now confirmed
      const updated = await createOrGetOrderAttempt({
        shop,
        checkoutSessionId: sessionId,
        expectedAmountMinor: 150000,
        payload: { shop, items: [] },
      });
      expect(updated.attempt.status).toBe('CONFIRMED');
      expect(updated.attempt.shopifyOrderId).toBe('77777');
    });
  });
});
