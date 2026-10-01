import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand } from '../src/commands.mjs';
import { MAX_IMAGE_BYTES } from '../web/images.js';
import { RpcWorker } from '../src/rpc.mjs';
import { cleanMessage, readSession, readSessionImage } from '../src/catalog.mjs';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionService } from '../src/service.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { socket, until, testKey } from './helpers.mjs';

const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
test('image commands allow image-only input and enforce format, count and total size', () => {
  const command = { type: 'prompt', text: '', images: [image] };
  assert.deepEqual(validateCommand(command), command);
  assert.deepEqual(validateCommand({ ...command, images: [{ ...image, name: 'discard' }] }), command);
  assert.deepEqual(validateCommand({ type: 'prompt', text: 'hello', images: [] }), { type: 'prompt', text: 'hello' });
  for (const images of [null, {}, [null], Array(5).fill(image), [{ ...image, mimeType: 'image/svg+xml' }],
    [{ ...image, type: 'text' }], ...['', '%%%%', 'abc', 'a=b=', 'abcd====', 42].map(data => [{ ...image, data }])]) {
    assert.throws(() => validateCommand({ ...command, images }), /Attach up to/);
  }
  const full = { ...image, data: Buffer.alloc(MAX_IMAGE_BYTES).toString('base64') };
  assert.equal(validateCommand({ ...command, images: [full] }).images[0].data, full.data);
  assert.throws(() => validateCommand({ ...command, images: [full, image] }), /2 MB/);
  assert.throws(() => validateCommand({ ...command, text: '/new' }), /slash command/);
  assert.throws(() => validateCommand({ ...command, images: [] }), /Enter a message/);
  assert.throws(() => validateCommand({ ...command, text: 'x'.repeat(50001) }), /50000/);
});

test('message previews keep bounded references, not base64 in every snapshot', () => {
  const message = cleanMessage({ role: 'user', content: [{ type: 'text', text: 'Look' }, image, image] }, 'user');
  assert.equal(message.text, 'Look');
  assert.equal(message.images.length, 2);
  assert.match(message.images[0].id, /^[a-f0-9]{64}$/);
  assert.deepEqual(message.images[0], message.images[1]);
  assert.equal(JSON.stringify(message).includes(image.data), false);
  for (const invalid of [{ ...image, mimeType: 'image/svg+xml' }, { ...image, data: '%%%%' },
    { ...image, data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') }]) {
    const cleaned = cleanMessage({ role: 'user', content: [invalid] }, 'user');
    assert.equal(cleaned.images, undefined);
    assert.equal(cleaned.text, '[image]');
  }
});

test('saved and existing live previews load over the authenticated relay with session boundaries', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-previews-')), file = join(dir, 'session.jsonl');
  const other = { ...image, data: 'd29ybGQ=' };
  writeFileSync(file, [
    { type: 'session', id: 'session', cwd: dir },
    { type: 'message', id: 'user', parentId: null, message: { role: 'user', timestamp: 1, content: [image] } },
    { type: 'message', id: 'abandoned', parentId: 'user', message: { role: 'user', content: [other] } },
    { type: 'message', id: 'result', parentId: 'user', message: { role: 'toolResult', toolCallId: 'read', content: [image] } }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const saved = readSession(file), reference = saved.messages[0].images[0];
  assert.equal(saved.messages[0].text, '');
  assert.deepEqual(readSessionImage(file, reference.id), image);
  assert.throws(() => readSessionImage(file, cleanMessage({ content: [other] }, 'other').images[0].id), /no longer available/);
  const service = new SessionService({ dir, roots: [dir] });
  const relay = await startRelay({ hostToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), publicUrl: 'http://localhost', port: 0 });
  const disconnect = connectRelay(service, `ws://127.0.0.1:${relay.http.address().port}`, 'h'.repeat(40), { key: testKey, allowInsecure: true });
  let client;
  t.after(async () => { client?.ws.terminate(); disconnect(); await service.close(); await relay.close(); rmSync(dir, { recursive: true, force: true }); });
  await until(disconnect.connected);
  client = await socket(`ws://127.0.0.1:${relay.http.address().port}/ws`, 'c'.repeat(40), 'http://localhost', testKey);
  assert.equal((await client.request('watch', { sessionId: saved.id })).ok, true);
  const snapshot = await until(() => client.messages.find(packet => packet.type === 'snapshot'));
  assert.deepEqual(snapshot.state.messages[0].images, [reference]);
  assert.equal(JSON.stringify(snapshot).includes(image.data), false);
  assert.deepEqual((await client.request('image', { sessionId: saved.id, imageId: reference.id })).value, image);
  for (const options of [{ sessionId: 'unknown', imageId: reference.id }, { sessionId: saved.id, imageId: '../secret' },
    { sessionId: saved.id, imageId: '0'.repeat(64) }]) {
    assert.equal((await client.request('image', options)).ok, false);
  }
  const legacy = { ...saved, status: 'working', messages: [{ id: 'user:1:', role: 'user', timestamp: 1, text: '[image]' }] };
  service.live.set(saved.id, { state: legacy });
  assert.deepEqual(service.read(saved.id).messages[0].images, [reference]);
  assert.equal(service.read(saved.id).messages[0].text, '');
  assert.equal(legacy.messages[0].text, '[image]', 'hydration must not mutate the bridge snapshot');
  service.roots = [join(dir, 'elsewhere')];
  assert.throws(() => service.getImage(saved.id, reference.id), /configured roots/);
  service.roots = [dir];
  rmSync(file); symlinkSync('/etc/hosts', file);
  assert.throws(() => service.getImage(saved.id, reference.id), /configured roots/);
});

test('RPC forwards image content for prompt, steering and follow-up', async () => {
  const calls = [], worker = { request: async (type, data) => calls.push({ type, ...data }) };
  for (const type of ['prompt', 'steer', 'followUp']) {
    await RpcWorker.prototype.command.call(worker, { type, text: '', images: [image] });
  }
  assert.deepEqual(calls, [
    { type: 'prompt', message: '', images: [image], streamingBehavior: 'steer' },
    { type: 'steer', message: '', images: [image] },
    { type: 'follow_up', message: '', images: [image] }
  ]);
});
