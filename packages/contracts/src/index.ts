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
  /** Standard v1 path: own one-page COD checkout (ADR 0002). */
  standaloneCodCheckout: CapabilityDecisionSchema,
  checkoutUiExtension: CapabilityDecisionSchema,
  /** Prepaid/card capture — not COD Admin order write. */
  customPayment: CapabilityDecisionSchema,
});
export type CapabilityDecision = z.infer<typeof CapabilityDecisionSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** Readiness covers this foundation process only, not the future checkout dependencies. */
export const HealthResponseSchema = z.strictObject({
  status: z.enum(['alive', 'ready']),
  scope: z.literal('foundation'),
});

/** Fixture-driven demo session for the standalone COD shell. Not a live Shopify cart. */
export const DemoCheckoutLineSchema = z.strictObject({
  title: z.string().min(1).max(120),
  variantTitle: z.string().min(1).max(80),
  quantity: z.int().positive().max(99),
  unitAmount: MoneySchema,
});
export const DemoCheckoutSessionSchema = z.strictObject({
  sessionId: z.string().min(8).max(64),
  mode: z.literal('fixture'),
  currency: z.literal('INR'),
  paymentMethod: z.literal('cod'),
  lines: z.array(DemoCheckoutLineSchema).min(1).max(20),
  totals: MoneySchema,
});
export type DemoCheckoutSession = z.infer<typeof DemoCheckoutSessionSchema>;

export const PlaceCodOrderRequestSchema = z.strictObject({
  sessionId: z.string().min(8).max(64),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  fullName: z.string().min(1).max(80),
  addressLine1: z.string().min(1).max(120),
  locality: z.string().min(1).max(80),
  region: z.string().min(1).max(40),
  postalCode: z.string().regex(/^\d{6}$/),
});
export type PlaceCodOrderRequest = z.infer<typeof PlaceCodOrderRequestSchema>;

export const PlaceCodOrderResponseSchema = z.strictObject({
  orderId: z.string().min(8).max(64),
  status: z.literal('accepted_demo'),
  paymentMethod: z.literal('cod'),
  message: z.string().min(1).max(200),
});
export type PlaceCodOrderResponse = z.infer<typeof PlaceCodOrderResponseSchema>;

// https://zod.dev/json-schema — one contract supplies runtime validation and transport schemas.
export const contractSchemas = {
  Money: z.toJSONSchema(MoneySchema, { target: 'draft-7' }),
  ErrorResponse: z.toJSONSchema(ErrorResponseSchema, { target: 'draft-7' }),
  Capabilities: z.toJSONSchema(CapabilitiesSchema, { target: 'draft-7' }),
  HealthResponse: z.toJSONSchema(HealthResponseSchema, { target: 'draft-7' }),
  DemoCheckoutSession: z.toJSONSchema(DemoCheckoutSessionSchema, { target: 'draft-7' }),
  PlaceCodOrderRequest: z.toJSONSchema(PlaceCodOrderRequestSchema, { target: 'draft-7' }),
  PlaceCodOrderResponse: z.toJSONSchema(PlaceCodOrderResponseSchema, { target: 'draft-7' }),
};
