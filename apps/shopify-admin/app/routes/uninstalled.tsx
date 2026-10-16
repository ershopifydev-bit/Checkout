import type { ActionFunctionArgs } from 'react-router';
import { authenticate, sessionStorage } from '../shopify.server';
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);
  if (topic !== 'APP_UNINSTALLED') return new Response(null, { status: 400 });
  // Authenticate before mutation, including retries after the session is already gone.
  await sessionStorage.deleteShopSessions(shop);
  return new Response(null, { status: 200 });
}
