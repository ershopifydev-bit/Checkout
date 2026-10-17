import type { ActionFunctionArgs } from 'react-router';
import { verifyOtp } from '../checkout-auth.server';
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
  const body = (await request.json().catch(() => null)) as {
    phone?: string;
    code?: string;
  } | null;
  try {
    const shopper = await verifyOtp(shop, body?.phone || '', body?.code || '');
    return Response.json(shopper);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
    const messages: Record<string, [string, number]> = {
      INVALID_PHONE: ['Enter a valid 10-digit mobile number.', 400],
      OTP_EXPIRED: ['OTP expired. Request a new code.', 400],
      OTP_INVALID: ['Incorrect OTP. Try again.', 400],
      OTP_LOCKED: ['Too many attempts. Request a new OTP.', 429],
    };
    const [message, status] = messages[code] || ['Could not verify OTP.', 400];
    return errorResponse(code, message, status);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
