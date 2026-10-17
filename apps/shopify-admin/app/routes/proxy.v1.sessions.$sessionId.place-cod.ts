import type { ActionFunctionArgs } from 'react-router';
import { getShopper } from '../checkout-auth.server';
import { placeCodFromSession, type CheckoutAddress } from '../checkout-session.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object')
    return errorResponse('INVALID_REQUEST', 'Invalid body.', 400);
  const address: CheckoutAddress = {
    phone: String(body['phone'] ?? ''),
    fullName: String(body['fullName'] ?? ''),
    addressLine1: String(body['addressLine1'] ?? ''),
    locality: String(body['locality'] ?? ''),
    region: String(body['region'] ?? ''),
    postalCode: String(body['postalCode'] ?? ''),
  };
  if (body['email'] != null && String(body['email'])) address.email = String(body['email']);

  const shopperToken = request.headers.get('x-ec-shopper') || '';
  const shopper = getShopper(shopperToken);

  try {
    const result = await placeCodFromSession(
      String(params['sessionId'] || ''),
      address,
      undefined,
      {
        ...(shopper?.customerId ? { customerId: shopper.customerId } : {}),
      },
    );
    return Response.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
    if (code === 'SESSION_NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Session not found.', 404);
    }
    if (code === 'NOT_SERVICEABLE') {
      return errorResponse('NOT_SERVICEABLE', 'COD is not available for this PIN.', 400);
    }
    if (code === 'ADMIN_TOKEN_MISSING') {
      return errorResponse(
        code,
        'App is not installed with Admin access. Reinstall the app and try again.',
        503,
      );
    }
    if (code === 'ORDER_CREATE_FAILED') {
      return errorResponse(
        code,
        'Could not create the Shopify order. Check write_orders scope and try again.',
        502,
      );
    }
    if (code === 'INVALID_ADDRESS') {
      return errorResponse(code, 'Enter a valid delivery address.', 400);
    }
    return errorResponse('INVALID_REQUEST', 'Invalid request.', 400);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
