import { describe, expect, it } from 'vitest';
import {
  defaultCheckoutSettings,
  normalizePaymentMethods,
  publicCheckoutSettings,
} from '../../apps/shopify-admin/app/checkout-settings.server';
import {
  createDashboardToken,
  verifyDashboardToken,
} from '../../apps/shopify-admin/app/dashboard-token.server';

describe('checkout settings', () => {
  it('defaults to brand name mode with COD confirmation on and prepaid off', () => {
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
    expect(settings.loyaltyPartnerName).toBe('Tezvix');
    expect(settings.loyaltyPointsBalance).toBe(1250);
    expect(settings.payments).toEqual({
      cod: true,
      upi: false,
      card: false,
      netbanking: false,
    });
    expect(settings.upiConfig).toEqual({
      vpa: '',
      merchantName: 'RARE',
      discountBadge: '₹50 Off',
      cashbackBadge: 'Win Cashback',
      apps: ['paytm', 'phonepe', 'gpay', 'amazonpay', 'bhim', 'cred'],
    });
  });

  it('exposes only public fields including payments and upiConfig', () => {
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
      loyaltyPartnerName: 'Tezvix',
      loyaltyPointsBalance: 250,
      payments: { cod: true, upi: true, card: false, netbanking: false },
      upiConfig: {
        vpa: 'acme@upi',
        merchantName: 'Acme',
        discountBadge: '₹50 Off',
        cashbackBadge: 'Win Cashback',
        apps: ['paytm', 'phonepe', 'gpay', 'amazonpay', 'bhim', 'cred'],
      },
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
      loyaltyPartnerName: 'Tezvix',
      loyaltyPointsBalance: 250,
      payments: { cod: true, upi: true, card: false, netbanking: false },
      upiConfig: {
        vpa: 'acme@upi',
        merchantName: 'Acme',
        discountBadge: '₹50 Off',
        cashbackBadge: 'Win Cashback',
        apps: ['paytm', 'phonepe', 'gpay', 'amazonpay', 'bhim', 'cred'],
      },
    });
  });

  it('keeps COD on when every payment method is turned off', () => {
    expect(
      normalizePaymentMethods({ cod: false, upi: false, card: false, netbanking: false }),
    ).toEqual({
      cod: true,
      upi: false,
      card: false,
      netbanking: false,
    });
  });

  it('generates and verifies dashboard HMAC tokens for authenticated shops', () => {
    const secret = 'super-secret-key-32-bytes-test!!';
    const shop = 'codemadi.myshopify.com';
    const token = createDashboardToken(shop, secret);
    expect(typeof token).toBe('string');
    expect(verifyDashboardToken(token, shop, secret)).toBe(true);

    // Rejects token with wrong shop
    expect(verifyDashboardToken(token, 'other.myshopify.com', secret)).toBe(false);

    // Rejects forged token
    expect(verifyDashboardToken('invalid:token:format', shop, secret)).toBe(false);
  });
});
