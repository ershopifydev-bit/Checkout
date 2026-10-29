(function () {
  const CARD_UI_VERSION = '20261029-card-2';
  console.info('[Easy Checkout] script loaded', { version: CARD_UI_VERSION });
  let apiBase = '';
  let activeSessionId = '';
  let shopper = null;
  let otpSent = false;
  let boundRoot = null;
  let basePayMinor = 0;
  let selectedPay = 'cod';
  let addressBook = [];
  let selectedAddressId = '';
  let editingAddressId = '';
  let addressFormMode = 'edit'; // edit | add
  let addressFocus = false;
  let cartBusy = false;
  let sessionLines = [];
  let currentSession = null;
  /** 'cart' | 'buy_now' — only clear Shopify cart after place when checkout started from cart. */
  let sessionSource = 'cart';
  let upsellItems = [];

  // This flag need to be driven from admin.
  let requireCodConfirmation = true;
  let showUpsell = true;
  /** Mirrors /v1/settings.payments — applied in the same settings fetch (no extra request). */
  let paymentMethods = { cod: true, upi: false, card: false, netbanking: false };
  let currentSettings = null;
  let currentUpiConfig = null;
  let upiTimerInterval = null;

  // Login / OTP loading state
  let loginBusy = null; // null | 'send' | 'verify' | 'resend'
  let resendLeft = 0;
  let resendTimer = null;
  const RESEND_SECONDS = 30;

  // Session-open loading overlay
  let loadingTimer = null;
  let loadingIndex = 0;

  // Funnel & event tracking
  let orderCompleted = false;

  function determineCurrentFunnelStep() {
    if (!shopper?.token) return 'Login';
    if (!addressComplete(shopper?.address)) return 'Address';
    if (offersSheetMode) return 'Discounts';
    return 'Payment';
  }

  function trackCheckoutEvent(eventName, data = {}) {
    try {
      const sessionId = activeSessionId || (data && data.sessionId) || '';
      if (!sessionId && eventName !== 'started') return;
      const stepMap = {
        started: 'started',
        logged_in: 'login',
        address_added: 'address',
        discount_applied: 'discounts',
        payment_selected: 'payment',
        checkout_completed: 'complete',
        checkout_abandoned: 'payment',
        step_viewed: 'started',
      };
      const step = stepMap[eventName] || 'started';
      const payload = {
        sessionId,
        event: eventName,
        step,
        timestamp: new Date().toISOString(),
        device: window.innerWidth > 640 ? 'desktop' : 'mobile',
        ...(shopper?.phone ? { shopperPhone: shopper.phone } : {}),
        ...(shopper?.customerId ? { customerId: shopper.customerId } : {}),
        ...(basePayMinor ? { cartValueMinor: basePayMinor } : {}),
        metadata: {
          ...data,
          url: window.location.href,
        },
      };
      if (data.couponCode) payload.couponCode = data.couponCode;
      if (data.paymentMethod || data.method) {
        payload.paymentMethod = data.paymentMethod || data.method;
      }
      if (data.orderId) payload.orderId = data.orderId;
      if (data.orderName) payload.orderName = data.orderName;

      const endpoint = `${apiBase}/v1/events`;
      if (eventName === 'checkout_abandoned' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
      } else {
        fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      }
    } catch (_) {}
  }

  const STORAGE_SHOPPER = 'ec_shopper_v1';
  const STORAGE_ADDRESSES = 'ec_addresses_v1';

  const LOADING_BEATS = [
    {
      text: 'Getting checkout ready…',
      sub: 'Hang tight — this only takes a moment',
      anim: 'orbit',
    },
    {
      text: 'Fetching your bag…',
      sub: 'Pulling live prices and discounts',
      anim: 'bags',
    },
    {
      text: 'Hunting for better offers…',
      sub: 'Saving you a few extra rupees if we can',
      anim: 'spark',
    },
    {
      text: 'Securing your session…',
      sub: 'Almost there — preparing COD checkout',
      anim: 'pulse',
    },
    {
      text: 'Warming up delivery options…',
      sub: 'You’re seconds away from placing the order',
      anim: 'orbit',
    },
  ];

  // Shown in address picker during development so list UI is visible.
  const DEV_DEFAULT_ADDRESS = {
    id: 'dev-home',
    label: 'Home (demo)',
    isDemo: true,
    phone: '9876543210',
    fullName: 'Demo Customer',
    addressLine1: '12 MG Road',
    locality: 'Bengaluru',
    region: 'Karnataka',
    postalCode: '560001',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function formatInr(amountMinor) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format((Number(amountMinor) || 0) / 100);
  }

  function parsePriceMajor(text) {
    if (!text) return 0;
    const cleaned = String(text).replace(/,/g, '');
    const match = cleaned.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  }

  function sanitizeShopperError(msg) {
    if (!msg || typeof msg !== 'string') return 'Something went wrong. Please try again.';
    const lower = msg.toLowerCase();
    if (
      lower.includes('(?-mix:') ||
      lower.includes('expected integer') ||
      lower.includes('bad_request') ||
      lower.includes('syntaxerror')
    ) {
      return 'Unable to update item quantity. Please try again.';
    }
    return msg;
  }

  let errorDismissTimer = null;
  function showErr(id, message) {
    const el = $(id);
    if (!el) return;
    if (id === 'ec-error') {
      if (errorDismissTimer) {
        clearTimeout(errorDismissTimer);
        errorDismissTimer = null;
      }
      const textEl = $('ec-error-text') || el;
      if (!message) {
        el.hidden = true;
        el.classList.remove('is-visible');
        if (textEl !== el) textEl.textContent = '';
        return;
      }
      const cleanMsg = sanitizeShopperError(message);
      if (textEl !== el) {
        textEl.textContent = cleanMsg;
      } else {
        el.textContent = cleanMsg;
      }
      el.hidden = false;
      el.classList.add('is-visible');
      errorDismissTimer = setTimeout(() => {
        el.hidden = true;
        el.classList.remove('is-visible');
      }, 8000);
      return;
    }
    el.hidden = !message;
    el.textContent = message || '';
  }

  function persistShopper(next) {
    shopper = next;
    try {
      if (next) localStorage.setItem(STORAGE_SHOPPER, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_SHOPPER);
    } catch {
      /* ignore */
    }
    window.__ecWarmShopper = next || null;
    syncAccountHeader();
  }

  function loadShopper() {
    try {
      const raw = localStorage.getItem(STORAGE_SHOPPER);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.token && parsed.phone) return parsed;
    } catch {
      /* ignore */
    }
    return null;
  }

  function formatPhoneDisplay(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `+91 ${digits}`;
    if (digits.length === 12 && digits.startsWith('91'))
      return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
    return phone ? String(phone) : '';
  }

  function syncAccountHeader() {
    const account = $('ec-account');
    const phoneEl = $('ec-account-phone');
    const nameEl = $('ec-account-name');
    const initialEl = $('ec-account-avatar-initial');
    const avatarImg = $('ec-account-avatar-img');
    const topRow =
      boundRoot?.querySelector?.('.ec-top-row') || document.querySelector('.ec-top-row');
    if (!account) return;
    const phone = formatPhoneDisplay(shopper?.phone || shopper?.address?.phone);
    if (phone) {
      account.hidden = false;
      if (topRow) topRow.classList.add('is-logged-in');
      if (phoneEl) phoneEl.textContent = phone;
      const fullName = (shopper?.fullName || shopper?.address?.fullName || '').trim();
      const firstName = fullName ? fullName.split(/\s+/)[0] : '';
      const displayName = firstName || 'Shopper';
      if (nameEl) nameEl.textContent = displayName;
      if (initialEl) {
        initialEl.textContent = displayName ? displayName.charAt(0).toUpperCase() : '👤';
      }
      if (avatarImg) {
        if (shopper?.avatarUrl) {
          avatarImg.src = shopper.avatarUrl;
          avatarImg.hidden = false;
          if (initialEl) initialEl.hidden = true;
        } else {
          avatarImg.hidden = true;
          if (initialEl) initialEl.hidden = false;
        }
      }
    } else {
      account.hidden = true;
      if (topRow) topRow.classList.remove('is-logged-in');
      if (phoneEl) phoneEl.textContent = '';
      if (nameEl) nameEl.textContent = '';
    }
  }

  function syncUpsellVisibility() {
    const section =
      boundRoot?.querySelector?.('.ec-upsell') || document.querySelector('.ec-upsell');
    if (section) section.hidden = !showUpsell;
  }

  function applyPaymentMethods(payments) {
    const src = payments && typeof payments === 'object' ? payments : {};
    paymentMethods = {
      cod: src.cod !== false,
      upi: src.upi === true,
      card: src.card === true,
      netbanking: src.netbanking === true,
    };
    if (
      !paymentMethods.cod &&
      !paymentMethods.upi &&
      !paymentMethods.card &&
      !paymentMethods.netbanking
    ) {
      paymentMethods.cod = true;
    }
    const rows = document.querySelectorAll('[data-ec-pay]');
    for (const row of rows) {
      const id = row.getAttribute('data-ec-pay') || '';
      const on = paymentMethods[id] === true;
      row.hidden = !on;
      if ('disabled' in row) row.disabled = !on;
      row.setAttribute('data-ec-pay-enabled', on ? '1' : '0');
      if (!on) {
        row.classList.remove('is-selected');
        row.setAttribute('aria-checked', 'false');
      }
    }
    const selectedRow = document.querySelector(`[data-ec-pay="${selectedPay}"]`);
    if (!selectedRow || selectedRow.hidden) {
      const first = document.querySelector('[data-ec-pay]:not([hidden])');
      selectedPay = first?.getAttribute('data-ec-pay') || 'cod';
    }
    for (const row of rows) {
      const on = row.getAttribute('data-ec-pay') === selectedPay && !row.hidden;
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (typeof refreshPaymentAmounts === 'function') refreshPaymentAmounts();
  }

  // --------------------------------------------------------------------------
  // QR Code generator for UPI payment URIs (zero external dependencies)
  // --------------------------------------------------------------------------
  function generateUpiQrSvg(text, pixelSize = 124) {
    const GF256_EXP = new Uint8Array(512);
    const GF256_LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF256_EXP[i] = x;
      GF256_EXP[i + 255] = x;
      GF256_LOG[x] = i;
      x <<= 1;
      if (x & 256) x ^= 0x11d;
    }

    function gfMul(a, b) {
      if (a === 0 || b === 0) return 0;
      return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]];
    }

    function rsGenPoly(n) {
      let poly = [1];
      for (let i = 0; i < n; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
          next[j] ^= gfMul(poly[j], GF256_EXP[i]);
          next[j + 1] ^= poly[j];
        }
        poly = next;
      }
      return poly;
    }

    function rsEncode(data, numEc) {
      const gen = rsGenPoly(numEc);
      const res = new Uint8Array(numEc);
      for (let i = 0; i < data.length; i++) {
        const factor = data[i] ^ res[0];
        for (let j = 0; j < numEc - 1; j++) {
          res[j] = res[j + 1] ^ gfMul(gen[j + 1], factor);
        }
        res[numEc - 1] = gfMul(gen[numEc], factor);
      }
      return res;
    }

    const VERSIONS = [
      null,
      { ver: 1, size: 21, dataCw: 16, ecCw: 10, align: [] },
      { ver: 2, size: 25, dataCw: 28, ecCw: 16, align: [6, 18] },
      { ver: 3, size: 29, dataCw: 44, ecCw: 26, align: [6, 22] },
      { ver: 4, size: 33, dataCw: 64, ecCw: 36, align: [6, 26] },
      { ver: 5, size: 37, dataCw: 86, ecCw: 48, align: [6, 30] },
      { ver: 6, size: 41, dataCw: 108, ecCw: 64, align: [6, 34] },
      { ver: 7, size: 45, dataCw: 124, ecCw: 72, align: [6, 22, 38] },
      { ver: 8, size: 49, dataCw: 154, ecCw: 88, align: [6, 24, 42] },
    ];

    const bytes =
      typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(text)
        : Array.from(text).map((c) => c.charCodeAt(0));

    let spec = VERSIONS[VERSIONS.length - 1];
    for (let v = 1; v < VERSIONS.length; v++) {
      if (bytes.length <= VERSIONS[v].dataCw - 2) {
        spec = VERSIONS[v];
        break;
      }
    }

    const bits = [];
    function putBits(val, len) {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }
    putBits(0b0100, 4); // Byte mode
    putBits(bytes.length, 8); // 8-bit length
    for (let b of bytes) putBits(b, 8);
    const cap = spec.dataCw * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    const pad = [0xec, 0x11];
    let padIdx = 0;
    while (bits.length < cap) {
      putBits(pad[padIdx++ % 2], 8);
    }
    const dataCw = new Uint8Array(spec.dataCw);
    for (let i = 0; i < spec.dataCw; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
      dataCw[i] = b;
    }

    const ecCw = rsEncode(dataCw, spec.ecCw);
    const total = new Uint8Array(dataCw.length + ecCw.length);
    total.set(dataCw);
    total.set(ecCw, dataCw.length);

    const size = spec.size;
    const mat = Array.from({ length: size }, () => new Int8Array(size).fill(-1));

    function finder(row, col) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const mr = row + r;
          const mc = col + c;
          if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
          if (
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          ) {
            mat[mr][mc] = 1;
          } else {
            mat[mr][mc] = 0;
          }
        }
      }
    }
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      if (mat[6][i] === -1) mat[6][i] = i % 2 === 0 ? 1 : 0;
      if (mat[i][6] === -1) mat[i][6] = i % 2 === 0 ? 1 : 0;
    }

    if (spec.align.length > 1) {
      for (let r of spec.align) {
        for (let c of spec.align) {
          if (mat[r][c] !== -1) continue;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const d = Math.max(Math.abs(dr), Math.abs(dc));
              mat[r + dr][c + dc] = d === 1 ? 0 : 1;
            }
          }
        }
      }
    }

    for (let i = 0; i <= 8; i++) {
      if (mat[8][i] === -1) mat[8][i] = -2;
      if (mat[i][8] === -1) mat[i][8] = -2;
    }
    for (let i = size - 8; i < size; i++) {
      if (mat[8][i] === -1) mat[8][i] = -2;
      if (mat[i][8] === -1) mat[i][8] = -2;
    }
    mat[size - 8][8] = 1;

    let byteIdx = 0,
      bitIdx = 7;
    let dir = -1;
    let col = size - 1;
    while (col > 0) {
      if (col === 6) col--;
      for (let i = 0; i < size; i++) {
        const r = dir === -1 ? size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const currCol = col - c;
          if (mat[r][currCol] === -1) {
            let bit = 0;
            if (byteIdx < total.length) {
              bit = (total[byteIdx] >> bitIdx) & 1;
              bitIdx--;
              if (bitIdx < 0) {
                bitIdx = 7;
                byteIdx++;
              }
            }
            if ((r + currCol) % 2 === 0) bit ^= 1;
            mat[r][currCol] = bit;
          }
        }
      }
      dir = -dir;
      col -= 2;
    }

    // Format bits for mask 0
    let rem = 0 << 10;
    const poly = 0x537;
    for (let i = 14; i >= 10; i--) {
      if (rem & (1 << i)) rem ^= poly << (i - 10);
    }
    const fmt = rem ^ 0x5412;
    const fmtBits = [];
    for (let i = 14; i >= 0; i--) fmtBits.push((fmt >> i) & 1);

    const fmtCoords1 = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8],
    ];
    for (let i = 0; i < 15; i++) {
      const [r, c] = fmtCoords1[i];
      mat[r][c] = fmtBits[i];
    }
    const fmtCoords2 = [
      [size - 1, 8],
      [size - 2, 8],
      [size - 3, 8],
      [size - 4, 8],
      [size - 5, 8],
      [size - 6, 8],
      [size - 7, 8],
      [8, size - 8],
      [8, size - 7],
      [8, size - 6],
      [8, size - 5],
      [8, size - 4],
      [8, size - 3],
      [8, size - 2],
      [8, size - 1],
    ];
    for (let i = 0; i < 15; i++) {
      const [r, c] = fmtCoords2[i];
      mat[r][c] = fmtBits[i];
    }

    const padSize = 2;
    const fullSize = size + padSize * 2;
    let d = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (mat[r][c] === 1) {
          d += `M${c + padSize},${r + padSize}h1v1h-1z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullSize} ${fullSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" aria-label="UPI QR Code"><rect width="100%" height="100%" fill="#ffffff"/><path d="${d.trim()}" fill="#111827"/></svg>`;
  }

  // --------------------------------------------------------------------------
  // UPI App targets & Mobile OS deep-link handlers (Android & iOS)
  // --------------------------------------------------------------------------
  const UPI_APP_TARGETS = {
    paytm: {
      id: 'paytm',
      name: 'Paytm',
      androidPackage: 'net.one97.paytm',
      iosScheme: 'paytmmp://pay',
      logo: `<svg viewBox="0 0 48 18" width="42" height="16" fill="none"><path d="M6.2 3.8h2.3c1.5 0 2.5.9 2.5 2.2 0 1.4-1 2.3-2.5 2.3H6.2v3.9H4V3.8h2.2zm0 3.1h2.1c.6 0 1-.3 1-.9s-.4-.9-1-.9H6.2v1.8z" fill="#002970"/><path d="M14.5 12.2c-.3 0-.6-.1-.8-.3-.3-.2-.5-.6-.5-1v-4h2.2v3.7c0 .4.2.6.5.6.4 0 .7-.2.8-.5V6.9h2.2v4.4c-.4.5-.9.8-1.5 1-.3 0-.6-.1-.9-.1z" fill="#002970"/><path d="M22.5 4.8h2.2v2.1h1.5v1.8h-1.5v3.5h-2.2V8.7h-1.1V6.9h1.1V4.8z" fill="#002970"/><path d="M30.4 6.9l-1.9 4.3-1.8-4.3h-2.3l3.1 6.5-1.2 2.5h2.3l4.2-9h-2.4z" fill="#00BAF2"/><path d="M36.2 6.9h2.2v5.3h-2.2V6.9zm0-2.8h2.2v1.9h-2.2V4.1z" fill="#00BAF2"/></svg>`,
    },
    phonepe: {
      id: 'phonepe',
      name: 'PhonePe',
      androidPackage: 'com.phonepe.app',
      iosScheme: 'phonepe://pay',
      logo: `<svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="15" fill="#5F259F"/><path d="M19.5 8.5h-5.2c-2.4 0-4.3 1.9-4.3 4.3v10.7h3.6v-4.1h2.9l3.8 4.1h4.6l-4.4-4.7c1.8-.7 3-2.4 3-4.4 0-3.3-2.4-5.9-5.4-5.9zm-2.3 8.3h-3.6v-5.2h3.6c1.4 0 2.6 1.2 2.6 2.6s-1.2 2.6-2.6 2.6z" fill="#FFFFFF"/></svg>`,
    },
    gpay: {
      id: 'gpay',
      name: 'G Pay',
      androidPackage: 'com.google.android.apps.nbu.paisa.user',
      iosScheme: 'gpay://upi/pay',
      logo: `<svg viewBox="0 0 32 32" width="28" height="28"><path d="M26.8 16.3c0-.8-.1-1.6-.2-2.3H16v4.4h6.1c-.3 1.4-1.1 2.6-2.4 3.4v2.8h3.9c2.3-2.1 3.2-5.2 3.2-8.3z" fill="#4285F4"/><path d="M16 27.2c3.3 0 6.1-1.1 8.1-3l-3.9-2.8c-1.1.7-2.5 1.2-4.2 1.2-3.2 0-6-2.2-7-5.1H5v3c2.1 4.1 6.3 6.7 11 6.7z" fill="#34A853"/><path d="M9 17.5c-.3-.8-.4-1.6-.4-2.5s.1-1.7.4-2.5V9.5H5c-.9 1.8-1.4 3.8-1.4 6s.5 4.2 1.4 6l4-3.5-.4-.5z" fill="#FBBC05"/><path d="M16 7.8c1.8 0 3.4.6 4.7 1.8l3.5-3.5C22.1 4.2 19.3 3 16 3 11.3 3 7.1 5.6 5 9.7l4 3.1c1-2.9 3.8-5 7-5z" fill="#EA4335"/></svg>`,
    },
    amazonpay: {
      id: 'amazonpay',
      name: 'Amazon Pay',
      androidPackage: 'in.amazon.mShop.android.shopping',
      iosScheme: 'amazonpay://pay',
      logo: `<svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="15" fill="#232F3E"/><text x="16" y="15" fill="#FFFFFF" font-size="10" font-family="system-ui, sans-serif" font-weight="800" text-anchor="middle">pay</text><path d="M9 20c4 2.5 10 2.5 14 0" stroke="#FF9900" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M21.5 19.2l1.8.8-.6 1.8" fill="#FF9900"/></svg>`,
    },
    bhim: {
      id: 'bhim',
      name: 'BHIM',
      androidPackage: 'in.org.npci.upiapp',
      iosScheme: 'upi://pay',
      logo: `<svg viewBox="0 0 32 32" width="26" height="26"><path d="M8 6l8 10-8 10h5l8-10-8-10H8z" fill="#FF9933"/><path d="M14 6l8 10-8 10h5l8-10-8-10h-5z" fill="#138808"/></svg>`,
    },
    cred: {
      id: 'cred',
      name: 'CRED',
      androidPackage: 'com.dreamplug.androidapp',
      iosScheme: 'credpay://pay',
      logo: `<svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="6" fill="#0F172A"/><path d="M16 6L7 11v8c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12v-8l-9-5z" stroke="#FFFFFF" stroke-width="2" fill="none"/></svg>`,
    },
    all: {
      id: 'all',
      name: 'All UPI Apps',
      androidPackage: '',
      iosScheme: 'upi://pay',
      logo: `<svg class="ec-upi-grid-dots" width="22" height="22" viewBox="0 0 24 24" fill="#4f46e5" aria-hidden="true"><circle cx="5" cy="5" r="2.2" /><circle cx="12" cy="5" r="2.2" /><circle cx="19" cy="5" r="2.2" /><circle cx="5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /><circle cx="5" cy="19" r="2.2" /><circle cx="12" cy="19" r="2.2" /><circle cx="19" cy="19" r="2.2" /></svg>`,
    },
    generic: {
      id: 'generic',
      name: 'All UPI Apps',
      androidPackage: '',
      iosScheme: 'upi://pay',
      logo: `<svg class="ec-upi-grid-dots" width="22" height="22" viewBox="0 0 24 24" fill="#4f46e5" aria-hidden="true"><circle cx="5" cy="5" r="2.2" /><circle cx="12" cy="5" r="2.2" /><circle cx="19" cy="5" r="2.2" /><circle cx="5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /><circle cx="5" cy="19" r="2.2" /><circle cx="12" cy="19" r="2.2" /><circle cx="19" cy="19" r="2.2" /></svg>`,
    },
  };

  function getMobilePlatform() {
    const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'other';
  }

  function buildUpiParams(customVpa) {
    const payableEl = document.querySelector('[data-ec-pay="upi"]');
    const payableMinor = payableEl ? payAmountForMethod(payableEl, basePayMinor) : basePayMinor;
    const amountStr = (payableMinor / 100).toFixed(2);
    const vpa = (customVpa || currentUpiConfig?.vpa || 'merchant@upi').trim();
    const merchantName = (
      currentUpiConfig?.merchantName ||
      currentSettings?.brandName ||
      'Tezvix Store'
    ).trim();
    const note = activeSessionId ? 'Order ' + activeSessionId.slice(-8) : 'Order payment';
    return `pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(merchantName)}&am=${encodeURIComponent(amountStr)}&cu=INR&tn=${encodeURIComponent(note)}`;
  }

  function getUpiLaunchUrl(appId, customVpa) {
    const target = UPI_APP_TARGETS[appId] || UPI_APP_TARGETS.generic;
    const queryString = buildUpiParams(customVpa);
    const platform = getMobilePlatform();

    if (platform === 'android') {
      if (target.androidPackage) {
        const fallbackUrl = encodeURIComponent('upi://pay?' + queryString);
        return `intent://pay?${queryString}#Intent;scheme=upi;package=${target.androidPackage};S.browser_fallback_url=${fallbackUrl};end`;
      }
      return `upi://pay?${queryString}`;
    }

    if (platform === 'ios') {
      if (target.iosScheme && target.iosScheme.includes('://')) {
        return `${target.iosScheme}?${queryString}`;
      }
      return `upi://pay?${queryString}`;
    }

    return `upi://pay?${queryString}`;
  }

  function launchUpiApp(appId, customVpa) {
    const url = getUpiLaunchUrl(appId, customVpa);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_top';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (_) {}

    setTimeout(() => {
      try {
        window.location.assign(url);
      } catch (_) {
        try {
          window.location.href = url;
        } catch (__) {}
      }
    }, 150);
  }

  function renderMobileUpiApps(settings) {
    const grid = $('ec-upi-apps-grid');
    if (!grid) return;

    const configured =
      Array.isArray(settings?.upiConfig?.apps) && settings.upiConfig.apps.length > 0
        ? settings.upiConfig.apps
        : ['paytm', 'phonepe', 'gpay', 'amazonpay'];

    grid.replaceChildren();

    const topApps = configured.filter((a) => a !== 'generic' && a !== 'all').slice(0, 4);

    topApps.forEach((appId, index) => {
      const item = UPI_APP_TARGETS[appId] || {
        id: appId,
        name: appId.toUpperCase(),
        logo: '📱',
      };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = index === 0 ? 'ec-upi-app-card is-selected' : 'ec-upi-app-card';
      btn.setAttribute('data-ec-upi-app', item.id);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', index === 0 ? 'true' : 'false');
      btn.innerHTML = `<span class="ec-upi-app-logo">${item.logo}</span><span class="ec-upi-app-name">${item.name}</span>`;
      grid.appendChild(btn);
    });

    // Add one more card at the end of the payment apps: "All UPI Apps"
    const allItem = UPI_APP_TARGETS.all;
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'ec-upi-app-card';
    allBtn.setAttribute('data-ec-upi-app', allItem.id);
    allBtn.setAttribute('role', 'radio');
    allBtn.setAttribute('aria-checked', 'false');
    allBtn.innerHTML = `<span class="ec-upi-app-logo">${allItem.logo}</span><span class="ec-upi-app-name">${allItem.name}</span>`;
    grid.appendChild(allBtn);
  }

  function applyUpiSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    currentUpiConfig = settings.upiConfig || null;
    const discountText = settings.upiConfig?.discountBadge || '₹50 Off';
    const cashbackText = settings.upiConfig?.cashbackBadge || 'Win Cashback';

    const deskDiscount = $('ec-upi-desk-discount-badge');
    if (deskDiscount) deskDiscount.textContent = discountText;
    const mobDiscount = $('ec-upi-mob-discount-badge');
    if (mobDiscount) mobDiscount.textContent = discountText.toUpperCase();
    const cashbackEl = $('ec-upi-mob-cashback-text');
    if (cashbackEl) cashbackEl.textContent = cashbackText;

    renderMobileUpiApps(settings);
  }

  function startUpiQrCountdown(seconds = 540) {
    if (upiTimerInterval) clearInterval(upiTimerInterval);
    let remaining = seconds;
    const timerText = $('ec-upi-timer-text');
    function tick() {
      if (!timerText) return;
      const mins = Math.floor(remaining / 60)
        .toString()
        .padStart(2, '0');
      const secs = (remaining % 60).toString().padStart(2, '0');
      timerText.innerHTML = `QR valid for <strong>${mins}:${secs} mins</strong>`;
      if (remaining <= 0) {
        clearInterval(upiTimerInterval);
        timerText.innerHTML = `<span>QR expired · <u>Click to refresh</u></span>`;
      }
      remaining--;
    }
    tick();
    upiTimerInterval = setInterval(tick, 1000);
  }

  function handleShowUpiQr() {
    selectedPay = 'upi';
    for (const row of document.querySelectorAll('[data-ec-pay]')) {
      const on = row.getAttribute('data-ec-pay') === 'upi';
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    updatePayableDisplay();

    const upiUri = `upi://pay?${buildUpiParams()}`;
    const realEl = $('ec-upi-qr-real');
    const blurredEl = $('ec-upi-qr-blurred');
    const showBtn = $('ec-upi-show-qr-btn');
    if (realEl) {
      realEl.innerHTML = generateUpiQrSvg(upiUri, 124);
      realEl.hidden = false;
    }
    if (blurredEl) blurredEl.hidden = true;
    if (showBtn) showBtn.hidden = true;
    const timerBadge = $('ec-upi-timer-badge');
    if (timerBadge) timerBadge.hidden = false;

    startUpiQrCountdown(540);
  }

  function handleUpiAppSelect(btn) {
    selectedPay = 'upi';
    const appId = btn.getAttribute('data-ec-upi-app') || 'generic';
    for (const b of document.querySelectorAll('[data-ec-upi-app]')) {
      const on = b === btn;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    for (const row of document.querySelectorAll('[data-ec-pay]')) {
      const on = row.getAttribute('data-ec-pay') === 'upi';
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    updatePayableDisplay();
    launchUpiApp(appId);
  }

  function handleUpiVpaSubmit() {
    const input = $('ec-upi-vpa-input');
    const errEl = $('ec-upi-vpa-error');
    const val = (input?.value || '').trim();
    if (!val || !val.includes('@') || val.length < 5) {
      if (errEl) {
        errEl.textContent = 'Please enter a valid UPI ID (e.g. yourname@okaxis)';
        errEl.hidden = false;
      }
      return;
    }
    if (errEl) errEl.hidden = true;
    selectedPay = 'upi';
    for (const row of document.querySelectorAll('[data-ec-pay]')) {
      const on = row.getAttribute('data-ec-pay') === 'upi';
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    updatePayableDisplay();
    input?.blur();
    launchUpiApp('generic', val);
  }

  function applyBrand(settings) {
    if (!settings || typeof settings !== 'object') return;
    currentSettings = settings;
    if (settings.upiConfig) applyUpiSettings(settings);
    if (typeof settings.requireCodConfirmation === 'boolean') {
      requireCodConfirmation = settings.requireCodConfirmation;
    }
    if (typeof settings.showUpsell === 'boolean') {
      showUpsell = settings.showUpsell;
      syncUpsellVisibility();
      if (!showUpsell) {
        upsellItems = [];
        const rail = $('ec-upsell-rail');
        if (rail) rail.replaceChildren();
      } else if (sessionLines.length) {
        void loadStoreUpsells(sessionLines);
      }
    }
    if (settings.payments) applyPaymentMethods(settings.payments);
    const mode = settings.brandMode === 'logo' ? 'logo' : 'name';
    const name = String(settings.brandName || 'RARE').trim() || 'RARE';
    const logoUrl = String(settings.logoUrl || '').trim();
    const title = $('ec-title');
    const loadingBrand =
      boundRoot?.querySelector?.('.ec-loading-brand') ||
      document.querySelector('.ec-loading-brand');
    const useLogo = mode === 'logo' && /^https?:\/\//i.test(logoUrl);

    if (title) {
      title.classList.toggle('is-logo', useLogo);
      title.replaceChildren();
      if (useLogo) {
        const img = document.createElement('img');
        img.src = logoUrl;
        img.alt = name;
        img.className = 'ec-brand-logo';
        title.appendChild(img);
      } else {
        title.textContent = name;
      }
    }

    if (loadingBrand) {
      loadingBrand.classList.toggle('is-logo', useLogo);
      loadingBrand.replaceChildren();
      if (useLogo) {
        const img = document.createElement('img');
        img.src = logoUrl;
        img.alt = name;
        img.className = 'ec-brand-logo';
        loadingBrand.appendChild(img);
      } else {
        loadingBrand.textContent = name;
      }
    }
  }

  async function loadCheckoutSettings() {
    if (!apiBase) return null;
    try {
      const response = await fetch(`${apiBase}/v1/settings`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = await response.json();
      applyBrand(body);
      return body;
    } catch {
      return null;
    }
  }

  function setStep(step) {
    $('ec-step-login').hidden = step !== 'login';
    $('ec-step-address').hidden = step !== 'address';
    $('ec-step-checkout').hidden = step !== 'checkout';
    const loggedIn = step !== 'login' && !!shopper;
    if (!loggedIn) {
      const account = $('ec-account');
      if (account) account.hidden = true;
    } else {
      syncAccountHeader();
    }
    // Close (✕) is only shown on the login step; other steps show Logout + phone.
    const closeBtn = $('ec-close');
    if (closeBtn) closeBtn.hidden = step !== 'login';
    if (step !== 'checkout') setAddressFocus(false);
    if (step === 'login') collapseSummary(false);
  }

  function shellEl() {
    return (
      (boundRoot?.classList?.contains('ec-shell') && boundRoot) ||
      boundRoot?.querySelector?.('.ec-shell') ||
      document.querySelector('.ec-shell') ||
      boundRoot ||
      null
    );
  }

  function collapseSummary(force) {
    const panel = $('ec-summary-panel');
    const toggle = $('ec-summary-toggle');
    const scrim = $('ec-summary-scrim');
    if (!panel || !toggle) return;
    const open = force === true ? true : force === false ? false : panel.hidden;
    panel.hidden = !open;
    if (scrim) scrim.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    const chevron = toggle.querySelector('.ec-chevron');
    if (chevron) chevron.textContent = open ? '▴' : '▾';
    const shell = shellEl();
    if (shell) shell.classList.toggle('is-summary-open', open);
    if (open) {
      // Reset so newly opened bag starts from the top.
      panel.scrollTop = 0;
      const lines = $('ec-lines');
      if (lines) lines.scrollTop = 0;
    }
  }

  /** Scrim covers the lower screen while items are open — forward pans/wheels into the lines list. */
  function bindSummaryScrimScroll() {
    const scrim = $('ec-summary-scrim');
    const panel = $('ec-summary-panel');
    if (!scrim || !panel || scrim.dataset.ecScrollBound === '1') return;
    scrim.dataset.ecScrollBound = '1';
    let lastY = null;

    scrim.addEventListener(
      'touchstart',
      (event) => {
        if (panel.hidden || !event.touches[0]) return;
        lastY = event.touches[0].clientY;
      },
      { passive: true },
    );
    scrim.addEventListener(
      'touchmove',
      (event) => {
        if (panel.hidden || lastY == null || !event.touches[0]) return;
        const y = event.touches[0].clientY;
        const target = $('ec-lines') || panel;
        target.scrollTop += lastY - y;
        lastY = y;
        event.preventDefault();
      },
      { passive: false },
    );
    scrim.addEventListener(
      'touchend',
      () => {
        lastY = null;
      },
      { passive: true },
    );
    scrim.addEventListener(
      'touchcancel',
      () => {
        lastY = null;
      },
      { passive: true },
    );
    scrim.addEventListener(
      'wheel',
      (event) => {
        if (panel.hidden) return;
        const target = $('ec-lines') || panel;
        target.scrollTop += event.deltaY;
        event.preventDefault();
      },
      { passive: false },
    );
  }

  function otpInputs() {
    return Array.from(document.querySelectorAll('[data-ec-otp]'));
  }

  function readOtp() {
    return otpInputs()
      .map((input) => input.value.replace(/\D/g, ''))
      .join('');
  }

  function clearOtp() {
    for (const input of otpInputs()) input.value = '';
  }

  function fillOtp(code) {
    const digits = String(code || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .split('');
    otpInputs().forEach((input, index) => {
      input.value = digits[index] || '';
    });
  }

  /* ---------- Login / OTP UI state ---------- */

  function syncLoginUi() {
    const phoneEl = $('ec-login-phone');
    const consent = $('ec-consent');
    const btn = $('ec-login-submit');
    if (!phoneEl || !btn) return;
    const sending = loginBusy === 'send';
    const verifying = loginBusy === 'verify';
    const resending = loginBusy === 'resend';
    const busy = !!loginBusy;

    // Fields that can't be edited right now are disabled
    phoneEl.disabled = otpSent || busy;
    if (consent) consent.disabled = otpSent || busy;
    otpInputs().forEach((input) => {
      input.disabled = !otpSent || verifying || resending;
    });
    const editBtn = $('ec-phone-edit');
    if (editBtn) editBtn.disabled = busy;

    const phoneOk = /^[6-9]\d{9}$/.test(phoneEl.value);
    btn.disabled = busy || (otpSent ? readOtp().length !== 4 : !phoneOk);
    btn.classList.toggle('is-loading', sending || verifying);
    const label = btn.querySelector('.ec-cta-label');
    if (label) {
      label.textContent = sending
        ? 'Sending OTP…'
        : verifying
          ? 'Verifying…'
          : otpSent
            ? 'Verify & Continue'
            : 'Send OTP';
    }

    const resend = $('ec-resend');
    if (resend) {
      resend.disabled = busy || resendLeft > 0;
      resend.textContent = resending
        ? 'Sending…'
        : resendLeft > 0
          ? `Resend OTP in 00:${String(resendLeft).padStart(2, '0')}`
          : 'Resend OTP';
    }
  }

  function stopResendTimer() {
    clearInterval(resendTimer);
    resendTimer = null;
    resendLeft = 0;
  }

  function startResendTimer() {
    stopResendTimer();
    resendLeft = RESEND_SECONDS;
    resendTimer = setInterval(() => {
      resendLeft -= 1;
      if (resendLeft <= 0) stopResendTimer();
      syncLoginUi();
    }, 1000);
    syncLoginUi();
  }

  function showOtpPhase(show) {
    otpSent = show;
    $('ec-otp-field').hidden = !show;
    const phoneField = $('ec-phone-field');
    if (phoneField) phoneField.hidden = show; // phone goes out of focus on the OTP step
    const consentRow = $('ec-consent-row');
    if (consentRow) consentRow.hidden = show;
    const otpNote = $('ec-otp-note');
    if (otpNote) otpNote.hidden = !show;
    const heading = $('ec-login-heading');
    const hint = $('ec-login-hint');
    const phone = $('ec-login-phone')?.value?.trim() || '';
    if (show) {
      if (heading) heading.textContent = 'Verify OTP';
      if (hint) {
        const masked =
          phone.length === 10 ? `+91 ${phone.slice(0, 2)}XXXXXX${phone.slice(-2)}` : '+91';
        hint.innerHTML = `We sent a 4-digit code to <span class="ec-otp-phone-wrapper"><strong class="ec-otp-phone-display">${masked}</strong><button type="button" class="ec-phone-edit-icon" id="ec-phone-edit" title="Change number" aria-label="Change number"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button></span>`;
      }
      syncLoginUi();
      otpInputs()[0]?.focus();
    } else {
      clearOtp();
      stopResendTimer();
      loginBusy = null;
      const otpHint = $('ec-otp-hint');
      if (otpHint) otpHint.hidden = true;
      if (heading) heading.textContent = 'Login to continue';
      if (hint) {
        hint.textContent = 'Enter your mobile number to continue checkout and unlock COD/offers.';
      }
      syncLoginUi();
      $('ec-login-phone')?.focus();
    }
  }

  function lineUnitMinor(line) {
    return line?.unitAmount?.amountMinor || 0;
  }

  function lineHasDeal(line) {
    const unit = lineUnitMinor(line);
    return typeof line.compareAtAmountMinor === 'number' && line.compareAtAmountMinor > unit;
  }

  function renderLines(lines) {
    const root = $('ec-lines');
    if (!root) return;
    root.replaceChildren();

    const totalCouponDisc =
      currentSession?.coupon?.discountMinor ||
      (appliedCouponCode ? currentSession?.totals?.discountMinor || 0 : 0);
    const totalLinesCount = (lines || []).length;
    const couponCode = currentSession?.coupon?.code || appliedCouponCode || '';

    for (const line of lines || []) {
      const row = document.createElement('article');
      row.className = 'ec-line';

      const thumb = document.createElement('div');
      thumb.className = 'ec-thumb';
      if (line.imageUrl) {
        const img = document.createElement('img');
        img.src = line.imageUrl;
        img.alt = line.title || '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'ec-thumb-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        thumb.appendChild(fallback);
      }

      const meta = document.createElement('div');
      meta.className = 'ec-line-meta';

      const head = document.createElement('div');
      head.className = 'ec-line-head';
      const title = document.createElement('strong');
      title.className = 'ec-line-title';
      title.textContent = line.title || 'Item';
      head.appendChild(title);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ec-line-delete';
      delBtn.setAttribute('aria-label', 'Remove item');
      if (line.variantId) delBtn.dataset.ecVariantId = String(line.variantId);
      if (line.lineKey) delBtn.dataset.ecLineKey = String(line.lineKey);
      delBtn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      if (totalLinesCount <= 1) {
        delBtn.disabled = true;
      }
      head.appendChild(delBtn);
      meta.appendChild(head);

      if (line.variantTitle && line.variantTitle !== 'Default Title') {
        const variant = document.createElement('div');
        variant.className = 'ec-line-variant';
        variant.textContent = line.variantTitle.replace(/\s*\/\s*/g, ' · ');
        meta.appendChild(variant);
      }

      const qty = line.quantity || 1;
      const unit = lineUnitMinor(line);
      const todayOfferTotal = unit * qty;

      const hasCompare =
        typeof line.compareAtAmountMinor === 'number' && line.compareAtAmountMinor > unit;
      const mrpTotal = (hasCompare ? line.compareAtAmountMinor : unit) * qty;

      let lineExtraDisc =
        typeof line.lineDiscountMinor === 'number' && line.lineDiscountMinor > 0
          ? line.lineDiscountMinor
          : 0;
      if (!lineExtraDisc && totalCouponDisc > 0) {
        if (totalLinesCount === 1) {
          lineExtraDisc = totalCouponDisc;
        } else {
          const totalSub = (lines || []).reduce(
            (s, l) => s + lineUnitMinor(l) * (l.quantity || 1),
            0,
          );
          lineExtraDisc =
            totalSub > 0 ? Math.round((todayOfferTotal / totalSub) * totalCouponDisc) : 0;
        }
      }

      const pricingRow = document.createElement('div');
      pricingRow.className = 'ec-line-pricing';

      if (hasCompare && mrpTotal > todayOfferTotal) {
        const mrpStrike = document.createElement('span');
        mrpStrike.className = 'ec-mrp-strike';
        mrpStrike.textContent = formatInr(mrpTotal);
        pricingRow.appendChild(mrpStrike);

        const pct = Math.max(1, Math.round(((mrpTotal - todayOfferTotal) / mrpTotal) * 100));
        const pctSpan = document.createElement('span');
        pctSpan.className = 'ec-mrp-pct';
        pctSpan.textContent = `(${pct}% OFF)`;
        pricingRow.appendChild(pctSpan);
      }

      const offerWrap = document.createElement('span');
      offerWrap.className = 'ec-offer-wrap';
      const offerPrice = document.createElement('strong');
      offerPrice.className = 'ec-offer-price';
      offerPrice.textContent = formatInr(todayOfferTotal);
      offerWrap.appendChild(offerPrice);
      pricingRow.appendChild(offerWrap);

      meta.appendChild(pricingRow);

      if (lineExtraDisc > 0) {
        const couponTag = document.createElement('div');
        couponTag.className = 'ec-line-coupon-tag';
        const withCode = couponCode ? ` with ${couponCode}` : '';
        couponTag.innerHTML = `<span class="ec-ticket-icon" aria-hidden="true">🎟️</span><span>EXTRA ${formatInr(lineExtraDisc)} OFF${withCode}</span>`;
        meta.appendChild(couponTag);
      }

      const foot = document.createElement('div');
      foot.className = 'ec-line-foot';

      const stepper = document.createElement('div');
      stepper.className = 'ec-qty-stepper';
      const dec = document.createElement('button');
      dec.type = 'button';
      dec.className = 'ec-qty-btn';
      dec.dataset.ecQtyDelta = '-1';
      if (line.variantId) dec.dataset.ecVariantId = String(line.variantId);
      if (line.lineKey) dec.dataset.ecLineKey = String(line.lineKey);
      dec.setAttribute('aria-label', 'Decrease quantity');
      dec.textContent = '−';

      const qtySpan = document.createElement('span');
      qtySpan.className = 'ec-qty-value';
      qtySpan.textContent = String(qty);

      const inc = document.createElement('button');
      inc.type = 'button';
      inc.className = 'ec-qty-btn';
      inc.dataset.ecQtyDelta = '1';
      if (line.variantId) inc.dataset.ecVariantId = String(line.variantId);
      if (line.lineKey) inc.dataset.ecLineKey = String(line.lineKey);
      inc.setAttribute('aria-label', 'Increase quantity');
      inc.textContent = '+';

      if (!line.variantId && !line.lineKey) {
        dec.disabled = true;
        inc.disabled = true;
      }
      if (qty <= 1 && totalLinesCount <= 1) {
        dec.disabled = true;
      }
      stepper.append(dec, qtySpan, inc);
      foot.appendChild(stepper);

      const finalPriceCol = document.createElement('div');
      finalPriceCol.className = 'ec-line-final-price';
      const finalLbl = document.createElement('span');
      finalLbl.className = 'ec-final-label';
      finalLbl.textContent = 'Final Price';

      const finalAmount = Math.max(0, todayOfferTotal - lineExtraDisc);
      const finalAmt = document.createElement('strong');
      finalAmt.className = 'ec-final-amount';
      finalAmt.textContent = formatInr(finalAmount);

      finalPriceCol.append(finalLbl, finalAmt);
      foot.appendChild(finalPriceCol);

      meta.appendChild(foot);
      row.append(thumb, meta);
      root.appendChild(row);
    }

    requestAnimationFrame(() => {
      const card = root.querySelector('.ec-line');
      const cssVersion = card
        ? getComputedStyle(card).getPropertyValue('--ec-card-ui-version').trim()
        : '';
      console.info('[Easy Checkout] item-card sync', {
        scriptVersion: CARD_UI_VERSION,
        cssVersion: cssVersion || (card ? 'missing / old CSS' : 'no items to check'),
        cssSynced: card ? cssVersion === CARD_UI_VERSION : null,
        cardDisplay: card ? getComputedStyle(card).display : null,
      });
    });
  }

  async function changeLineQuantity(variantId, lineKey, delta) {
    if (cartBusy || !delta) return;
    const match = sessionLines.find(
      (line) =>
        (lineKey && line.lineKey === lineKey) ||
        (variantId && String(line.variantId) === String(variantId)) ||
        (variantId &&
          line.variantId &&
          String(line.variantId).replace(/\D/g, '') === String(variantId).replace(/\D/g, '')),
    );
    if (!match) return;
    // Last remaining unit in the bag — ignore minus (no loading / no cart call).
    if (delta < 0 && (match.quantity || 1) <= 1 && sessionLines.length === 1) {
      return;
    }
    const nextQty = Math.max(0, Math.min(99, (match.quantity || 1) + delta));
    setCartBusy(true);
    const text = $('ec-loading-text');
    const sub = $('ec-loading-sub');
    if (text) text.textContent = nextQty === 0 ? 'Removing item…' : 'Updating quantity…';
    if (sub) sub.textContent = 'Refreshing your bag — please wait';
    try {
      showErr('ec-error', '');

      // 1. Buy Now session: update directly via patchSession.
      // Buy Now lines do not exist in Shopify's /cart.js cookie, so /cart/change.js cannot be used.
      if (sessionSource === 'buy_now') {
        const patchRes = await patchSession({
          lineQuantity: {
            variantId: variantId
              ? String(variantId)
              : match.variantId
                ? String(match.variantId)
                : undefined,
            lineKey: lineKey || match.lineKey || undefined,
            quantity: nextQty,
          },
        });
        if (!patchRes?.lines?.length) {
          showErr('ec-error', 'Your bag is empty. Add items to continue checkout.');
          applySession({ ...patchRes, lines: [], totals: patchRes.totals });
          return;
        }
        applySession(patchRes);
        collapseSummary(true);
        return;
      }

      // 2. Standard cart session:
      // Shopify /cart/change.js requires id to be an integer variant ID (\A\d+\z) or line key (\A\d+:[a-f0-9]{32}\z).
      const rawLineKey = String(lineKey || match.lineKey || '').trim();
      const is32HexLineKey = /^\d+:[a-f0-9]{32}$/i.test(rawLineKey);

      const rawVariantId = String(variantId || match.variantId || '').replace(/\D/g, '');
      const isNumericVariant = /^\d+$/.test(rawVariantId);

      let cartItemId = null;
      if (is32HexLineKey) {
        cartItemId = rawLineKey;
      } else if (isNumericVariant) {
        cartItemId = Number(rawVariantId);
      }

      let cartChangeSucceeded = false;
      if (cartItemId != null) {
        try {
          const payload = { id: cartItemId, quantity: nextQty };
          const changeRes = await fetch('/cart/change.js', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
          });
          if (changeRes.ok) {
            cartChangeSucceeded = true;
          } else {
            console.warn('[EasyCheckout] /cart/change.js returned status:', changeRes.status);
          }
        } catch (e) {
          console.warn('[EasyCheckout] /cart/change.js fetch failed:', e);
        }
      }

      let session = null;
      if (
        cartChangeSucceeded &&
        typeof window.EasyCheckout?.refreshSessionFromCart === 'function'
      ) {
        try {
          session = await window.EasyCheckout.refreshSessionFromCart();
        } catch (e) {
          console.warn(
            '[EasyCheckout] refreshSessionFromCart failed, falling back to patchSession:',
            e,
          );
        }
      }

      // If /cart/change.js was skipped, failed, or refreshSessionFromCart failed, update session directly via patchSession
      if (!session) {
        session = await patchSession({
          lineQuantity: {
            variantId: isNumericVariant
              ? rawVariantId
              : match.variantId
                ? String(match.variantId)
                : undefined,
            lineKey: is32HexLineKey ? rawLineKey : match.lineKey || undefined,
            quantity: nextQty,
          },
        });
      }

      if (!session?.lines?.length) {
        showErr('ec-error', 'Your bag is empty. Add items to continue checkout.');
        applySession({ ...session, lines: [], totals: session.totals });
        return;
      }
      applySession(session);
      collapseSummary(true);
    } catch (error) {
      console.error('[EasyCheckout] qty change', error);
      showErr('ec-error', error?.message || 'Could not update quantity.');
    } finally {
      setCartBusy(false);
    }
  }

  function payAmountForMethod(el, baseMinor) {
    const discountPct = Number(el.getAttribute('data-ec-pay-discount-pct') || 0);
    const surchargePct = Number(el.getAttribute('data-ec-pay-surcharge-pct') || 0);
    if (discountPct > 0) {
      return Math.max(0, Math.round(baseMinor * (1 - discountPct / 100)));
    }
    if (surchargePct > 0) {
      return Math.round(baseMinor * (1 + surchargePct / 100));
    }
    return baseMinor;
  }

  function refreshPaymentAmounts() {
    const rows = document.querySelectorAll('[data-ec-pay]');
    for (const row of rows) {
      const amountEl = row.querySelector('[data-ec-pay-amount]');
      if (!amountEl) continue;
      amountEl.textContent = formatInr(payAmountForMethod(row, basePayMinor));
    }
    updatePayableDisplay();
  }

  let updatingPayable = false;
  function updatePayableDisplay() {
    if (updatingPayable) return;
    updatingPayable = true;
    try {
      const selected = document.querySelector(`[data-ec-pay="${selectedPay}"]`);
      const payable = selected ? payAmountForMethod(selected, basePayMinor) : basePayMinor;
      $('ec-total-header').textContent = formatInr(payable);
      $('ec-total').textContent = formatInr(payable);
      $('ec-total-mobile').textContent = formatInr(payable);
      if (currentSession && sessionLines.length) {
        applyTotals(currentSession.totals, sessionLines);
      }
    } finally {
      updatingPayable = false;
    }
  }

  function hidePaySheet() {
    const overlay = $('ec-pay-overlay');
    if (overlay) overlay.hidden = true;
  }

  function showPaySheet(title, bodyHtml, confirmLabel) {
    $('ec-pay-sheet-title').textContent = title;
    $('ec-pay-sheet-body').innerHTML = bodyHtml;
    $('ec-pay-sheet-confirm').textContent = confirmLabel || 'Confirm & place';
    $('ec-pay-overlay').hidden = false;
  }

  function openPaymentDetailsOrConfirm() {
    const payableEl = document.querySelector(`[data-ec-pay="${selectedPay}"]`);
    const amount = formatInr(
      payableEl ? payAmountForMethod(payableEl, basePayMinor) : basePayMinor,
    );
    if (selectedPay === 'cod') {
      showPaySheet(
        'Confirm COD order',
        `<p class="ec-sub">You will pay <strong>${amount}</strong> when the order arrives.</p><p class="ec-sub">Deliver to <strong>${shopper?.address?.fullName || ''}</strong>.</p>`,
        'Yes, place COD order',
      );
      return;
    }
    if (selectedPay === 'card') {
      showPaySheet(
        'Card details',
        `<div class="ec-field"><label>Name on card</label><input id="ec-card-name" autocomplete="cc-name" placeholder="Name" /></div>
         <div class="ec-field"><label>Card number</label><input id="ec-card-number" inputmode="numeric" autocomplete="cc-number" placeholder="XXXX XXXX XXXX XXXX" maxlength="19" /></div>
         <div class="ec-grid-2">
           <div class="ec-field"><label>Expiry</label><input id="ec-card-exp" placeholder="MM/YY" maxlength="5" /></div>
           <div class="ec-field"><label>CVV</label><input id="ec-card-cvv" inputmode="numeric" maxlength="4" placeholder="***" /></div>
         </div>
         <p class="ec-hint">Demo only — card is not charged.</p>`,
        `Pay ${amount}`,
      );
      return;
    }
    if (selectedPay === 'upi') {
      const isMobile = window.innerWidth <= 640;
      if (!isMobile) {
        const realEl = $('ec-upi-qr-real');
        if (realEl && realEl.hidden) {
          handleShowUpiQr();
        }
        $('ec-upi-qr-box')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        const upiCard = document.querySelector('.ec-pay-upi-card');
        if (upiCard) {
          upiCard.classList.remove('is-collapsed');
          upiCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        const selectedAppBtn = document.querySelector('.ec-upi-app-card.is-selected');
        const appId = selectedAppBtn?.getAttribute('data-ec-upi-app') || 'paytm';
        launchUpiApp(appId);
      }
      return;
    }
    if (selectedPay === 'netbanking') {
      const banks = ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak'];
      showPaySheet(
        'Net banking',
        `<p class="ec-sub">Select your bank · payable <strong>${amount}</strong></p>
         <div class="ec-bank-list" id="ec-bank-list">${banks
           .map(
             (bank, i) =>
               `<button type="button" class="ec-bank-option${i === 0 ? ' is-selected' : ''}" data-ec-bank="${bank}">${bank}</button>`,
           )
           .join('')}</div>
         <p class="ec-hint">Demo only — no bank redirect yet.</p>`,
        `Continue to bank`,
      );
    }
  }

  async function beginPlaceOrder() {
    if (cartBusy) {
      showErr('ec-error', 'Please wait — we are still adding an item to your bag.');
      return;
    }
    if (addressFocus) {
      showErr('ec-error', 'Finish choosing your delivery address to place the order.');
      $('ec-address-picker')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      $('ec-address-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    // Non-COD always opens method details first. COD confirm is gated by flag.
    if (selectedPay !== 'cod' || requireCodConfirmation) {
      openPaymentDetailsOrConfirm();
      return;
    }
    await placeOrder();
  }

  function setCompareDisplay(compareMinor, payMinor) {
    const show = compareMinor > payMinor;
    for (const id of ['ec-header-compare', 'ec-mobile-compare']) {
      const el = $(id);
      if (!el) continue;
      el.hidden = !show;
      el.textContent = show ? formatInr(compareMinor) : '';
    }
  }

  function syncFreeShippingBadge(shippingMinor) {
    const free = !(Number(shippingMinor) > 0);
    for (const id of ['ec-ship-free-badge', 'ec-ship-free-badge-address']) {
      const el = $(id);
      if (el) el.hidden = !free;
    }
  }

  function applyTotals(totals, lines) {
    const subtotal = totals?.subtotalMinor ?? 0;
    const discount = totals?.discountMinor ?? 0;
    const shipping = totals?.shippingMinor ?? 0;
    const amount = totals?.amountMinor ?? Math.max(0, subtotal - discount + shipping);
    basePayMinor = amount;
    const count = (lines || []).reduce((sum, line) => sum + (line.quantity || 0), 0);
    $('ec-item-count').textContent = `${count} item${count === 1 ? '' : 's'}`;

    let mrpMinor = 0;
    for (const line of lines || []) {
      const unit = lineUnitMinor(line);
      const qty = line.quantity || 1;
      const compare =
        typeof line.compareAtAmountMinor === 'number' && line.compareAtAmountMinor > unit
          ? line.compareAtAmountMinor
          : line.lineDiscountMinor > 0
            ? unit + Math.round(line.lineDiscountMinor / qty)
            : unit;
      mrpMinor += compare * qty;
    }
    const mrpDiscount = Math.max(0, mrpMinor - subtotal);
    const showMrp = mrpMinor > subtotal;
    const mrpRow = $('ec-mrp-row');
    const mrpEl = $('ec-mrp');
    const subtotalRow = $('ec-subtotal-row');
    if (mrpRow) mrpRow.hidden = !showMrp;
    if (mrpEl && showMrp) mrpEl.textContent = formatInr(mrpMinor);
    const mrpDiscRow = $('ec-mrp-discount-row');
    const mrpDiscEl = $('ec-mrp-discount');
    if (mrpDiscRow) mrpDiscRow.hidden = mrpDiscount <= 0;
    if (mrpDiscEl && mrpDiscount > 0) {
      mrpDiscEl.textContent = `−${formatInr(mrpDiscount)}`;
      mrpDiscEl.classList.add('ec-green');
    }

    if (subtotalRow) subtotalRow.hidden = showMrp;
    $('ec-subtotal').textContent = formatInr(subtotal);

    // Discount bifurcation
    const discountRow = $('ec-discount-row');
    const discountLabel = $('ec-discount-label');
    const discEl = $('ec-discount');
    const breakdownEl = $('ec-discount-breakdown');

    const breakdown = [];
    const couponDisc = currentSession?.coupon?.discountMinor || (appliedCouponCode ? discount : 0);
    const couponCode = currentSession?.coupon?.code || appliedCouponCode;

    let productDiscountsTotal = 0;
    for (const l of lines || []) {
      if (typeof l.lineDiscountMinor === 'number' && l.lineDiscountMinor > 0) {
        productDiscountsTotal += l.lineDiscountMinor;
      }
    }

    const coupons = currentSession?.coupons?.length
      ? currentSession.coupons
      : couponCode
        ? [{ code: couponCode, discountMinor: couponDisc }]
        : [];
    for (const coupon of coupons) {
      let label = coupon.code;
      if (label.startsWith('GIFT:')) label = `Gift voucher (${label.slice(5)})`;
      else if (label === 'LOYALTY') label = 'Tezvix Points';
      breakdown.push({
        label,
        amount: coupon.discountMinor || 0,
        freeShipping: coupon.kind === 'free_shipping',
      });
    }

    if (productDiscountsTotal > 0 && productDiscountsTotal !== couponDisc) {
      breakdown.push({ label: 'Product Discount', amount: productDiscountsTotal });
    }

    // Check payment method discount if active
    const selectedPay = document.querySelector(
      '.ec-pay-row.is-selected, .ec-pay-upi-card.is-selected',
    );
    if (selectedPay && selectedPay.getAttribute('data-ec-pay') === 'upi') {
      const upiBadgeText =
        currentUpiConfig?.discountBadge ||
        $('ec-upi-desk-discount-badge')?.textContent ||
        $('ec-upi-mob-discount-badge')?.textContent ||
        '';
      const match = upiBadgeText.match(/\d+/);
      if (match) {
        const upiValMinor = parseInt(match[0], 10) * 100;
        if (upiValMinor > 0) {
          breakdown.push({ label: 'Prepaid Discount', amount: upiValMinor });
        }
      }
    }

    const totalDiscMinor =
      breakdown.length > 0 ? breakdown.reduce((s, b) => s + b.amount, 0) : discount;

    if (totalDiscMinor > 0 || coupons.some((coupon) => coupon.kind === 'free_shipping')) {
      if (discountRow) discountRow.hidden = false;
      if (discEl) {
        discEl.textContent = totalDiscMinor > 0 ? `−${formatInr(totalDiscMinor)}` : 'Free shipping';
        discEl.classList.add('ec-green');
      }

      if (discountLabel) {
        discountLabel.innerHTML =
          'Coupons & discounts <span class="ec-caret" aria-hidden="true">▾</span>';
        discountLabel.setAttribute('aria-expanded', 'false');
        discountLabel.disabled = breakdown.length === 0;
      }
      if (breakdownEl) {
        breakdownEl.hidden = true;
        const items = $('ec-discount-items');
        if (items)
          items.innerHTML = breakdown
            .map(
              (item) =>
                `<div class="ec-discount-subrow"><dt>${escHtml(item.label)}</dt><dd>${item.freeShipping ? 'Free shipping' : `−${formatInr(item.amount)}`}</dd></div>`,
            )
            .join('');
      }
    } else {
      if (discountRow) discountRow.hidden = true;
      if (breakdownEl) breakdownEl.hidden = true;
      $('ec-discount-items')?.replaceChildren();
      discountLabel?.setAttribute('aria-expanded', 'false');
    }

    $('ec-shipping').textContent = shipping > 0 ? formatInr(shipping) : 'FREE';
    syncFreeShippingBadge(shipping);

    const finalAmount = Math.max(0, subtotal - totalDiscMinor + shipping);
    basePayMinor = finalAmount;
    $('ec-total').textContent = formatInr(finalAmount);
    $('ec-total-header').textContent = formatInr(finalAmount);
    $('ec-total-mobile').textContent = formatInr(finalAmount);

    const totalSaved = mrpDiscount + totalDiscMinor;
    const savePill = $('ec-save-pill');
    const saveText = $('ec-save-pill-text');
    if (totalSaved > 0) {
      if (savePill) savePill.hidden = false;
      if (saveText) saveText.textContent = `You're saving ${formatInr(totalSaved)}`;
    } else if (savePill) {
      savePill.hidden = true;
    }
    const payLabel = $('ec-header-pay-label');
    if (payLabel) {
      payLabel.textContent = totalSaved > 0 ? 'Total Savings' : 'Total Payable';
    }
    const compareMinor =
      mrpMinor > finalAmount
        ? mrpMinor
        : totalDiscMinor > 0
          ? finalAmount + totalDiscMinor
          : subtotal > finalAmount
            ? subtotal
            : 0;
    setCompareDisplay(compareMinor, finalAmount);
    refreshPaymentAmounts();
  }

  function paintUpsellRail(items) {
    const rail = $('ec-upsell-rail');
    if (!rail) return;
    rail.replaceChildren();
    upsellItems = items;
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'ec-hint';
      empty.textContent = 'No more products to suggest right now.';
      rail.appendChild(empty);
      return;
    }
    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'ec-upsell-card';
      card.setAttribute('role', 'listitem');
      const thumb = document.createElement('div');
      thumb.className = 'ec-upsell-thumb';
      if (item.imageUrl) {
        const img = document.createElement('img');
        img.src = item.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }
      const title = document.createElement('strong');
      title.textContent = item.title;
      const price = document.createElement('div');
      price.className = 'ec-upsell-price';
      price.textContent = formatInr(item.priceMinor);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'ec-upsell-add';
      add.dataset.ecUpsellAdd = item.variantId;
      add.textContent = 'Add';
      card.append(thumb, title, price, add);
      rail.appendChild(card);
    }
  }

  function isVariantPurchasable(variant) {
    if (!variant?.id) return false;
    // Strict: only offer variants Shopify marks available. Never fall back to sold-out.
    if (variant.available === true) return true;
    if (variant.available === false) return false;
    if (typeof variant.inventory_quantity === 'number') {
      if (variant.inventory_quantity > 0) return true;
      return variant.inventory_policy === 'continue';
    }
    return false;
  }

  async function loadStoreUpsells(sessionLines) {
    syncUpsellVisibility();
    if (!showUpsell) {
      upsellItems = [];
      const rail = $('ec-upsell-rail');
      if (rail) rail.replaceChildren();
      return;
    }
    const inCart = new Set(
      (sessionLines || []).map((line) => String(line.variantId || '')).filter(Boolean),
    );
    try {
      const response = await fetch('/products.json?limit=50', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('products_failed');
      const body = await response.json();
      const items = [];
      for (const product of body.products || []) {
        if (product.available === false) continue;
        const variant = (product.variants || []).find(isVariantPurchasable);
        if (!variant) continue;
        const variantId = String(variant.id);
        if (inCart.has(variantId)) continue;
        const priceMajor = Number(variant.price);
        items.push({
          variantId,
          productId: String(product.id),
          title: product.title || 'Product',
          priceMinor: Number.isFinite(priceMajor) ? Math.round(priceMajor * 100) : 0,
          imageUrl: product.images?.[0]?.src || product.image?.src || '',
        });
        if (items.length >= 8) break;
      }
      paintUpsellRail(items);
    } catch (error) {
      console.warn('[EasyCheckout] upsell products', error);
      paintUpsellRail([]);
    }
  }

  function setCartBusy(on) {
    cartBusy = !!on;
    const overlay = $('ec-loading');
    if (!overlay) return;
    if (on) {
      if (loadingTimer) {
        window.clearInterval(loadingTimer);
        loadingTimer = null;
      }
      overlay.hidden = false;
      overlay.setAttribute('aria-busy', 'true');
      const text = $('ec-loading-text');
      const sub = $('ec-loading-sub');
      const stage = $('ec-loading-stage');
      if (text) {
        text.style.opacity = '1';
        text.textContent = 'Adding to your bag…';
      }
      if (sub) sub.textContent = 'Please wait — do not place the order yet';
      if (stage) stage.setAttribute('data-ec-anim', 'bags');
    } else {
      overlay.hidden = true;
      overlay.setAttribute('aria-busy', 'false');
    }
  }

  function linesToSessionPayload(lines) {
    return (lines || []).map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      lineKey: line.lineKey,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle || '',
      quantity: line.quantity || 1,
      amountMinor: line.unitAmount?.amountMinor ?? line.amountMinor ?? 0,
      imageUrl: line.imageUrl,
      compareAtAmountMinor: line.compareAtAmountMinor,
      lineDiscountMinor: line.lineDiscountMinor,
    }));
  }

  /** Re-add session lines missing from Shopify cart (cart checkout desync). */
  async function ensureSessionLinesInCart() {
    const needed = (sessionLines || []).filter((line) => line.variantId);
    if (!needed.length) return;
    const cart = await fetch('/cart.js', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).then((r) => r.json());
    const have = new Map();
    for (const item of cart.items || []) {
      const id = String(item.variant_id);
      have.set(id, (have.get(id) || 0) + (item.quantity || 0));
    }
    const toAdd = [];
    for (const line of needed) {
      const id = String(line.variantId);
      const want = line.quantity || 1;
      const current = have.get(id) || 0;
      if (current < want) toAdd.push({ id: Number(id), quantity: want - current });
    }
    if (!toAdd.length) return;
    const addRes = await fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ items: toAdd }),
    });
    if (!addRes.ok) {
      const err = await addRes.json().catch(() => null);
      throw new Error(err?.description || err?.message || 'Could not sync your bag');
    }
  }

  async function createSessionFromLines(source, lines, discountMinor) {
    const response = await fetch(`${apiBase}/v1/sessions`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        source,
        discountMinor: discountMinor || 0,
        lines: linesToSessionPayload(lines),
      }),
    });
    const session = await response.json().catch(() => null);
    if (!response.ok) throw new Error(session?.error?.message || 'session_failed');
    return session;
  }

  async function addUpsellToCart(variantId, button) {
    if (!variantId || cartBusy) return;
    if (button) {
      button.disabled = true;
      button.textContent = 'Adding…';
    }
    setCartBusy(true);
    try {
      let session;

      if (sessionSource === 'buy_now') {
        // Buy now lines are not in the Shopify cart. Refreshing from cart would
        // drop the original item and leave only the upsell — merge into session instead.
        const upsell = upsellItems.find((item) => String(item.variantId) === String(variantId));
        if (!upsell) throw new Error('Could not add product.');
        const merged = sessionLines.map((line) => ({ ...line }));
        const existing = merged.find((line) => String(line.variantId) === String(variantId));
        if (existing) {
          existing.quantity = (existing.quantity || 1) + 1;
        } else {
          merged.push({
            variantId: String(variantId),
            productId: upsell.productId,
            title: upsell.title || 'Product',
            variantTitle: '',
            quantity: 1,
            unitAmount: { currency: 'INR', amountMinor: upsell.priceMinor || 0 },
            imageUrl: upsell.imageUrl || '',
          });
        }
        session = await createSessionFromLines('buy_now', merged, 0);
      } else {
        // Cart checkout: keep existing bag lines, then append upsell and rebuild session from cart.
        await ensureSessionLinesInCart();
        const addRes = await fetch('/cart/add.js', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
        });
        if (!addRes.ok) {
          const err = await addRes.json().catch(() => null);
          const message = err?.description || err?.message || 'Could not add item';
          if (/sold out|unavailable|not available/i.test(message)) {
            upsellItems = upsellItems.filter(
              (item) => String(item.variantId) !== String(variantId),
            );
            paintUpsellRail(upsellItems);
          }
          throw new Error(message);
        }
        if (typeof window.EasyCheckout?.refreshSessionFromCart === 'function') {
          session = await window.EasyCheckout.refreshSessionFromCart();
        } else {
          throw new Error('Could not refresh checkout after adding item.');
        }
      }

      applySession(session);
      if (button) {
        button.textContent = 'Added';
        button.classList.add('is-added');
      }
    } catch (error) {
      console.error('[EasyCheckout] upsell add', error);
      showErr('ec-error', error?.message || 'Could not add product.');
      if (button) {
        button.disabled = false;
        button.textContent = 'Add';
      }
    } finally {
      setCartBusy(false);
    }
  }

  function showExitFeedback() {
    const overlay = $('ec-exit-overlay');
    if (!overlay) {
      window.EasyCheckout?.close();
      return;
    }
    overlay.hidden = false;
  }

  function hideExitFeedback() {
    const overlay = $('ec-exit-overlay');
    if (overlay) overlay.hidden = true;
  }

  function confirmLeaveCheckout() {
    const reason =
      document.querySelector('input[name="ec-exit-reason"]:checked')?.value || 'no_reason';
    const note = $('ec-exit-note')?.value?.trim() || '';
    if (!orderCompleted && activeSessionId) {
      trackCheckoutEvent('checkout_abandoned', {
        droppedAt: determineCurrentFunnelStep(),
        reason,
        note,
      });
    }
    console.info('[EasyCheckout] exit feedback', { reason, note });
    hideExitFeedback();
    window.EasyCheckout?.close();
  }

  let offersCache = null;
  let offersAutoApplied = false;
  let offersSheetMode = '';
  let sheetOfferCategory = 'store';
  let appliedCouponCode = '';
  let loyaltyAppliedPoints = 0;
  let giftVouchersEnabled = true;

  const SHEET_OFFER_TABS = [
    { id: 'store', label: 'Store offers', section: 'Store offers' },
    { id: 'payments', label: 'Payment offers', section: 'Payment offers' },
    { id: 'foryou', label: 'Only for you', section: 'Only for you' },
    { id: 'bank', label: 'Bank offers', section: 'Bank offers' },
  ];

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function couponCategory(coupon) {
    const hay = `${coupon?.code || ''} ${coupon?.summary || ''}`.toLowerCase();
    if (/\b(upi|card|wallet|paytm|gpay|phonepe|payment)\b/.test(hay)) return 'payments';
    if (/\b(hdfc|icici|axis|sbi|kotak|bank|emi|credit)\b/.test(hay)) return 'bank';
    if (/\b(referral|welcome|first|member|personal|foryou|for you)\b/.test(hay)) return 'foryou';
    return 'store';
  }

  function taggedOfferCoupons(coupons) {
    const all = Array.isArray(coupons) ? coupons : [];
    return all.map((c) => ({ ...c, category: c.category || couponCategory(c) }));
  }

  function currentCouponCode() {
    return appliedCouponCode || '';
  }

  function loyaltyData(loyalty) {
    if (loyalty && typeof loyalty.points === 'number') return loyalty;
    return {
      partnerName: 'Tezvix',
      points: 1250,
      redeemableMinor: 12500,
    };
  }

  function formatPoints(points) {
    const n = Math.max(0, Number(points) || 0);
    if (!Number.isFinite(n)) return '0';
    if (Number.isInteger(n)) return new Intl.NumberFormat('en-IN').format(n);
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
  }

  /** Decimals only when the available balance itself is fractional (e.g. 1.3 / 2.8). */
  function loyaltyAllowsFractional() {
    const max = Number(loyaltyData(offersCache?.loyalty).points || 0);
    return Number.isFinite(max) && max > 0 && !Number.isInteger(max);
  }

  function sanitizeLoyaltyPointsInput(value) {
    let next = String(value ?? '');
    if (loyaltyAllowsFractional()) {
      next = next.replace(/[^\d.]/g, '');
      const dot = next.indexOf('.');
      if (dot === -1) return next;
      return `${next.slice(0, dot + 1)}${next.slice(dot + 1).replace(/\D/g, '')}`;
    }
    return next.replace(/\D/g, '');
  }

  /** 10 points = ₹1.00 (100 minor). */
  function loyaltyWorthMinor(points) {
    const n = Number(points);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n / 10) * 100;
  }

  function syncLoyaltyInputWorth() {
    const input = $('ec-loyalty-points-input');
    const eq = $('ec-loyalty-input-worth');
    if (!eq) return;
    const points = Number(sanitizeLoyaltyPointsInput(input?.value || ''));
    const worth = loyaltyWorthMinor(points);
    if (!worth) {
      eq.hidden = true;
      eq.textContent = '';
      return;
    }
    eq.hidden = false;
    eq.textContent = `= ${formatInr(worth)}`;
  }

  function syncCouponApplyVisibility() {
    const input = $('ec-coupon-input');
    const applyBtn = $('ec-coupon-apply');
    if (!applyBtn) return;
    applyBtn.hidden = !(input && input.value.trim());
    applyBtn.disabled = false;
  }

  function setLoyaltyPresetActive(amount) {
    for (const btn of document.querySelectorAll('[data-ec-loyalty-preset]')) {
      const key = btn.getAttribute('data-ec-loyalty-preset');
      const max = loyaltyData(offersCache?.loyalty).points || 0;
      const matched = key === 'max' ? amount === max : Number(key) === amount;
      btn.classList.toggle('is-active', matched);
    }
  }

  function hideOffersSheet() {
    const overlay = $('ec-offers-overlay');
    if (overlay) overlay.hidden = true;
    const sheet = $('ec-offers-sheet');
    sheet?.classList.remove('ec-coupons-sheet');
    offersSheetMode = '';
  }

  function showOffersSheet(title, bodyHtml, confirmLabel) {
    const titleEl = $('ec-offers-sheet-title');
    if (titleEl) titleEl.textContent = title;
    $('ec-offers-sheet-body').innerHTML = bodyHtml;
    const confirm = $('ec-offers-sheet-confirm');
    if (confirm) {
      confirm.hidden = !confirmLabel;
      confirm.textContent = confirmLabel || 'Confirm';
    }
    const sheet = $('ec-offers-sheet');
    sheet?.classList.toggle('ec-coupons-sheet', offersSheetMode === 'coupons');
    $('ec-offers-overlay').hidden = false;
  }

  function paintTopCoupons() {
    // Coupons only appear in View all — not on the main Offers card.
  }

  function syncLoyaltyUi(loyalty) {
    const row = $('ec-loyalty-row');
    const applyBtn = $('ec-loyalty-open');
    const removeBtn = $('ec-loyalty-remove');
    const redeem = $('ec-loyalty-redeem');
    const partner = $('ec-loyalty-partner');
    const points = $('ec-loyalty-points');
    const value = $('ec-loyalty-value');
    const foot = $('ec-loyalty-foot');
    const input = $('ec-loyalty-points-input');
    const brandSub = document.querySelector('.ec-loyalty-brand small');
    if (!row) return;
    const data = loyaltyData(loyalty);
    const maxPts = data.points || 0;
    const applied = loyaltyAppliedPoints > 0;
    const balanceWorth = data.redeemableMinor || loyaltyWorthMinor(maxPts);
    const appliedWorth = loyaltyWorthMinor(loyaltyAppliedPoints);
    row.hidden = false;
    row.classList.toggle('is-applied', applied);
    if (partner) partner.textContent = data.partnerName || 'Tezvix';
    if (brandSub) {
      brandSub.textContent = applied
        ? `${formatPoints(loyaltyAppliedPoints)} points applied on this order`
        : 'Redeem loyalty points on this order';
    }
    if (points) {
      points.hidden = applied;
      points.textContent = `${formatPoints(maxPts)} points`;
    }
    if (value) {
      const worthLabel = applied
        ? `${formatInr(appliedWorth)} applied`
        : balanceWorth > 0
          ? `Worth ${formatInr(balanceWorth)}`
          : 'Worth ₹0';
      value.hidden = false;
      value.replaceChildren();
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('width', '11');
      icon.setAttribute('height', '11');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'currentColor');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML =
        '<ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v4c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/><path d="M5 12v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>';
      value.append(icon, document.createTextNode(` ${worthLabel}`));
    }
    if (foot) foot.hidden = true;
    if (redeem) redeem.hidden = applied;
    if (removeBtn) {
      removeBtn.hidden = !applied;
      removeBtn.disabled = false;
    }
    if (input) {
      input.inputMode = loyaltyAllowsFractional() ? 'decimal' : 'numeric';
      if (!applied) {
        const cleaned = sanitizeLoyaltyPointsInput(input.value);
        if (cleaned !== input.value) input.value = cleaned;
      }
      input.disabled = applied;
      syncLoyaltyInputWorth();
    }
    for (const btn of document.querySelectorAll('[data-ec-loyalty-preset]')) {
      btn.disabled = applied || maxPts < 10;
      btn.classList.remove('is-active');
    }
    if (applyBtn) {
      applyBtn.disabled = applied || maxPts < 10;
      applyBtn.textContent = 'Apply';
      applyBtn.classList.remove('is-remove');
    }
    checkLoyaltyRowSpace();
  }

  function checkLoyaltyRowSpace() {
    const row = document.querySelector('.ec-loyalty-redeem-row');
    if (!row) return;
    const isConstrained = row.clientWidth > 0 && row.clientWidth < 380;
    row.classList.toggle('is-compact', isConstrained);
  }

  function syncGiftUi(enabled) {
    giftVouchersEnabled = enabled !== false;
  }

  async function patchSession(body) {
    if (!activeSessionId) throw new Error('NO_SESSION');
    const response = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(activeSessionId)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(json?.error?.message || 'Request failed');
      err.code = json?.error?.code;
      throw err;
    }
    return json;
  }

  async function applyCouponCode(codeOverride, options = {}) {
    const keepSheet = !!options.keepSheet;
    const input = keepSheet ? $('ec-sheet-coupon-input') : $('ec-coupon-input');
    const applyBtn = keepSheet ? $('ec-sheet-coupon-apply') : $('ec-coupon-apply');
    const code = String(codeOverride || input?.value || '').trim();
    const mainErr = 'ec-coupon-error';
    const sheetErr = 'ec-sheet-coupon-error';
    showErr(mainErr, '');
    showErr(sheetErr, '');
    if (!code) {
      showErr(keepSheet ? sheetErr : mainErr, 'Enter a coupon code.');
      return;
    }
    if (applyBtn) applyBtn.disabled = true;
    try {
      const session = await patchSession({ couponCode: code });
      applySession(session);
      trackCheckoutEvent('discount_applied', {
        couponCode: code,
        discountMinor: session?.totals?.discountMinor,
      });
      showErr(mainErr, '');
      showErr(sheetErr, '');
      if (input && !codeOverride) input.value = '';
      syncCouponApplyVisibility();
      hideOffersSheet();
    } catch (error) {
      const msg = error?.message || 'Could not apply that coupon.';
      if (keepSheet || offersSheetMode === 'coupons') showErr(sheetErr, msg);
      else showErr(mainErr, msg);
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  async function fetchOffers(selectedCode) {
    if (!activeSessionId || !apiBase) return null;
    const response = await fetch(
      `${apiBase}/v1/sessions/${encodeURIComponent(activeSessionId)}/offers`,
      { credentials: 'same-origin', headers: { accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const body = await response.json();
    offersCache = body;
    syncLoyaltyUi(body.loyalty);
    syncGiftUi(body.giftVouchersEnabled !== false);
    return body;
  }

  async function loadOffersAndMaybeAutoApply(session) {
    syncLoyaltyUi(loyaltyData(null));
    syncGiftUi(true);
    try {
      const selected = session?.coupon?.code || '';
      const body = await fetchOffers(selected);
      if (!body) return;
      // Auto-apply the maximum-savings (recommended) coupon once per open.
      if (!offersAutoApplied && !selected && body.recommendedCode) {
        offersAutoApplied = true;
        await applyCouponCode(body.recommendedCode);
      }
    } catch {
      /* ignore — offers are optional; gift/loyalty still shown */
    }
  }

  function openCouponsSheet(selectedCode) {
    offersSheetMode = 'coupons';
    const selected = (currentSession?.coupons || []).map((c) => c.code.toUpperCase());
    if (!selected.length) selected.push((selectedCode || currentCouponCode()).toUpperCase());
    const tabMeta =
      SHEET_OFFER_TABS.find((t) => t.id === sheetOfferCategory) || SHEET_OFFER_TABS[0];
    const filtered = taggedOfferCoupons(offersCache?.coupons || []).filter(
      (c) => c.category === sheetOfferCategory,
    );
    const tabs = SHEET_OFFER_TABS.map(
      (t) =>
        `<button type="button" class="ec-sheet-tab${t.id === sheetOfferCategory ? ' is-active' : ''}" data-ec-sheet-cat="${t.id}" role="tab" aria-selected="${t.id === sheetOfferCategory ? 'true' : 'false'}">${escHtml(t.label)}</button>`,
    ).join('');
    const banner =
      sheetOfferCategory === 'payments'
        ? `<p class="ec-offer-banner">Save more with these offers — they work best with select payment methods.</p>`
        : '';
    const cards = filtered.length
      ? filtered
          .map((c) => {
            const applied = selected.includes(c.code.toUpperCase());
            const saveLine =
              c.discountMinor > 0 ? `Save ${formatInr(c.discountMinor)}` : c.summary || '';
            const hint = c.recommended
              ? `<p class="ec-coupon-card-hint">Best savings on this order</p>`
              : c.summary && c.discountMinor > 0
                ? `<p class="ec-coupon-card-hint is-muted">${escHtml(c.summary)}</p>`
                : '';
            return `<article class="ec-coupon-card${applied ? ' is-applied' : ''}${c.recommended ? ' is-best' : ''}">
              ${hint}
              <div class="ec-coupon-card-row">
                <span class="ec-coupon-card-icon" aria-hidden="true">%</span>
                <div class="ec-coupon-card-main">
                  <strong class="ec-coupon-saving">${escHtml(saveLine)}</strong>
                  <span class="ec-coupon-code-box">${escHtml(c.code)}</span>
                </div>
                <button type="button" class="ec-coupon-card-apply" data-ec-coupon-code="${escHtml(c.code)}" ${applied ? 'disabled' : ''}>${applied ? 'Applied' : 'Apply'}</button>
              </div>
            </article>`;
          })
          .join('')
      : `<p class="ec-sub ec-sheet-empty">No ${escHtml(tabMeta.label.toLowerCase())} right now.</p>`;

    showOffersSheet(
      'Coupons & Offers',
      `<div class="ec-coupons-sheet-inner">
        <p class="ec-coupon-intro">Choose an offer for your order. Eligible codes can be combined.</p>
        ${currentSession?.coupon ? `<div class="ec-coupon-applied-summary"><span>Applied: <strong>${escHtml(currentSession.coupon.code)}</strong></span><button type="button" id="ec-sheet-coupons-clear">Remove all</button></div>` : ''}
        <div class="ec-sheet-coupon-field">
          <input id="ec-sheet-coupon-input" type="text" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="Enter coupon code" aria-label="Coupon code" />
          <button type="button" class="ec-sheet-coupon-apply" id="ec-sheet-coupon-apply">Apply</button>
        </div>
        <p class="ec-error" id="ec-sheet-coupon-error" role="alert" hidden></p>
        <button type="button" class="ec-sheet-gv" id="ec-sheet-gift-open">
          Redeem your GV
          <span>Code + ${offersCache?.giftVoucherVerifyMode === 'otp' ? 'OTP' : 'PIN'} ›</span>
        </button>
        <div class="ec-sheet-tabs" role="tablist" aria-label="Offer types">${tabs}</div>
        <h3 class="ec-sheet-section-title">${escHtml(tabMeta.section)}</h3>
        ${banner}
        <div class="ec-coupon-card-list">${cards}</div>
      </div>`,
      '',
    );

    const titleEl = $('ec-offers-sheet-title');
    if (titleEl) {
      titleEl.innerHTML =
        '<span class="ec-coupons-title-icon" aria-hidden="true">%</span><span>Coupons &amp; Offers</span>';
    }
  }

  function openGiftSheet() {
    offersSheetMode = 'gift';
    const mode = offersCache?.giftVoucherVerifyMode === 'otp' ? 'otp' : 'pin';
    const verifyLabel = mode === 'otp' ? 'OTP' : 'PIN';
    const hint =
      mode === 'otp'
        ? 'Enter the OTP sent for this gift voucher.'
        : 'Enter the PIN for this gift voucher.';
    showOffersSheet(
      'Redeem gift voucher',
      `<div class="ec-field"><label for="ec-gift-code">Voucher code</label>
       <input id="ec-gift-code" type="text" maxlength="40" autocomplete="off" autocapitalize="characters" /></div>
       <div class="ec-field"><label for="ec-gift-pin">${verifyLabel}</label>
       <input id="ec-gift-pin" type="${mode === 'otp' ? 'text' : 'password'}" inputmode="numeric" maxlength="6" autocomplete="${mode === 'otp' ? 'one-time-code' : 'off'}" /></div>
       <p class="ec-hint">${hint}</p>
       <p class="ec-error" id="ec-gift-error" hidden></p>`,
      'Apply gift voucher',
    );
  }

  async function confirmLoyaltyRedeem() {
    const loyalty = loyaltyData(offersCache?.loyalty);
    const input = $('ec-loyalty-points-input');
    const raw = sanitizeLoyaltyPointsInput(input?.value || '');
    if (input) input.value = raw;
    const points = Number(raw);
    const applyBtn = $('ec-loyalty-open');
    const maxPts = loyalty.points || 0;
    showErr('ec-loyalty-inline-error', '');
    if (!raw || !Number.isFinite(points) || points <= 0) {
      showErr('ec-loyalty-inline-error', 'Enter points to redeem.');
      return;
    }
    if (!loyaltyAllowsFractional() && !Number.isInteger(points)) {
      showErr('ec-loyalty-inline-error', 'Whole points only.');
      return;
    }
    if (points < 10 && maxPts >= 10) {
      showErr('ec-loyalty-inline-error', 'Enter at least 10 points.');
      return;
    }
    if (points > maxPts) {
      showErr('ec-loyalty-inline-error', 'Not enough points.');
      return;
    }
    if (applyBtn) applyBtn.disabled = true;
    try {
      // ponytail: session discount until loyalty partner API is wired.
      const session = await patchSession({ loyaltyRedeemPoints: points });
      loyaltyAppliedPoints = points;
      applySession(session);
      syncLoyaltyUi(loyalty);
      window.alert('Points applied');
    } catch (error) {
      showErr('ec-loyalty-inline-error', error?.message || 'Could not apply points.');
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  async function removeLoyaltyRedeem() {
    const removeBtn = $('ec-loyalty-remove');
    showErr('ec-loyalty-inline-error', '');
    if (removeBtn) removeBtn.disabled = true;
    try {
      const session = await patchSession({ couponCode: '' });
      loyaltyAppliedPoints = 0;
      applySession(session);
      const input = $('ec-loyalty-points-input');
      if (input) input.value = '';
      syncLoyaltyUi(offersCache?.loyalty);
    } catch (error) {
      showErr('ec-loyalty-inline-error', error?.message || 'Could not remove points.');
      if (removeBtn) removeBtn.disabled = false;
    }
  }

  async function confirmOffersSheet() {
    if (offersSheetMode === 'gift') {
      const code = $('ec-gift-code')?.value?.trim() || '';
      const pin = $('ec-gift-pin')?.value?.trim() || '';
      showErr('ec-gift-error', '');
      try {
        const session = await patchSession({ giftVoucher: { code, pin } });
        applySession(session);
        hideOffersSheet();
      } catch (error) {
        showErr('ec-gift-error', error?.message || 'Could not apply gift voucher.');
      }
    }
  }

  function applySession(session) {
    currentSession = session;
    activeSessionId = session.sessionId;
    const sessionField = $('ec-sessionId');
    if (sessionField) sessionField.value = session.sessionId;
    sessionSource = session.source === 'buy_now' ? 'buy_now' : 'cart';
    sessionLines = Array.isArray(session.lines) ? session.lines : [];

    // Fallback: If single line lacks compareAtAmountMinor or variantTitle, check page DOM and product JSON
    if (sessionLines.length === 1) {
      const line = sessionLines[0];
      const unit = lineUnitMinor(line);
      if (!line.compareAtAmountMinor || line.compareAtAmountMinor <= unit) {
        const compEls = document.querySelectorAll(
          '.price--on-sale .price__sale .price-item--regular, .price--on-sale s.price-item--regular, s.price-item--regular, .price__sale s, .price-item--regular, [data-compare-at-price], .price--compare, s.money, del.price-item--regular, [data-compare-price]',
        );
        for (const el of compEls) {
          const parsed = parsePriceMajor(el.textContent);
          if (parsed > 0 && Math.round(parsed * 100) > unit) {
            line.compareAtAmountMinor = Math.round(parsed * 100);
            break;
          }
        }
      }
      if (!line.variantTitle || line.variantTitle === 'Default Title') {
        const checkedOpts = Array.from(
          document.querySelectorAll(
            'fieldset.js-product-form__input input:checked, variant-radios input:checked, .product-form__input input[type="radio"]:checked, [data-variant-radio]:checked',
          ),
        )
          .map((el) => (el.value || '').trim())
          .filter((v) => v && v !== 'Default Title');
        if (checkedOpts.length) {
          line.variantTitle = checkedOpts.join(' · ');
        } else {
          const selectedOpts = Array.from(
            document.querySelectorAll('variant-selects select, .product-form__input select'),
          )
            .map((el) => (el.value || '').trim())
            .filter((v) => v && v !== 'Default Title');
          if (selectedOpts.length) {
            line.variantTitle = selectedOpts.join(' · ');
          }
        }
      }
      if (typeof window !== 'undefined' && window.location.pathname.includes('/products/')) {
        const handle = window.location.pathname
          .split('/products/')[1]
          ?.split('?')[0]
          ?.replace(/\/$/, '');
        if (handle) {
          fetch(`/products/${handle}.js`, { headers: { accept: 'application/json' } })
            .then((res) => (res.ok ? res.json() : null))
            .then((prod) => {
              if (!prod || !Array.isArray(prod.variants)) return;
              const matched = line.variantId
                ? prod.variants.find((v) => String(v.id) === String(line.variantId))
                : prod.variants[0];
              let changed = false;
              if (matched) {
                if (
                  typeof matched.compare_at_price === 'number' &&
                  matched.compare_at_price > unit
                ) {
                  if (
                    !line.compareAtAmountMinor ||
                    line.compareAtAmountMinor !== matched.compare_at_price
                  ) {
                    line.compareAtAmountMinor = matched.compare_at_price;
                    changed = true;
                  }
                }
                if (
                  matched.title &&
                  matched.title !== 'Default Title' &&
                  (!line.variantTitle || line.variantTitle === 'Default Title')
                ) {
                  line.variantTitle = matched.title.replace(/\s*\/\s*/g, ' · ');
                  changed = true;
                }
              }
              if (changed) {
                renderLines(sessionLines);
                applyTotals(currentSession.totals, sessionLines);
              }
            })
            .catch(() => {});
        }
      }
    }

    appliedCouponCode = session.coupon?.code || '';
    if (session.coupon?.code === 'LOYALTY') {
      loyaltyAppliedPoints = Math.round(((session.coupon.discountMinor || 0) / 100) * 10);
    } else {
      loyaltyAppliedPoints = 0;
    }
    syncCouponApplyVisibility();
    syncLoyaltyUi(offersCache?.loyalty);
    if (!sessionLines.length) {
      renderLines([]);
      applyTotals(session.totals || {}, []);
      showErr('ec-error', 'No items in this checkout.');
      return;
    }
    showErr('ec-error', '');
    renderLines(sessionLines);
    applyTotals(session.totals, sessionLines);
    void loadStoreUpsells(sessionLines);
    void loadOffersAndMaybeAutoApply(session);
    collapseSummary(false);
  }

  function addressKey(address) {
    return [
      address.fullName,
      address.addressLine1,
      address.locality,
      address.region,
      address.postalCode,
      address.phone,
    ]
      .join('|')
      .toLowerCase();
  }

  function upsertAddressInBook(address, extras = {}) {
    if (!address || !addressComplete(address)) return null;
    // Update-by-id first so edits keep the same row when fields (and key) change.
    if (extras.id) {
      const byId = addressBook.find((a) => a.id === extras.id);
      if (byId) {
        Object.assign(byId, {
          ...address,
          id: byId.id,
          label: extras.label || byId.label || 'Saved',
          isDemo: extras.isDemo != null ? !!extras.isDemo : false,
        });
        const key = addressKey(byId);
        addressBook = addressBook.filter((a) => a.id === byId.id || addressKey(a) !== key);
        return byId.id;
      }
    }
    const key = addressKey(address);
    const existing = addressBook.find((a) => addressKey(a) === key);
    if (existing) {
      Object.assign(existing, {
        ...address,
        id: existing.id,
        label: extras.label || existing.label || 'Saved',
        isDemo: extras.isDemo != null ? !!extras.isDemo : !!existing.isDemo,
      });
      return existing.id;
    }
    const id = extras.id || `addr_${Date.now()}_${addressBook.length}`;
    addressBook = [
      ...addressBook,
      {
        ...address,
        id,
        label: extras.label || 'Saved',
        isDemo: !!extras.isDemo,
      },
    ];
    return id;
  }

  function loadAddressBook() {
    const phone = shopper?.phone || '';
    let saved = [];
    try {
      const raw = localStorage.getItem(`${STORAGE_ADDRESSES}:${phone}`);
      if (raw) saved = JSON.parse(raw) || [];
    } catch {
      saved = [];
    }
    const previous = addressBook.slice();
    addressBook = [];
    // Keep session addresses first so selecting never drops earlier ones.
    for (const item of previous)
      upsertAddressInBook(item, { id: item.id, label: item.label, isDemo: item.isDemo });
    if (shopper?.address) {
      upsertAddressInBook(shopper.address, { label: 'Default' });
    }
    for (const item of saved) {
      upsertAddressInBook(item, { id: item.id, label: item.label || 'Saved' });
    }
    // Dev sample so the picker never looks empty during local testing.
    upsertAddressInBook(DEV_DEFAULT_ADDRESS, {
      id: DEV_DEFAULT_ADDRESS.id,
      label: DEV_DEFAULT_ADDRESS.label,
      isDemo: true,
    });
    if (shopper?.address && addressComplete(shopper.address)) {
      const match = addressBook.find((a) => addressKey(a) === addressKey(shopper.address));
      if (match) selectedAddressId = match.id;
    } else if (!selectedAddressId || !addressBook.some((a) => a.id === selectedAddressId)) {
      selectedAddressId = addressBook[0]?.id || '';
    }
    persistAddressBook();
    return addressBook;
  }

  function persistAddressBook() {
    const phone = shopper?.phone || '';
    if (!phone) return;
    const toSave = addressBook.filter((a) => !a.isDemo).map((a) => ({ ...a }));
    try {
      localStorage.setItem(`${STORAGE_ADDRESSES}:${phone}`, JSON.stringify(toSave));
    } catch {
      /* ignore */
    }
  }

  function fillAddressBlock(targetId, address) {
    const summary = $(targetId);
    summary.replaceChildren();
    const name = document.createElement('strong');
    name.textContent = address.fullName;
    const line = document.createElement('div');
    line.textContent = `${address.addressLine1}, ${address.locality}, ${address.region} ${address.postalCode}`;
    const phone = document.createElement('div');
    phone.className = 'ec-phone';
    phone.textContent = `+91 ${address.phone}`;
    summary.append(name, line, phone);
  }

  function renderAddressList() {
    const root = $('ec-address-list');
    if (!root) return;
    root.replaceChildren();
    for (const address of addressBook) {
      const card = document.createElement('div');
      card.className = `ec-address-option${address.id === selectedAddressId ? ' is-selected' : ''}${
        address.isDemo ? ' is-demo' : ''
      }`;
      card.dataset.ecAddressId = address.id;
      card.setAttribute('role', 'option');
      card.tabIndex = 0;
      card.setAttribute('aria-selected', address.id === selectedAddressId ? 'true' : 'false');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ec-icon-btn ec-address-card-edit';
      edit.dataset.ecAddressEdit = address.id;
      edit.setAttribute('aria-label', `Edit address for ${address.fullName}`);
      edit.title = 'Edit address';
      edit.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm14.71-9.04c.39-.39.39-1.02 0-1.41l-2.51-2.51a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 2-1.66z"/></svg>';
      const title = document.createElement('strong');
      title.textContent = address.fullName;
      const line = document.createElement('div');
      line.textContent = `${address.addressLine1}, ${address.locality}, ${address.region} ${address.postalCode}`;
      const meta = document.createElement('small');
      meta.textContent = address.isDemo
        ? `${address.label} · +91 ${address.phone}`
        : `+91 ${address.phone}`;
      card.append(edit, title, line, meta);
      root.appendChild(card);
    }
  }

  function setAddressFocus(on) {
    addressFocus = !!on;
    const shell =
      (boundRoot?.classList?.contains('ec-shell') && boundRoot) ||
      boundRoot?.querySelector?.('.ec-shell') ||
      document.querySelector('.ec-shell') ||
      boundRoot;
    if (shell) shell.classList.toggle('is-address-focus', addressFocus);
    const scrim = $('ec-address-focus-scrim');
    if (scrim) scrim.hidden = !addressFocus;
    if (addressFocus) {
      showErr('ec-error', '');
      // Pin the address card in view; form scrolls inside the card.
      const body = shell?.querySelector?.('.ec-body');
      const card = shell?.querySelector?.('.ec-address');
      if (body) body.scrollTop = 0;
      if (card) card.scrollTop = 0;
    }
  }

  function showAddressPicker() {
    loadAddressBook();
    renderAddressList();
    $('ec-address-summary').hidden = true;
    $('ec-address-form').hidden = true;
    $('ec-address-picker').hidden = false;
    $('ec-address-toggle').textContent = 'Cancel';
    setAddressFocus(true);
  }

  function hideAddressPicker() {
    $('ec-address-picker').hidden = true;
    $('ec-address-form').hidden = true;
    if (shopper?.address) {
      $('ec-address-summary').hidden = false;
      $('ec-address-toggle').textContent = 'Change';
    }
    setAddressFocus(false);
  }

  function fillEditForm(address) {
    $('ec-edit-fullName').value = address?.fullName || '';
    $('ec-edit-addressLine1').value = address?.addressLine1 || '';
    $('ec-edit-locality').value = address?.locality || '';
    $('ec-edit-region').value = address?.region || '';
    $('ec-edit-postalCode').value = address?.postalCode || '';
  }

  function openAddressForm(mode, address) {
    addressFormMode = mode;
    editingAddressId = mode === 'edit' ? address?.id || selectedAddressId || '' : '';
    if (mode === 'edit' && editingAddressId) selectedAddressId = editingAddressId;
    $('ec-address-form-title').textContent = mode === 'add' ? 'Add new address' : 'Edit address';
    fillEditForm(
      mode === 'add'
        ? { fullName: '', addressLine1: '', locality: '', region: '', postalCode: '' }
        : address,
    );
    $('ec-address-picker').hidden = true;
    $('ec-address-summary').hidden = true;
    $('ec-address-form').hidden = false;
    $('ec-address-toggle').textContent = 'Cancel';
    setAddressFocus(true);
  }

  function applyAddressSelection(selected) {
    if (!selected || !addressComplete(selected)) return false;
    // Keep the previous delivery address in the book (select ≠ delete).
    if (shopper?.address && addressComplete(shopper.address)) {
      const prevKey = addressKey(shopper.address);
      const prevEntry = addressBook.find((a) => addressKey(a) === prevKey);
      upsertAddressInBook(shopper.address, {
        id: prevEntry?.id,
        label: prevEntry?.label || 'Saved',
        isDemo: prevEntry?.isDemo,
      });
    }
    const id = upsertAddressInBook(selected, {
      id: selected.id,
      label: selected.label || 'Saved',
      isDemo: selected.isDemo,
    });
    selectedAddressId = id || selected.id;
    persistAddressBook();
    const address = {
      phone: selected.phone || shopper?.phone || '',
      fullName: selected.fullName,
      addressLine1: selected.addressLine1,
      locality: selected.locality,
      region: selected.region,
      postalCode: selected.postalCode,
    };
    persistShopper({ ...shopper, address, needsAddress: false, isNew: false });
    renderDeliverTo(address);
    void quotePin(address.postalCode);
    trackCheckoutEvent('address_added', {
      postalCode: address.postalCode,
      locality: address.locality,
      region: address.region,
    });
    return true;
  }

  function confirmAddressFocusSelection() {
    const form = $('ec-address-form');
    if (form && !form.hidden) {
      // Backdrop during edit returns to the list (does not discard the book).
      showAddressPicker();
      return;
    }
    const selected = addressBook.find((a) => a.id === selectedAddressId);
    if (!applyAddressSelection(selected)) {
      showErr('ec-error', 'Tap an address to select it, then tap outside to confirm.');
    }
  }

  function renderDeliverTo(address) {
    fillAddressBlock('ec-address-summary', address);
    $('ec-address-summary').hidden = false;
    $('ec-address-form').hidden = true;
    $('ec-address-picker').hidden = true;
    $('ec-address-toggle').textContent = 'Change';
    setAddressFocus(false);
  }

  function fillNewAddressForm(phone, address) {
    $('ec-phone').value = phone || address?.phone || '';
    $('ec-fullName').value = address?.fullName || '';
    $('ec-addressLine1').value = address?.addressLine1 || '';
    $('ec-locality').value = address?.locality || '';
    $('ec-region').value = address?.region || '';
    $('ec-postalCode').value = address?.postalCode || '';
  }

  function readNewAddress() {
    return {
      phone: $('ec-phone').value.trim(),
      fullName: $('ec-fullName').value.trim(),
      addressLine1: $('ec-addressLine1').value.trim(),
      locality: $('ec-locality').value.trim(),
      region: $('ec-region').value.trim(),
      postalCode: $('ec-postalCode').value.trim(),
    };
  }

  function readEditAddress() {
    return {
      phone: shopper?.phone || '',
      fullName: $('ec-edit-fullName').value.trim(),
      addressLine1: $('ec-edit-addressLine1').value.trim(),
      locality: $('ec-edit-locality').value.trim(),
      region: $('ec-edit-region').value.trim(),
      postalCode: $('ec-edit-postalCode').value.trim(),
    };
  }

  function addressComplete(address) {
    return (
      !!address &&
      /^[6-9]\d{9}$/.test(address.phone) &&
      address.fullName &&
      address.addressLine1 &&
      address.locality &&
      address.region &&
      /^\d{6}$/.test(address.postalCode)
    );
  }

  function routeAfterAuth(next) {
    persistShopper(next);
    collapseSummary(false);
    // Default: go straight to place-order with last/default address.
    if (addressComplete(next.address)) {
      renderDeliverTo(next.address);
      setStep('checkout');
      return;
    }
    // Prefill whatever Shopify / profile already has; only blank when truly new.
    fillNewAddressForm(next.phone, next.address);
    setStep('address');
  }

  async function requestOtp(isResend = false) {
    if (loginBusy) return;
    showErr('ec-login-error', '');
    const phone = $('ec-login-phone').value.replace(/\D/g, '').trim();
    if (!/^[6-9]\d{9}$/.test(phone)) {
      showErr('ec-login-error', 'Enter a valid 10-digit mobile number.');
      return;
    }
    if (!isResend && $('ec-consent') && !$('ec-consent').checked) {
      showErr('ec-login-error', 'Please agree to receive order updates to continue.');
      return;
    }
    $('ec-login-phone').value = phone;
    loginBusy = isResend ? 'resend' : 'send';
    syncLoginUi();
    try {
      const response = await fetch(`${apiBase}/v1/auth/otp/request`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        showErr('ec-login-error', body?.error?.message || 'Could not send OTP.');
        return;
      }
      if (isResend) clearOtp();
      else showOtpPhase(true);
      startResendTimer();
      const hint = $('ec-otp-hint');
      if (hint) {
        hint.hidden = !body?.devCode;
        if (body?.devCode) hint.textContent = `Dev OTP: ${body.devCode}`;
      }
    } catch {
      showErr('ec-login-error', 'Could not send OTP. Try again.');
    } finally {
      loginBusy = null;
      syncLoginUi();
      if (otpSent) otpInputs()[0]?.focus();
    }
  }

  async function verifyOtp() {
    if (loginBusy) return;
    showErr('ec-login-error', '');
    const phone = $('ec-login-phone').value.trim();
    const code = readOtp();
    if (!/^\d{4}$/.test(code)) return;
    loginBusy = 'verify';
    syncLoginUi();
    let failed = false;
    try {
      const response = await fetch(`${apiBase}/v1/auth/otp/verify`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ phone, code, sessionId: activeSessionId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        failed = true;
        showErr('ec-login-error', body?.error?.message || 'Incorrect OTP. Try again.');
        return;
      }
      stopResendTimer();
      trackCheckoutEvent('logged_in', {
        phone: body?.phone || phone,
        customerId: body?.customerId,
        isNew: body?.isNew,
      });
      routeAfterAuth(body);
    } catch (error) {
      failed = true;
      showErr('ec-login-error', 'OTP verification failed. Try again.');
      console.error('[EasyCheckout] verify OTP', error);
    } finally {
      loginBusy = null;
      if (failed) clearOtp();
      syncLoginUi();
      if (failed) otpInputs()[0]?.focus();
    }
  }

  async function saveNewCustomerAddress() {
    showErr('ec-address-error', '');
    if (!shopper?.token) {
      setStep('login');
      return;
    }
    const address = readNewAddress();
    if (!addressComplete(address)) {
      showErr('ec-address-error', 'Enter a valid name, address, and 6-digit PIN.');
      return;
    }
    const response = await fetch(`${apiBase}/v1/auth/customer`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-ec-shopper': shopper.token,
      },
      body: JSON.stringify(address),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      showErr('ec-address-error', body?.error?.message || 'Could not save address.');
      return;
    }
    persistShopper(body);
    renderDeliverTo(body.address || address);
    trackCheckoutEvent('address_added', {
      postalCode: address.postalCode,
      locality: address.locality,
      region: address.region,
    });
    setStep('checkout');
  }

  function showLogoutConfirmation() {
    const overlay = $('ec-logout-overlay');
    if (!overlay) {
      void logout();
      return;
    }
    const phoneEl = $('ec-logout-phone');
    if (phoneEl) {
      const raw = shopper?.phone || shopper?.address?.phone || '';
      const formatted = raw ? `+91 ${raw.replace(/^\+?91/, '')}` : '';
      const name = (shopper?.fullName || shopper?.address?.fullName || '').trim();
      phoneEl.textContent =
        name && formatted ? `${name} (${formatted})` : formatted || name || 'your account';
    }
    overlay.hidden = false;
  }

  function hideLogoutConfirmation() {
    const overlay = $('ec-logout-overlay');
    if (overlay) overlay.hidden = true;
  }

  async function logout() {
    hideLogoutConfirmation();
    if (shopper?.token) {
      await fetch(`${apiBase}/v1/auth/customer`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-ec-shopper': shopper.token, accept: 'application/json' },
      }).catch(() => null);
    }
    persistShopper(null);
    showOtpPhase(false);
    showErr('ec-login-error', '');
    setStep('login');
  }

  async function quotePin(postalCode) {
    if (!activeSessionId || !/^\d{6}$/.test(postalCode)) return;
    const response = await fetch(
      `${apiBase}/v1/sessions/${encodeURIComponent(activeSessionId)}/quote`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ postalCode }),
      },
    );
    if (!response.ok) return;
    applySession(await response.json());
  }

  /** Clear success/order UI so a reused panel does not reopen on the last thank-you screen. */
  function resetOrderSuccessUi() {
    hideLogoutConfirmation();
    offersAutoApplied = false;
    offersCache = null;
    appliedCouponCode = '';
    loyaltyAppliedPoints = 0;
    sheetOfferCategory = 'store';
    hideOffersSheet();
    const shell = shellEl();
    if (shell) {
      shell.classList.remove('is-order-success');
      shell.classList.remove('is-summary-open');
    }
    const success = $('ec-success');
    if (success) success.hidden = true;
    const nameEl = $('ec-order-name');
    if (nameEl) nameEl.textContent = '—';
    const message = $('ec-success-message');
    if (message) message.textContent = 'Pay cash on delivery when your order arrives.';
    const idEl = $('ec-order-id');
    if (idEl) idEl.textContent = '';
    showErr('ec-error', '');
    setAddressFocus(false);
    cartBusy = false;
  }

  function showOrderSuccess(result) {
    const shell = shellEl();
    if (shell) shell.classList.add('is-order-success');
    collapseSummary(false);
    const success = $('ec-success');
    if (success) success.hidden = false;
    const orderName = result?.orderName || result?.orderId || '—';
    const nameEl = $('ec-order-name');
    if (nameEl) nameEl.textContent = orderName;
    const message = $('ec-success-message');
    if (message) {
      message.textContent =
        result?.message || `Order ${orderName} placed. Pay cash on delivery when it arrives.`;
    }
    const idEl = $('ec-order-id');
    if (idEl) idEl.textContent = result?.orderId || orderName;
    success?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function placeOrder() {
    showErr('ec-error', '');
    if (selectedPay !== 'cod') {
      showErr(
        'ec-error',
        'This payment method is coming soon. Choose Cash on Delivery to place your order.',
      );
      return;
    }
    if (cartBusy) {
      showErr('ec-error', 'Please wait — we are still adding an item to your bag.');
      return;
    }
    if (!shopper?.token) {
      setStep('login');
      return;
    }
    const address = shopper.address;
    if (!addressComplete(address)) {
      fillNewAddressForm(shopper.phone, address);
      setStep('address');
      showErr('ec-address-error', 'Add a delivery address to place your COD order.');
      return;
    }
    if (!activeSessionId) {
      showErr('ec-error', 'Checkout session expired. Close and open checkout again.');
      return;
    }
    setCartBusy(true);
    const text = $('ec-loading-text');
    const sub = $('ec-loading-sub');
    if (text) text.textContent = 'Placing your COD order…';
    if (sub) sub.textContent = 'Creating your order in the store — hang tight';
    try {
      await quotePin(address.postalCode);
      let response = await fetch(
        `${apiBase}/v1/sessions/${encodeURIComponent(activeSessionId)}/place-cod`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(shopper.token ? { 'x-ec-shopper': shopper.token } : {}),
          },
          credentials: 'same-origin',
          body: JSON.stringify(address),
        },
      );
      let body = await response.json().catch(() => null);

      // Handle in-progress or reconciling state via graceful polling
      let pollCount = 0;
      while (
        pollCount < 5 &&
        (response.status === 202 ||
          body?.status === 'RECONCILING' ||
          (response.status === 409 && body?.error?.code === 'ORDER_IN_PROGRESS'))
      ) {
        pollCount++;
        const waitMs = body?.retryAfterMs || (response.status === 202 ? 2000 : 1500);
        if (text) text.textContent = 'Confirming your order…';
        if (sub) sub.textContent = 'Verifying confirmation with the store — please wait';
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        response = await fetch(
          `${apiBase}/v1/sessions/${encodeURIComponent(activeSessionId)}/place-cod`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              ...(shopper.token ? { 'x-ec-shopper': shopper.token } : {}),
            },
            credentials: 'same-origin',
            body: JSON.stringify(address),
          },
        );
        body = await response.json().catch(() => null);
        if (response.ok && body?.orderId) break;
      }

      if (!response.ok || !body?.orderId) {
        const errorMsg =
          body?.error?.code === 'NOT_FOUND'
            ? 'Checkout session expired. Please close and reopen checkout.'
            : body?.message || body?.error?.message || 'Could not place the order.';
        showErr('ec-error', errorMsg);
        return;
      }
      // Keep last-used address as default for next checkout.
      persistShopper({ ...shopper, address, needsAddress: false, isNew: false });
      const completedSessionId = activeSessionId;
      orderCompleted = true;
      trackCheckoutEvent('checkout_completed', {
        sessionId: completedSessionId,
        orderId: body?.orderId,
        orderName: body?.orderName,
        paymentMethod: 'cod',
      });
      activeSessionId = '';
      // Cart checkout: clear bag so purchased lines don't linger.
      // Buy now: leave the cart alone — other items may still be in it.
      const isCart = (body && body.source === 'cart') || sessionSource === 'cart';
      if (isCart) {
        try {
          await fetch('/cart/clear.js', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
          });
          try {
            document.dispatchEvent(new CustomEvent('cart:cleared'));
            document.dispatchEvent(new CustomEvent('cart:refresh'));
          } catch {}
        } catch (e) {
          console.warn('[EasyCheckout] cart clear error:', e);
        }
      }

      showOrderSuccess(body);

      const redirectUrl = body?.statusUrl;
      if (redirectUrl) {
        const message = $('ec-success-message');
        if (message) {
          message.textContent = `Order ${body?.orderName || ''} confirmed! Redirecting to order status…`;
        }
        setTimeout(() => {
          try {
            (window.top || window).location.href = redirectUrl;
          } catch {
            window.location.href = redirectUrl;
          }
        }, 750);
      }
    } finally {
      setCartBusy(false);
    }
  }

  async function loadSession(existing) {
    if (existing && existing.sessionId && existing.lines) {
      applySession(existing);
      return;
    }
    if (existing && typeof existing === 'string') {
      const response = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(existing)}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        showErr('ec-login-error', 'Could not load checkout. Try again.');
        return;
      }
      applySession(await response.json());
    }
  }

  function revalidateShopperInBackground(token) {
    void fetch(`${apiBase}/v1/auth/customer`, {
      headers: { accept: 'application/json', 'x-ec-shopper': token },
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) {
          persistShopper(null);
          if (!$('ec-step-login').hidden) return;
          showOtpPhase(false);
          setStep('login');
          return;
        }
        const fresh = await response.json();
        persistShopper(fresh);
        if (!$('ec-step-checkout').hidden && addressComplete(fresh.address)) {
          renderDeliverTo(fresh.address);
        }
      })
      .catch(() => {
        /* keep optimistic session */
      });
  }

  function paintLoadingBeat(index) {
    const beat = LOADING_BEATS[index % LOADING_BEATS.length];
    const text = $('ec-loading-text');
    const sub = $('ec-loading-sub');
    const stage = $('ec-loading-stage');
    if (text) {
      text.style.opacity = '0';
      window.setTimeout(() => {
        text.textContent = beat.text;
        text.style.opacity = '1';
      }, 160);
    }
    if (sub) sub.textContent = beat.sub;
    if (stage) stage.setAttribute('data-ec-anim', beat.anim);
  }

  function setLoading(on) {
    const overlay = $('ec-loading');
    if (!overlay) return;
    if (on) {
      overlay.hidden = false;
      overlay.setAttribute('aria-busy', 'true');
      if (!loadingTimer) {
        loadingIndex = 0;
        paintLoadingBeat(0);
        loadingTimer = window.setInterval(() => {
          loadingIndex += 1;
          paintLoadingBeat(loadingIndex);
        }, 2200);
      }
    } else {
      overlay.hidden = true;
      overlay.setAttribute('aria-busy', 'false');
      if (loadingTimer) {
        window.clearInterval(loadingTimer);
        loadingTimer = null;
      }
    }
  }

  function bindRoot(root) {
    if (!root || root.getAttribute('data-ec-bound') === '1') return;
    root.setAttribute('data-ec-bound', '1');
    boundRoot = root;
    bindSummaryScrimScroll();

    // Event delegation survives panel HTML refresh (innerHTML replace).
    root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const exitBtn = target.closest('[data-ec-exit]');
      if (exitBtn) {
        // Back arrow on the OTP screen returns to the phone screen
        if (exitBtn.id === 'ec-back' && otpSent && !$('ec-step-login').hidden) {
          if (!loginBusy) {
            showOtpPhase(false);
            showErr('ec-login-error', '');
          }
          return;
        }
        showExitFeedback();
        return;
      }
      if (target.closest('#ec-login-submit')) {
        void (otpSent ? verifyOtp() : requestOtp());
        return;
      }
      if (target.closest('#ec-resend')) {
        void requestOtp(true);
        return;
      }
      if (target.closest('#ec-exit-stay')) {
        hideExitFeedback();
        return;
      }
      if (target.closest('#ec-exit-leave')) {
        confirmLeaveCheckout();
        return;
      }
      if (target.closest('#ec-discount-label')) {
        const breakdownEl = $('ec-discount-breakdown');
        const toggle = $('ec-discount-label');
        if (breakdownEl && $('ec-discount-items')?.children.length > 0) {
          breakdownEl.hidden = !breakdownEl.hidden;
          toggle?.setAttribute('aria-expanded', String(!breakdownEl.hidden));
        }
        return;
      }
      if (target.closest('[data-ec-close]') && window.EasyCheckout) {
        if (!orderCompleted && activeSessionId) {
          trackCheckoutEvent('checkout_abandoned', {
            droppedAt: determineCurrentFunnelStep(),
            reason: 'close_button',
          });
        }
        window.EasyCheckout.close();
        return;
      }
      if (target.closest('#ec-error-close') || target.closest('[data-ec-error-close]')) {
        showErr('ec-error', '');
        return;
      }
      if (target.closest('#ec-pay-sheet-close')) {
        hidePaySheet();
        return;
      }
      if (target.closest('#ec-pay-sheet-confirm')) {
        hidePaySheet();
        void placeOrder();
        return;
      }
      const bank = target.closest('[data-ec-bank]');
      if (bank) {
        for (const el of document.querySelectorAll('[data-ec-bank]')) {
          el.classList.toggle('is-selected', el === bank);
        }
        return;
      }
      // UPI-specific interactions
      if (
        target.closest('#ec-upi-show-qr-btn') ||
        target.closest('#ec-upi-qr-box') ||
        target.closest('#ec-upi-qr-blurred')
      ) {
        handleShowUpiQr();
        return;
      }
      if (
        target.closest('#ec-upi-timer-badge') &&
        $('ec-upi-timer-text')?.textContent.includes('expired')
      ) {
        handleShowUpiQr();
        return;
      }
      if (target.closest('#ec-upi-mob-toggle')) {
        const upiCard = target.closest('.ec-pay-upi-card');
        if (upiCard) {
          upiCard.classList.toggle('is-collapsed');
          selectedPay = 'upi';
          for (const row of document.querySelectorAll('[data-ec-pay]')) {
            const on = row === upiCard;
            row.classList.toggle('is-selected', on);
            row.setAttribute('aria-checked', on ? 'true' : 'false');
          }
          updatePayableDisplay();
          trackCheckoutEvent('payment_selected', { method: 'upi' });
        }
        return;
      }
      const upiAppBtn = target.closest('[data-ec-upi-app]');
      if (upiAppBtn) {
        handleUpiAppSelect(upiAppBtn);
        return;
      }
      if (target.closest('#ec-upi-vpa-toggle')) {
        const form = $('ec-upi-vpa-form');
        const card = target.closest('.ec-upi-vpa-card');
        if (form) {
          form.hidden = !form.hidden;
          if (card) card.classList.toggle('is-active', !form.hidden);
          if (!form.hidden) $('ec-upi-vpa-input')?.focus();
        }
        return;
      }
      if (target.closest('#ec-upi-vpa-submit')) {
        handleUpiVpaSubmit();
        return;
      }
      const payRow = target.closest('[data-ec-pay]');
      if (payRow) {
        if (payRow.disabled || payRow.getAttribute('data-ec-pay-enabled') !== '1') return;
        selectedPay = payRow.getAttribute('data-ec-pay') || 'cod';
        for (const row of document.querySelectorAll('[data-ec-pay]')) {
          const on = row === payRow;
          row.classList.toggle('is-selected', on);
          row.setAttribute('aria-checked', on ? 'true' : 'false');
        }
        updatePayableDisplay();
        trackCheckoutEvent('payment_selected', { method: selectedPay });

        if (selectedPay === 'upi') {
          const isMobile = window.innerWidth <= 640;
          if (isMobile) {
            const upiCard =
              target.closest('.ec-pay-upi-card') || document.querySelector('.ec-pay-upi-card');
            if (upiCard) upiCard.classList.remove('is-collapsed');
          }
          return;
        }

        // Place / confirm on payment method tap — no separate pay button.
        void beginPlaceOrder();
        return;
      }
      const qtyBtn = target.closest('[data-ec-qty-delta]');
      if (qtyBtn) {
        const delta = Number(qtyBtn.getAttribute('data-ec-qty-delta') || 0);
        void changeLineQuantity(
          qtyBtn.getAttribute('data-ec-variant-id') || '',
          qtyBtn.getAttribute('data-ec-line-key') || '',
          delta,
        );
        return;
      }
      const delBtn = target.closest('.ec-line-delete');
      if (delBtn) {
        const variantId = delBtn.getAttribute('data-ec-variant-id') || '';
        const lineKey = delBtn.getAttribute('data-ec-line-key') || '';
        const match = sessionLines.find(
          (line) =>
            (lineKey && line.lineKey === lineKey) ||
            (variantId && String(line.variantId) === String(variantId)),
        );
        if (match) {
          void changeLineQuantity(variantId, lineKey, -(match.quantity || 1));
        }
        return;
      }
      const upsellAdd = target.closest('[data-ec-upsell-add]');
      if (upsellAdd) {
        void addUpsellToCart(upsellAdd.getAttribute('data-ec-upsell-add'), upsellAdd);
        return;
      }
      if (target.closest('#ec-address-focus-scrim')) {
        confirmAddressFocusSelection();
        return;
      }
      const addressEdit = target.closest('[data-ec-address-edit]');
      if (addressEdit) {
        const editId = addressEdit.getAttribute('data-ec-address-edit') || '';
        const selected = addressBook.find((a) => a.id === editId);
        if (selected) openAddressForm('edit', selected);
        return;
      }
      const addressOpt = target.closest('[data-ec-address-id]');
      if (addressOpt) {
        selectedAddressId = addressOpt.getAttribute('data-ec-address-id') || '';
        const selected = addressBook.find((a) => a.id === selectedAddressId);
        renderAddressList();
        if (!selected || !addressComplete(selected)) {
          showErr('ec-error', 'That address is incomplete. Tap the pen to edit it.');
          return;
        }
        // Tap selects and applies that delivery address.
        showErr('ec-error', '');
        applyAddressSelection(selected);
        return;
      }
      if (target.closest('#ec-address-add')) {
        openAddressForm('add');
        return;
      }
      if (target.closest('#ec-address-cancel')) {
        showAddressPicker();
        return;
      }
      if (target.closest('#ec-summary-scrim')) {
        collapseSummary(false);
        return;
      }
      if (target.closest('#ec-summary-toggle')) {
        collapseSummary();
        return;
      }
      if (target.closest('#ec-logout')) {
        showLogoutConfirmation();
        return;
      }
      if (target.closest('#ec-logout-close') || target.closest('#ec-logout-stay')) {
        hideLogoutConfirmation();
        return;
      }
      if (target.closest('#ec-logout-confirm')) {
        void logout();
        return;
      }
      if (target.id === 'ec-logout-overlay') {
        hideLogoutConfirmation();
        return;
      }
      if (target.closest('#ec-phone-edit')) {
        showOtpPhase(false);
        showErr('ec-login-error', '');
        return;
      }
      if (target.closest('#ec-address-continue')) {
        void saveNewCustomerAddress();
        return;
      }
      if (target.closest('#ec-address-toggle')) {
        const picker = $('ec-address-picker');
        const form = $('ec-address-form');
        if (picker && !picker.hidden) {
          // Cancel pick — keep previous delivery address.
          hideAddressPicker();
          return;
        }
        if (form && !form.hidden) {
          showAddressPicker();
          return;
        }
        showAddressPicker();
        return;
      }
      if (target.closest('#ec-save-address')) {
        void (async () => {
          const address = readEditAddress();
          if (!addressComplete(address)) {
            showErr('ec-error', 'Enter a valid address and PIN.');
            return;
          }
          showErr('ec-error', '');
          let savedId;
          if (addressFormMode === 'edit' && editingAddressId) {
            savedId = upsertAddressInBook(address, {
              id: editingAddressId,
              label: 'Saved',
              isDemo: false,
            });
          } else {
            savedId = upsertAddressInBook(address, {
              id: `addr_${Date.now()}`,
              label: 'New',
              isDemo: false,
            });
          }
          selectedAddressId = savedId || editingAddressId || selectedAddressId;
          editingAddressId = '';
          persistAddressBook();
          if (shopper?.token) {
            const response = await fetch(`${apiBase}/v1/auth/customer`, {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                'x-ec-shopper': shopper.token,
              },
              body: JSON.stringify(address),
            });
            const body = await response.json().catch(() => null);
            if (response.ok && body) {
              // Keep the edited book id; only refresh shopper profile fields from API.
              persistShopper({
                ...body,
                address: body.address || address,
              });
              if (selectedAddressId) {
                upsertAddressInBook(body.address || address, {
                  id: selectedAddressId,
                  label: 'Saved',
                  isDemo: false,
                });
                persistAddressBook();
              }
              renderDeliverTo(body.address || address);
              void quotePin((body.address || address).postalCode);
              return;
            }
          }
          persistShopper({ ...shopper, address, needsAddress: false, isNew: false });
          renderDeliverTo(address);
          void quotePin(address.postalCode);
        })();
        return;
      }
      if (target.closest('#ec-coupon-apply')) {
        void applyCouponCode();
        return;
      }
      if (target.closest('#ec-sheet-coupons-clear')) {
        const button = target.closest('#ec-sheet-coupons-clear');
        button.disabled = true;
        void patchSession({ couponCode: '' })
          .then((session) => {
            // Do not auto-apply an offer immediately after an explicit removal.
            offersAutoApplied = true;
            applySession(session);
            openCouponsSheet();
          })
          .catch((error) => {
            showErr('ec-sheet-coupon-error', error?.message || 'Could not remove discounts.');
            button.disabled = false;
          });
        return;
      }
      if (target.closest('#ec-sheet-coupon-apply')) {
        void applyCouponCode(undefined, { keepSheet: true });
        return;
      }
      if (target.closest('#ec-coupons-view-all')) {
        void (async () => {
          if (!offersCache) await fetchOffers('');
          sheetOfferCategory = 'store';
          openCouponsSheet();
        })();
        return;
      }
      const sheetTab = target.closest('[data-ec-sheet-cat]');
      if (sheetTab && sheetTab.closest('#ec-offers-sheet-body')) {
        sheetOfferCategory = sheetTab.getAttribute('data-ec-sheet-cat') || 'store';
        openCouponsSheet();
        return;
      }
      if (target.closest('#ec-sheet-gift-open')) {
        openGiftSheet();
        return;
      }
      const loyaltyPreset = target.closest('[data-ec-loyalty-preset]');
      if (loyaltyPreset) {
        if (loyaltyPreset.disabled || loyaltyAppliedPoints > 0) return;
        const loyalty = loyaltyData(offersCache?.loyalty);
        const key = loyaltyPreset.getAttribute('data-ec-loyalty-preset');
        const amount = key === 'max' ? loyalty.points || 0 : Number(key || 0);
        const input = $('ec-loyalty-points-input');
        if (input) input.value = String(Math.max(0, Math.min(amount, loyalty.points || 0)));
        setLoyaltyPresetActive(Number(input?.value || 0));
        syncLoyaltyInputWorth();
        showErr('ec-loyalty-inline-error', '');
        return;
      }
      if (target.closest('#ec-loyalty-remove')) {
        if ($('ec-loyalty-remove')?.disabled) return;
        void removeLoyaltyRedeem();
        return;
      }
      if (target.closest('#ec-loyalty-open')) {
        const loyaltyBtn = $('ec-loyalty-open');
        if (loyaltyBtn?.disabled || loyaltyAppliedPoints > 0) return;
        void confirmLoyaltyRedeem();
        return;
      }
      if (target.closest('#ec-offers-sheet-close')) {
        hideOffersSheet();
        return;
      }
      if (target.closest('#ec-offers-sheet-confirm')) {
        void confirmOffersSheet();
        return;
      }
      const sheetApply = target.closest('.ec-coupon-card-apply[data-ec-coupon-code]');
      if (sheetApply && sheetApply.closest('#ec-offers-sheet-body')) {
        if (sheetApply.disabled) return;
        void applyCouponCode(sheetApply.getAttribute('data-ec-coupon-code') || '', {
          keepSheet: true,
        });
        return;
      }
    });

    root.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id === 'ec-login-phone') {
        if (otpSent) return;
        target.value = target.value.replace(/\D/g, '').slice(0, 10);
        syncLoginUi();
        // Auto-send once the number is a valid 10-digit Indian mobile.
        if (/^[6-9]\d{9}$/.test(target.value)) void requestOtp();
        return;
      }
      if (target.id === 'ec-coupon-input') {
        syncCouponApplyVisibility();
        return;
      }
      if (target.id === 'ec-sheet-coupon-input') {
        return;
      }
      if (target.id === 'ec-loyalty-points-input') {
        const cleaned = sanitizeLoyaltyPointsInput(target.value);
        if (cleaned !== target.value) target.value = cleaned;
        setLoyaltyPresetActive(Number(cleaned || 0));
        syncLoyaltyInputWorth();
        return;
      }
      if (target.matches('[data-ec-otp]')) {
        const digit = target.value.replace(/\D/g, '').slice(-1);
        target.value = digit;
        syncLoginUi();
        const inputs = otpInputs();
        const index = inputs.indexOf(target);
        if (digit && inputs[index + 1]) inputs[index + 1].focus();
        // Auto-submit as soon as the 4th digit is entered
        if (readOtp().length === 4) void verifyOtp();
      }
    });

    root.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (event.key === 'Enter' && target.id === 'ec-login-phone') {
        event.preventDefault();
        void requestOtp();
        return;
      }
      if (event.key === 'Enter' && target.id === 'ec-coupon-input') {
        event.preventDefault();
        void applyCouponCode();
        return;
      }
      if (event.key === 'Enter' && target.id === 'ec-sheet-coupon-input') {
        event.preventDefault();
        void applyCouponCode(undefined, { keepSheet: true });
        return;
      }
      if (!target.matches('[data-ec-otp]')) return;
      if (event.key !== 'Backspace' || target.value) return;
      const inputs = otpInputs();
      const index = inputs.indexOf(target);
      if (inputs[index - 1]) inputs[index - 1].focus();
    });

    root.addEventListener('paste', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.matches('[data-ec-otp]')) return;
      event.preventDefault();
      const text = (event.clipboardData || window.clipboardData).getData('text');
      fillOtp(text);
      syncLoginUi();
      if (readOtp().length === 4) void verifyOtp();
    });
  }

  window.addEventListener('resize', checkLoyaltyRowSpace);

  window.addEventListener('beforeunload', () => {
    if (!orderCompleted && activeSessionId && boundRoot && !boundRoot.hidden) {
      trackCheckoutEvent('checkout_abandoned', {
        droppedAt: determineCurrentFunnelStep(),
        reason: 'page_unload',
      });
    }
  });

  window.EasyCheckoutApp = {
    setLoading,
    startLoading() {
      setLoading(true);
    },
    reset() {
      if (!orderCompleted && activeSessionId) {
        trackCheckoutEvent('checkout_abandoned', {
          droppedAt: determineCurrentFunnelStep(),
          reason: 'modal_reset',
        });
      }
      resetOrderSuccessUi();
      setLoading(false);
    },
    async mount(root, options = {}) {
      orderCompleted = false;
      apiBase = (options.apiBase || window.EasyCheckout?.apiBase || '').replace(/\/$/, '');
      bindRoot(root);
      // Panel DOM is reused across opens — always leave the previous thank-you state.
      resetOrderSuccessUi();
      if (options.loading !== false) setLoading(true);
      if (options.settings) applyBrand(options.settings);
      else void loadCheckoutSettings();

      try {
        // Session first (already created in parallel by embed) — paint totals immediately.
        if (options.session) applySession(options.session);
        else await loadSession(options.sessionId);

        const initSessionId = activeSessionId || options.sessionId || options.session?.sessionId;
        if (initSessionId) {
          trackCheckoutEvent('started', {
            sessionId: initSessionId,
            source: sessionSource,
          });
        }

        // Auth: prefer warm/cached shopper so checkout does not wait on network.
        const warm =
          options.shopper ||
          window.__ecWarmShopper ||
          (addressComplete(loadShopper()?.address) ? loadShopper() : null);

        if (warm?.token) {
          persistShopper(warm);
          routeAfterAuth(warm);
          revalidateShopperInBackground(warm.token);
          return;
        }

        const existing = loadShopper();
        if (existing?.token) {
          // Optimistic route if we already have an address; revalidate in background.
          if (addressComplete(existing.address)) {
            persistShopper(existing);
            routeAfterAuth(existing);
            revalidateShopperInBackground(existing.token);
            return;
          }
          const response = await fetch(`${apiBase}/v1/auth/customer`, {
            headers: { accept: 'application/json', 'x-ec-shopper': existing.token },
            credentials: 'same-origin',
          });
          if (response.ok) {
            routeAfterAuth(await response.json());
            return;
          }
          persistShopper(null);
        }

        showOtpPhase(false);
        syncLoginUi();
        setStep('login');
        collapseSummary(false);
      } finally {
        setLoading(false);
      }
    },
  };
})();
