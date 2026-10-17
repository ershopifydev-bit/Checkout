import { randomUUID } from 'node:crypto';

export type DemoCheckoutSession = {
  sessionId: string;
  mode: 'fixture';
  currency: 'INR';
  paymentMethod: 'cod';
  lines: Array<{
    title: string;
    variantTitle: string;
    quantity: number;
    unitAmount: { currency: 'INR'; amountMinor: number };
  }>;
  totals: { currency: 'INR'; amountMinor: number };
};

export type PlaceCodOrderRequest = {
  sessionId: string;
  phone: string;
  fullName: string;
  addressLine1: string;
  locality: string;
  region: string;
  postalCode: string;
};

/** ponytail: in-memory fixture until cart/order sync lands in Mongo. */
const activeSessions = new Map<string, DemoCheckoutSession>();

const FIXTURE_LINES: DemoCheckoutSession['lines'] = [
  {
    title: 'Oversized Hoodie',
    variantTitle: 'Black / XL',
    quantity: 1,
    unitAmount: { currency: 'INR', amountMinor: 109900 },
  },
];

export function createDemoCheckoutSession(): DemoCheckoutSession {
  const amountMinor = FIXTURE_LINES.reduce(
    (total, line) => total + line.unitAmount.amountMinor * line.quantity,
    0,
  );
  const session: DemoCheckoutSession = {
    sessionId: `demo_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    mode: 'fixture',
    currency: 'INR',
    paymentMethod: 'cod',
    lines: FIXTURE_LINES,
    totals: { currency: 'INR', amountMinor },
  };
  activeSessions.set(session.sessionId, session);
  return session;
}

export function placeDemoCodOrder(input: PlaceCodOrderRequest) {
  if (!/^[6-9]\d{9}$/.test(input.phone) || !/^\d{6}$/.test(input.postalCode)) {
    throw new Error('INVALID_REQUEST');
  }
  if (!input.fullName || !input.addressLine1 || !input.locality || !input.region) {
    throw new Error('INVALID_REQUEST');
  }
  if (!activeSessions.has(input.sessionId)) throw new Error('SESSION_NOT_FOUND');
  activeSessions.delete(input.sessionId);
  return {
    orderId: `demo_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    status: 'accepted_demo' as const,
    paymentMethod: 'cod' as const,
    message: 'Demo COD order accepted on the storefront. Shopify Admin order sync is not enabled yet.',
  };
}
