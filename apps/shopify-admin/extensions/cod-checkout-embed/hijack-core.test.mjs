import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(dir, 'assets/hijack-core.js'), 'utf8');
const sandbox = { URL, console };
sandbox.globalThis = sandbox;
runInContext(code, createContext(sandbox));
const hijack = sandbox.EasyCheckoutHijack;

describe('EasyCheckoutHijack', () => {
  it('detects native checkout URLs', () => {
    const base = 'https://codemadi.myshopify.com/cart';
    assert.equal(hijack.isNativeCheckoutUrl('/checkout', base), true);
    assert.equal(hijack.isNativeCheckoutUrl('/checkouts/abc/cn', base), true);
    assert.equal(hijack.isNativeCheckoutUrl('https://checkout.shopify.com/c/1', base), true);
    assert.equal(hijack.isNativeCheckoutUrl('/cart', base), false);
    assert.equal(hijack.isNativeCheckoutUrl('/products/x', base), false);
  });

  it('detects Dawn checkout controls and buy-now text', () => {
    const button = {
      nodeType: 1,
      tagName: 'BUTTON',
      name: 'checkout',
      getAttribute: (name) => (name === 'aria-label' ? null : null),
      textContent: 'Check out',
      matches: (sel) => sel.includes('[name="checkout"]'),
      closest: () => null,
    };
    assert.equal(hijack.isCheckoutControl(button), true);

    const buyNow = {
      nodeType: 1,
      tagName: 'BUTTON',
      getAttribute: (name) => (name === 'aria-label' ? 'Buy it now' : null),
      textContent: '',
      matches: () => false,
      closest: () => null,
    };
    assert.equal(hijack.isCheckoutControl(buyNow), true);

    const add = {
      nodeType: 1,
      tagName: 'BUTTON',
      name: 'add',
      getAttribute: () => null,
      textContent: 'Add to cart',
      matches: () => false,
      closest: () => null,
    };
    assert.equal(hijack.isCheckoutControl(add), false);
  });

  it('treats cart checkout submitters as checkout submits only', () => {
    const checkoutSubmitter = {
      nodeType: 1,
      tagName: 'BUTTON',
      name: 'checkout',
      getAttribute: () => null,
      textContent: 'Check out',
      matches: (sel) => sel.includes('[name="checkout"]'),
      closest: () => null,
    };
    assert.equal(hijack.isCheckoutSubmit({ submitter: checkoutSubmitter, target: {} }), true);

    const updateSubmitter = {
      nodeType: 1,
      tagName: 'BUTTON',
      name: 'update',
      getAttribute: () => null,
      textContent: 'Update',
      matches: () => false,
      closest: () => null,
    };
    assert.equal(
      hijack.isCheckoutSubmit({
        submitter: updateSubmitter,
        target: { getAttribute: () => '/cart' },
      }),
      false,
    );
  });
});
