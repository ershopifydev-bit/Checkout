import type { ActionFunctionArgs } from 'react-router';
import { recordCheckoutEvent } from '../checkout-events.server';
import { verifyOtp } from '../checkout-auth.server';
import { guardProxyRequest } from '../proxy-guard.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  const guard = await guardProxyRequest(request, 'otpVerify');
  if (guard instanceof Response) return guard;
  const { shop } = guard;
  const body = (await request.json().catch(() => null)) as {
    phone?: string;
    code?: string;
    sessionId?: string;
  } | null;
  try {
    const shopper = await verifyOtp(shop, body?.phone || '', body?.code || '');
    void recordCheckoutEvent({
      shop,
      sessionId: String(body?.sessionId || ''),
      event: 'logged_in',
      step: 'login',
      shopperPhone: shopper.phone,
      customerId: shopper.customerId,
      metadata: {
        isNew: shopper.isNew,
        hasAddress: Boolean(shopper.address),
      },
    });
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
