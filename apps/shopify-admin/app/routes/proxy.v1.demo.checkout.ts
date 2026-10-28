import type { LoaderFunctionArgs } from 'react-router';
import { createDemoCheckoutSession } from '../demo-checkout.server';
import { authenticate } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  return Response.json(createDemoCheckoutSession());
}
