import type { LoaderFunctionArgs } from 'react-router';
import {
  getCheckoutSettings,
  publicCheckoutSettings,
} from '../checkout-settings.server';
import { authenticate } from '../shopify.server';

function shopFromRequest(request: Request): string {
  const url = new URL(request.url);
  return (url.searchParams.get('shop') || '').trim().toLowerCase();
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const shop = shopFromRequest(request);
  if (!shop) {
    return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Missing shop.' } }, { status: 400 });
  }
  const settings = await getCheckoutSettings(shop);
  return Response.json(publicCheckoutSettings(settings), {
    headers: { 'cache-control': 'private, max-age=30' },
  });
}
