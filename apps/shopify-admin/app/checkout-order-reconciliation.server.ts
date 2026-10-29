import {
  findAttemptBySessionId,
  findAttemptBySourceIdentifier,
  markAttemptConfirmed,
  type CheckoutOrderAttempt,
} from './checkout-order-attempt.server';
import { decimalStringToMinor } from './money.server';
import { executeShopifyGraphQL } from './shopify-client.server';

export interface ReconciledOrder {
  orderGid: string;
  orderId: string;
  orderName: string;
  totalMinor: number;
  statusUrl?: string | undefined;
}

export type ReconciliationResult =
  | { status: 'CONFIRMED'; order: ReconciledOrder }
  | { status: 'RECONCILING'; message: string; attempt: CheckoutOrderAttempt }
  | { status: 'FAILED'; reason: string }
  | { status: 'MANUAL_REVIEW'; reason: string; matches: number };

interface ShopifyOrderNode {
  id: string;
  name: string;
  legacyResourceId?: string | null | undefined;
  sourceIdentifier?: string | null | undefined;
  statusPageUrl?: string | null | undefined;
  currentTotalPriceSet?:
    | {
        shopMoney?:
          | {
              amount?: string | undefined;
              currencyCode?: string | undefined;
            }
          | undefined;
      }
    | undefined;
  displayFinancialStatus?: string | undefined;
  createdAt?: string | undefined;
}

const RECONCILIATION_QUERY = `
  query OrderReconciliation($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        legacyResourceId
        sourceIdentifier
        statusPageUrl
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        displayFinancialStatus
        createdAt
      }
    }
  }
`;

/**
 * Reconciles an ambiguous or pending checkout attempt against Shopify Admin API.
 */
export async function reconcileCheckoutAttempt(
  shop: string,
  token: string,
  checkoutSessionId: string,
): Promise<ReconciliationResult> {
  const normShop = shop.trim().toLowerCase();
  const attempt = await findAttemptBySessionId(normShop, checkoutSessionId);
  if (!attempt) {
    return { status: 'FAILED', reason: 'ATTEMPT_NOT_FOUND' };
  }

  // If already confirmed locally, return immediately
  if (
    attempt.status === 'CONFIRMED' &&
    attempt.shopifyOrderGid &&
    attempt.shopifyOrderId &&
    attempt.shopifyOrderName
  ) {
    return {
      status: 'CONFIRMED',
      order: {
        orderGid: attempt.shopifyOrderGid,
        orderId: attempt.shopifyOrderId,
        orderName: attempt.shopifyOrderName,
        totalMinor: attempt.shopifyOrderTotalMinor ?? attempt.expectedAmountMinor,
        statusUrl: attempt.shopifyOrderStatusUrl || undefined,
      },
    };
  }

  const sourceIdentifier = attempt.sourceIdentifier;

  // Query Shopify for orders with this source_identifier
  try {
    const { data } = await executeShopifyGraphQL<{
      orders?: { nodes?: ShopifyOrderNode[] | undefined } | undefined;
    }>(
      normShop,
      token,
      RECONCILIATION_QUERY,
      { query: `source_identifier:'${sourceIdentifier}'` },
      { timeoutMs: 10000, estimatedCost: 10 },
    );

    const matchingNodes = (data.orders?.nodes || []).filter(
      (node) => node.sourceIdentifier === sourceIdentifier,
    );

    if (matchingNodes.length === 1) {
      const node = matchingNodes[0];
      if (!node) {
        return { status: 'FAILED', reason: 'EMPTY_NODE' };
      }
      const orderTotalMinor = node.currentTotalPriceSet?.shopMoney?.amount
        ? decimalStringToMinor(node.currentTotalPriceSet.shopMoney.amount)
        : attempt.expectedAmountMinor;

      // Verify total matches expected
      const diff = Math.abs(orderTotalMinor - attempt.expectedAmountMinor);
      if (diff > 100) {
        // More than 1 rupee mismatch
        console.error('[Reconciliation] Order total mismatch in Shopify:', {
          expected: attempt.expectedAmountMinor,
          actual: orderTotalMinor,
          orderId: node.id,
        });
      }

      const orderId = String(node.legacyResourceId || node.id.split('/').pop() || node.id);
      await markAttemptConfirmed(attempt._id, {
        shopifyOrderGid: node.id,
        shopifyOrderId: orderId,
        shopifyOrderName: node.name,
        shopifyOrderTotalMinor: orderTotalMinor,
        shopifyOrderStatusUrl: node.statusPageUrl || undefined,
      });

      return {
        status: 'CONFIRMED',
        order: {
          orderGid: node.id,
          orderId,
          orderName: node.name,
          totalMinor: orderTotalMinor,
          statusUrl: node.statusPageUrl || undefined,
        },
      };
    }

    if (matchingNodes.length > 1) {
      // Multiple orders matched the same sourceIdentifier! Escalate immediately.
      console.error(
        `[Reconciliation CRITICAL] Multiple Shopify orders found for sourceIdentifier ${sourceIdentifier}`,
      );
      return {
        status: 'MANUAL_REVIEW',
        reason: 'MULTIPLE_SHOPIFY_ORDERS_MATCHED',
        matches: matchingNodes.length,
      };
    }

    // No matching order found in Shopify search yet
    const elapsedMs = Date.now() - new Date(attempt.updatedAt).getTime();
    if (elapsedMs < 60000) {
      // Within 60 seconds: Shopify search index or asynchronous creation may lag
      return {
        status: 'RECONCILING',
        message: 'Order creation status is still being confirmed. Please wait.',
        attempt,
      };
    }

    // Older than 60s and verified no order exists with this sourceIdentifier
    return {
      status: 'FAILED',
      reason: 'ORDER_NOT_FOUND_IN_SHOPIFY',
    };
  } catch (err: unknown) {
    console.error('[Reconciliation] query error:', (err as Error).message);
    return {
      status: 'RECONCILING',
      message: 'Could not contact Shopify to confirm order. We are retrying confirmation.',
      attempt,
    };
  }
}

/**
 * Handles incoming `orders/create` webhook to idempotently confirm order attempts.
 */
export async function processOrderCreateWebhook(
  shop: string,
  webhookPayload: Record<string, unknown>,
): Promise<boolean> {
  const normShop = shop.trim().toLowerCase();
  const sourceIdentifier = String(webhookPayload['source_identifier'] || '').trim();
  if (!sourceIdentifier) return false;

  const attempt = await findAttemptBySourceIdentifier(normShop, sourceIdentifier);
  if (!attempt) return false;

  if (attempt.status === 'CONFIRMED') {
    return true; // Already confirmed
  }

  const orderId = String(webhookPayload['id'] || '');
  const orderName = String(webhookPayload['name'] || '');
  const totalPrice = String(webhookPayload['total_price'] || '');
  const orderTotalMinor = totalPrice
    ? decimalStringToMinor(totalPrice)
    : attempt.expectedAmountMinor;

  await markAttemptConfirmed(attempt._id, {
    shopifyOrderGid: `gid://shopify/Order/${orderId}`,
    shopifyOrderId: orderId,
    shopifyOrderName: orderName,
    shopifyOrderTotalMinor: orderTotalMinor,
  });

  console.info(`[Webhook] Reconciled attempt ${attempt._id} via orders/create webhook`, {
    orderName,
    orderId,
  });
  return true;
}

export { processOrderCreateWebhook as processOrderCreatedWebhook };
