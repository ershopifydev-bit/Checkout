import { describe, expect, it } from 'vitest';
import {
  DemoCheckoutSessionSchema,
  PlaceCodOrderRequestSchema,
  PlaceCodOrderResponseSchema,
} from '@checkout/contracts';
import { createDemoCheckoutSession, placeDemoCodOrder } from '../../apps/api/src/demo-checkout.js';

describe('demo checkout fixture', () => {
  it('returns a stable fixture cart in INR with COD only', () => {
    const session = DemoCheckoutSessionSchema.parse(createDemoCheckoutSession());
    expect(session.paymentMethod).toBe('cod');
    expect(session.currency).toBe('INR');
    expect(session.lines.length).toBeGreaterThan(0);
    expect(session.totals.amountMinor).toBeGreaterThan(0);
    expect(session.mode).toBe('fixture');
  });
});

describe('demo COD place-order', () => {
  it('accepts a valid COD payload and returns a demo order id', () => {
    const session = createDemoCheckoutSession();
    const result = placeDemoCodOrder({
      sessionId: session.sessionId,
      phone: '9876543210',
      fullName: 'Ada Merchant',
      addressLine1: '12 MG Road',
      locality: 'Bengaluru',
      region: 'KA',
      postalCode: '560001',
    });
    expect(PlaceCodOrderResponseSchema.parse(result).status).toBe('accepted_demo');
    expect(result.orderId.startsWith('demo_')).toBe(true);
  });

  it.each([{ phone: '12345' }, { postalCode: '56A001' }, { fullName: '' }])(
    'rejects invalid shopper input %#',
    (partial) => {
      const session = createDemoCheckoutSession();
      const parsed = PlaceCodOrderRequestSchema.safeParse({
        sessionId: session.sessionId,
        phone: '9876543210',
        fullName: 'Ada Merchant',
        addressLine1: '12 MG Road',
        locality: 'Bengaluru',
        region: 'KA',
        postalCode: '560001',
        ...partial,
      });
      expect(parsed.success).toBe(false);
    },
  );

  it('rejects unknown session ids', () => {
    expect(() =>
      placeDemoCodOrder({
        sessionId: 'unknown-session',
        phone: '9876543210',
        fullName: 'Ada Merchant',
        addressLine1: '12 MG Road',
        locality: 'Bengaluru',
        region: 'KA',
        postalCode: '560001',
      }),
    ).toThrow(/SESSION_NOT_FOUND/);
  });
});
