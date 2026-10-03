import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { deploymentScreen, checkRelay, verifyRelay, relayGone } from '../src/setup.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { e2eKey } from '../src/e2e.mjs';
import { until } from './helpers.mjs';

const config = { relayToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), bridgeToken: 'b'.repeat(40) };
const keys = { matches: (key, name) => key === name.replace('tui.select.', '') };

test('deployment guide shows one step at a time and keeps each token on its own screen', async () => {
  const tui = { terminal: { rows: 12 }, requestRender() {} };
  const opened = [], copied = [];
  let result;
  const screen = deploymentScreen(config, tui, keys, value => { result = value; }, { open: url => opened.push(url),
    copy: async text => { copied.push(text); return copied.length === 1; } });
  assert.match(screen.render(40).join(' '), /already have a Pi Remote relay/);
  screen.handleInput('confirm'); // Only an answer leaves the question.
  screen.handleInput('n');
  const screens = [];
  for (let step = 0; step < 5; step++) {
    const lines = screen.render(40);
    assert.equal(lines.length, 12); // Covers the whole terminal, whatever the step's length.
    // Keys follow the step directly; only padding comes after them.
    const keysAt = lines.findIndex(line => line.includes('Esc Cancel'));
    assert.ok(keysAt > 0 && lines.slice(keysAt + 1).every(line => line === ''), lines.join('|'));
    assert.ok(lines.every(line => line.length <= 40));
    screens.push(lines.join(''));
    screen.handleInput('O'); screen.handleInput('c');
    await new Promise(resolve => setImmediate(resolve));
    if (step === 2) assert.match(screen.render(40).join(''), /Copied to the clipboard/);
    if (step === 3) assert.match(screen.render(40).join(''), /Could not copy/);
    screen.handleInput('confirm');
  }
  // Render's sign-up drops the deploy link, so sign-up comes first.
  assert.deepEqual(opened, ['https://dashboard.render.com/register', 'https://render.com/deploy?repo=https://github.com/peterlimg/pi-remote/tree/main']);
  assert.deepEqual(copied, [config.relayToken, config.clientToken]);
  assert.deepEqual(screens.map(text => [text.includes(config.relayToken), text.includes(config.clientToken)]),
    [[false, false], [false, false], [true, false], [false, true], [false, false]]);
  assert.doesNotMatch(screens.join(''), /npm install|relay-env|#token=/);
  assert.equal(result, true);
  const again = deploymentScreen(config, tui, keys, value => { result = value; }, { open() {}, copy: async () => true });
  again.handleInput('n'); again.handleInput('confirm'); again.handleInput('b');
  assert.match(again.render(80).join('\n'), /Step 1 of 5 · Deploy a new relay\nCreate a free Render account/);
  again.handleInput('b');
  assert.match(again.render(80).join('\n'), /already have a Pi Remote relay/);
  again.handleInput('cancel');
  assert.equal(result, false);
});

test('an existing relay gets this computer\'s tokens instead of a second deployment', () => {
  const opened = [], screens = [];
  let result;
  const screen = deploymentScreen(config, { terminal: { rows: 20 }, requestRender() {} }, keys, value => { result = value; },
    { open: url => opened.push(url), copy: async () => true });
  screen.handleInput('Y');
  for (let step = 0; step < 4; step++) { screens.push(screen.render(80).join('\n')); screen.handleInput('o'); screen.handleInput('confirm'); }
  assert.deepEqual(opened, ['https://dashboard.render.com']);
  assert.match(screens[0], /Step 1 of 4 · Use your relay\nOpen your relay in Render/);
  assert.ok(screens[1].includes(config.relayToken) && screens[2].includes(config.clientToken));
  assert.doesNotMatch(screens.join(''), /render\.com\/deploy/);
  assert.equal(result, true);
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

test('only a definite non-relay answer marks a saved relay as gone', async () => {
  let status = 404;
  const http = createServer((_req, res) => { res.statusCode = status; res.end(status === 200 ? 'ok' : 'Not Found'); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + http.address().port;
  assert.equal(await relayGone(origin), true); // Render's reply for a deleted service.
  status = 200; assert.equal(await relayGone(origin), false); // A relay.
  status = 503; assert.equal(await relayGone(origin), false); // Restarting.
  http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  assert.equal(await relayGone(origin), false); // Unreachable may be temporary.
});
