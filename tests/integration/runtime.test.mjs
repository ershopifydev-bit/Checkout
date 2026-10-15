import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

async function listenOnFreePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert(address && typeof address === 'object');
  return { socket, port: address.port };
}

function launch(t, environment) {
  const child = spawn(process.execPath, ['apps/api/dist/server.js'], {
    env: { ...process.env, HOST: '127.0.0.1', LOG_LEVEL: 'info', ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const exited = once(child, 'exit');
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return { child, exited, output: () => output };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`compiled API serves HTTP and shuts down on ${signal}`, { timeout: 10000 }, async (t) => {
    const { socket, port } = await listenOnFreePort();
    await new Promise((resolve) => socket.close(resolve));
    const running = launch(t, { PORT: String(port) });
    const deadline = Date.now() + 5000;
    while (!running.output().includes('Server listening at')) {
      assert.equal(running.child.exitCode, null, running.output());
      assert(Date.now() < deadline, 'API did not start within 5 seconds');
      await delay(20);
    }
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ready', scope: 'foundation' });
    running.child.kill(signal);
    assert.deepEqual(await running.exited, [0, null], running.output());
    assert(!running.output().includes('FastifyDeprecation'), running.output());
    await assert.rejects(globalThis.fetch(`http://127.0.0.1:${port}/health/ready`));
  });
}

test(
  'invalid startup configuration exits unsuccessfully without leaking values',
  { timeout: 10000 },
  async (t) => {
    const running = launch(t, { PORT: 'private-config-value' });
    assert.deepEqual(await running.exited, [1, null]);
    assert.match(running.output(), /API startup failed/);
    assert(!running.output().includes('private-config-value'));
  },
);

test('an occupied listener exits unsuccessfully without hanging', { timeout: 10000 }, async (t) => {
  const { socket, port } = await listenOnFreePort();
  t.after(() => new Promise((resolve) => socket.close(resolve)));
  const running = launch(t, { PORT: String(port) });
  assert.deepEqual(await running.exited, [1, null]);
  assert.match(running.output(), /API listener failed to start/);
});
