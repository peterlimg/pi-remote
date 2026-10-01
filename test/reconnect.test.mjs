import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
