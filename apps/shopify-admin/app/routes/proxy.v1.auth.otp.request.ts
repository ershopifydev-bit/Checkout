import type { ActionFunctionArgs } from 'react-router';
import { requestOtp } from '../checkout-auth.server';
import { authenticate } from '../shopify.server';

function shopFromRequest(request: Request): string {
  return (new URL(request.url).searchParams.get('shop') || '').trim().toLowerCase();
}

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  const shop = shopFromRequest(request);
  if (!shop) return errorResponse('INVALID_REQUEST', 'Missing shop.', 400);
  const body = (await request.json().catch(() => null)) as { phone?: string } | null;
  try {
    const result = await requestOtp(shop, body?.phone || '');
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PHONE') {
      return errorResponse('INVALID_PHONE', 'Enter a valid 10-digit mobile number.', 400);
    }
    return errorResponse('INVALID_REQUEST', 'Could not send OTP.', 400);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
