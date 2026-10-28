import type { ActionFunctionArgs } from 'react-router';
import { publicSessionView, quoteCheckoutSession } from '../checkout-session.server';
import { guardProxyRequest, storeUnavailableResponse } from '../proxy-guard.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  const guard = await guardProxyRequest(request, 'sessionWrite', {
    sessionId: String(params['sessionId'] || ''),
  });
  if (guard instanceof Response) return guard;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const quote: { postalCode?: string } = {};
  if (body?.['postalCode'] != null) quote.postalCode = String(body['postalCode']);
  try {
    const session = await quoteCheckoutSession(String(params['sessionId'] || ''), quote);
    return Response.json(publicSessionView(session));
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Session not found.', 404);
    }
    if (error instanceof Error && error.message === 'SESSION_STORE_UNAVAILABLE') {
      return storeUnavailableResponse();
    }
    return errorResponse('INVALID_REQUEST', 'Invalid quote request.', 400);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
