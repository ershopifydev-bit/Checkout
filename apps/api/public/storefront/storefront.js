function bind(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function openCheckout() {
  if (window.EasyCheckout && typeof window.EasyCheckout.open === 'function') {
    window.EasyCheckout.open();
    return;
  }
  console.error('Checkout embed failed to load');
}

bind('buyNow', openCheckout);
bind('addCheckout', openCheckout);
bind('openCart', openCheckout);

if (new URLSearchParams(window.location.search).get('checkout') === 'open') {
  window.addEventListener('load', openCheckout);
}
