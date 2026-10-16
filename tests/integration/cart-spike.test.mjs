import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { runCartSpike } from '../../scripts/shopify-cart-spike.mjs';

const config = {
  shop: 'example.myshopify.com',
  input: {
    lines: [
      {
        merchandiseId: 'gid://shopify/ProductVariant/2',
        quantity: 2,
        sellingPlanId: 'gid://shopify/SellingPlan/3',
        attributes: [{ key: 'fixture', value: 'second-variant' }],
      },
      { merchandiseId: 'gid://shopify/ProductVariant/4', quantity: 1 },
    ],
    attributes: [{ key: 'spike', value: 'anonymous-cart' }],
    buyerIdentity: { countryCode: 'IN' },
  },
};
function cart() {
  return {
    id: 'gid://shopify/Cart/test?key=private-cart-key',
    checkoutUrl: 'https://example.myshopify.com/checkouts/test?key=private-checkout-key',
    totalQuantity: 3,
    attributes: config.input.attributes,
    buyerIdentity: { countryCode: 'IN' },
    cost: { totalAmount: { amount: '300.00', currencyCode: 'INR' } },
    lines: {
      pageInfo: { hasNextPage: false },
      nodes: config.input.lines.map((line) => ({
        merchandise: { id: line.merchandiseId },
        quantity: line.quantity,
        attributes: line.attributes ?? [],
        sellingPlanAllocation: line.sellingPlanId
          ? { sellingPlan: { id: line.sellingPlanId } }
          : null,
        cost: { totalAmount: { amount: String(line.quantity * 100), currencyCode: 'INR' } },
      })),
    },
  };
}
function responses(created = cart(), retrieved = cart()) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    const data =
      calls.length === 1
        ? { cartCreate: { cart: created, userErrors: [], warnings: [] } }
        : { cart: retrieved };
    return globalThis.Response.json({ data }, { headers: { 'x-shopify-api-version': '2026-10' } });
  };
  return { calls, fetch };
}

test('preserves selected variant, quantity, selling plan and context through existing-cart retrieval', async () => {
  const api = responses();
  const result = await runCartSpike(config, { fetch: api.fetch, token: 'private-token' });
  assert.equal(result.apiPreservation, 'passed');
  assert.equal(result.browserCheckout, 'not_verified');
  assert.equal(result.cart.id, cart().id);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(api.calls[0].body.variables.input, config.input);
  assert.deepEqual(api.calls[1].body.variables, { id: cart().id });
  assert.match(api.calls[1].body.query, /^query /);
  assert.equal(api.calls[0].redirect, 'error');
  assert.equal(api.calls[0].headers['X-Shopify-Storefront-Access-Token'], 'private-token');
});

for (const [name, change] of [
  ['dropped line', (c) => c.lines.nodes.pop()],
  ['changed quantity', (c) => c.lines.nodes[0].quantity++],
  ['lost selling plan', (c) => (c.lines.nodes[0].sellingPlanAllocation = null)],
  ['lost line attribute', (c) => (c.lines.nodes[0].attributes = [])],
  ['lost cart attribute', (c) => (c.attributes = [])],
  ['lost buyer context', (c) => (c.buyerIdentity.countryCode = 'US')],
  ['incomplete pagination', (c) => (c.lines.pageInfo.hasNextPage = true)],
  ['foreign checkout host', (c) => (c.checkoutUrl = 'https://evil.example/checkout')],
  ['non-HTTPS checkout', (c) => (c.checkoutUrl = 'http://example.myshopify.com/checkout')],
]) {
  test(`rejects ${name} on cart creation`, async () => {
    const c = cart();
    change(c);
    await assert.rejects(runCartSpike(config, { fetch: responses(c).fetch }));
  });
}
for (const [name, change] of [
  ['expired cart', () => null],
  ['replacement cart', (c) => ({ ...c, id: 'gid://shopify/Cart/replacement' })],
  [
    'changed total',
    (c) => ({ ...c, cost: { totalAmount: { amount: '999', currencyCode: 'INR' } } }),
  ],
  ['lost existing line', (c) => ({ ...c, lines: { ...c.lines, nodes: c.lines.nodes.slice(1) } })],
]) {
  test(`rejects ${name} when reading the existing reference`, async () => {
    await assert.rejects(runCartSpike(config, { fetch: responses(cart(), change(cart())).fetch }));
  });
}

test('accepts order-independent line and attribute comparisons', async () => {
  const c = cart();
  c.lines.nodes.reverse();
  assert.equal(
    (await runCartSpike(config, { fetch: responses(cart(), c).fetch })).apiPreservation,
    'passed',
  );
});
for (const bad of [
  { ...config, shop: 'example.myshopify.com@evil.example' },
  { ...config, shop: 'example.myshopify.com/path' },
  { ...config, input: { ...config.input, lines: [] } },
  {
    ...config,
    input: {
      ...config.input,
      lines: [{ merchandiseId: 'gid://shopify/ProductVariant/2', quantity: 0 }],
    },
  },
  { ...config, input: { ...config.input, buyerIdentity: { email: 'real@example.com' } } },
]) {
  test('rejects invalid config before network access', async () => {
    let calls = 0;
    await assert.rejects(
      runCartSpike(bad, {
        fetch: () => {
          calls++;
          throw Error('network');
        },
      }),
    );
    assert.equal(calls, 0);
  });
}
for (const [name, response] of [
  ['HTTP failure', () => new globalThis.Response('secret-provider-detail', { status: 403 })],
  [
    'GraphQL failure',
    () => globalThis.Response.json({ errors: [{ message: 'secret-provider-detail' }] }),
  ],
  [
    'mutation error',
    () =>
      globalThis.Response.json({
        data: {
          cartCreate: {
            cart: cart(),
            userErrors: [{ message: 'secret-provider-detail' }],
            warnings: [],
          },
        },
      }),
  ],
  [
    'mutation warning',
    () =>
      globalThis.Response.json({
        data: {
          cartCreate: {
            cart: cart(),
            userErrors: [],
            warnings: [{ message: 'secret-provider-detail' }],
          },
        },
      }),
  ],
  ['invalid JSON', () => new globalThis.Response('secret-provider-detail')],
  [
    'network failure',
    () => {
      throw Error('secret-provider-detail');
    },
  ],
  [
    'API version fallback',
    () =>
      globalThis.Response.json({ data: {} }, { headers: { 'x-shopify-api-version': '2027-01' } }),
  ],
]) {
  test(`fails safely on ${name}`, async () => {
    await assert.rejects(
      runCartSpike(config, {
        fetch: async () => {
          const result = response();
          if (!result.headers.has('x-shopify-api-version'))
            result.headers.set('x-shopify-api-version', '2026-10');
          return result;
        },
      }),
      (error) => {
        assert(!String(error).includes('secret-provider-detail'));
        return true;
      },
    );
  });
}

test('rejects duplicate variant selections before creating a cart', async () => {
  const duplicated = globalThis.structuredClone(config);
  duplicated.input.lines.push(duplicated.input.lines[0]);
  let called = false;
  await assert.rejects(
    runCartSpike(duplicated, {
      fetch: async () => {
        called = true;
      },
    }),
    /DUPLICATE_LINE/,
  );
  assert.equal(called, false);
});

test('accepts an explicitly verified custom checkout host', async () => {
  const c = cart();
  c.checkoutUrl = 'https://store.example.com/checkouts/test';
  const result = await runCartSpike(
    { ...config, checkoutHost: 'store.example.com' },
    { fetch: responses(c, c).fetch },
  );
  assert.equal(result.apiPreservation, 'passed');
});

test('rejects a missing API version header instead of assuming the requested version', async () => {
  await assert.rejects(
    runCartSpike(config, { fetch: async () => globalThis.Response.json({ data: {} }) }),
    /API_VERSION_UNVERIFIED/,
  );
});

test('serializes requests and verifies responses over real HTTP', async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    response.setHeader('content-type', 'application/json');
    response.setHeader('x-shopify-api-version', '2026-10');
    response.end(
      JSON.stringify({
        data:
          requests.length === 1
            ? { cartCreate: { cart: cart(), userErrors: [], warnings: [] } }
            : { cart: cart() },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const result = await runCartSpike(config, {
    fetch: (url, options) => {
      assert.equal(url, 'https://example.myshopify.com/api/2026-10/graphql.json');
      return globalThis.fetch(endpoint, options);
    },
  });
  assert.equal(result.apiPreservation, 'passed');
  assert.deepEqual(requests[0].variables.input, config.input);
  assert.equal(requests[1].variables.id, cart().id);
});

test('CLI saves private evidence, omits secrets from logs and refuses to overwrite it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'checkout-spike-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'fixture.json'), JSON.stringify(config));
  const preload = join(directory, 'fake-storefront.mjs');
  await writeFile(
    preload,
    `const cart = ${JSON.stringify(cart())};
    globalThis.fetch = async (_url, options) => {
      const { query } = JSON.parse(options.body);
      return Response.json({ data: query.startsWith('mutation')
        ? { cartCreate: { cart, userErrors: [], warnings: [] } } : { cart } },
        { headers: { 'x-shopify-api-version': '2026-10' } });
    };`,
  );
  const script = fileURLToPath(new URL('../../scripts/shopify-cart-spike.mjs', import.meta.url));
  const args = ['--import', preload, script, 'fixture.json'];
  const run = promisify(execFile);
  const { stdout, stderr } = await run(process.execPath, args, { cwd: directory });
  assert.match(stdout, /Browser checkout remains unverified/);
  assert.equal(stderr, '');
  assert(!stdout.includes('private-cart-key'));
  assert(!stdout.includes('private-checkout-key'));
  const artifact = join(directory, '.env.cart-spike-result.json');
  const contents = await readFile(artifact, 'utf8');
  assert.equal(JSON.parse(contents).cart.id, cart().id);
  assert.equal((await stat(artifact)).mode & 0o777, 0o600);
  await assert.rejects(run(process.execPath, args, { cwd: directory }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Cart spike failed/);
    assert(!error.stderr.includes('private-cart-key'));
    return true;
  });
  assert.equal(await readFile(artifact, 'utf8'), contents);
});
