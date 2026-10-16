(function () {
  'use strict';

  var ROOT_ID = 'easy-checkout-root';
  var config = window.EasyCheckoutConfig || {};
  var apiBase = (config.apiBase || '/apps/easy-checkout').replace(/\/$/, '');
  var hijack = window.EasyCheckoutHijack;
  if (!hijack) {
    console.error('[EasyCheckout] hijack-core.js missing; checkout interception disabled');
    return;
  }

  var root = null;
  var loaded = false;
  var opening = false;

  function hijackEnabled() {
    return config.hijackCheckout !== false;
  }

  function ensureStyles() {
    if (document.getElementById('easy-checkout-css')) return;
    var link = document.createElement('link');
    link.id = 'easy-checkout-css';
    link.rel = 'stylesheet';
    link.href = config.cssUrl || apiBase + '/checkout/checkout.css';
    document.head.appendChild(link);
  }

  function ensurePanel() {
    if (loaded && root) return Promise.resolve(root);
    ensureStyles();
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.className = 'ec-root';
      root.hidden = true;
      document.body.appendChild(root);
    }
    var panelUrl = config.panelUrl || apiBase + '/panel.html';
    return fetch(panelUrl, { headers: { accept: 'text/html' }, credentials: 'same-origin' }).then(
      function (response) {
        if (!response.ok) throw new Error('checkout_panel_failed');
        return response.text();
      },
    ).then(function (html) {
      root.innerHTML = html;
      if (document.getElementById('easy-checkout-js')) {
        loaded = true;
        return root;
      }
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.id = 'easy-checkout-js';
        script.src = config.jsUrl || apiBase + '/checkout/checkout.js';
        script.onload = function () {
          loaded = true;
          resolve(root);
        };
        script.onerror = reject;
        document.body.appendChild(script);
      });
    });
  }

  function open() {
    if (opening) return Promise.resolve();
    opening = true;
    return ensurePanel()
      .then(function (panel) {
        panel.hidden = false;
        document.documentElement.classList.add('ec-lock');
        if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.mount === 'function') {
          return window.EasyCheckoutApp.mount(panel, { apiBase: apiBase });
        }
      })
      .catch(function (err) {
        console.error('[EasyCheckout] open failed', err);
        window.alert('COD checkout could not open. Please try again.');
      })
      .then(function () {
        opening = false;
      });
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove('ec-lock');
  }

  function blockEvent(event) {
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    else event.stopPropagation();
  }

  function interceptCheckoutGesture(event) {
    if (!hijackEnabled()) return false;
    if (event.defaultPrevented) return false;
    var target = event.target;
    if (target && target.closest && target.closest('#easy-checkout-root')) return false;

    if (event.type === 'submit') {
      if (!hijack.isCheckoutSubmit(event)) return false;
      blockEvent(event);
      void open();
      return true;
    }

    var el = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (!el) return false;
    // Composed path covers retargeted clicks from open shadow trees when available.
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    var hit = null;
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].nodeType === 1 && hijack.isCheckoutControl(path[i])) {
        hit = path[i];
        break;
      }
    }
    if (!hit && el.closest) {
      hit = hijack.isCheckoutControl(el) ? el : null;
      if (!hit) {
        var closestAccel = el.closest(hijack.ACCELERATED_SELECTORS);
        var closestCheckout = el.closest(
          '[name="checkout"], #checkout, [class*="cart__checkout"], a[href*="/checkout"]',
        );
        hit = closestAccel || closestCheckout;
      }
    }
    if (!hit) return false;
    blockEvent(event);
    void open();
    return true;
  }

  function insertBuyNowButton(anchor) {
    var host =
      (anchor.closest && anchor.closest('.product-form__buttons, .buy-buttons, .product-form')) ||
      anchor.parentElement;
    if (!host || (host.querySelector && host.querySelector('[data-ec-buy-now]'))) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-ec-buy-now', '1');
    btn.className = 'button button--primary button--full-width ec-buy-now';
    btn.textContent = 'Buy now';
    btn.addEventListener(
      'click',
      function (event) {
        blockEvent(event);
        void open();
      },
      true,
    );
    host.appendChild(btn);
  }

  function neutralizeAcceleratedCheckout() {
    if (!hijackEnabled() || !document.body) return;
    var nodes = document.querySelectorAll(hijack.ACCELERATED_SELECTORS);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute('data-ec-neutralized') === '1') {
        // Shopify may re-enable the custom element after init; keep forcing it out.
        node.setAttribute('hidden', '');
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
        continue;
      }
      node.setAttribute('data-ec-neutralized', '1');
      insertBuyNowButton(node);
      // Remove the host node so closed-shadow Buy it now cannot receive clicks.
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  function disableShopifyPaymentButtonApi() {
    window.Shopify = window.Shopify || {};
    var paymentButton = window.Shopify.PaymentButton || {};
    paymentButton.init = function () {
      neutralizeAcceleratedCheckout();
    };
    window.Shopify.PaymentButton = paymentButton;
  }

  function patchNavigation() {
    if (!hijackEnabled()) return;
    var base = location.href;

    function guard(url) {
      if (hijack.isNativeCheckoutUrl(url, base)) {
        void open();
        return true;
      }
      return false;
    }

    // Browsers often make location.* non-writable; never let that abort install.
    try {
      var assign = window.location.assign.bind(window.location);
      window.location.assign = function (url) {
        if (guard(url)) return;
        return assign(url);
      };
    } catch {
      /* ignore */
    }

    try {
      var replace = window.location.replace.bind(window.location);
      window.location.replace = function (url) {
        if (guard(url)) return;
        return replace(url);
      };
    } catch {
      /* ignore */
    }

    try {
      var proto = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
      if (proto && proto.set && proto.get) {
        Object.defineProperty(window.location, 'href', {
          configurable: true,
          enumerable: true,
          get: function () {
            return proto.get.call(window.location);
          },
          set: function (url) {
            if (guard(url)) return;
            proto.set.call(window.location, url);
          },
        });
      }
    } catch {
      /* ignore */
    }

    try {
      var openWindow = window.open.bind(window);
      window.open = function (url) {
        if (url && guard(url)) return null;
        return openWindow.apply(window, arguments);
      };
    } catch {
      /* ignore */
    }
  }

  function install() {
    window.EasyCheckout = { open: open, close: close, apiBase: apiBase };
    if (!hijackEnabled()) return;

    document.addEventListener('click', interceptCheckoutGesture, true);
    document.addEventListener('auxclick', interceptCheckoutGesture, true);
    document.addEventListener('submit', interceptCheckoutGesture, true);
    document.addEventListener(
      'keydown',
      function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        interceptCheckoutGesture(event);
      },
      true,
    );

    disableShopifyPaymentButtonApi();
    neutralizeAcceleratedCheckout();
    patchNavigation();

    var observer = new MutationObserver(function () {
      neutralizeAcceleratedCheckout();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
