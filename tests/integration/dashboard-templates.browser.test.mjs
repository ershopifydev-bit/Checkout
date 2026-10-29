import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

// Local fixture API only: no merchant credentials, live writes, or external services.
const user = {
  _id: 'fixture-user',
  name: 'Alex Morgan',
  email: 'alex@example.test',
  role: 'ADMIN',
  isActive: true,
};
const orders = [
  {
    _id: 'attempt-1001',
    shop: 'studio.myshopify.com',
    status: 'CONFIRMED',
    shopifyOrderName: '#1042',
    formattedAmount: '₹3,638.25',
    createdAt: '2026-10-29T09:00:00Z',
  },
  {
    _id: 'attempt-1002',
    shop: 'studio.myshopify.com',
    status: 'MANUAL_REVIEW',
    shopifyOrderName: '#1041',
    formattedAmount: '₹2,450.00',
    createdAt: '2026-10-29T08:45:00Z',
  },
];
const monitor = {
  database: {
    status: 'HEALTHY',
    databaseName: 'checkout',
    latencyMs: 3,
    totalCollections: 12,
    storageStats: { totalObjects: 8420, storageSizeMb: 24, indexSizeMb: 4 },
  },
  ordersAndAttempts: {
    totalAttempts: 128,
    confirmed: 112,
    failed: 4,
    manualReview: 12,
    confirmedRevenue: { minor: 38425000, formatted: '₹3,84,250' },
    failureRatePercent: 3.1,
  },
  funnelsAndCheckouts: {
    totalFunnelSessions: 356,
    totalAbandoned: 48,
    conversionRatePercent: 31.5,
  },
  latestAttempts: orders,
};
const analytics = {
  funnel: {
    totalStarted: 356,
    totalAddressAdded: 242,
    totalDiscountApplied: 180,
    totalCompleted: 112,
    totalAbandoned: 48,
    conversionRatePercent: 31.5,
  },
  abandoned: [],
};

async function until(check, message = 'condition', timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function connect(url) {
  const socket = new globalThis.WebSocket(url);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(String(data));
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text);
    const task = pending.get(event.id);
    if (task) {
      pending.delete(event.id);
      if (event.error) task.reject(new Error(event.error.message));
      else task.resolve(event.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description || response.exceptionDetails.text,
      );
    return response.result.value;
  };
  return { send, evaluate, errors, close: () => socket.close() };
}

test(
  'dashboard templates preserve views, settings APIs and browser preference',
  { timeout: 90000 },
  async (t) => {
    const root = resolve('apps/shopify-admin/public/dashboard');
    const screenshots =
      process.env.DASHBOARD_SCREENSHOT_DIR || join(tmpdir(), 'tezvix-dashboard-templates');
    await mkdir(screenshots, { recursive: true });
    let settings = {
      shop: 'studio.myshopify.com',
      brandMode: 'name',
      brandName: 'Studio',
      logoUrl: '',
      requireCodConfirmation: true,
      showUpsell: true,
      payments: { cod: true, upi: false, card: false, netbanking: false },
    };
    const requests = [];
    const writes = [];
    let ordersFail = false;
    let emptyOrders = false;
    const server = createServer(async (req, res) => {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        requests.push(`${req.method} ${path}`);
        res.setHeader('content-type', 'application/json');
        if (path === '/api/settings') {
          if (req.method === 'PUT') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            writes.push(body);
            settings = { ...settings, ...body };
          }
          res.end(JSON.stringify(settings));
        } else if (path === '/api/auth/me') res.end(JSON.stringify({ user }));
        else if (path === '/api/monitor/overview') res.end(JSON.stringify(monitor));
        else if (path === '/api/analytics') res.end(JSON.stringify(analytics));
        else if (path === '/api/orders') {
          res.statusCode = ordersFail ? 503 : 200;
          res.end(
            JSON.stringify({
              orders: emptyOrders ? [] : orders,
              total: emptyOrders ? 0 : orders.length,
            }),
          );
        } else res.end('{}');
        return;
      }
      try {
        const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
        if (!file.startsWith(root + '/')) throw new Error('invalid path');
        const data = await readFile(file);
        const types = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        };
        res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
        res.end(
          extname(file) === '.html'
            ? data.toString().replace(/<link[^>]+href="https:\/\/fonts\.[\s\S]*?>/g, '')
            : data,
        );
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const profile = await mkdtemp(join(tmpdir(), 'tezvix-template-chrome-'));
    const chrome = spawn(
      process.env.CHROME_BIN || 'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-background-networking',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    t.after(async () => {
      chrome.kill();
      await once(chrome, 'exit');
      await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    });
    const port = await until(async () => {
      try {
        return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      } catch {
        return null;
      }
    }, 'Chrome startup');
    const pages = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const browser = await connect(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    t.after(() => browser.close());
    const { send, evaluate } = browser;
    await send('Runtime.enable');
    await send('Page.enable');
    const viewport = (width) =>
      send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
    const screenshot = async (name) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(screenshots, name + '.png'), Buffer.from(data, 'base64'));
    };
    const click = (selector) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const choose = async (id) => {
      await click(`[data-template-option="${id}"]`);
      await until(
        () => evaluate(`document.documentElement.dataset.dashboardTemplate === '${id}'`),
        'template ' + id,
      );
    };
    const navigate = async (name) => {
      await evaluate(
        `[...document.querySelectorAll('#nav button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(name)})).click()`,
      );
      await until(
        () => evaluate(`document.querySelector('#view').dataset.view === ${JSON.stringify(name)}`),
        'tab ' + name,
      );
    };
    await viewport(1440);
    await send('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/?token=local-fixture-token&shop=studio.myshopify.com`,
    });
    await until(
      () => evaluate(`document.querySelector('#view')?.textContent.includes('₹3,84,250')`),
      'fixture data',
    );
    assert.equal(await evaluate(`document.documentElement.dataset.dashboardTemplate`), 'classic');
    const tabs = await evaluate(
      `[...document.querySelectorAll('#nav button')].map(b => b.textContent)`,
    );
    await screenshot('classic-desktop');
    const requestCount = requests.length;
    await choose('workspace');
    assert.deepEqual(
      await evaluate(`[...document.querySelectorAll('#nav button')].map(b => b.textContent)`),
      tabs,
    );
    assert.equal(requests.length, requestCount, 'switching layouts must not refetch data');
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('#nav')).position`),
      'fixed',
    );
    await screenshot('workspace-desktop');
    await evaluate(`document.querySelector('[data-template-option="classic"]').focus()`);
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await until(
      () => evaluate(`document.documentElement.dataset.dashboardTemplate === 'classic'`),
      'keyboard template switch',
    );
    await choose('workspace');
    await navigate('Orders');
    await until(
      () => evaluate(`document.querySelector('#view').textContent.includes('#1042')`),
      'orders',
    );
    await evaluate(
      `window.__orderInput = document.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(window.__orderInput,'#1042'); window.__orderInput.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await choose('classic');
    assert.equal(
      await evaluate(
        `document.querySelector('input[type="search"]') === window.__orderInput && window.__orderInput.value === '#1042'`,
      ),
      true,
    );
    await choose('workspace');
    await navigate('Settings');
    await evaluate(
      `window.__brandInput = [...document.querySelectorAll('.fld')].find(e=>e.querySelector('label')?.textContent==='Brand name').querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(window.__brandInput,'Draft brand'); window.__brandInput.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await choose('classic');
    assert.equal(
      await evaluate(
        `window.__brandInput.isConnected && window.__brandInput.value === 'Draft brand'`,
      ),
      true,
    );
    const save = () =>
      evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Save all settings').click()`,
      );
    await save();
    await until(() => writes.length === 1, 'Classic save');
    assert.equal(writes[0].brandName, 'Draft brand');
    await choose('workspace');
    await until(
      () =>
        evaluate(
          `![...document.querySelectorAll('button')].find(b=>b.textContent==='Save all settings')?.disabled`,
        ),
      'save ready',
    );
    await save();
    await until(() => writes.length === 2, 'Workspace save');
    assert.deepEqual(writes[1], writes[0], 'templates use the same settings payload');
    assert.equal(
      'template' in writes[1],
      false,
      'layout preference is separate from merchant data',
    );
    await send('Page.reload');
    await until(
      () =>
        evaluate(
          `document.querySelector('#view') && document.documentElement.dataset.dashboardTemplate === 'workspace'`,
        ),
      'saved template',
    );
    await click('#portal button:nth-child(2)');
    await until(
      () => evaluate(`document.querySelector('#view').dataset.view==='Overview'`),
      'internal portal',
    );
    const internalTabs = await evaluate(
      `[...document.querySelectorAll('#nav button')].map(b => b.textContent)`,
    );
    await choose('classic');
    assert.deepEqual(
      await evaluate(`[...document.querySelectorAll('#nav button')].map(b => b.textContent)`),
      internalTabs,
    );
    await choose('workspace');
    await click('#portal button:first-child');
    await navigate('Orders');
    ordersFail = true;
    await evaluate(
      `[...document.querySelectorAll('#view button')].find(b=>b.textContent.includes('Refresh')).click()`,
    );
    await until(
      () =>
        evaluate(
          `document.querySelector('#view').textContent.includes('Could not load orders (503)')`,
        ),
      'API error state',
    );
    ordersFail = false;
    emptyOrders = true;
    await evaluate(
      `[...document.querySelectorAll('#view button')].find(b=>b.textContent.includes('Retry connection')).click()`,
    );
    await until(
      () =>
        evaluate(`document.querySelector('#view').textContent.includes('No order attempts found')`),
      'empty state',
    );
    await navigate('Dashboard');
    for (const width of [320, 768, 1024, 1440]) {
      await viewport(width);
      assert.equal(
        await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
        true,
        `no page overflow at ${width}px`,
      );
      if (width <= 900) {
        assert.equal(
          await evaluate(`getComputedStyle(document.querySelector('#nav')).display`),
          'none',
        );
        await click('.dashboard-menu-toggle');
        assert.notEqual(
          await evaluate(`getComputedStyle(document.querySelector('#nav')).display`),
          'none',
        );
        await navigate('Orders');
        assert.equal(
          await evaluate(
            `document.querySelector('.dashboard-menu-toggle').getAttribute('aria-expanded')`,
          ),
          'false',
        );
        await navigate('Dashboard');
      }
      for (const page of ['Orders', 'Settings']) {
        await navigate(page);
        assert.equal(
          await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
          true,
          `${page} fits ${width}px`,
        );
      }
      await navigate('Dashboard');
      if (width === 320) await screenshot('workspace-mobile');
    }
    await click('#rt');
    await until(() => evaluate(`document.documentElement.dataset.theme==='dark'`), 'dark theme');
    await screenshot('workspace-dark');
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('.tezvix-brand-dark')).display`),
      'block',
    );
    assert.deepEqual(browser.errors, [], 'no uncaught browser exceptions');
    console.log(
      `Verified Classic/Workspace, both portals, settings PUT, state preservation, reload, error/empty states and 4 viewport widths. Screenshots: ${screenshots}`,
    );
  },
);
