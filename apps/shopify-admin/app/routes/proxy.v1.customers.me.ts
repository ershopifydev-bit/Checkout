import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { getShopper } from '../checkout-auth.server';
import { guardProxyRequest } from '../proxy-guard.server';
import { authenticate } from '../shopify.server';
import { getUniversalCustomer, updateCustomerProfile } from '../universal-customer.server';

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

  return jsonResponse({
    customerId: customer._id,
    phoneMasked: customer.phoneMasked,
    firstName: customer.firstName,
    lastName: customer.lastName,
    primaryEmail: customer.primaryEmail,
    birthday: customer.birthday,
    weddingAnniversary: customer.weddingAnniversary,
    gender: customer.gender,
    addresses: customer.addresses,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  });
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

  if (request.method !== 'PATCH' && request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'PATCH or POST required', 405);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return errorResponse('INVALID_BODY', 'Invalid JSON payload', 400);
  }

  // Strict Phone Immutability Check
  if ('phone' in body || 'phoneKey' in body) {
    return errorResponse(
      'PHONE_IMMUTABLE',
      'Verified customer phone numbers cannot be changed through profile APIs',
      400,
    );
  }

  try {
    const updated = await updateCustomerProfile(shopper.universalCustomerId, {
      ...(typeof body['firstName'] === 'string' ? { firstName: body['firstName'] } : {}),
      ...(typeof body['lastName'] === 'string' ? { lastName: body['lastName'] } : {}),
      ...(typeof body['primaryEmail'] === 'string' ? { primaryEmail: body['primaryEmail'] } : {}),
      ...(typeof body['birthday'] === 'string' ? { birthday: body['birthday'] } : {}),
      ...(typeof body['weddingAnniversary'] === 'string'
        ? { weddingAnniversary: body['weddingAnniversary'] }
        : {}),
      ...(typeof body['gender'] === 'string' ? { gender: body['gender'] as any } : {}),
    });

    return jsonResponse({
      customerId: updated._id,
      phoneMasked: updated.phoneMasked,
      firstName: updated.firstName,
      lastName: updated.lastName,
      primaryEmail: updated.primaryEmail,
      birthday: updated.birthday,
      weddingAnniversary: updated.weddingAnniversary,
      gender: updated.gender,
      updatedAt: updated.updatedAt,
    });
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (message.includes('PHONE_IMMUTABLE')) {
      return errorResponse('PHONE_IMMUTABLE', message, 400);
    }
    if (message.includes('INVALID_EMAIL')) {
      return errorResponse('INVALID_EMAIL', 'Please enter a valid email address', 400);
    }
    return errorResponse('UPDATE_FAILED', message, 400);
  }
}
