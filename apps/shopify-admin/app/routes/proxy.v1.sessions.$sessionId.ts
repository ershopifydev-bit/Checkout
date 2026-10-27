import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import {
  getCheckoutSession,
  patchCheckoutSession,
  publicSessionView,
  type CheckoutAddress,
} from '../checkout-session.server';
import { guardProxyRequest, storeUnavailableResponse } from '../proxy-guard.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const sessionId = String(params['sessionId'] || '');
  const guard = await guardProxyRequest(request, 'sessionRead', { sessionId });
  if (guard instanceof Response) return guard;
  const session = await getCheckoutSession(sessionId);
  if (!session) return errorResponse('NOT_FOUND', 'Session not found.', 404);
  return Response.json(publicSessionView(session));
}

export async function action({ request, params }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'PATCH' && request.method !== 'POST') {
    return errorResponse('INVALID_REQUEST', 'PATCH required.', 405);
  }
  const guard = await guardProxyRequest(request, 'sessionWrite', {
    sessionId: String(params['sessionId'] || ''),
  });
  if (guard instanceof Response) return guard;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object')
    return errorResponse('INVALID_REQUEST', 'Invalid body.', 400);
  const patch: {
    address?: CheckoutAddress;
    couponCode?: string;
    giftVoucher?: { code?: string; pin?: string };
    loyaltyRedeemPoints?: number;
  } = {};
  const addressRaw = body['address'];
  if (addressRaw && typeof addressRaw === 'object') {
    const a = addressRaw as Record<string, unknown>;
    const address: CheckoutAddress = {
      phone: String(a['phone'] ?? ''),
      fullName: String(a['fullName'] ?? ''),
      addressLine1: String(a['addressLine1'] ?? ''),
      locality: String(a['locality'] ?? ''),
      region: String(a['region'] ?? ''),
      postalCode: String(a['postalCode'] ?? ''),
    };
    if (a['email'] != null && String(a['email'])) address.email = String(a['email']);
    patch.address = address;
  }
  if (body['couponCode'] != null) patch.couponCode = String(body['couponCode']);
  if (body['giftVoucher'] && typeof body['giftVoucher'] === 'object') {
    const g = body['giftVoucher'] as Record<string, unknown>;
    patch.giftVoucher = { code: String(g['code'] ?? ''), pin: String(g['pin'] ?? '') };
  }
  if (body['loyaltyRedeemPoints'] != null) {
    patch.loyaltyRedeemPoints = Number(body['loyaltyRedeemPoints']);
  }
  try {
    const session = await patchCheckoutSession(String(params['sessionId'] || ''), patch);
    return Response.json(publicSessionView(session));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
    if (code === 'SESSION_NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Session not found.', 404);
    }
    if (code === 'SESSION_STORE_UNAVAILABLE') return storeUnavailableResponse();
    if (code === 'INVALID_COUPON' || code === 'COUPON_INACTIVE') {
      return errorResponse(code, 'That coupon code is not valid.', 400);
    }
    if (code === 'COUPON_UNSUPPORTED') {
      return errorResponse(code, 'This coupon type is not supported in COD checkout yet.', 400);
    }
    if (code === 'INVALID_GIFT_CODE' || code === 'INVALID_GIFT_PIN') {
      return errorResponse(code, 'Enter a valid gift voucher code and PIN/OTP.', 400);
    }
    if (code === 'INVALID_LOYALTY_POINTS') {
      return errorResponse(code, 'Not enough loyalty points to redeem.', 400);
    }
    if (code === 'DISCOUNT_SCOPE_MISSING' || code === 'ADMIN_TOKEN_MISSING') {
      return errorResponse(
        'DISCOUNT_UNAVAILABLE',
        'Discount lookup is unavailable. Re-authorize the app with discount access.',
        503,
      );
    }
    if (code === 'DISCOUNT_LOOKUP_FAILED') {
      return errorResponse(code, 'Could not verify that coupon right now.', 502);
    }
    return errorResponse('INVALID_REQUEST', 'Invalid address or session.', 400);
  }
}
