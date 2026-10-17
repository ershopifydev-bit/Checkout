import type { ActionFunctionArgs } from 'react-router';
import { createCheckoutSession, publicSessionView } from '../checkout-session.server';
import { authenticate } from '../shopify.server';

function shopFromRequest(request: Request): string {
  const url = new URL(request.url);
  return (url.searchParams.get('shop') || '').trim().toLowerCase();
}

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  const shop = shopFromRequest(request);
  if (!shop) return errorResponse('INVALID_REQUEST', 'Missing shop.', 400);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object')
    return errorResponse('INVALID_REQUEST', 'Invalid body.', 400);
  const source = body['source'] === 'buy_now' ? 'buy_now' : 'cart';
  const lines = Array.isArray(body['lines']) ? body['lines'] : [];
  const discountMinor =
    typeof body['discountMinor'] === 'number' && Number.isFinite(body['discountMinor'])
      ? Math.max(0, Math.round(body['discountMinor']))
      : undefined;
  try {
    const session = await createCheckoutSession({
      shop,
      source,
      ...(discountMinor != null ? { discountMinor } : {}),
      lines: lines as never,
    });
    return Response.json(publicSessionView(session));
  } catch (error) {
    if (error instanceof Error && error.message === 'EMPTY_CART') {
      return errorResponse('EMPTY_CART', 'Add an item before checkout.', 400);
    }
    return errorResponse('INVALID_REQUEST', 'Invalid session request.', 400);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
