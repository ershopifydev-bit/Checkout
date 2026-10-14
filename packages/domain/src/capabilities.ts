import type { Capabilities, CapabilityDecision } from '@checkout/contracts';

/** Construct only from authenticated tenant state and verified server-side evidence, never request bodies. */
export interface MerchantCapabilityContext {
  readonly shopId: string;
  readonly installation: 'active' | 'uninstalled' | 'suspended';
  readonly standardEntitled: boolean;
  readonly handoffEnabled: boolean;
  readonly handoffEvidence: {
    readonly shopId: string;
    readonly result: 'eligible' | 'ineligible';
    readonly checkedAt: number;
    readonly expiresAt: number;
  } | null;
}

function resolveHandoff(merchant: MerchantCapabilityContext, now: number): CapabilityDecision {
  if (merchant.installation !== 'active') return { enabled: false, reason: 'MERCHANT_INACTIVE' };
  if (!merchant.handoffEnabled) return { enabled: false, reason: 'FEATURE_DISABLED' };
  if (!merchant.standardEntitled) return { enabled: false, reason: 'NOT_ENTITLED' };
  const evidence = merchant.handoffEvidence;
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
  const shopifyCheckoutHandoff = resolveHandoff(merchant, now);
  return {
    tier: shopifyCheckoutHandoff.enabled ? 'standard' : 'unavailable',
    shopifyCheckoutHandoff,
    // Plan membership alone does not authorize an extension. Separate integration gates remain open.
    checkoutUiExtension: { enabled: false, reason: 'NOT_IMPLEMENTED' },
    customPayment: { enabled: false, reason: 'APPROVAL_REQUIRED' },
  };
}
