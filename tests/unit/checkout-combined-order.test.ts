import { expect, it, vi } from 'vitest';
import { createCodOrderInShopify } from '../../apps/shopify-admin/app/shopify-cod-order.server';
import { executeShopifyGraphQL } from '../../apps/shopify-admin/app/shopify-client.server';

vi.mock('../../apps/shopify-admin/app/shopify-client.server', () => ({
  executeShopifyGraphQL: vi.fn().mockResolvedValue({
    data: {
      orderCreate: {
        order: {
          id: 'gid://shopify/Order/1',
          name: '#1',
          statusPageUrl: 'https://test.myshopify.com/orders/1a2b3c',
          currentTotalPriceSet: { shopMoney: { amount: '800.00' } },
        },
        userErrors: [],
      },
    },
  }),
}));

it('passes combined coupon savings to the Shopify COD order', async () => {
  const result = await createCodOrderInShopify({
    shop: 'test.myshopify.com',
    token: 'test',
    checkoutSessionId: 'sess_test',
    address: {
      fullName: 'Test Shopper',
      phone: '9876543210',
      addressLine1: '1 Test Road',
      locality: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
    },
    lines: [
      {
        title: 'Bag',
        variantTitle: 'Default Title',
        quantity: 1,
        unitAmount: { currency: 'INR', amountMinor: 100000 },
      },
    ],
    totals: {
      currency: 'INR',
      subtotalMinor: 100000,
      discountMinor: 20000,
      shippingMinor: 0,
      codFeeMinor: 0,
      amountMinor: 80000,
    },
    coupon: {
      code: 'ONE + TWO',
      kind: 'fixed',
      value: 20000,
      discountMinor: 20000,
      summary: 'Combined savings',
    },
  });
  const call = vi.mocked(executeShopifyGraphQL).mock.calls[0]!;
  expect(call[2]).not.toMatch(/order\s*\{[^}]*\bfinancialStatus\b/);
  expect(call[2]).toContain('displayFinancialStatus');
  expect(call[2]).toContain('statusPageUrl');
  expect(result.statusUrl).toBe('https://test.myshopify.com/orders/1a2b3c');
  expect(call[3]).toMatchObject({
    order: {
      discountCode: {
        itemFixedDiscountCode: {
          code: 'ONE + TWO',
          amountSet: { shopMoney: { amount: '200.00', currencyCode: 'INR' } },
        },
      },
    },
  });
});
