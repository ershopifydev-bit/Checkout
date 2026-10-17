import { describe, expect, it } from 'vitest';
import {
  defaultCheckoutSettings,
  publicCheckoutSettings,
} from '../../apps/shopify-admin/app/checkout-settings.server';

describe('checkout settings', () => {
  it('defaults to brand name mode with COD confirmation on', () => {
    const settings = defaultCheckoutSettings('Demo.MyShopify.com');
    expect(settings.shop).toBe('demo.myshopify.com');
    expect(settings.brandMode).toBe('name');
    expect(settings.brandName).toBe('RARE');
    expect(settings.logoUrl).toBe('');
    expect(settings.requireCodConfirmation).toBe(true);
    expect(settings.showUpsell).toBe(true);
    expect(settings.giftVouchersEnabled).toBe(true);
    expect(settings.giftVoucherVerifyMode).toBe('pin');
    expect(settings.loyaltyPartnerEnabled).toBe(true);
    expect(settings.loyaltyPartnerName).toBe('EasyRewardz');
    expect(settings.loyaltyPointsBalance).toBe(1250);
  });

  it('exposes only public fields', () => {
    const pub = publicCheckoutSettings({
      shop: 'demo.myshopify.com',
      brandMode: 'logo',
      brandName: 'Acme',
      logoUrl: 'https://cdn.example.com/logo.png',
      requireCodConfirmation: false,
      showUpsell: false,
      giftVouchersEnabled: true,
      giftVoucherVerifyMode: 'otp',
      loyaltyPartnerEnabled: true,
      loyaltyPartnerName: 'EasyRewardz',
      loyaltyPointsBalance: 250,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(pub).toEqual({
      brandMode: 'logo',
      brandName: 'Acme',
      logoUrl: 'https://cdn.example.com/logo.png',
      requireCodConfirmation: false,
      showUpsell: false,
      giftVouchersEnabled: true,
      giftVoucherVerifyMode: 'otp',
      loyaltyPartnerEnabled: true,
      loyaltyPartnerName: 'EasyRewardz',
      loyaltyPointsBalance: 250,
    });
  });
});
