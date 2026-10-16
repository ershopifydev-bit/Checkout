/**
 * Pure checkout-hijack helpers. Loaded before embed.js on the storefront.
 * Kept free of DOM side effects so node:test can execute this file as-is.
 */
(function (root) {
  'use strict';

  var ACCELERATED_SELECTORS = [
    'shopify-accelerated-checkout',
    'shopify-accelerated-checkout-cart',
    '[data-shopify="payment-button"]',
    '.shopify-payment-button',
  ].join(',');

  function isNativeCheckoutUrl(href, base) {
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return false;
    var url;
    try {
      url = new URL(String(href), base || 'https://example.myshopify.com');
    } catch {
      return false;
    }
    var path = url.pathname || '';
    if (path === '/checkout' || path === '/checkout/') return true;
    if (path.indexOf('/checkouts/') === 0) return true;
    if (path.indexOf('/cart/checkout') === 0) return true;
    // Portable wallets / Shop Pay sometimes use checkout.shopify.com
    if (/(^|\.)checkout\.shopify\.com$/i.test(url.hostname)) return true;
    if (/(^|\.)shop\.app$/i.test(url.hostname) && /checkout/i.test(path)) return true;
    return false;
  }

  function textLooksLikeCheckout(el) {
    if (!el || el.nodeType !== 1) return false;
    var raw = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > 48) return false;
    return /^(buy\s*it\s*now|buy\s*now|check\s*out|checkout)$/i.test(raw);
  }

  function isCheckoutControl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest('#easy-checkout-root, [data-ec-buy-now]')) {
      // Our own Buy now is a checkout control by intent, handled separately.
      if (el.closest('[data-ec-buy-now]')) return true;
      return false;
    }
    if (el.matches) {
      if (
        el.matches('[name="checkout"], [name="goto_pp"], #checkout, [id*="checkout"], [id*="Checkout"]')
      ) {
        return true;
      }
      if (el.matches('a[href="/checkout"], a[href*="/checkout"], a[href*="/checkouts/"]')) {
        return true;
      }
      if (el.matches('button[name="checkout"], input[name="checkout"][type="submit"]')) {
        return true;
      }
      if (el.matches('[class*="cart__checkout"], [class*="checkout-button"]')) return true;
      if (el.matches(ACCELERATED_SELECTORS)) return true;
    }
    if (el.closest) {
      if (el.closest(ACCELERATED_SELECTORS)) return true;
      if (el.closest('[name="checkout"], #checkout, [class*="cart__checkout"]')) return true;
    }
    var tag = el.tagName;
    if ((tag === 'BUTTON' || tag === 'A' || (tag === 'INPUT' && el.type === 'submit')) && textLooksLikeCheckout(el)) {
      return true;
    }
    return false;
  }

  function isCheckoutSubmit(event) {
    var submitter = event.submitter;
    if (submitter && isCheckoutControl(submitter)) return true;
    var form = event.target;
    if (!form || !form.getAttribute) return false;
    var action = form.getAttribute('action') || '';
    if (isNativeCheckoutUrl(action, 'https://example.myshopify.com')) return true;
    // Cart forms posting with checkout submitter already covered; never treat generic /cart updates as checkout.
    return false;
  }

  root.EasyCheckoutHijack = {
    ACCELERATED_SELECTORS: ACCELERATED_SELECTORS,
    isNativeCheckoutUrl: isNativeCheckoutUrl,
    isCheckoutControl: isCheckoutControl,
    isCheckoutSubmit: isCheckoutSubmit,
    textLooksLikeCheckout: textLooksLikeCheckout,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
