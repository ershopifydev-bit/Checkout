import { describe, expect, it } from 'vitest';
import { createCheckoutSession } from '../../apps/shopify-admin/app/checkout-session.server';
import { guardProxyRequest } from '../../apps/shopify-admin/app/proxy-guard.server';

function req(shop?: string) {
  const url = new URL('https://app.test/proxy/v1/sessions/x');
  if (shop) url.searchParams.set('shop', shop);
  return new Request(url, { headers: { 'x-forwarded-for': '9.9.9.9' } });
}

describe('guardProxyRequest', () => {
  it('rejects requests without a shop', async () => {
    const result = await guardProxyRequest(req(), 'sessionRead');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('returns 404 for an unknown session', async () => {
    const result = await guardProxyRequest(req('a.myshopify.com'), 'sessionRead', {
      sessionId: 'sess_unknown',
    });
    expect((result as Response).status).toBe(404);
  });

  it('returns 404 when the session belongs to another shop, and passes for its own shop', async () => {
    const session = await createCheckoutSession({
      shop: 'a.myshopify.com',
      source: 'buy_now',
      lines: [{ variantId: '1', title: 'Chair', quantity: 1, price: 100 }],
    });
    const other = await guardProxyRequest(req('b.myshopify.com'), 'sessionRead', {
      sessionId: session.sessionId,
    });
    expect((other as Response).status).toBe(404);
    const own = await guardProxyRequest(req('a.myshopify.com'), 'sessionRead', {
      sessionId: session.sessionId,
    });
    expect(own).toEqual({ shop: 'a.myshopify.com' });
  });
});
