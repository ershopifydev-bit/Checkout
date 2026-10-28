import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { getStore } from '../merchant-hierarchy.server';
import { authenticate } from '../shopify.server';
import { getStoreCustomerProfile, updateStoreCustomerFlags } from '../universal-customer.server';

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function errorResponse(code: string, message: string, status = 400) {
  return Response.json({ error: { code, message } }, { status });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const storeId = String(params['storeId'] || '');
  const customerId = String(params['customerId'] || '');

  const store = await getStore(storeId);
  if (!store || (store.shopifyDomain && store.shopifyDomain !== session.shop)) {
    return errorResponse('UNAUTHORIZED', 'Access to this store is unauthorized', 403);
  }

  const profile = await getStoreCustomerProfile(
    customerId,
    store._id,
    store.merchantId,
    store.brandId,
  );

  return jsonResponse(profile);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const storeId = String(params['storeId'] || '');
  const customerId = String(params['customerId'] || '');

  const store = await getStore(storeId);
  if (!store || (store.shopifyDomain && store.shopifyDomain !== session.shop)) {
    return errorResponse('UNAUTHORIZED', 'Access to this store is unauthorized', 403);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.['flags'] || typeof body['flags'] !== 'object') {
    return errorResponse('INVALID_BODY', 'flags object required', 400);
  }

  const updated = await updateStoreCustomerFlags({
    customerId,
    storeId: store._id,
    merchantId: store.merchantId,
    brandId: store.brandId,
    flags: body['flags'] as any,
    reason: body['reason'] ? String(body['reason']) : undefined,
    changedBy: session.shop,
  });

  return jsonResponse(updated);
}
