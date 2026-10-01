import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { connectRelay } from '../src/relay.mjs';
import { e2eKey } from '../src/e2e.mjs';
import { hello, channel } from '../web/e2e.js';
import { until } from './helpers.mjs';

test('a relay cannot read or drive the host without the phone key', async t => {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const service = new EventEmitter();
  service.list = () => ({ sessions: [{ id: 'secret-session' }], offset: 0, total: 1 });
  const key = e2eKey({ bridgeToken: 'b'.repeat(40), clientToken: 'c'.repeat(40) });
  const connection = new Promise(resolve => wss.once('connection', resolve));
  const disconnect = connectRelay(service, 'ws://127.0.0.1:' + http.address().port, 'h'.repeat(40), { key, allowInsecure: true });
  t.after(async () => { disconnect(); wss.close(); await new Promise(resolve => http.close(resolve)); });
  const relay = await connection, packets = [];
  relay.on('message', raw => packets.push(JSON.parse(raw.toString())));
  relay.send(JSON.stringify({ type: 'ready' }));
  const open = id => relay.send(JSON.stringify({ type: 'open', id }));
  const deliver = (id, data) => relay.send(JSON.stringify({ type: 'data', id, data }));
  const frames = id => packets.filter(p => p.type === 'data' && p.id === id).map(p => p.data);
  const closed = id => until(() => packets.some(p => p.type === 'close' && p.id === id));

  // A relay holding the client token can no longer issue plaintext requests.
  open('plain'); deliver('plain', JSON.stringify({ op: 'list', id: 'x' }));
  await closed('plain');
  assert.deepEqual(frames('plain'), []);

  // Nor can it complete the handshake and forge frames without the key.
  open('forged');
  const forgedHello = hello(); deliver('forged', JSON.stringify(forgedHello.packet));
  const forgedReply = JSON.parse((await until(() => frames('forged')[0])));
  const wrong = await channel('A'.repeat(43), forgedHello.nonce, forgedReply.nonce);
  deliver('forged', await wrong.seal(JSON.stringify({ op: 'list', id: 'y' })));
  await closed('forged');

  // The phone's browser crypto talks to the host; the relay sees only ciphertext.
  open('phone');
  const phoneHello = hello(); deliver('phone', JSON.stringify(phoneHello.packet));
  const reply = JSON.parse(await until(() => frames('phone')[0]));
  const phone = await channel(key, phoneHello.nonce, reply.nonce);
  await until(() => frames('phone').length >= 3);
  assert.ok(frames('phone').slice(1).every(frame => !frame.includes('secret-session')));
  assert.equal(JSON.parse(await phone.open(frames('phone')[1])).type, 'ready');
  assert.equal(JSON.parse(await phone.open(frames('phone')[2])).sessions[0].id, 'secret-session');
  const ping = await phone.seal(JSON.stringify({ op: 'ping', id: 'p' }));
  deliver('phone', ping);
  await until(() => frames('phone').length >= 4);
  assert.deepEqual(JSON.parse(await phone.open(frames('phone')[3])).value, { pong: true });

  // A replayed frame is rejected: its counter has already been used.
  deliver('phone', ping);
  await closed('phone');
});
