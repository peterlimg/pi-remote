import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { loadConfig, saveConnection, publicOrigin } from '../src/config.mjs';
import { startHost } from '../src/host.mjs';
import { ensureHost, stopHost, restartHost, hostStatus } from '../src/control.mjs';
import { pairingUrl, pairingQr, pairingLines, mobileUrl } from '../src/pairing.mjs';
import { e2eKey } from '../src/e2e.mjs';
import { socket, until } from './helpers.mjs';
import { sessionKey, acquireLock } from '../src/locks.mjs';
import { restartAndResume } from '../scripts/restart-and-resume.mjs';
import { fullScreen } from '../src/setup.mjs';

async function environment(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-control-'));
  const env = { PI_REMOTE_HOME: dir, PI_REMOTE_PORT: undefined, PI_REMOTE_PUBLIC_URL: undefined, PI_REMOTE_RELAY_URL: undefined, PI_REMOTE_SESSION_DIRS: dir, PI_REMOTE_PI_BIN: undefined, BROWSER: 'true' };
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

async function remoteList(config) {
  const client = await socket(`ws://127.0.0.1:${config.port}/ws`, config.clientToken, `http://127.0.0.1:${config.port}`);
  try { return (await client.request('list')).value; }
  finally { client.ws.terminate(); }
}

for (const flag of ['--allow-resume', '--no-allow-resume']) test(`serve supports ${flag}`, async t => {
  const { dir, config } = await environment(t);
  const file = join(dir, 'saved.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  const child = fork(fileURLToPath(new URL('../bin/pi-remote.mjs', import.meta.url)), ['serve', flag], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  t.after(() => child.kill());
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  assert.equal(message.type, 'ready');
  const list = await remoteList(config), allowed = flag === '--allow-resume';
  assert.equal(list.allowResume, allowed);
  assert.equal(list.sessions.find(session => session.id === sessionKey(file)).resumable, allowed);
  if (!allowed) {
    const client = await socket(`ws://127.0.0.1:${config.port}/ws`, config.clientToken, `http://127.0.0.1:${config.port}`);
    try {
      const result = (await client.request('resume', { sessionId: sessionKey(file) })).value;
      assert.equal(result.ok, false);
      assert.match(result.error, /resume.*disabled/i);
      assert.equal(existsSync(join(dir, 'locks', sessionKey(file) + '.json')), false);
    } finally { client.ws.terminate(); }
  }
});

test('stop keeps waiting after a status timeout once DELETE was accepted', async t => {
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    methods.push(options.method);
    if (methods.length === 1) return Response.json({ protocol: 1, pid: process.pid, closing: false });
    if (methods.length === 2) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  });
  assert.equal(await stopHost({ port: 1, bridgeToken: 'test-only' }), true);
  assert.deepEqual(methods, ['DELETE', 'GET', 'GET']);
});

for (const code of ['ECONNRESET', 'ECONNREFUSED']) {
  for (const phase of ['DELETE', 'GET']) test(`stop tolerates ${code} during ${phase}`, async t => {
    const methods = [];
    t.mock.method(globalThis, 'fetch', async (_url, { method }) => {
      methods.push(method);
      if (method === phase && methods.length <= 2) throw new TypeError('fetch failed', { cause: { code } });
      if (method === 'DELETE') return Response.json({ protocol: 1, pid: process.pid });
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    assert.equal(await stopHost({ port: 1, bridgeToken: 'test-only' }), !(code === 'ECONNREFUSED' && phase === 'DELETE'));
    assert.equal(methods[0], 'DELETE');
    if (code === 'ECONNRESET') assert.equal(methods.at(-1), 'GET');
  });
}

test('stop finishes when the known host exits even if status keeps timing out', async t => {
  let exited = false;
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(pid, 12345); assert.equal(signal, 0);
    if (exited) throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
  });
  t.mock.method(globalThis, 'fetch', async (_url, { method }) => {
    if (method === 'DELETE') return Response.json({ protocol: 1, pid: 12345 });
    exited = true;
    throw new DOMException('Timeout', 'TimeoutError');
  });
  assert.equal(await stopHost({ port: 1, bridgeToken: 'test-only' }), true);
});

test('stop timeouts have an overall deadline and other status errors still fail', async t => {
  let now = 0, failure = 'timeout';
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (_url, { method }) => {
    if (method === 'DELETE') return Response.json({ protocol: 1, pid: process.pid });
    if (failure === 'auth') return new Response('', { status: 403 });
    now += 30001;
    throw new DOMException('Timeout', 'TimeoutError');
  });
  const config = { port: 1, bridgeToken: 'test-only' };
  await assert.rejects(stopHost(config), /still stopping after 30 seconds/);
  failure = 'auth';
  await assert.rejects(stopHost(config), /Cannot control the service/);
});

test('restart retries startup after a failed stop wait and a transient startup status timeout', async t => {
  const { dir, config } = await environment(t);
  const first = await ensureHost(config, dir);
  const fetch = globalThis.fetch;
  let stopping = false, failures = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'DELETE') stopping = true;
    else if (stopping && failures++ < 2) {
      if (failures === 1) throw new Error('Unexpected stop poll failure');
      throw new DOMException('Startup status timed out', 'TimeoutError');
    }
    return fetch(url, options);
  });
  try {
    const restarted = await restartHost(config, dir);
    assert.notEqual(restarted.pid, first.pid);
    assert.ok(failures >= 3);
    assert.equal((await hostStatus(config)).pid, restarted.pid);
    assert.equal((await remoteList(config)).allowResume, true);
  } finally { mock.mock.restore(); }
});

test('restart-and-resume upgrades an old host and starts a replacement after a shutdown reset', async t => {
  const { dir, config } = await environment(t);
  const fakePi = fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url));
  const bin = join(dir, 'fake-pi');
  writeFileSync(bin, `#!${process.execPath}\nimport ${JSON.stringify(new URL('./fixtures/fake-pi.mjs', import.meta.url).href)};\n`, { mode: 0o700 });
  process.env.PI_REMOTE_PI_BIN = bin;
  const file = join(dir, 'saved.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  const id = sessionKey(file);
  const host = await startHost({ dir, config, roots: [dir], allowResume: true,
    workerOptions: { bin: process.execPath, prefix: [fakePi] } });
  t.after(() => host.close());
  assert.equal((await host.service.resume(id, 'initial-resume')).ok, true);
  const terminal = acquireLock(join(dir, 'locks'), 'a'.repeat(64), { kind: 'terminal' });
  t.after(() => terminal.release());
  // The old host closes workers without writing a restore list.
  t.mock.method(host.service, 'close', async () => {
    clearInterval(host.service.timer);
    await Promise.all([...host.service.live.values()].filter(item => item.worker).map(item => item.worker.close()));
  });
  const fetch = globalThis.fetch;
  let deleting = false, reset = false;
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'DELETE') deleting = true;
    else if (deleting && !reset) {
      reset = true;
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    }
    return fetch(url, options);
  });
  let restarted;
  try { restarted = await restartAndResume(config, dir); }
  finally { mock.mock.restore(); }
  assert.equal(reset, true);
  assert.notEqual(restarted.pid, process.pid);
  assert.equal((await hostStatus(config)).pid, restarted.pid);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'resume-sessions.json'), 'utf8')), [id]);
  const client = await socket(`ws://127.0.0.1:${config.port}/ws`, config.clientToken, `http://127.0.0.1:${config.port}`);
  t.after(() => client.ws.terminate());
  assert.equal((await client.request('list')).value.allowResume, true);
  await until(() => client.messages.some(message => message.type === 'sessions' && message.sessions.some(session => session.id === id && session.status === 'idle')));
  assert.equal((await client.request('command', { sessionId: id, command: { type: 'prompt', text: 'restored' } })).value.ok, true);
});

test('restart makes a startup attempt after DELETE fails and reports bounded recovery failure', async t => {
  let now = 0;
  const methods = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (_url, { method }) => {
    methods.push(method); now += 30001;
    throw new DOMException('Timeout', 'TimeoutError');
  });
  await assert.rejects(restartHost({ port: 1, bridgeToken: 'test-only' }, '.'), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /restart failed/);
    return true;
  });
  assert.deepEqual(methods, ['DELETE', 'GET']);
});

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
  assert.equal((await remoteList(config)).allowResume, true);
  assert.equal(statSync(join(dir, 'host.log')).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(dir, 'host.log'), 'utf8').includes(config.clientToken));
  assert.equal(await stopHost(config), true);
  assert.equal(await stopHost(config), false);
  assert.equal(existsSync(join(dir, 'locks', 'service.json')), false);
  const stoppedLog = readFileSync(join(dir, 'host.log'), 'utf8');
  assert.match(stoppedLog, /\d{4}-\d\d-\d\dT[^\n]+ Pi Remote host \d+: stopped: DELETE \/_pi\/remote/);
  execFileSync(process.execPath, [fileURLToPath(new URL('../bin/pi-remote.mjs', import.meta.url)), 'start'], { timeout: 15000 });
  const restarted = await hostStatus(config);
  assert.notEqual(restarted.pid, first.pid);
  assert.equal((await remoteList(config)).allowResume, true);
  execFileSync(process.execPath, [fileURLToPath(new URL('../bin/pi-remote.mjs', import.meta.url)), 'restart'], { timeout: 15000 });
  const cliRestarted = await hostStatus(config);
  assert.notEqual(cliRestarted.pid, restarted.pid);
  assert.equal((await remoteList(config)).allowResume, true);
  process.kill(cliRestarted.pid, 'SIGTERM'); // Only this test's temporary host, never a Pi worker.
  await until(() => readFileSync(join(dir, 'host.log'), 'utf8').includes('stopped: SIGTERM'));
});

test('a host exits once its config is replaced, so a reinstall can take the port', async t => {
  const { dir, config } = await environment(t);
  const { pid } = await ensureHost(config, dir);
  // Deleting ~/.pi/remote and reinstalling recreates the config with new tokens.
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...config, bridgeToken: 'n'.repeat(43) }));
  await until(() => readFileSync(join(dir, 'host.log'), 'utf8').includes('stopped: install or config removed'), 10000);
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
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
  const lines = readFileSync(join(dir, 'host.log'), 'utf8').trim().split('\n');
  assert.equal(lines.filter(line => line.includes('stopping: DELETE')).length, 1);
  assert.equal(lines.filter(line => line.includes('stopped: DELETE')).length, 1);
});

test('host logs a timestamp and reason for startup errors', async t => {
  const { dir, config } = await environment(t);
  const server = createServer();
  await new Promise(resolve => server.listen(config.port, '127.0.0.1', resolve));
  try { await assert.rejects(startHost({ dir, config, roots: [] }), { code: 'EADDRINUSE' }); }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.match(readFileSync(join(dir, 'host.log'), 'utf8'), /\d{4}-\d\d-\d\dT[^\n]+stopped: error:.*EADDRINUSE/);
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
  assert.equal(new URL(url).hash, '#token=' + config.clientToken + '&key=' + e2eKey(config));
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
  let address, verified = false, checks = 0;
  const guides = [];
  const ctx = { mode: 'tui', cwd: dir,
    sessionManager: { getSessionFile: () => file, getSessionId: () => 'test', getBranch: () => [] },
    ui: {
      notify: (text, type) => notices.push({ text, type }), setStatus: (_key, text) => statuses.push(text),
      select: async () => assert.fail('Relay setup must not ask users to choose a transport'),
      input: async () => assert.fail('The relay address is entered in the guide'),
      custom: async (factory, options) => {
        let closed = false, result, resolve;
        const finished = new Promise(r => { resolve = r; });
        const component = factory({ terminal: { rows: 60 }, requestRender() {} }, { fg: (_color, text) => text, bold: text => text },
          { matches: (key, name) => key === name.replace('tui.select.', '') },
          value => { closed = true; result = value; resolve(value); });
        const lines = component.render(120);
        assert.equal(options, fullScreen); // Never a box over the middle of the conversation.
        // The network-backed check is tested with real sockets in setup.test.mjs.
        if (lines[0].includes('Checking relay')) { component.dispose(); checks++; return verified && {}; }
        if (/^(Starting|Checking) Pi Remote/.test(lines[0])) return finished;
        if (lines[0].includes('Deploy your relay')) {
          // Walk every step, so the guide shows both tokens before pasting an address or cancelling.
          const seen = [...lines];
          for (const key of ['confirm', 'confirm']) { component.handleInput(key); seen.push(...component.render(120)); }
          guides.push(seen);
          if (address) { component.handleInput('\x1b[200~' + address + '\x1b[201~'); component.handleInput('confirm'); }
          else component.handleInput('cancel');
        } else {
          assert.equal(verified, true, 'Never show a QR before the relay check succeeds');
          screens.push(lines);
          component.handleInput('cancel');
        }
        assert.equal(closed, true);
        return result;
      }
    }
  };
  const emit = async name => { for (const handler of handlers.get(name) || []) await handler({}, ctx); };
  (await import('../extension/index.ts')).default(pi);
  t.after(() => emit('session_shutdown'));
  await emit('session_start');
  const run = args => commands.get('pi-remote').handler(args, ctx);
  await run(''); // Cancelling the deployment guide must leave configuration untouched and start no host.
  assert.equal(await hostStatus(config), null);
  assert.equal(loadConfig(dir).relayUrl, '');
  assert.equal(screens.length, 0);
  for (const token of [config.relayToken, config.clientToken]) assert.ok(guides[0].join('').includes(token));
  address = 'https://phone.example';
  await run(''); // An unverified relay must not reveal a login QR.
  assert.equal(screens.length, 0);
  assert.equal(checks, 1);
  verified = true;
  await run('');
  assert.equal(guides.length, 2);
  assert.equal(notices.filter(x => x.type === 'error').length, 0, JSON.stringify(notices));
  const first = await hostStatus(loadConfig(dir));
  assert.ok(first);
  assert.equal(first.publicUrl, 'https://phone.example');
  assert.equal(first.relayUrl, 'wss://phone.example');
  assert.equal((await remoteList(config)).allowResume, true);
  assert.ok(screens[0].join('').includes(config.clientToken));
  for (const token of [config.relayToken, config.clientToken]) assert.ok(!JSON.stringify(notices).includes(token));
  await until(() => statuses.includes('remote connected'));
  await emit('session_shutdown'); await emit('session_start');
  await run('start');
  assert.equal((await hostStatus(loadConfig(dir))).pid, first.pid);
  assert.equal(guides.length, 2);
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
