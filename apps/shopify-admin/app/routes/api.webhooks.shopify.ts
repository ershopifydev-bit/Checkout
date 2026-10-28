import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { ingestWebhook, processWebhookEntry } from '../webhook-inbox.server';

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload, webhookId, apiVersion } = await authenticate.webhook(request);

  if (!webhookId) {
    return new Response('Webhook ID required', { status: 400 });
  }

  // Durably ingest into webhookInbox first (idempotent deduplication)
  const { entry, isNew } = await ingestWebhook({
    shop,
    webhookId,
    topic,
    apiVersion,
    payload: (payload || {}) as Record<string, unknown>,
  });

  // If new, asynchronously trigger immediate processing
  if (isNew) {
    void processWebhookEntry(entry).catch((err: unknown) => {
      console.error(`[Webhook] Async processing failed for ${entry._id}:`, (err as Error).message);
    });
  }

  // Acknowledge receipt to Shopify immediately with HTTP 200
  return new Response('OK', { status: 200 });
}
