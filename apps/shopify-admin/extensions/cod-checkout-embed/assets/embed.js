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
  var warmPromise = null;
  var STORAGE_SHOPPER = 'ec_shopper_v1';
  // Bump when public/checkout panel HTML changes so proxy fetch bypasses intermediary caches.
  var PANEL_V = '20261029-order-status-redirect';
  var cachedSettings = null;
  var settingsPromise = null;

  function hijackEnabled() {
    return config.hijackCheckout !== false;
  }

  function fetchCheckoutSettings() {
    if (cachedSettings) return Promise.resolve(cachedSettings);
    if (settingsPromise) return settingsPromise;
    settingsPromise = fetch(apiBase + '/v1/settings', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (body) {
        if (body && typeof body === 'object') cachedSettings = body;
        settingsPromise = null;
        return cachedSettings;
      })
      .catch(function () {
        settingsPromise = null;
        return null;
      });
    return settingsPromise;
  }

  function brandBootHtml(settings) {
    var name = ((settings && settings.brandName) || 'RARE').trim() || 'RARE';
    var logoUrl = (settings && settings.logoUrl) || '';
    var useLogo =
      settings && settings.brandMode === 'logo' && /^https?:\/\//i.test(String(logoUrl));
    if (useLogo) {
      return (
        '<img src="' +
        String(logoUrl).replace(/"/g, '&quot;') +
        '" alt="' +
        name.replace(/"/g, '&quot;') +
        '" style="display:block;margin:0 auto;max-height:2.25em;max-width:10em;object-fit:contain" />'
      );
    }
    return (
      '<p style="margin:0;letter-spacing:.22em;font-weight:700;font-family:Georgia,serif">' +
      name.replace(/</g, '&lt;') +
      '</p>'
    );
  }

  function withCacheBust(url, token) {
    if (!url) return url;
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + 'ecv=' + encodeURIComponent(token || PANEL_V);
  }

  function readCachedShopper() {
    try {
      var raw = localStorage.getItem(STORAGE_SHOPPER);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.token && parsed.phone) return parsed;
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Prefetch panel + revalidate shopper so checkout open is not blocked on auth. */
  function warmInBackground() {
    if (warmPromise) return warmPromise;
    warmPromise = Promise.all([
      ensurePanel().catch(function () {
        warmPromise = null;
      }),
      fetchCheckoutSettings(),
      (function () {
        var cached = readCachedShopper();
        if (!cached || !cached.token) {
          window.__ecWarmShopper = null;
          return Promise.resolve(null);
        }
        // Optimistic: expose cache immediately for a fast open.
        window.__ecWarmShopper = cached;
        return fetch(apiBase + '/v1/auth/customer', {
          headers: { accept: 'application/json', 'x-ec-shopper': cached.token },
          credentials: 'same-origin',
        })
          .then(function (response) {
            if (!response.ok) {
              try {
                localStorage.removeItem(STORAGE_SHOPPER);
              } catch {
                /* ignore */
              }
              window.__ecWarmShopper = null;
              return null;
            }
            return response.json();
          })
          .then(function (fresh) {
            if (!fresh) return null;
            window.__ecWarmShopper = fresh;
            try {
              localStorage.setItem(STORAGE_SHOPPER, JSON.stringify(fresh));
            } catch {
              /* ignore */
            }
            return fresh;
          })
          .catch(function () {
            /* keep optimistic cache */
            return cached;
          });
      })(),
    ]);
    return warmPromise;
  }

  function desiredCssUrl() {
    return withCacheBust(
      config.cssUrl || apiBase + '/checkout.css',
      config.assetVersion || PANEL_V,
    );
  }

  function desiredJsUrl() {
    return withCacheBust(config.jsUrl || apiBase + '/checkout.js', config.assetVersion || PANEL_V);
  }

  function desiredPanelUrl() {
    return withCacheBust(
      config.panelUrl || apiBase + '/panel.html',
      config.assetVersion || PANEL_V,
    );
  }

  function ensureStyles() {
    var href = desiredCssUrl();
    var link = document.getElementById('easy-checkout-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'easy-checkout-css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  function loadCheckoutScript(jsUrl) {
    var existing = document.getElementById('easy-checkout-js');
    if (existing && existing.getAttribute('src') === jsUrl && window.EasyCheckoutApp) {
      return Promise.resolve();
    }
    if (existing) existing.remove();
    // Drop stale app so a new script file can re-register handlers.
    window.EasyCheckoutApp = undefined;
    if (root) root.removeAttribute('data-ec-bound');
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.id = 'easy-checkout-js';
      script.src = jsUrl;
      script.onload = function () {
        resolve();
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function ensurePanel() {
    if (
      loaded &&
      root &&
      window.EasyCheckoutApp &&
      root.getAttribute('data-ec-panel-v') === PANEL_V
    ) {
      return Promise.resolve(root);
    }
    ensureStyles();
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.className = 'ec-root';
      root.hidden = true;
      document.body.appendChild(root);
    }
    var panelUrl = desiredPanelUrl();
    var jsUrl = desiredJsUrl();
    return fetch(panelUrl, {
      headers: { accept: 'text/html', 'cache-control': 'no-cache' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (response) {
        if (!response.ok) throw new Error('checkout_panel_failed');
        return response.text();
      })
      .then(function (html) {
        root.innerHTML = html;
        root.setAttribute('data-ec-panel-v', PANEL_V);
        root.removeAttribute('style');
        // Handlers are delegated on root, so HTML refresh keeps working without re-bind.
        return loadCheckoutScript(jsUrl).then(function () {
          loaded = true;
          return root;
        });
      });
  }

  function parsePriceMajor(text) {
    if (!text) return 0;
    var cleaned = String(text).replace(/,/g, '');
    var match = cleaned.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  }

  function readBuyNowPayload() {
    var form =
      document.querySelector('form[data-type="add-to-cart-form"]') ||
      document.querySelector('form[action*="/cart/add"]');
    if (!form) return null;
    var idInput = form.querySelector('[name="id"]');
    if (!idInput || !idInput.value) return null;
    var qtyInput = form.querySelector('[name="quantity"]');
    var quantity = Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1);
    // Prefer the visible h1 — Dawn's .product__title wraps duplicates whose textContent concatenates.
    var titleEl = document.querySelector(
      '.product__title h1, h1.product-single__title, h1.product__title, main h1, h1',
    );
    var salePriceEl = document.querySelector(
      '.price--on-sale .price-item--sale, .price__sale .price-item--sale, .price-item--sale, [data-product-price], .price__regular .price-item--regular, .price-item--regular, .price .money',
    );
    var comparePriceEl = document.querySelector(
      '.price--on-sale .price__sale .price-item--regular, .price--on-sale .price-item--regular, s.price-item--regular, [data-compare-at-price], .price--compare, s.money, del.price-item--regular, [data-compare-price]',
    );
    var title = ((titleEl && titleEl.textContent) || 'Item')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    var imgEl = document.querySelector(
      '.product__media img, .product-media-container img, .product__main-photos img, meta[property="og:image"]',
    );
    var imageUrl =
      (imgEl && (imgEl.getAttribute('content') || imgEl.currentSrc || imgEl.src)) || undefined;
    var skuEl = form.querySelector('[name="sku"], [data-product-sku], .sku');
    var sku =
      ((skuEl && (skuEl.value || skuEl.textContent)) || '').trim().slice(0, 80) || undefined;

    var sellingPrice = parsePriceMajor(salePriceEl && salePriceEl.textContent);
    var comparePrice = parsePriceMajor(comparePriceEl && comparePriceEl.textContent);

    if (!comparePrice || comparePrice <= sellingPrice) {
      var allRegular = document.querySelectorAll(
        '.price--on-sale .price__sale .price-item--regular, .price--on-sale s.price-item--regular, s.price-item--regular, .price__sale s, .price-item--regular, [data-compare-at-price], .price--compare, s.money, del.price-item--regular, [data-compare-price]',
      );
      for (var r = 0; r < allRegular.length; r++) {
        var p = parsePriceMajor(allRegular[r].textContent);
        if (p > sellingPrice) {
          comparePrice = p;
          break;
        }
      }
    }

    var variantTitle = '';
    var checkedOpts = document.querySelectorAll(
      'fieldset.js-product-form__input input:checked, variant-radios input:checked, .product-form__input input[type="radio"]:checked, [data-variant-radio]:checked',
    );
    if (checkedOpts && checkedOpts.length) {
      var parts = [];
      for (var c = 0; c < checkedOpts.length; c++) {
        var val = (checkedOpts[c].value || '').trim();
        if (val && val !== 'Default Title') parts.push(val);
      }
      if (parts.length) variantTitle = parts.join(' · ');
    }
    if (!variantTitle) {
      var checkedSelects = document.querySelectorAll(
        'variant-selects select, .product-form__input select',
      );
      if (checkedSelects && checkedSelects.length) {
        var partsSel = [];
        for (var s = 0; s < checkedSelects.length; s++) {
          var valSel = (checkedSelects[s].value || '').trim();
          if (valSel && valSel !== 'Default Title') partsSel.push(valSel);
        }
        if (partsSel.length) variantTitle = partsSel.join(' · ');
      }
    }
    if (!variantTitle && typeof window !== 'undefined') {
      try {
        var variants =
          (window.ShopifyAnalytics &&
            window.ShopifyAnalytics.meta &&
            window.ShopifyAnalytics.meta.product &&
            window.ShopifyAnalytics.meta.product.variants) ||
          (window.meta && window.meta.product && window.meta.product.variants);
        if (Array.isArray(variants)) {
          var vId = parseInt(idInput.value, 10);
          var matched = variants.find(function (v) {
            return v && v.id === vId;
          });
          if (matched && (!comparePrice || comparePrice <= sellingPrice) && typeof matched.compare_at_price === 'number' && matched.compare_at_price > 0) {
            var comp = matched.compare_at_price;
            if (comp > (sellingPrice || 0) * 10) comp = comp / 100;
            if (comp > (sellingPrice || 0)) comparePrice = comp;
          }
          if (matched && matched.title && matched.title !== 'Default Title') {
            variantTitle = matched.title;
          }
        }
        if (!variantTitle) {
          var selOpt = form.querySelector('select[name="id"] option:checked');
          if (selOpt && selOpt.textContent && !selOpt.textContent.includes('Default Title')) {
            variantTitle = selOpt.textContent.split('-')[0].trim();
          }
        }
      } catch (e) {}
    }

    var linePayload = {
      variantId: String(idInput.value),
      title: title,
      variantTitle: variantTitle,
      quantity: quantity,
      price: sellingPrice,
      imageUrl: imageUrl,
      sku: sku,
    };
    if (comparePrice > sellingPrice) {
      linePayload.compareAtPrice = comparePrice;
    }

    return {
      source: 'buy_now',
      lines: [linePayload],
    };
  }

  function readCartPayload() {
    return fetch('/cart.js', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(function (response) {
        if (!response.ok) throw new Error('cart_failed');
        return response.json();
      })
      .then(function (cart) {
        var lines = (cart.items || []).map(function (item) {
          var qty = item.quantity || 1;
          // cart.js: price / original_price / final_price are unit amounts in minor units.
          var unitMinor = typeof item.price === 'number' ? item.price : item.final_price;
          var finalUnit = typeof item.final_price === 'number' ? item.final_price : unitMinor;
          var lineDiscountMinor = 0;
          if (Array.isArray(item.line_level_discount_allocations)) {
            for (var i = 0; i < item.line_level_discount_allocations.length; i++) {
              var alloc = item.line_level_discount_allocations[i];
              if (alloc && typeof alloc.amount === 'number') lineDiscountMinor += alloc.amount;
            }
          }
          if (
            !lineDiscountMinor &&
            typeof unitMinor === 'number' &&
            typeof finalUnit === 'number'
          ) {
            lineDiscountMinor = Math.max(0, (unitMinor - finalUnit) * qty);
          }
          // Prefer true compare-at; fall back to original_price only when it is higher than unit.
          var compareAt;
          if (typeof item.compare_at_price === 'number' && item.compare_at_price > unitMinor) {
            compareAt = item.compare_at_price;
          } else if (typeof item.original_price === 'number' && item.original_price > unitMinor) {
            compareAt = item.original_price;
          }
          return {
            variantId: item.variant_id != null ? String(item.variant_id) : undefined,
            productId: item.product_id != null ? String(item.product_id) : undefined,
            lineKey: item.key ? String(item.key) : undefined,
            sku: item.sku ? String(item.sku) : undefined,
            title: item.product_title || item.title || 'Item',
            variantTitle: item.variant_title || '',
            quantity: qty,
            amountMinor: unitMinor,
            imageUrl: item.image || undefined,
            compareAtAmountMinor: compareAt,
            lineDiscountMinor: lineDiscountMinor || undefined,
          };
        });

        // Enrich missing compare_at_price and variantTitle from /products/{handle}.js if available
        var missingHandles = [];
        (cart.items || []).forEach(function (item, idx) {
          var h = item.handle;
          if (!h && item.url) {
            var matchH = item.url.match(/\/products\/([^/?#]+)/);
            if (matchH) h = matchH[1];
          }
          if (h && missingHandles.indexOf(h) === -1) {
            missingHandles.push(h);
          }
        });

        if (!missingHandles.length) {
          return {
            source: 'cart',
            discountMinor: typeof cart.total_discount === 'number' ? cart.total_discount : 0,
            lines: lines,
          };
        }

        return Promise.all(
          missingHandles.map(function (handle) {
            return fetch('/products/' + handle + '.js', { headers: { accept: 'application/json' } })
              .then(function (res) { return res.ok ? res.json() : null; })
              .catch(function () { return null; });
          })
        ).then(function (prods) {
          var variantMap = {};
          prods.forEach(function (p) {
            if (p && Array.isArray(p.variants)) {
              p.variants.forEach(function (v) {
                if (v && v.id) {
                  variantMap[String(v.id)] = v;
                }
              });
            }
          });
          lines.forEach(function (l) {
            if (l.variantId && variantMap[l.variantId]) {
              var vInfo = variantMap[l.variantId];
              if (
                !l.compareAtAmountMinor &&
                typeof vInfo.compare_at_price === 'number' &&
                vInfo.compare_at_price > l.amountMinor
              ) {
                l.compareAtAmountMinor = vInfo.compare_at_price;
              }
              if (
                (!l.variantTitle || l.variantTitle === 'Default Title') &&
                vInfo.title &&
                vInfo.title !== 'Default Title'
              ) {
                l.variantTitle = vInfo.title;
              }
            }
          });
          return {
            source: 'cart',
            discountMinor: typeof cart.total_discount === 'number' ? cart.total_discount : 0,
            lines: lines,
          };
        });
      });
  }

  function resolveMerchandise(intent) {
    if (intent === 'buy_now') {
      var buyNow = readBuyNowPayload();
      return buyNow ? Promise.resolve(buyNow) : readCartPayload();
    }
    if (intent === 'cart') return readCartPayload();
    var preferred = readBuyNowPayload();
    return preferred ? Promise.resolve(preferred) : readCartPayload();
  }

  function createSession(payload) {
    return fetch(apiBase + '/v1/sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error((body && body.error && body.error.message) || 'session_failed');
        }
        return body;
      });
    });
  }

  function ensureRootNode() {
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.className = 'ec-root';
      document.body.appendChild(root);
    }
    return root;
  }

  /** Instant shell on click — full panel/CSS may still be loading in the background. */
  function showInstantCheckoutShell(settings) {
    ensureStyles();
    ensureRootNode();
    var isDesktop = typeof window !== 'undefined' && window.innerWidth > 640;
    root.setAttribute(
      'style',
      isDesktop
        ? 'position:fixed;inset:0;z-index:9999;display:flex;justify-content:center;align-items:center;' +
            'background:rgba(17,17,17,.5);margin:0;padding:1.5rem 1rem;box-sizing:border-box;'
        : 'position:fixed;inset:0;z-index:9999;display:flex;justify-content:center;align-items:stretch;' +
            'background:rgba(17,17,17,.45);margin:0;padding:0;box-sizing:border-box;',
    );
    root.hidden = false;
    document.documentElement.classList.add('ec-lock');
    if (root.querySelector('#ec-loading')) {
      root.querySelector('#ec-loading').hidden = false;
      if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.startLoading === 'function') {
        window.EasyCheckoutApp.startLoading();
      }
      return;
    }
    if (root.querySelector('.ec-shell')) return;
    var shellStyle = isDesktop
      ? 'width:min(480px,calc(100vw - 2rem));height:auto;max-height:min(92dvh,880px);margin:auto;display:flex;align-items:center;justify-content:center;background:#fcfbf9;font-family:DM Sans,Segoe UI,sans-serif;padding:1.5em;box-sizing:border-box;flex:0 0 auto;border-radius:20px;box-shadow:0 20px 45px -10px rgba(0,0,0,.3);border:0;'
      : 'width:100%;height:100dvh;max-height:100dvh;margin:0;display:flex;align-items:center;justify-content:center;background:#fcfbf9;font-family:DM Sans,Segoe UI,sans-serif;padding:1.5em;box-sizing:border-box;flex:1 1 auto;border-radius:0;box-shadow:none;border:0;';

    root.innerHTML =
      '<div class="ec-boot" id="ec-boot-loader" style="' +
      shellStyle +
      '">' +
      '<div style="text-align:center;max-width:280px;width:100%">' +
      '<div style="width:56px;height:56px;margin:0 auto 1em;border:3px solid #e5e7eb;border-top-color:#111;border-radius:50%;animation:ec-boot-spin .8s linear infinite"></div>' +
      brandBootHtml(settings || cachedSettings) +
      '<p style="margin:.55em 0 0;font-weight:700">Opening secure checkout…</p>' +
      '<p style="margin:.35em 0 0;color:#6b7280;font-size:.85em">Loading your bag and best offers</p>' +
      '</div></div>' +
      '<style>@keyframes ec-boot-spin{to{transform:rotate(360deg)}}</style>';
  }

  function open(intent) {
    if (opening) return Promise.resolve();
    opening = true;
    // Paint checkout chrome immediately on hijack click.
    showInstantCheckoutShell(cachedSettings);
    void warmInBackground();
    void fetchCheckoutSettings();

    var panelReady = ensurePanel().then(function (panel) {
      panel.hidden = false;
      document.documentElement.classList.add('ec-lock');
      var loading = panel.querySelector('#ec-loading');
      if (loading) loading.hidden = false;
      if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.startLoading === 'function') {
        window.EasyCheckoutApp.startLoading();
      }
      return panel;
    });

    var sessionReady = resolveMerchandise(intent || 'auto').then(function (payload) {
      if (!payload.lines || !payload.lines.length) throw new Error('empty_cart');
      return createSession(payload);
    });

    return Promise.all([panelReady, sessionReady, fetchCheckoutSettings()])
      .then(function (results) {
        var panel = results[0];
        var session = results[1];
        var settings = results[2];
        if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.mount === 'function') {
          return window.EasyCheckoutApp.mount(panel, {
            apiBase: apiBase,
            session: session,
            shopper: window.__ecWarmShopper || readCachedShopper() || null,
            settings: settings || cachedSettings || null,
            loading: true,
          });
        }
      })
      .catch(function (err) {
        console.error('[EasyCheckout] open failed', err);
        window.alert(
          err && err.message === 'empty_cart'
            ? 'Your cart is empty. Add a product first.'
            : 'COD checkout could not open. Please try again.',
        );
        close();
      })
      .then(function () {
        opening = false;
      });
  }

  function close() {
    opening = false;
    if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.reset === 'function') {
      window.EasyCheckoutApp.reset();
    } else if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.setLoading === 'function') {
      window.EasyCheckoutApp.setLoading(false);
    }
    if (!root) return;
    root.hidden = true;
    root.removeAttribute('style');
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
      void open('cart');
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
    var buyNowIntent =
      (hit.getAttribute && hit.getAttribute('data-ec-buy-now') === '1') ||
      (hit.closest &&
        (hit.closest('[data-ec-buy-now]') ||
          hit.closest('.shopify-payment-button') ||
          hit.closest('[class*="shopify-payment-button"]')));
    void open(buyNowIntent ? 'buy_now' : 'cart');
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
        void open('buy_now');
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
        void open('cart');
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

  function refreshSessionFromCart() {
    return readCartPayload().then(function (payload) {
      if (!payload.lines || !payload.lines.length) throw new Error('empty_cart');
      return createSession(payload);
    });
  }

  function install() {
    window.EasyCheckout = {
      open: open,
      close: close,
      apiBase: apiBase,
      refreshSessionFromCart: refreshSessionFromCart,
      readCartPayload: readCartPayload,
      createSession: createSession,
    };
    // Start panel + shopper warm before the shopper taps checkout.
    void warmInBackground();
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
