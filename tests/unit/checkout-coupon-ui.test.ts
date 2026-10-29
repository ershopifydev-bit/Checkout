import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('apps/shopify-admin/public/checkout/checkout.js', 'utf8');
const applySource = source.slice(
  source.indexOf('  async function applyCouponCode'),
  source.indexOf('  async function fetchOffers'),
);

describe('checkout coupon modal', () => {
  it.each([true, false])('closes after successful apply (from sheet: %s)', async (keepSheet) => {
    const hideOffersSheet = vi.fn();
    const applySession = vi.fn();
    const input = { value: 'SAVE', disabled: false };
    const session = { coupon: { code: 'SAVE' }, totals: { discountMinor: 100 } };
    const patchSession = vi.fn().mockResolvedValue(session);
    const apply = runInNewContext(`${applySource}; applyCouponCode`, {
      $: () => input,
      patchSession,
      applySession,
      hideOffersSheet,
      showErr: vi.fn(),
      trackCheckoutEvent: vi.fn(),
      syncCouponApplyVisibility: vi.fn(),
      offersSheetMode: 'coupons',
    }) as (code?: string, options?: { keepSheet: boolean }) => Promise<void>;
    await apply(undefined, { keepSheet });
    expect(patchSession).toHaveBeenCalledWith({ couponCode: 'SAVE' });
    expect(applySession).toHaveBeenCalledWith(session);
    expect(hideOffersSheet).toHaveBeenCalledOnce();
  });

  it('keeps the modal and existing session when a code cannot combine', async () => {
    const hideOffersSheet = vi.fn();
    const applySession = vi.fn();
    const showErr = vi.fn();
    const input = { value: 'NO', disabled: false };
    const apply = runInNewContext(`${applySource}; applyCouponCode`, {
      $: () => input,
      patchSession: vi.fn().mockRejectedValue(new Error('Cannot combine')),
      applySession,
      hideOffersSheet,
      showErr,
      offersSheetMode: 'coupons',
    }) as (code?: string, options?: { keepSheet: boolean }) => Promise<void>;
    await apply(undefined, { keepSheet: true });
    expect(hideOffersSheet).not.toHaveBeenCalled();
    expect(applySession).not.toHaveBeenCalled();
    expect(showErr).toHaveBeenCalledWith('ec-sheet-coupon-error', 'Cannot combine');
    expect(input.disabled).toBe(false);
  });
});
