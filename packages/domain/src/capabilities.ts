import type { Capabilities, CapabilityDecision } from '@checkout/contracts';

/** Construct only from authenticated tenant state and verified server-side evidence, never request bodies. */
export interface MerchantCapabilityContext {
  readonly shopId: string;
  readonly installation: 'active' | 'uninstalled' | 'suspended';
  readonly standardEntitled: boolean;
  readonly standaloneCodEnabled: boolean;
  readonly standaloneCodEvidence: {
    readonly shopId: string;
    readonly result: 'eligible' | 'ineligible';
    readonly checkedAt: number;
    readonly expiresAt: number;
  } | null;
}

function resolveStandaloneCod(
  merchant: MerchantCapabilityContext,
  now: number,
): CapabilityDecision {
  if (merchant.installation !== 'active') return { enabled: false, reason: 'MERCHANT_INACTIVE' };
  if (!merchant.standaloneCodEnabled) return { enabled: false, reason: 'FEATURE_DISABLED' };
  if (!merchant.standardEntitled) return { enabled: false, reason: 'NOT_ENTITLED' };
  const evidence = merchant.standaloneCodEvidence;
  if (
    !evidence ||
    !merchant.shopId ||
    evidence.shopId !== merchant.shopId ||
    !Number.isFinite(now) ||
    !Number.isFinite(evidence.checkedAt) ||
    !Number.isFinite(evidence.expiresAt) ||
    evidence.checkedAt > now ||
    evidence.expiresAt <= evidence.checkedAt
  ) {
    return { enabled: false, reason: 'ELIGIBILITY_UNVERIFIED' };
  }
  if (evidence.expiresAt <= now) return { enabled: false, reason: 'ELIGIBILITY_EXPIRED' };
  if (evidence.result !== 'eligible') return { enabled: false, reason: 'NOT_ELIGIBLE' };
  return { enabled: true, reason: 'ELIGIBLE' };
}

export function resolveCapabilities(
  merchant: MerchantCapabilityContext,
  now: number,
): Capabilities {
  const standaloneCodCheckout = resolveStandaloneCod(merchant, now);
  return {
    tier: standaloneCodCheckout.enabled ? 'standard' : 'unavailable',
    standaloneCodCheckout,
    // Plan membership alone does not authorize an extension. Separate integration gates remain open.
    checkoutUiExtension: { enabled: false, reason: 'NOT_IMPLEMENTED' },
    // Prepaid/card capture only — COD Admin order write uses standaloneCodCheckout.
    customPayment: { enabled: false, reason: 'APPROVAL_REQUIRED' },
  };
}
