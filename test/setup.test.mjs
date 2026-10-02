import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { deploymentScreen, checkRelay, verifyRelay } from '../src/setup.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { e2eKey } from '../src/e2e.mjs';
import { until } from './helpers.mjs';

const config = { relayToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), bridgeToken: 'b'.repeat(40) };
const keys = { matches: (key, name) => key === name.replace('tui.select.', '') };

test('deployment guide keeps tokens UI-only and scrolls within narrow terminal bounds', () => {
  const tui = { terminal: { rows: 12 }, requestRender() {} };
  let result;
  const screen = deploymentScreen(config, tui, keys, value => { result = value; });
  const visible = [];
  for (let i = 0; i < 100; i++) {
    const lines = screen.render(40);
    assert.ok(lines.length <= 12);
    assert.ok(lines.every(line => line.length <= 40));
    visible.push(...lines);
    screen.handleInput('down');
  }
  const text = visible.join('');
  assert.ok(text.includes(config.relayToken));
  assert.ok(text.includes(config.clientToken));
  // Check the complete deployment link without terminal wrapping.
  const wide = deploymentScreen(config, { ...tui, terminal: { rows: 60 } }, keys, () => {}).render(120).join('\n');
  assert.match(wide, /https:\/\/render.com\/deploy\?repo=https:\/\/github.com\/peterlimg\/pi-remote\/tree\/main/);
  assert.match(wide, /No fork/);
  assert.doesNotMatch(wide, /npm install|relay-env|#token=/);
  screen.handleInput('confirm');
  assert.equal(result, true);
  screen.handleInput('cancel');
  assert.equal(result, false);
});

test('relay verification waits for a real host and rejects a wrong phone token', async t => {
  // Reserve the server port so the relay can enforce its exact browser origin.
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const publicUrl = 'http://127.0.0.1:' + port;
  const relay = await startRelay({ hostToken: config.relayToken, clientToken: config.clientToken, publicUrl, port });
  const service = new EventEmitter(); service.list = () => ({ sessions: [] });
  let disconnect;
  t.after(async () => { disconnect?.(); await relay.close(); });
  const options = { ...config, publicUrl };
  let verified = false;
  const pending = verifyRelay(options, AbortSignal.timeout(8000)).then(() => { verified = true; });
  // The probe must not accept an online relay with an offline computer.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(verified, false);
  disconnect = connectRelay(service, publicUrl.replace('http:', 'ws:'), config.relayToken, { key: e2eKey(config), allowInsecure: true });
  await pending;
  assert.equal(verified, true);
  const ui = { custom: factory => new Promise(resolve => {
    const component = factory({}, {}, keys, value => { component.dispose(); resolve(value); });
    assert.match(component.render(80).join(''), /Checking relay/);
  }) };
  assert.equal(await checkRelay(ui, options), true);
  await assert.rejects(checkRelay(ui, { ...options, clientToken: 'wrong' }), /client token/);
  await until(() => service.listenerCount('list') === 0);
});

test('a silent verification is bounded and cancellation closes its socket', async t => {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close(); await new Promise(resolve => http.close(resolve));
  });
  const options = { ...config, publicUrl: 'http://127.0.0.1:' + http.address().port };
  await assert.rejects(verifyRelay(options, AbortSignal.timeout(100)), /Timed out/);
  await until(() => wss.clients.size === 0);
  const controller = new AbortController();
  const pending = verifyRelay(options, controller.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  await until(() => wss.clients.size === 1);
  controller.abort();
  await rejected;
  await until(() => wss.clients.size === 0);

  const ui = { custom: factory => new Promise(resolve => {
    const component = factory({}, {}, keys, resolve);
    assert.match(component.render(80).join(''), /Checking relay/);
    component.handleInput('cancel');
    component.dispose();
  }) };
  assert.equal(await checkRelay(ui, options), false);
  await until(() => wss.clients.size === 0);
});

test('verification retries an open relay connection that goes silent instead of waiting 20 s', async t => {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(resolve => http.close(resolve)); });
  let connections = 0;
  wss.on('connection', () => connections++); // Lost notices and close frames look like silence.
  const started = Date.now();
  await assert.rejects(verifyRelay({ ...config, publicUrl: 'http://127.0.0.1:' + http.address().port }, AbortSignal.timeout(7500)), /Timed out/);
  assert.ok(connections >= 2, 'retried within ' + (Date.now() - started) + ' ms');
});
