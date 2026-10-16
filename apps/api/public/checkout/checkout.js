(function () {
  let quantity = 1;
  let unitMinor = 0;
  let mounted = false;

  function $(id) {
    return document.getElementById(id);
  }

  function formatInr(amountMinor) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  }

  function showError(message) {
    const el = $('ec-error');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function readAddress() {
    return {
      phone: $('ec-phone').value.trim(),
      fullName: $('ec-fullName').value.trim(),
      addressLine1: $('ec-addressLine1').value.trim(),
      locality: $('ec-locality').value.trim(),
      region: $('ec-region').value.trim(),
      postalCode: $('ec-postalCode').value.trim(),
    };
  }

  function addressComplete(address) {
    return (
      /^[6-9]\d{9}$/.test(address.phone) &&
      address.fullName &&
      address.addressLine1 &&
      address.locality &&
      address.region &&
      /^\d{6}$/.test(address.postalCode)
    );
  }

  function renderAddressSummary(address) {
    const summary = $('ec-address-summary');
    summary.replaceChildren();
    const name = document.createElement('strong');
    name.textContent = address.fullName;
    const tag = document.createElement('span');
    tag.className = 'ec-tag';
    tag.textContent = 'Home';
    const line = document.createElement('div');
    line.textContent = `${address.addressLine1}, ${address.locality}, ${address.region} ${address.postalCode}`;
    const phone = document.createElement('div');
    phone.className = 'ec-phone';
    phone.textContent = `☎ ${address.phone}`;
    summary.append(name, tag, line, phone);
    summary.hidden = false;
    $('ec-address-form').hidden = true;
    $('ec-address-toggle').textContent = 'Change';
  }

  function showAddressForm() {
    $('ec-address-summary').hidden = true;
    $('ec-address-form').hidden = false;
    $('ec-address-toggle').textContent = 'Cancel';
  }

  function updateTotals() {
    const totalMinor = unitMinor * quantity;
    const text = formatInr(totalMinor);
    $('ec-qty').textContent = String(quantity);
    $('ec-line-price').textContent = text;
    $('ec-subtotal').textContent = text;
    $('ec-total').textContent = text;
    $('ec-total-mobile').textContent = text;
  }

  async function loadSession() {
    showError('');
    $('ec-success').hidden = true;
    const response = await fetch('/v1/demo/checkout', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      showError('Could not load checkout. Try again.');
      return;
    }
    const session = await response.json();
    $('ec-sessionId').value = session.sessionId;
    const line = session.lines[0];
    quantity = line.quantity;
    unitMinor = line.unitAmount.amountMinor;
    $('ec-line-title').textContent = line.title;
    $('ec-line-variant').textContent = line.variantTitle;
    updateTotals();
  }

  async function placeOrder() {
    showError('');
    const address = readAddress();
    if (!addressComplete(address)) {
      showAddressForm();
      showError('Add a complete delivery address to place your COD order.');
      return;
    }
    renderAddressSummary(address);
    const buttons = [$('ec-place-desktop'), $('ec-place-mobile')];
    for (const button of buttons) if (button) button.disabled = true;
    const response = await fetch('/v1/demo/cod-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sessionId: $('ec-sessionId').value,
        ...address,
      }),
    });
    const body = await response.json().catch(() => null);
    for (const button of buttons) if (button) button.disabled = false;
    if (!response.ok) {
      showError(body?.error?.message || 'Could not place the order.');
      return;
    }
    $('ec-success').hidden = false;
    $('ec-success-message').textContent = body.message;
    $('ec-order-id').textContent = body.orderId;
  }

  function bindOnce(root) {
    if (mounted) return;
    mounted = true;

    root.addEventListener('click', (event) => {
      const close = event.target.closest('[data-ec-close]');
      if (close && window.EasyCheckout) window.EasyCheckout.close();
    });

    $('ec-address-toggle').addEventListener('click', () => {
      if ($('ec-address-form').hidden) showAddressForm();
      else if (addressComplete(readAddress())) renderAddressSummary(readAddress());
      else showAddressForm();
    });

    $('ec-save-address').addEventListener('click', () => {
      const address = readAddress();
      if (!addressComplete(address)) {
        showError('Enter a valid mobile, address, and 6-digit PIN.');
        return;
      }
      showError('');
      renderAddressSummary(address);
    });

    $('ec-offers-toggle').addEventListener('click', () => {
      const panel = $('ec-offers-panel');
      const open = panel.hidden;
      panel.hidden = !open;
      $('ec-offers-toggle').textContent = open ? 'Hide' : 'View all';
      $('ec-offers-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    $('ec-summary-coupon').addEventListener('click', () => {
      const panel = $('ec-offers-panel');
      panel.hidden = false;
      $('ec-offers-toggle').textContent = 'Hide';
      $('ec-offers-toggle').setAttribute('aria-expanded', 'true');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    $('ec-qty-dec').addEventListener('click', () => {
      quantity = Math.max(1, quantity - 1);
      updateTotals();
    });
    $('ec-qty-inc').addEventListener('click', () => {
      quantity = Math.min(99, quantity + 1);
      updateTotals();
    });

    $('ec-place-desktop').addEventListener('click', () => void placeOrder());
    $('ec-place-mobile').addEventListener('click', () => void placeOrder());
  }

  window.EasyCheckoutApp = {
    async mount(root) {
      bindOnce(root);
      showAddressForm();
      $('ec-address-toggle').textContent = 'Change';
      await loadSession();
    },
  };
})();
