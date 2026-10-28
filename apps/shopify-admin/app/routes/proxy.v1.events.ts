import type { ActionFunctionArgs } from 'react-router';
import {
  recordCheckoutEvent,
  type CheckoutEventType,
  type CheckoutFunnelStep,
} from '../checkout-events.server';
import { guardProxyRequest } from '../proxy-guard.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

const ALLOWED_EVENTS = new Set<CheckoutEventType>([
  'started',
  'logged_in',
  'address_added',
  'discount_applied',
  'payment_selected',
  'checkout_completed',
  'checkout_abandoned',
  'step_viewed',
]);

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);

  const guard = await guardProxyRequest(request, 'eventTrack');
  if (guard instanceof Response) return guard;
  const { shop } = guard;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse('INVALID_REQUEST', 'Invalid body.', 400);
  }

  const rawEvent = String(body['event'] || '').trim() as CheckoutEventType;
  if (!ALLOWED_EVENTS.has(rawEvent)) {
    return errorResponse('INVALID_EVENT', 'Unknown event type.', 400);
  }

  const sessionId = String(body['sessionId'] || '').trim();
  const step = body['step'] ? (String(body['step']).trim() as CheckoutFunnelStep) : undefined;
  const shopperPhone = body['shopperPhone'] ? String(body['shopperPhone']).trim() : undefined;
  const customerId = body['customerId'] ? String(body['customerId']).trim() : undefined;
  const cartValueMinor =
    typeof body['cartValueMinor'] === 'number' ? Math.round(body['cartValueMinor']) : undefined;
  const itemCount =
    typeof body['itemCount'] === 'number' ? Math.round(body['itemCount']) : undefined;
  const discountMinor =
    typeof body['discountMinor'] === 'number' ? Math.round(body['discountMinor']) : undefined;
  const couponCode = body['couponCode'] ? String(body['couponCode']).trim() : undefined;
  const paymentMethod = body['paymentMethod'] ? String(body['paymentMethod']).trim() : undefined;
  const device = body['device'] ? String(body['device']).trim() : undefined;
  const metadata =
    body['metadata'] && typeof body['metadata'] === 'object'
      ? (body['metadata'] as Record<string, unknown>)
      : undefined;

  try {
    const recorded = await recordCheckoutEvent({
      shop,
      sessionId,
      event: rawEvent,
      step,
      shopperPhone,
      customerId,
      cartValueMinor,
      itemCount,
      discountMinor,
      couponCode,
      paymentMethod,
      device,
      metadata,
    });
    return Response.json({ ok: true, eventId: recorded._id, timestamp: recorded.timestamp });
  } catch (err) {
    return errorResponse('INTERNAL_ERROR', 'Could not record event.', 500);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
