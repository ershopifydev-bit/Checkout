import { describe, expect, it } from 'vitest';
import { ErrorResponseSchema, MoneySchema, CapabilityDecisionSchema } from '@checkout/contracts';

describe('money contract', () => {
  it('preserves exact minor units and explicit currency', () => {
    expect(MoneySchema.parse({ currency: 'INR', amountMinor: 12345 })).toEqual({
      currency: 'INR',
      amountMinor: 12345,
    });
  });

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '100'])(
    'rejects inexact or non-numeric amounts: %s',
    (amountMinor) => {
      expect(MoneySchema.safeParse({ currency: 'INR', amountMinor }).success).toBe(false);
    },
  );

  it('allows exact signed adjustments and zero', () => {
    for (const amountMinor of [-100, 0, Number.MAX_SAFE_INTEGER]) {
      expect(MoneySchema.parse({ currency: 'INR', amountMinor }).amountMinor).toBe(amountMinor);
    }
  });

  it.each(['inr', '', 'RUPEES', undefined])(
    'requires a three-letter uppercase currency: %s',
    (currency) => {
      expect(MoneySchema.safeParse({ currency, amountMinor: 10 }).success).toBe(false);
    },
  );

  it('rejects undeclared fields', () => {
    expect(MoneySchema.safeParse({ currency: 'INR', amountMinor: 10, amount: 0.1 }).success).toBe(
      false,
    );
  });
});

describe('safe error contract', () => {
  it('requires a correlation UUID and rejects internal error details', () => {
    const error = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
    expect(ErrorResponseSchema.safeParse({ error }).success).toBe(false);
    const body = { error, correlationId: '827d7c31-579f-47be-9c64-1cd4b4a66243' };
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ ...body, stack: 'private' }).success).toBe(false);
    expect(
      ErrorResponseSchema.safeParse({ ...body, error: { ...error, token: 'private' } }).success,
    ).toBe(false);
  });
});

describe('capability contract', () => {
  it('cannot describe a denied capability as enabled', () => {
    expect(
      CapabilityDecisionSchema.safeParse({ enabled: true, reason: 'ELIGIBILITY_UNVERIFIED' })
        .success,
    ).toBe(false);
    expect(CapabilityDecisionSchema.safeParse({ enabled: false, reason: 'ELIGIBLE' }).success).toBe(
      false,
    );
    expect(CapabilityDecisionSchema.safeParse({ enabled: true, reason: 'ELIGIBLE' }).success).toBe(
      true,
    );
  });
});
