import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { loadConfig, saveConnection, publicOrigin } from '../src/config.mjs';
import { startHost } from '../src/host.mjs';
import { ensureHost, stopHost, hostStatus } from '../src/control.mjs';
import { pairingUrl, pairingQr, pairingLines, mobileUrl } from '../src/pairing.mjs';
import { until } from './helpers.mjs';

async function environment(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-control-'));
  const env = { PI_REMOTE_HOME: dir, PI_REMOTE_PORT: undefined, PI_REMOTE_PUBLIC_URL: undefined, PI_REMOTE_RELAY_URL: undefined, PI_REMOTE_SESSION_DIRS: dir };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const config = { ...loadConfig(dir), port, publicUrl: 'https://remote.example' };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  t.after(async () => {
    await stopHost(config);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, config };
}

test('background host starts once, survives callers, and stops without signalling Pi', async t => {
  const { dir, config } = await environment(t);
  assert.equal(await hostStatus(config), null);
  const results = await Promise.allSettled([ensureHost(config, dir), ensureHost(config, dir)]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const [first, second] = results.map(result => result.value);
  assert.equal(first.pid, second.pid);
  assert.notEqual(first.pid, process.pid);
  assert.equal((await ensureHost(config, dir)).pid, first.pid);
  assert.equal((await hostStatus(config)).publicUrl, config.publicUrl);
  assert.equal(statSync(join(dir, 'host.log')).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(dir, 'host.log'), 'utf8').includes(config.clientToken));
  assert.equal(await stopHost(config), true);
  assert.equal(await stopHost(config), false);
  assert.equal(existsSync(join(dir, 'locks', 'service.json')), false);
  const restarted = await ensureHost(config, dir);
  assert.notEqual(restarted.pid, first.pid);
});

test('host control requires the local bridge credential and rejects browser origins', async t => {
  const { dir, config } = await environment(t);
  const host = await startHost({ dir, config, roots: [] });
  t.after(() => host.close());
  const url = 'http://127.0.0.1:' + config.port + '/_pi/remote';
  for (const headers of [{}, { Authorization: 'Bearer ' + config.clientToken },
    { Authorization: 'Bearer ' + config.bridgeToken, Origin: config.publicUrl }]) {
    assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 403);
  }
  const status = await hostStatus(config);
  assert.equal(status.pid, process.pid);
  assert.ok(!JSON.stringify(status).includes(config.clientToken));
  await stopHost(config);
  await Promise.all([host.close(), host.close()]);
});

test('setup persists only validated origins and QR decodes to the private fragment link', async t => {
  const { dir, config } = await environment(t);
  delete process.env.PI_REMOTE_RELAY_URL;
  saveConnection('https://phone.example/', true, dir);
  const saved = loadConfig(dir);
  assert.equal(saved.publicUrl, 'https://phone.example');
  assert.equal(saved.relayUrl, 'wss://phone.example');
  assert.equal(saved.clientToken, config.clientToken);
  assert.equal(statSync(join(dir, 'config.json')).mode & 0o777, 0o600);
  for (const value of ['http://phone.example', 'https://user:secret@phone.example', 'https://phone.example/path', 'https://phone.example/?x=1', 'https://phone.example/#token=bad']) {
    assert.throws(() => publicOrigin(value));
  }
  assert.equal(mobileUrl('http://127.0.0.1:8787'), false);
  assert.equal(mobileUrl('https://localhost'), false);
  const url = pairingUrl(saved);
  assert.equal(new URL(url).hash, '#token=' + config.clientToken);
  const code = pairingQr(url), lines = code.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  const scale = 4, width = lines[0].length * scale, height = lines.length * 2 * scale;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const glyph = lines[Math.floor(y / (scale * 2))][Math.floor(x / scale)];
    const top = Math.floor(y / scale) % 2 === 0;
    const white = glyph === '█' || (top ? glyph === '▀' : glyph === '▄');
    const offset = (y * width + x) * 4;
    pixels.set([white ? 255 : 0, white ? 255 : 0, white ? 255 : 0, 255], offset);
  }
  assert.equal(jsQR(pixels, width, height)?.data, url);
  assert.ok(pairingLines(url, code, 100, 60).some(line => line.includes('█')));
  for (const [columns, rows] of [[30, 60], [100, 20]]) {
    const rendered = pairingLines(url, code, columns, rows);
    assert.ok(rendered.every(line => line.length <= columns));
    assert.ok(!rendered.some(line => line.includes('█')));
    assert.match(rendered.join(''), /Enlarge the terminal/);
  }
});

test('/pi-remote sets up once, displays UI-only QR, survives reload, and stops the shared host', async t => {
  const { dir, config } = await environment(t);
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...config, publicUrl: 'http://127.0.0.1:' + config.port }));
  const file = join(dir, 'session.jsonl'); writeFileSync(file, '');
  const handlers = new Map(), commands = new Map(), notices = [], statuses = [], screens = [];
  const pi = {
    on(name, handler) { const list = handlers.get(name) || []; list.push(handler); handlers.set(name, list); },
    registerCommand(name, command) { commands.set(name, command); }, getSessionName: () => 'Control test'
  };
  let inputs = 0, confirmations = 0;
  const ctx = { mode: 'tui', cwd: dir,
    sessionManager: { getSessionFile: () => file, getSessionId: () => 'test', getBranch: () => [] },
    ui: {
      notify: (text, type) => notices.push({ text, type }), setStatus: (_key, text) => statuses.push(text),
      select: async () => assert.fail('Relay setup must not ask users to choose a transport'),
      input: async () => { inputs++; return 'https://phone.example'; },
      confirm: async () => { confirmations++; return true; },
      custom: async factory => {
        let closed = false;
        const component = factory({ terminal: { rows: 60 } }, {}, { matches: (key, name) => key === 'esc' && name === 'tui.select.cancel' }, () => { closed = true; });
        screens.push(component.render(100));
        component.handleInput('esc'); assert.equal(closed, true);
      }
    }
  };
  const emit = async name => { for (const handler of handlers.get(name) || []) await handler({}, ctx); };
  (await import('../extension/index.ts')).default(pi);
  t.after(() => emit('session_shutdown'));
  await emit('session_start');
  const run = args => commands.get('pi-remote').handler(args, ctx);
  const input = ctx.ui.input, confirm = ctx.ui.confirm;
  ctx.ui.input = async () => undefined;
  await run('');
  assert.equal(await hostStatus(config), null);
  assert.equal(screens.length, 0);
  ctx.ui.input = input;
  ctx.ui.confirm = async () => false;
  await run('');
  assert.equal(await hostStatus(config), null);
  assert.equal(loadConfig(dir).relayUrl, '');
  assert.equal(screens.length, 0);
  ctx.ui.confirm = confirm;
  await run('');
  assert.equal(notices.filter(x => x.type === 'error').length, 0, JSON.stringify(notices));
  const first = await hostStatus(loadConfig(dir));
  assert.ok(first);
  assert.equal(first.publicUrl, 'https://phone.example');
  assert.equal(first.relayUrl, 'wss://phone.example');
  assert.equal(inputs, 2); assert.equal(confirmations, 1);
  assert.ok(screens[0].join('').includes(config.clientToken));
  assert.ok(!JSON.stringify(notices).includes(config.clientToken));
  await until(() => statuses.includes('remote connected'));
  await emit('session_shutdown'); await emit('session_start');
  await run('start');
  assert.equal((await hostStatus(loadConfig(dir))).pid, first.pid);
  assert.equal(inputs, 2); assert.equal(confirmations, 1);
  await commands.get('remote').handler('off', ctx);
  assert.equal(statuses.at(-1), 'remote off');
  await run('');
  assert.notEqual(statuses.at(-1), 'remote off');
  ctx.mode = 'rpc';
  await run('');
  assert.match(notices.at(-1).text, /interactive Pi terminal/);
  ctx.mode = 'tui';
  await run('status');
  assert.match(notices.at(-1).text, /running/);
  await run('stop');
  assert.equal(await hostStatus(loadConfig(dir)), null);
  assert.equal(existsSync(join(dir, 'locks', 'service.json')), false);
  assert.equal(readFileSync(file, 'utf8'), '');
});
