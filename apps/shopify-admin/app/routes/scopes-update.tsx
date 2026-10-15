import type { ActionFunctionArgs } from 'react-router';
import { authenticate, sessionStorage } from '../shopify.server';
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);
  if (topic !== 'APP_SCOPES_UPDATE') return new Response(null, { status: 400 });
  // Re-authenticate rather than retaining stale scopes or trusting out-of-order scope payloads.
  await sessionStorage.deleteShopSessions(shop);
  return new Response(null, { status: 200 });
}
