import type { LoaderFunctionArgs } from 'react-router';
import { getCheckoutSession } from '../checkout-session.server';
import { listShopifyCoupons } from '../shopify-discount.server';
import { getCheckoutSettings } from '../checkout-settings.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const session = await getCheckoutSession(String(params['sessionId'] || ''));
  if (!session) return errorResponse('NOT_FOUND', 'Session not found.', 404);

  const settings = await getCheckoutSettings(session.shop);
  let coupons: Awaited<ReturnType<typeof listShopifyCoupons>> = [];
  try {
    coupons = await listShopifyCoupons({
      shop: session.shop,
      subtotalMinor: session.totals.subtotalMinor,
      limit: 25,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'DISCOUNT_LOOKUP_FAILED';
    if (code === 'DISCOUNT_SCOPE_MISSING' || code === 'ADMIN_TOKEN_MISSING') {
      return errorResponse(
        'DISCOUNT_UNAVAILABLE',
        'Discount list unavailable. Re-authorize the app with discount access.',
        503,
      );
    }
    console.error('[EasyCheckout] offers list failed', code);
  }

  return Response.json({
    coupons,
    topCoupons: coupons.slice(0, 3),
    recommendedCode: coupons.find((c) => c.recommended)?.code || coupons[0]?.code || '',
    loyalty:
      settings.loyaltyPartnerEnabled !== false
        ? {
            partnerName: settings.loyaltyPartnerName || 'EasyRewardz',
            points: Math.max(0, Math.round(settings.loyaltyPointsBalance || 0)),
            // ponytail: 10 points = ₹1 until loyalty partner API drives conversion.
            redeemableMinor: Math.floor(Math.max(0, settings.loyaltyPointsBalance || 0) / 10) * 100,
          }
        : null,
    giftVouchersEnabled: settings.giftVouchersEnabled !== false,
    giftVoucherVerifyMode: settings.giftVoucherVerifyMode === 'otp' ? 'otp' : 'pin',
  });
}
