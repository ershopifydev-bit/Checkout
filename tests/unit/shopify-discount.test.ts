import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listShopifyCoupons,
  resolveShopifyCoupon,
} from '../../apps/shopify-admin/app/shopify-discount.server';

vi.mock('../../apps/shopify-admin/app/shopify.server', () => ({
  sessionStorage: { findSessionsByShop: async () => [{ id: 'offline_test', accessToken: 'test' }] },
}));
afterEach(() => vi.unstubAllGlobals());

describe('Shopify discount lookup', () => {
  it('retains combination rules and converts Shopify fractional percentages', async () => {
    const discount = {
      __typename: 'DiscountCodeBasic',
      status: 'ACTIVE',
      shortSummary: '20% off',
      discountClasses: ['ORDER'],
      combinesWith: { orderDiscounts: true, shippingDiscounts: true, productDiscounts: false },
      customerGets: { value: { percentage: 0.2 } },
      codes: { nodes: [{ code: 'SAVE20' }] },
    };
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          codeDiscountNodeByCode: { codeDiscount: discount },
          codeDiscountNodes: { nodes: [{ codeDiscount: discount }] },
        },
      }),
    });
    vi.stubGlobal('fetch', fetch);
    const coupon = await resolveShopifyCoupon({
      shop: 'test.myshopify.com',
      code: 'SAVE20',
      subtotalMinor: 100000,
    });
    expect(coupon.discountClass).toBe('ORDER');
    expect(coupon.combinesWith).toEqual(discount.combinesWith);
    expect(coupon.discountMinor).toBe(20000);
    const offers = await listShopifyCoupons({ shop: 'test.myshopify.com', subtotalMinor: 100000 });
    expect(offers[0]?.discountMinor).toBe(20000);
    const request = fetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(request[1].body) as { query: string };
    expect(body.query).toContain('combinesWith');
  });
});
