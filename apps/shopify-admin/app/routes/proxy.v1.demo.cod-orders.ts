import type { ActionFunctionArgs } from 'react-router';
import { placeDemoCodOrder } from '../demo-checkout.server';
import { authenticate } from '../shopify.server';

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') {
    return Response.json(
      { error: { code: 'INVALID_REQUEST', message: 'POST required.' } },
      { status: 405 },
    );
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return Response.json(
      { error: { code: 'INVALID_REQUEST', message: 'Invalid body.' } },
      { status: 400 },
    );
  }
  try {
    const result = placeDemoCodOrder({
      sessionId: String(body['sessionId'] ?? ''),
      phone: String(body['phone'] ?? ''),
      fullName: String(body['fullName'] ?? ''),
      addressLine1: String(body['addressLine1'] ?? ''),
      locality: String(body['locality'] ?? ''),
      region: String(body['region'] ?? ''),
      postalCode: String(body['postalCode'] ?? ''),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
        { status: 404 },
      );
    }
    return Response.json(
      { error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } },
      { status: 400 },
    );
  }
}

export async function loader() {
  return Response.json(
    { error: { code: 'INVALID_REQUEST', message: 'POST required.' } },
    { status: 405 },
  );
}
