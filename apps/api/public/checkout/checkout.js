const linesEl = document.getElementById('lines');
const totalEl = document.getElementById('total');
const sessionIdEl = document.getElementById('sessionId');
const form = document.getElementById('codForm');
const formError = document.getElementById('formError');
const success = document.getElementById('success');
const successMessage = document.getElementById('successMessage');
const orderIdEl = document.getElementById('orderId');
const submit = document.getElementById('submit');
const again = document.getElementById('again');

function formatInr(amountMinor) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function showError(message) {
  formError.hidden = !message;
  formError.textContent = message || '';
}

async function loadSession() {
  showError('');
  success.hidden = true;
  form.hidden = false;
  submit.disabled = true;
  const response = await fetch('/v1/demo/checkout', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    showError('Could not load the demo checkout. Retry in a moment.');
    return;
  }
  const session = await response.json();
  sessionIdEl.value = session.sessionId;
  linesEl.replaceChildren(
    ...session.lines.map((line) => {
      const item = document.createElement('li');
      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = line.title;
      const meta = document.createElement('span');
      meta.textContent = `${line.variantTitle} · Qty ${line.quantity}`;
      left.append(title, meta);
      const price = document.createElement('div');
      price.textContent = formatInr(line.unitAmount.amountMinor * line.quantity);
      item.append(left, price);
      return item;
    }),
  );
  totalEl.textContent = formatInr(session.totals.amountMinor);
  submit.disabled = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  submit.disabled = true;
  const payload = Object.fromEntries(new FormData(form).entries());
  const response = await fetch('/v1/demo/cod-orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    showError(body?.error?.message || 'Could not place the demo order.');
    submit.disabled = false;
    return;
  }
  form.hidden = true;
  success.hidden = false;
  successMessage.textContent = body.message;
  orderIdEl.textContent = body.orderId;
});

again.addEventListener('click', () => {
  form.reset();
  void loadSession();
});

void loadSession();
