import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { getShopper } from '../checkout-auth.server';
import { guardProxyRequest } from '../proxy-guard.server';
import { authenticate } from '../shopify.server';
import {
  addCustomerAddress,
  deleteCustomerAddress,
  getUniversalCustomer,
  setDefaultCustomerAddress,
} from '../universal-customer.server';

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function errorResponse(code: string, message: string, status = 400) {
  return Response.json({ error: { code, message } }, { status });
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const guard = await guardProxyRequest(request, 'customer');
  if (guard instanceof Response) return guard;

  const token = request.headers.get('x-ec-shopper') || '';
  const shopper = getShopper(token);
  if (!shopper?.universalCustomerId) {
    return errorResponse('UNAUTHORIZED', 'Verified customer authentication required', 401);
  }

  const customer = await getUniversalCustomer(shopper.universalCustomerId);
  if (!customer) {
    return errorResponse('NOT_FOUND', 'Customer profile not found', 404);
  }

  return jsonResponse({ addresses: customer.addresses });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  const guard = await guardProxyRequest(request, 'customer');
  if (guard instanceof Response) return guard;

  const token = request.headers.get('x-ec-shopper') || '';
  const shopper = getShopper(token);
  if (!shopper?.universalCustomerId) {
    return errorResponse('UNAUTHORIZED', 'Verified customer authentication required', 401);
  }

  const method = request.method.toUpperCase();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  try {
    if (method === 'POST') {
      if (!body) return errorResponse('INVALID_BODY', 'Address details required', 400);

      const res = await addCustomerAddress(shopper.universalCustomerId, {
        label: (body['label'] as any) || 'HOME',
        fullName: String(body['fullName'] || ''),
        phone: String(body['phone'] || shopper.phone),
        addressLine1: String(body['addressLine1'] || ''),
        locality: body['locality'] ? String(body['locality']) : undefined,
        region: String(body['region'] || ''),
        postalCode: String(body['postalCode'] || ''),
        countryCode: 'IN',
        isDefault: Boolean(body['isDefault']),
      });

      return jsonResponse({ success: true, address: res.address }, 201);
    }

    if (method === 'PATCH') {
      const addressId = String(body?.['addressId'] || '');
      if (!addressId) return errorResponse('INVALID_REQUEST', 'addressId required', 400);

      if (body?.['isDefault'] === true) {
        const updated = await setDefaultCustomerAddress(shopper.universalCustomerId, addressId);
        return jsonResponse({ success: true, addresses: updated.addresses });
      }
      return jsonResponse({ success: true });
    }

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const addressId = url.searchParams.get('addressId') || String(body?.['addressId'] || '');
      if (!addressId) return errorResponse('INVALID_REQUEST', 'addressId required', 400);

      const updated = await deleteCustomerAddress(shopper.universalCustomerId, addressId);
      return jsonResponse({ success: true, addresses: updated.addresses });
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Supported methods: POST, PATCH, DELETE', 405);
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('MAX_ADDRESSES_EXCEEDED')) {
      return errorResponse('MAX_ADDRESSES_EXCEEDED', message, 400);
    }
    return errorResponse('ADDRESS_OPERATION_FAILED', message, 400);
  }
}
