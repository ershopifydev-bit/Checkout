import { describe, expect, it } from 'vitest';
import {
  DEV_OTP,
  SHOPPER_TTL_MS,
  addressFromNode,
  createCustomerWithAddress,
  getShopper,
  logoutShopper,
  requestOtp,
  verifyOtp,
} from '../../apps/shopify-admin/app/checkout-auth.server';

describe('checkout auth OTP', () => {
  it('maps Shopify addresses that omit province (common for India)', () => {
    const address = addressFromNode('9876543210', 'Ada', {
      address1: '12 MG Road',
      city: 'Bengaluru',
      zip: '560 001',
      province: null,
      provinceCode: 'KA',
    });
    expect(address).toEqual({
      phone: '9876543210',
      fullName: 'Ada',
      addressLine1: '12 MG Road',
      locality: 'Bengaluru',
      region: 'KA',
      postalCode: '560001',
    });
  });

  it('issues fixed 0000 OTP in development and verifies new customers', async () => {
    const shop = 'codemadi.myshopify.com';
    const phone = '9876543210';
    const issued = await requestOtp(shop, phone);
    expect(issued.phone).toBe(phone);
    expect(issued.devCode).toBe(DEV_OTP);
    expect(issued.otpLength).toBe(4);

    const shopper = await verifyOtp(shop, phone, DEV_OTP);
    expect(shopper.token.startsWith('shopper_')).toBe(true);
    expect(shopper.isNew).toBe(true);
    expect(shopper.needsAddress).toBe(true);
    expect(shopper.expiresInSec).toBe(Math.floor(SHOPPER_TTL_MS / 1000));
    expect(getShopper(shopper.token)?.phone).toBe(phone);
  });

  it('saves address for a new shopper without throwing when Admin is unavailable', async () => {
    const shop = 'codemadi.myshopify.com';
    const phone = '9123456780';
    await requestOtp(shop, phone);
    const shopper = await verifyOtp(shop, phone, DEV_OTP);
    const saved = await createCustomerWithAddress(shopper.token, {
      phone,
      fullName: 'Test Buyer',
      addressLine1: '12 Market Road',
      locality: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
    });
    expect(saved.isNew).toBe(false);
    expect(saved.address?.postalCode).toBe('400001');
    expect(saved.customerId).toBeTruthy();
    logoutShopper(shopper.token);
    expect(getShopper(shopper.token)).toBeNull();
  });

  it('rejects bad OTP', async () => {
    await requestOtp('codemadi.myshopify.com', '9988776655');
    await expect(verifyOtp('codemadi.myshopify.com', '9988776655', '1111')).rejects.toThrow(
      'OTP_INVALID',
    );
  });
});
