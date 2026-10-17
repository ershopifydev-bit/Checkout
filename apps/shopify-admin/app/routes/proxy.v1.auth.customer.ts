import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import {
  createCustomerWithAddress,
  getShopper,
  logoutShopper,
  publicShopperView,
} from '../checkout-auth.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function tokenFrom(request: Request, body?: Record<string, unknown> | null) {
  const header = request.headers.get('x-ec-shopper') || '';
  if (header) return header;
  if (body && typeof body['token'] === 'string') return body['token'];
  return '';
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const shopper = getShopper(tokenFrom(request));
  if (!shopper) return errorResponse('UNAUTHORIZED', 'Login required.', 401);
  return Response.json(publicShopperView(shopper));
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const token = tokenFrom(request, body);

  if (request.method === 'DELETE') {
    logoutShopper(token);
    return Response.json({ ok: true });
  }

  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  if (!token) return errorResponse('UNAUTHORIZED', 'Login required.', 401);

  const address = {
    phone: String(body?.['phone'] || ''),
    fullName: String(body?.['fullName'] || ''),
    addressLine1: String(body?.['addressLine1'] || ''),
    locality: String(body?.['locality'] || ''),
    region: String(body?.['region'] || ''),
    postalCode: String(body?.['postalCode'] || ''),
    ...(typeof body?.['email'] === 'string' ? { email: body['email'] } : {}),
  };

  try {
    const shopper = await createCustomerWithAddress(token, address);
    return Response.json(publicShopperView(shopper));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
    if (code === 'SHOPPER_NOT_FOUND') return errorResponse(code, 'Login again.', 401);
    if (code === 'INVALID_ADDRESS') {
      return errorResponse(code, 'Enter a valid name, address, and PIN.', 400);
    }
    console.error('[EasyCheckout] customer save failed', code);
    return errorResponse('INVALID_REQUEST', 'Could not save customer.', 400);
  }
}
