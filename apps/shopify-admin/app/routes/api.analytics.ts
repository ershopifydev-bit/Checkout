import type { LoaderFunctionArgs } from 'react-router';
import {
  getAbandonedCheckouts,
  getCheckoutFunnelStats,
  getRecentCheckoutEvents,
} from '../checkout-analytics.server';
import { verifyDashboardToken } from '../dashboard-token.server';
import { authenticate } from '../shopify.server';

function shopFromToken(token?: string | null): string | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [shop] = raw.split(':');
    return shop || null;
  } catch {
    return null;
  }
}

async function authenticateAnalyticsRequest(request: Request): Promise<{ shop: string }> {
  try {
    const { session } = await authenticate.admin(request);
    return { shop: session.shop };
  } catch (err) {
    const url = new URL(request.url);
    const token = request.headers.get('x-dashboard-token') || url.searchParams.get('token');
    const shop = url.searchParams.get('shop') || shopFromToken(token);
    const secret = process.env['SESSION_ENCRYPTION_KEY'] || 'checkout-dashboard-secret';
    if (token && shop && verifyDashboardToken(token, shop, secret)) {
      return { shop };
    }
    throw err;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await authenticateAnalyticsRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));

    const [funnel, abandoned, recentEvents] = await Promise.all([
      getCheckoutFunnelStats(shop),
      getAbandonedCheckouts(shop, limit),
      getRecentCheckoutEvents(shop, undefined, 20),
    ]);

    return Response.json(
      {
        shop,
        funnel,
        abandoned,
        recentEvents,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 },
    );
  }
}
