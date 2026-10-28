import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';

const API_VERSION = '2026-10';
const fields = `
  id checkoutUrl totalQuantity attributes { key value }
  buyerIdentity { countryCode }
  cost { totalAmount { amount currencyCode } }
  lines(first: 100) {
    pageInfo { hasNextPage }
    nodes {
      quantity attributes { key value }
      merchandise { ... on ProductVariant { id } }
      sellingPlanAllocation { sellingPlan { id } }
      cost { totalAmount { amount currencyCode } }
    }
  }`;

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}
function onlyKeys(value, allowed) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}
function attributes(value = []) {
  requireValue(Array.isArray(value) && value.length <= 20, 'INVALID_ATTRIBUTES');
  requireValue(
    value.every(
      (item) =>
        onlyKeys(item, ['key', 'value']) &&
        typeof item.key === 'string' &&
        item.key.length > 0 &&
        item.key.length <= 100 &&
        typeof item.value === 'string' &&
        item.value.length <= 200,
    ),
    'INVALID_ATTRIBUTES',
  );
  requireValue(new Set(value.map((item) => item.key)).size === value.length, 'DUPLICATE_ATTRIBUTE');
  return value.map(({ key, value }) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
}
function lineIdentity(line) {
  return JSON.stringify([
    line.merchandiseId,
    line.sellingPlanId ?? null,
    attributes(line.attributes),
  ]);
}
function validateConfig(config) {
  requireValue(onlyKeys(config, ['shop', 'checkoutHost', 'input']), 'INVALID_CONFIG');
  requireValue(
    typeof config.shop === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.shop),
    'INVALID_SHOP',
  );
  const host = config.checkoutHost ?? config.shop;
  requireValue(
    typeof host === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host),
    'INVALID_CHECKOUT_HOST',
  );
  const input = config.input;
  requireValue(onlyKeys(input, ['lines', 'attributes', 'buyerIdentity']), 'INVALID_INPUT');
  requireValue(
    Array.isArray(input.lines) && input.lines.length > 0 && input.lines.length <= 20,
    'INVALID_LINES',
  );
  for (const line of input.lines) {
    requireValue(
      onlyKeys(line, ['merchandiseId', 'quantity', 'sellingPlanId', 'attributes']),
      'INVALID_LINE',
    );
    requireValue(
      typeof line.merchandiseId === 'string' &&
        /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(line.merchandiseId),
      'INVALID_VARIANT',
    );
    requireValue(
      Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 100,
      'INVALID_QUANTITY',
    );
    requireValue(
      line.sellingPlanId === undefined ||
        (typeof line.sellingPlanId === 'string' &&
          /^gid:\/\/shopify\/SellingPlan\/\d+$/.test(line.sellingPlanId)),
      'INVALID_SELLING_PLAN',
    );
    attributes(line.attributes);
  }
  requireValue(
    new Set(input.lines.map(lineIdentity)).size === input.lines.length,
    'DUPLICATE_LINE',
  );
  attributes(input.attributes);
  requireValue(
    input.buyerIdentity === undefined ||
      (onlyKeys(input.buyerIdentity, ['countryCode']) &&
        typeof input.buyerIdentity.countryCode === 'string' &&
        /^[A-Z]{2}$/.test(input.buyerIdentity.countryCode)),
    'INVALID_BUYER_CONTEXT',
  );
}
function money(value) {
  requireValue(
    value &&
      typeof value.amount === 'string' &&
      /^\d+(?:\.\d+)?$/.test(value.amount) &&
      typeof value.currencyCode === 'string' &&
      /^[A-Z]{3}$/.test(value.currencyCode),
    'INVALID_PRICE',
  );
  return { amount: value.amount, currencyCode: value.currencyCode };
}
function snapshot(cart, config) {
  requireValue(
    cart && typeof cart.id === 'string' && cart.id.startsWith('gid://shopify/Cart/'),
    'CART_UNAVAILABLE',
  );
  requireValue(typeof cart.checkoutUrl === 'string', 'INVALID_CHECKOUT_URL');
  let url;
  try {
    url = new URL(cart.checkoutUrl);
  } catch {
    throw new Error('INVALID_CHECKOUT_URL');
  }
  requireValue(
    url.protocol === 'https:' &&
      url.hostname === (config.checkoutHost ?? config.shop) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash,
    'INVALID_CHECKOUT_URL',
  );
  requireValue(
    cart.lines?.pageInfo?.hasNextPage === false && Array.isArray(cart.lines.nodes),
    'INCOMPLETE_CART',
  );
  const lines = cart.lines.nodes
    .map((line) => {
      requireValue(
        typeof line.merchandise?.id === 'string' &&
          Number.isSafeInteger(line.quantity) &&
          line.quantity > 0,
        'INVALID_CART_LINE',
      );
      const selection = {
        merchandiseId: line.merchandise.id,
        sellingPlanId: line.sellingPlanAllocation?.sellingPlan?.id ?? null,
        attributes: attributes(line.attributes),
      };
      return {
        key: lineIdentity(selection),
        quantity: line.quantity,
        total: money(line.cost?.totalAmount),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const expected = config.input.lines
    .map((line) => ({ key: lineIdentity(line), quantity: line.quantity }))
    .sort((a, b) => a.key.localeCompare(b.key));
  requireValue(
    isDeepStrictEqual(
      lines.map(({ key, quantity }) => ({ key, quantity })),
      expected,
    ),
    'CART_SELECTION_CHANGED',
  );
  requireValue(
    cart.totalQuantity === expected.reduce((sum, line) => sum + line.quantity, 0),
    'CART_QUANTITY_CHANGED',
  );
  const cartAttributes = attributes(cart.attributes);
  requireValue(
    isDeepStrictEqual(cartAttributes, attributes(config.input.attributes)),
    'CART_ATTRIBUTES_CHANGED',
  );
  if (config.input.buyerIdentity)
    requireValue(
      cart.buyerIdentity?.countryCode === config.input.buyerIdentity.countryCode,
      'BUYER_CONTEXT_CHANGED',
    );
  return {
    id: cart.id,
    lines,
    attributes: cartAttributes,
    countryCode: cart.buyerIdentity?.countryCode ?? null,
    total: money(cart.cost?.totalAmount),
  };
}

// Local feasibility probe only: callers supply synthetic fixtures, never shopper traffic.
export async function runCartSpike(config, { fetch = globalThis.fetch, token } = {}) {
  validateConfig(config);
  requireValue(
    token === undefined || (typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token)),
    'INVALID_TOKEN',
  );
  async function request(query, variables) {
    let response;
    let body;
    try {
      response = await fetch(`https://${config.shop}/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Shopify-Storefront-Access-Token': token } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      requireValue(response.ok, 'STOREFRONT_HTTP_ERROR');
      body = await response.json();
    } catch {
      throw new Error('STOREFRONT_REQUEST_FAILED');
    }
    const actualVersion = response.headers.get('x-shopify-api-version');
    requireValue(actualVersion === API_VERSION, 'API_VERSION_UNVERIFIED');
    requireValue(
      body &&
        (!body.errors || (Array.isArray(body.errors) && body.errors.length === 0)) &&
        body.data,
      'STOREFRONT_GRAPHQL_ERROR',
    );
    return body.data;
  }
  const data = await request(
    `mutation CartSpike($input: CartInput!) { cartCreate(input: $input) { cart { ${fields} } userErrors { code } warnings { code } } }`,
    { input: config.input },
  );
  const payload = data.cartCreate;
  requireValue(
    payload &&
      Array.isArray(payload.userErrors) &&
      payload.userErrors.length === 0 &&
      Array.isArray(payload.warnings) &&
      payload.warnings.length === 0,
    'CART_CREATE_REJECTED',
  );
  const initial = snapshot(payload.cart, config);
  const retrieved = await request(`query CartSpikeRead($id: ID!) { cart(id: $id) { ${fields} } }`, {
    id: initial.id,
  });
  const current = snapshot(retrieved.cart, config);
  requireValue(isDeepStrictEqual(current, initial), 'EXISTING_CART_CHANGED');
  return {
    shop: config.shop,
    apiVersion: API_VERSION,
    apiPreservation: 'passed',
    browserCheckout: 'not_verified',
    cart: { ...current, checkoutUrl: retrieved.cart.checkoutUrl },
  };
}

async function main() {
  requireValue(
    process.argv.length === 3,
    'USAGE: node scripts/shopify-cart-spike.mjs <fixture.json>',
  );
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = await runCartSpike(config, { token: process.env['SHOPIFY_STOREFRONT_TOKEN'] });
  // Exclusive creation avoids overwriting evidence or following an existing symlink.
  await writeFile('.env.cart-spike-result.json', JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(
    'Cart API preservation passed. Private artifact: .env.cart-spike-result.json. Browser checkout remains unverified.\n',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write(
      'Cart spike failed. Check fixture, store access, API version, and whether the result file already exists. No live task marked complete.\n',
    );
    process.exitCode = 1;
  });
}
