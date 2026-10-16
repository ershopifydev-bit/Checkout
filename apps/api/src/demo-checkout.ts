import { randomUUID } from 'node:crypto';
import type {
  DemoCheckoutSession,
  PlaceCodOrderRequest,
  PlaceCodOrderResponse,
} from '@checkout/contracts';

/** ponytail: in-memory fixture only — replace with Redis/Mongo session store when live carts land. */
const activeSessions = new Map<string, DemoCheckoutSession>();

const FIXTURE_LINES = [
  {
    title: 'Oversized Hoodie',
    variantTitle: 'Black / XL',
    quantity: 1,
    unitAmount: { currency: 'INR' as const, amountMinor: 109900 },
  },
];

function sumMinor(lines: typeof FIXTURE_LINES): number {
  return lines.reduce((total, line) => total + line.unitAmount.amountMinor * line.quantity, 0);
}

export function createDemoCheckoutSession(): DemoCheckoutSession {
  const session: DemoCheckoutSession = {
    sessionId: `demo_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    mode: 'fixture',
    currency: 'INR',
    paymentMethod: 'cod',
    lines: FIXTURE_LINES,
    totals: { currency: 'INR', amountMinor: sumMinor(FIXTURE_LINES) },
  };
  activeSessions.set(session.sessionId, session);
  return session;
}

export function placeDemoCodOrder(input: PlaceCodOrderRequest): PlaceCodOrderResponse {
  if (!activeSessions.has(input.sessionId)) {
    throw new Error('SESSION_NOT_FOUND');
  }
  activeSessions.delete(input.sessionId);
  return {
    orderId: `demo_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    status: 'accepted_demo',
    paymentMethod: 'cod',
    message: 'Demo COD order accepted. Shopify Admin sync is not enabled yet.',
  };
}

/** Test helper: clear in-memory sessions between cases when needed. */
export function resetDemoCheckoutSessions(): void {
  activeSessions.clear();
}
