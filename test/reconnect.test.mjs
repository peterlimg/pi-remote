import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { setTimeout as realTimeout } from 'node:timers';
import { WebSocketServer } from 'ws';
import { connectRelay } from '../src/relay.mjs';

async function eventually(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(resolve => realTimeout(resolve, 5));
  }
  assert.ok(condition(), 'Connection did not recover');
}

for (const stall of ['upgrade', 'ready']) test(`relay retries a connection stalled before ${stall}`, async t => {
  const http = createServer(), wss = new WebSocketServer({ noServer: true });
  const sockets = [];
  let attempts = 0, authenticated = false;
  http.on('upgrade', (request, socket, head) => {
    sockets.push(socket);
    const attempt = ++attempts;
    if (attempt === 1 && stall === 'upgrade') { socket.on('end', () => socket.end()); socket.resume(); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      ws.on('message', () => {
        authenticated = true;
        if (attempt > 1) ws.send(JSON.stringify({ type: 'ready' }));
      });
    });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const disconnect = connectRelay({}, 'ws://127.0.0.1:' + http.address().port, 'h'.repeat(40), { key: 'k'.repeat(43), allowInsecure: true });
  t.after(async () => {
    disconnect();
    t.mock.timers.reset();
    for (const socket of sockets) socket.destroy();
    wss.close();
    await new Promise(resolve => http.close(resolve));
  });
  await eventually(() => attempts === 1 && (stall === 'upgrade' || authenticated));
  assert.equal(disconnect.connected(), false);
  t.mock.timers.tick(20001);
  await eventually(() => sockets[0].destroyed);
  t.mock.timers.tick(2000);
  await eventually(() => disconnect.connected());
  assert.equal(attempts, 2);
  t.mock.timers.tick(25000); // Ready must cancel the attempt deadline.
  assert.equal(disconnect.connected(), true);
  disconnect();
  assert.equal(disconnect.connected(), false);
  t.mock.timers.tick(60000);
  assert.equal(attempts, 2);
});

test('a restarted computer replaces the stale relay connection instead of waiting for it to time out', async t => {
  const { startRelay } = await import('../src/relay.mjs');
  const { default: WebSocket } = await import('ws');
  const relay = await startRelay({ hostToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), publicUrl: 'http://localhost', port: 0 });
  t.after(() => relay.close());
  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + relay.http.address().port + '/host');
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'h'.repeat(40) })));
    ws.once('message', raw => JSON.parse(raw).type === 'ready' ? resolve(ws) : reject(new Error(raw.toString())));
    ws.once('close', (code, reason) => reject(new Error(code + ' ' + reason)));
  });
  const stale = await connect();
  const closed = new Promise(resolve => stale.once('close', resolve));
  const fresh = await connect();
  await closed;
  assert.equal(fresh.readyState, 1);
  fresh.terminate();
});

test('stopping the computer sends the relay a close frame instead of a bare reset', async t => {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { wss.close(); await new Promise(resolve => http.close(resolve)); });
  const closed = new Promise(resolve => wss.once('connection', ws => {
    ws.once('message', () => ws.send(JSON.stringify({ type: 'ready' })));
    ws.once('close', code => resolve(code));
  }));
  const disconnect = connectRelay({}, 'ws://127.0.0.1:' + http.address().port, 'h'.repeat(40), { key: 'k'.repeat(43), allowInsecure: true });
  await eventually(() => disconnect.connected());
  disconnect();
  assert.equal(await closed, 1001);
});

const bundled = path => readFileSync(new URL('../web' + path, import.meta.url), 'utf8');

test('relay serves the phone app from the connected computer and its own copy to older computers', async t => {
  const { startRelay } = await import('../src/relay.mjs');
  const { default: WebSocket } = await import('ws');
  const relay = await startRelay({ hostToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), publicUrl: 'http://localhost', port: 0 });
  t.after(() => relay.close());
  const base = 'http://127.0.0.1:' + relay.http.address().port, requests = [];
  const connect = auth => new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/host');
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'h'.repeat(40), ...auth })));
    ws.on('message', raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'ready') resolve(ws);
      if (packet.type !== 'asset') return;
      requests.push(packet.path);
      ws.send(JSON.stringify({ type: 'asset', id: packet.id, body: Buffer.from('computer ' + packet.path).toString('base64') }));
    });
    ws.once('close', (code, reason) => reject(new Error(code + ' ' + reason)));
  });
  const computer = await connect({ version: 2 });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(base + '/app.js');
    assert.equal(await response.text(), 'computer /app.js');
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  // Public requests reach the computer once per connection.
  assert.deepEqual(requests, ['/app.js']);
  computer.terminate();
  await connect({});
  assert.equal(await (await fetch(base + '/app.js')).text(), bundled('/app.js'));
  assert.deepEqual(requests, ['/app.js']);
});

test('the computer gives its relay only phone app files and flags an older relay', async t => {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const replies = new Map();
  let auth;
  wss.once('connection', ws => ws.once('message', raw => {
    auth = JSON.parse(raw);
    ws.send(JSON.stringify({ type: 'ready' })); // A relay from before protocol 2 sends no version.
    ws.on('message', raw => { const packet = JSON.parse(raw); replies.set(packet.id, packet.body); });
    for (const path of ['/app.js', '/../config.json']) ws.send(JSON.stringify({ type: 'asset', id: path, path }));
  }));
  const disconnect = connectRelay({}, 'ws://127.0.0.1:' + http.address().port, 'h'.repeat(40), { key: 'k'.repeat(43), allowInsecure: true });
  t.after(async () => { disconnect(); wss.close(); await new Promise(resolve => http.close(resolve)); });
  await eventually(() => replies.size === 2);
  assert.equal(auth.version, 2);
  assert.equal(Buffer.from(replies.get('/app.js'), 'base64').toString(), bundled('/app.js'));
  assert.equal(replies.get('/../config.json'), undefined);
  assert.equal(disconnect.outdated(), true);
});
