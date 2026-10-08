import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { connectionScreen, openTunnel, deploymentScreen, checkRelay, verifyRelay, relayGone } from '../src/setup.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { e2eKey } from '../src/e2e.mjs';
import { until } from './helpers.mjs';

const config = { relayToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), bridgeToken: 'b'.repeat(40) };
const keys = { matches: (key, name) => key === name.replace('tui.select.', '') };

test('deployment guide shows one step at a time and shows both tokens on one screen', async () => {
  const tui = { terminal: { rows: 20 }, requestRender() {} };
  const opened = [], copied = [];
  let result;
  const screen = deploymentScreen(config, tui, keys, value => { result = value; }, { open: url => opened.push(url),
    copy: async text => { copied.push(text); return copied.length === 1; } });
  const screens = [];
  for (let step = 0; step < 3; step++) {
    const lines = screen.render(40);
    assert.equal(lines.length, 20); // Covers the whole terminal, whatever the step's length.
    // Keys follow the step directly; only padding comes after them.
    const keysAt = lines.findIndex(line => line.includes('Esc Cancel'));
    assert.ok(keysAt > 0 && lines.slice(keysAt + 1).every(line => line === ''), lines.join('|'));
    assert.ok(lines.every(line => line.length <= 40));
    screens.push(lines.join(''));
    if (step === 0) assert.match(screens[0], /free plan.*Enter Open in browser/); // Enter opens the page and moves on.
    if (step === 1) {
      assert.match(screens[1], /name the Blueprint\s*pi-remote-[a-z0-9-]+,/); // The deploy link cannot prefill it.
      screen.handleInput('o'); // Render's sign-up drops the deploy page.
    }
    if (step === 1) {
      screen.handleInput('1'); await new Promise(resolve => setImmediate(resolve));
      assert.match(screen.render(40).join(''), /Copied PI_REMOTE_RELAY_HOST_TOKEN/);
      screen.handleInput('2'); await new Promise(resolve => setImmediate(resolve));
      assert.match(screen.render(40).join(''), /Could not copy/);
    }
    if (step === 2) {
      // The address is typed in the guide; invalid addresses stay on screen with a hint.
      for (const key of 'http://x.onrender.com') screen.handleInput(key);
      screen.handleInput('confirm');
      assert.match(screen.render(40).join(''), /Use the https:\/\/ address/);
      assert.equal(result, undefined);
      for (const _ of 'http://x.onrender.com') screen.handleInput('\x7f');
      screen.handleInput('\x7f'); // Backspace on an empty address goes back.
      assert.match(screen.render(40).join(''), /Step 2 of 3/);
      screen.handleInput('confirm');
      screen.handleInput('\x1b[200~https://x.onrender.com/\x1b[201~');
    }
    screen.handleInput('confirm');
  }
  const deploy = 'https://render.com/deploy?repo=https://github.com/peterlimg/pi-remote/tree/main';
  assert.deepEqual(opened, [deploy, deploy]);
  assert.deepEqual(copied, [config.relayToken, config.clientToken]);
  assert.deepEqual(screens.map(text => [text.includes(config.relayToken), text.includes(config.clientToken)]),
    [[false, false], [true, true], [false, false]]);
  assert.doesNotMatch(screens.join(''), /npm install|relay-env|#token=/);
  assert.equal(result, 'https://x.onrender.com');
  const again = deploymentScreen(config, tui, keys, value => { result = value; }, { open() {}, copy: async () => true });
  again.handleInput('confirm'); again.handleInput('b');
  assert.match(again.render(80).join('\n'), /Step 1 of 3 · Deploy your relay\nOpen the Render deploy page/);
  again.handleInput('cancel');
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
    const component = factory({ terminal: { rows: 6 } }, undefined, keys, value => { component.dispose(); resolve(value); });
    const lines = component.render(80);
    assert.match(lines.join(''), /Checking phone login/);
    assert.equal(lines.length, 6); // Covers the conversation instead of a box over its middle.
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
    const component = factory({ terminal: { rows: 6 } }, undefined, keys, resolve);
    assert.match(component.render(80).join(''), /Checking phone login/);
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

test('connection screen offers opentunnel first and Render as the alternative', () => {
  const results = [];
  for (const key of ['confirm', 'R', 'cancel']) {
    const screen = connectionScreen({ terminal: { rows: 20 } }, keys, value => results.push(value));
    const lines = screen.render(40);
    assert.equal(lines.length, 20);
    assert.ok(lines.every(line => line.length <= 40));
    assert.match(lines.join(' '), /npm install -g opentunnel/);
    screen.handleInput(key);
  }
  assert.deepEqual(results, ['opentunnel', 'render', false]);
});

test('openTunnel returns the printed address and explains failures', async () => {
  const fake = (error, stdout, stderr) => (_file, args, _options, callback) => { assert.deepEqual(args, ['route', 'add', 'pi-remote', '8787']); callback(error, stdout, stderr); };
  assert.equal(await openTunnel(8787, undefined, fake(null, 'Tunnel is ready.\nAdded route\nhttps://pi-remote.abc.opentunnel.xyz\n')),
    'https://pi-remote.abc.opentunnel.xyz');
  await assert.rejects(openTunnel(8787, undefined, fake(Object.assign(new Error('spawn'), { code: 'ENOENT' }))), /npm install -g opentunnel/);
  await assert.rejects(openTunnel(8787, undefined, fake(new Error('exit 1'), '', 'starting\nerror: rate limited\n')), /opentunnel failed: error: rate limited/);
  await assert.rejects(openTunnel(8787, undefined, fake(null, 'http://pi-remote.abc.opentunnel.xyz\n')), /did not print an https address/);
});
