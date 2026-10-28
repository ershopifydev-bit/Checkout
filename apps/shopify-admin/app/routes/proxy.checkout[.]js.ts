import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const path = fileURLToPath(new URL('../../public/checkout/checkout.js', import.meta.url));
  const body = await readFile(path, 'utf8');
  return new Response(body, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
