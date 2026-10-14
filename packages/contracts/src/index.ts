import { z } from 'zod';

/** Signed exact minor units; currency exponent and supported codes belong to the provider adapter. */
export const MoneySchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.int(),
});
export type Money = z.infer<typeof MoneySchema>;

export const ErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'NOT_READY',
  'INTERNAL_ERROR',
]);
export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: ErrorCodeSchema, message: z.string().min(1).max(200) }),
  correlationId: z.uuid(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const CapabilityDenialSchema = z.enum([
  'MERCHANT_INACTIVE',
  'FEATURE_DISABLED',
  'NOT_ENTITLED',
  'ELIGIBILITY_UNVERIFIED',
  'ELIGIBILITY_EXPIRED',
  'NOT_ELIGIBLE',
  'APPROVAL_REQUIRED',
  'NOT_IMPLEMENTED',
]);
export const CapabilityDecisionSchema = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(true), reason: z.literal('ELIGIBLE') }),
  z.strictObject({ enabled: z.literal(false), reason: CapabilityDenialSchema }),
]);
export const CapabilitiesSchema = z.strictObject({
  tier: z.enum(['unavailable', 'standard']),
  shopifyCheckoutHandoff: CapabilityDecisionSchema,
  checkoutUiExtension: CapabilityDecisionSchema,
  customPayment: CapabilityDecisionSchema,
});
export type CapabilityDecision = z.infer<typeof CapabilityDecisionSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** Readiness covers this foundation process only, not the future checkout dependencies. */
export const HealthResponseSchema = z.strictObject({
  status: z.enum(['alive', 'ready']),
  scope: z.literal('foundation'),
});

// https://zod.dev/json-schema — one contract supplies runtime validation and transport schemas.
export const contractSchemas = {
  Money: z.toJSONSchema(MoneySchema, { target: 'draft-7' }),
  ErrorResponse: z.toJSONSchema(ErrorResponseSchema, { target: 'draft-7' }),
  Capabilities: z.toJSONSchema(CapabilitiesSchema, { target: 'draft-7' }),
  HealthResponse: z.toJSONSchema(HealthResponseSchema, { target: 'draft-7' }),
};
