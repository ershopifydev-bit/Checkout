import { describe, expect, it } from 'vitest';
import { CapabilitiesSchema } from '@checkout/contracts';
import { resolveCapabilities, type MerchantCapabilityContext } from '@checkout/domain';

const now = Date.UTC(2026, 9, 14);
const eligible: MerchantCapabilityContext = {
  shopId: 'shop-a',
  installation: 'active',
  standardEntitled: true,
  standaloneCodEnabled: true,
  standaloneCodEvidence: {
    shopId: 'shop-a',
    result: 'eligible',
    checkedAt: now - 1000,
    expiresAt: now + 1000,
  },
};

describe('server-side capability decisions', () => {
  it('enables Standard standalone COD only with current tenant-specific evidence', () => {
    const decision = resolveCapabilities(eligible, now);
    expect(CapabilitiesSchema.parse(decision)).toEqual({
      tier: 'standard',
      standaloneCodCheckout: { enabled: true, reason: 'ELIGIBLE' },
      checkoutUiExtension: { enabled: false, reason: 'NOT_IMPLEMENTED' },
      customPayment: { enabled: false, reason: 'APPROVAL_REQUIRED' },
    });
  });

  it.each([
    [{ installation: 'uninstalled' }, 'MERCHANT_INACTIVE'],
    [{ installation: 'suspended' }, 'MERCHANT_INACTIVE'],
    [{ standaloneCodEnabled: false }, 'FEATURE_DISABLED'],
    [{ standardEntitled: false }, 'NOT_ENTITLED'],
    [{ standaloneCodEvidence: null }, 'ELIGIBILITY_UNVERIFIED'],
  ] as const)('denies unavailable merchant state: %j', (change, reason) => {
    const decision = resolveCapabilities({ ...eligible, ...change }, now);
    expect(decision.tier).toBe('unavailable');
    expect(decision.standaloneCodCheckout).toEqual({ enabled: false, reason });
    expect(decision.customPayment.enabled).toBe(false);
  });

  it.each([
    [{ shopId: 'shop-b' }, 'ELIGIBILITY_UNVERIFIED'],
    [{ result: 'ineligible' }, 'NOT_ELIGIBLE'],
    [{ expiresAt: now }, 'ELIGIBILITY_EXPIRED'],
    [{ expiresAt: now - 1 }, 'ELIGIBILITY_EXPIRED'],
    [{ checkedAt: now + 1 }, 'ELIGIBILITY_UNVERIFIED'],
    [{ checkedAt: NaN }, 'ELIGIBILITY_UNVERIFIED'],
    [{ expiresAt: Infinity }, 'ELIGIBILITY_UNVERIFIED'],
  ] as const)('denies invalid or expired evidence: %j', (change, reason) => {
    const standaloneCodEvidence = {
      shopId: 'shop-a',
      result: 'eligible' as const,
      checkedAt: now - 1000,
      expiresAt: now + 1000,
      ...change,
    };
    expect(
      resolveCapabilities({ ...eligible, standaloneCodEvidence }, now).standaloneCodCheckout,
    ).toEqual({ enabled: false, reason });
  });

  it('denies evaluation with an invalid clock', () => {
    expect(resolveCapabilities(eligible, NaN).standaloneCodCheckout).toEqual({
      enabled: false,
      reason: 'ELIGIBILITY_UNVERIFIED',
    });
  });

  it('re-evaluates revocation without reusing an earlier allowed result', () => {
    expect(resolveCapabilities(eligible, now).standaloneCodCheckout.enabled).toBe(true);
    expect(
      resolveCapabilities({ ...eligible, installation: 'uninstalled' }, now).standaloneCodCheckout
        .enabled,
    ).toBe(false);
  });
});
