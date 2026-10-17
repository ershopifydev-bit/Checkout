import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { Session } from '@shopify/shopify-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EncryptedMongoSessionStorage } from '../app/session-storage.server';

const uri = process.env['MONGODB_TEST_URI'];
if (!uri) throw new Error('Set MONGODB_TEST_URI to an isolated test MongoDB server.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const database = `checkout_http_test_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const secret = randomBytes(32).toString('hex');
const store = new EncryptedMongoSessionStorage(() => client.db(database), key);
let child: ReturnType<typeof spawn> | undefined;
let base = '';
let output = '';
beforeAll(async () => {
  await client.connect();
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['apps/shopify-admin/server.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      SHOPIFY_API_KEY: 'test-client-id',
      SHOPIFY_API_SECRET: secret,
      SHOPIFY_APP_URL: base,
      MONGODB_URI: uri,
      MONGODB_DATABASE: database,
      SESSION_ENCRYPTION_KEY: key.toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const deadline = Date.now() + 8000;
  while (!output.includes('Shopify admin listening')) {
    if (child.exitCode !== null || Date.now() > deadline)
      throw new Error('Admin startup failed: ' + output);
    await delay(25);
  }
});
afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  await client.db(database).dropDatabase();
  await client.close();
});
function installed(shop: string) {
  return new Session({
    id: `offline_${shop}`,
    shop,
    state: '',
    isOnline: false,
    accessToken: 'private-token',
  });
}
function webhook(path: string, shop: string, topic: string, valid = true) {
  const body = JSON.stringify({ myshopify_domain: shop });
  const hmac = createHmac('sha256', valid ? secret : 'wrong-secret')
    .update(body)
    .digest('base64');
  return fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': hmac,
      'x-shopify-shop-domain': shop,
      'x-shopify-topic': topic,
      'x-shopify-api-version': '2026-10',
      'x-shopify-webhook-id': randomUUID(),
    },
    body,
  });
}
const browserAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
function sessionToken(
  shop: string,
  signingSecret = secret,
  expires = Math.floor(Date.now() / 1000) + 60,
) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: 'test-client-id',
      sub: '123',
      exp: expires,
      nbf: Math.floor(Date.now() / 1000) - 1,
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
      sid: randomUUID(),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', signingSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}
describe('compiled Shopify app over real HTTP', () => {
  it('renders a real landing page and prevents caching', async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('Connect your Shopify store');
  });
  it('requires Shopify authentication for the embedded home', async () => {
    const response = await fetch(base + '/app', {
      redirect: 'manual',
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
    });
    const body = await response.text();
    // Shopify returns its App Bridge authentication bootstrap for document requests.
    expect(body).not.toContain('Store connection');
    expect(body).toContain('https://cdn.shopify.com/shopifycloud/app-bridge.js');
    expect(response.status).toBe(200);
  });
  it('rejects an invalid shop and redirects a valid shop only to Shopify', async () => {
    const invalid = await fetch(base + '/auth/login', {
      method: 'POST',
      body: new URLSearchParams({ shop: 'evil.example' }),
      redirect: 'manual',
    });
    expect(await invalid.text()).toContain('Enter a valid myshopify.com store domain');
    const valid = await fetch(base + '/auth/login', {
      method: 'POST',
      body: new URLSearchParams({ shop: 'codemadi.myshopify.com' }),
      redirect: 'manual',
    });
    expect(valid.status).toBe(302);
    expect(valid.headers.get('location')).toBe(
      'https://admin.shopify.com/store/codemadi/oauth/install?client_id=test-client-id',
    );
  });
  it('uses the verified JWT tenant instead of the query-string shop', async () => {
    const original = installed('authenticated.myshopify.com');
    await store.storeSession(original);
    const response = await fetch(base + '/app?shop=attacker.myshopify.com', {
      redirect: 'manual',
      headers: {
        'user-agent': browserAgent,
        authorization: `Bearer ${sessionToken(original.shop)}`,
      },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(original.shop);
    expect(html).not.toContain('private-token');
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
  });
  it('rejects forged and expired session JWTs', async () => {
    for (const token of [
      sessionToken('authenticated.myshopify.com', 'wrong-secret'),
      sessionToken('authenticated.myshopify.com', secret, 1),
    ]) {
      const response = await fetch(base + '/app', {
        redirect: 'manual',
        headers: { 'user-agent': browserAgent, authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain('Store connection');
    }
  });
  it('logs authentication status without sensitive query parameters or credentials', async () => {
    await fetch(base + '/app', {
      headers: {
        'user-agent': browserAgent,
        authorization: `Bearer ${sessionToken('authenticated.myshopify.com', 'wrong-secret')}`,
      },
    });
    await delay(25);
    await fetch(base + '/?private=private-query-secret', { redirect: 'manual' });
    expect(output).not.toContain('private-query-secret');
    expect(output).not.toContain(secret);
    expect(output).toContain('Shopify admin authentication response: 401');
    expect(output).not.toContain('Bearer ');
    expect(output).not.toContain('private-token');
  });
  it('rejects forged uninstall webhooks without deleting sessions', async () => {
    const original = installed('forged.myshopify.com');
    await store.storeSession(original);
    expect(
      (await webhook('/webhooks/app/uninstalled', original.shop, 'app/uninstalled', false)).status,
    ).toBe(401);
    expect(await store.loadSession(original.id)).toBeDefined();
  });
  it('accepts signed uninstall retries and removes only that shop', async () => {
    const original = installed('remove.myshopify.com');
    const other = installed('keep.myshopify.com');
    await store.storeSession(original);
    await store.storeSession(other);
    expect(
      (await webhook('/webhooks/app/uninstalled', original.shop, 'app/uninstalled')).status,
    ).toBe(200);
    expect(
      (await webhook('/webhooks/app/uninstalled', original.shop, 'app/uninstalled')).status,
    ).toBe(200);
    expect(await store.loadSession(original.id)).toBeUndefined();
    expect(await store.loadSession(other.id)).toBeDefined();
  });
  it('invalidates cached sessions after a signed scope change', async () => {
    const original = installed('scopes.myshopify.com');
    await store.storeSession(original);
    expect(
      (await webhook('/webhooks/app/scopes_update', original.shop, 'app/scopes_update')).status,
    ).toBe(200);
    expect(await store.loadSession(original.id)).toBeUndefined();
  });
  it('does not accept a signed different topic on the uninstall route', async () => {
    const original = installed('wrong-topic.myshopify.com');
    await store.storeSession(original);
    expect(
      (await webhook('/webhooks/app/uninstalled', original.shop, 'app/scopes_update')).status,
    ).toBe(400);
    expect(await store.loadSession(original.id)).toBeDefined();
  });
});
