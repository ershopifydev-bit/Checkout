import type { ActionFunctionArgs } from 'react-router';
import {
  IdempotencyConflictError,
  OrderInProgressError,
  OrderReconciliationRequiredError,
} from '../checkout-order-attempt.server';
import { recordCheckoutEvent } from '../checkout-events.server';
import { getShopper } from '../checkout-auth.server';
import { placeCodFromSession, type CheckoutAddress } from '../checkout-session.server';
import { guardProxyRequest, storeUnavailableResponse } from '../proxy-guard.server';
import {
  AmbiguousShopifyError,
  ShopifyThrottledError,
  ShopifyValidationError,
} from '../shopify-client.server';
import { authenticate } from '../shopify.server';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (request.method !== 'POST') return errorResponse('INVALID_REQUEST', 'POST required.', 405);
  const guard = await guardProxyRequest(request, 'placeOrder');
  if (guard instanceof Response) return guard;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object')
    return errorResponse('INVALID_REQUEST', 'Invalid body.', 400);
  const address: CheckoutAddress = {
    phone: String(body['phone'] ?? ''),
    fullName: String(body['fullName'] ?? ''),
    addressLine1: String(body['addressLine1'] ?? ''),
    locality: String(body['locality'] ?? ''),
    region: String(body['region'] ?? ''),
    postalCode: String(body['postalCode'] ?? ''),
  };
  if (body['email'] != null && String(body['email'])) address.email = String(body['email']);

  const shopperToken = request.headers.get('x-ec-shopper') || '';
  const shopper = getShopper(shopperToken);

  try {
    const sessionId = String(params['sessionId'] || '');
    const result = await placeCodFromSession(sessionId, address, undefined, {
      shop: guard.shop,
      ...(shopper?.customerId ? { customerId: shopper.customerId } : {}),
    });
    void recordCheckoutEvent({
      shop: guard.shop,
      sessionId,
      event: 'checkout_completed',
      step: 'complete',
      shopperPhone: address.phone,
      customerId: shopper?.customerId,
      orderId: result.orderId,
      orderName: result.orderName,
      orderGid: result.orderGid,
      paymentMethod: 'cod',
      cartValueMinor: result.totals.amountMinor,
      discountMinor: result.totals.discountMinor,
      itemCount: result.lines.reduce((sum, l) => sum + (l.quantity || 1), 0),
      items: result.lines.map((l) => ({
        title: l.title,
        quantity: l.quantity,
        amountMinor: l.unitAmount.amountMinor,
      })),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return errorResponse('IDEMPOTENCY_CONFLICT', error.message, 409);
    }
    if (error instanceof OrderInProgressError) {
      return Response.json(
        {
          error: {
            code: 'ORDER_IN_PROGRESS',
            message: 'This order is already being placed. Please wait.',
          },
          status: 'PROCESSING',
          retryAfterMs: 1500,
        },
        { status: 409 },
      );
    }
    if (
      error instanceof OrderReconciliationRequiredError ||
      error instanceof AmbiguousShopifyError
    ) {
      return Response.json(
        {
          success: false,
          status: 'RECONCILING',
          message:
            'Order verification in progress with Shopify. Please wait a moment while we confirm your order.',
          retryAfterMs: 2000,
        },
        { status: 202 },
      );
    }
    if (error instanceof ShopifyValidationError) {
      return errorResponse('SHOPIFY_VALIDATION_ERROR', error.message, 422);
    }
    if (error instanceof ShopifyThrottledError) {
      return errorResponse(
        'SHOPIFY_THROTTLED',
        'Store order creation capacity is currently busy. Please retry in a few seconds.',
        429,
      );
    }

    const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
    if (code === 'SESSION_NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Session not found.', 404);
    }
    if (code === 'CUSTOMER_BLOCKED') {
      return errorResponse(
        'CUSTOMER_BLOCKED',
        'Checkout is restricted for your account by the merchant.',
        403,
      );
    }
    if (code === 'SESSION_STORE_UNAVAILABLE') return storeUnavailableResponse();
    if (code === 'ORDER_IN_PROGRESS') {
      return errorResponse(code, 'This order is already being placed.', 409);
    }
    if (code === 'NOT_SERVICEABLE') {
      return errorResponse('NOT_SERVICEABLE', 'COD is not available for this PIN.', 400);
    }
    if (code === 'ADMIN_TOKEN_MISSING') {
      return errorResponse(
        code,
        'App is not installed with Admin access. Reinstall the app and try again.',
        503,
      );
    }
    if (code === 'ORDER_CREATE_FAILED') {
      return errorResponse(
        code,
        'Could not create the Shopify order. Check write_orders scope and try again.',
        502,
      );
    }
    if (code === 'INVALID_ADDRESS') {
      return errorResponse(code, 'Enter a valid delivery address.', 400);
    }
    return errorResponse('INVALID_REQUEST', 'Invalid request.', 400);
  }
}

export async function loader() {
  return errorResponse('INVALID_REQUEST', 'POST required.', 405);
}
