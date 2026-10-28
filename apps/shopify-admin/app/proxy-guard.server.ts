import { getCheckoutSession } from './checkout-session.server';
import { enforceRateLimit, type RateLimitName } from './rate-limit.server';

export function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

/** Shop domain from the app-proxy query string (covered by Shopify's signature). */
export function proxyShop(request: Request): string {
  return (new URL(request.url).searchParams.get('shop') || '').trim().toLowerCase();
}

export function storeUnavailableResponse() {
  return errorResponse('SERVICE_UNAVAILABLE', 'Checkout is temporarily unavailable.', 503);
}

/**
 * Common gate for public app-proxy routes. Call after `authenticate.public.appProxy`.
 * Applies the per-IP rate limit, and when `sessionId` is given requires a live session
 * (started when the checkout opens) that belongs to the requesting shop.
 */
export async function guardProxyRequest(
  request: Request,
  name: RateLimitName,
  options: { sessionId?: string } = {},
): Promise<Response | { shop: string }> {
  const shop = proxyShop(request);
  if (!shop) return errorResponse('INVALID_REQUEST', 'Missing shop.', 400);

  const limited = await enforceRateLimit(request, name, shop);
  if (limited) return limited;

  if (options.sessionId !== undefined) {
    try {
      const session = await getCheckoutSession(options.sessionId);
      if (!session || session.shop !== shop) {
        return errorResponse('NOT_FOUND', 'Session not found.', 404);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_STORE_UNAVAILABLE') {
        return storeUnavailableResponse();
      }
      throw error;
    }
  }
  return { shop };
}
