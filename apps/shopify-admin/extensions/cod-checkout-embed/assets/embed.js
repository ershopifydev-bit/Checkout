(function () {
  const ROOT_ID = 'easy-checkout-root';
  const config = window.EasyCheckoutConfig || {};
  const apiBase = (config.apiBase || '/apps/easy-checkout').replace(/\/$/, '');
  let root = null;
  let loaded = false;

  function ensureStyles() {
    if (document.getElementById('easy-checkout-css')) return;
    const link = document.createElement('link');
    link.id = 'easy-checkout-css';
    link.rel = 'stylesheet';
    link.href = config.cssUrl || `${apiBase}/checkout/checkout.css`;
    document.head.appendChild(link);
  }

  async function ensurePanel() {
    if (loaded && root) return root;
    ensureStyles();
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.className = 'ec-root';
      root.hidden = true;
      document.body.appendChild(root);
    }
    const panelUrl = config.panelUrl || `${apiBase}/checkout/panel.html`;
    const response = await fetch(panelUrl, { headers: { accept: 'text/html' } });
    if (!response.ok) throw new Error('checkout_panel_failed');
    root.innerHTML = await response.text();
    if (!document.getElementById('easy-checkout-js')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = 'easy-checkout-js';
        script.src = config.jsUrl || `${apiBase}/checkout/checkout.js`;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
    loaded = true;
    return root;
  }

  async function open() {
    const panel = await ensurePanel();
    panel.hidden = false;
    document.documentElement.classList.add('ec-lock');
    if (window.EasyCheckoutApp && typeof window.EasyCheckoutApp.mount === 'function') {
      await window.EasyCheckoutApp.mount(panel, { apiBase });
    }
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove('ec-lock');
  }

  function shouldHijack(event) {
    if (config.hijackCheckout === false) return false;
    const el = event.target.closest(
      '[name="checkout"], [name="goto_pp"], form[action*="/cart"] [type="submit"], a[href="/checkout"], a[href*="/checkouts/"], button[id*="checkout"], button[class*="checkout"]',
    );
    return Boolean(el);
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!shouldHijack(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void open();
    },
    true,
  );

  window.EasyCheckout = { open, close, apiBase };
})();
