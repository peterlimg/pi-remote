import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { videoMessage, splitVideoMessage } from '../web/videos.js';
import { readSession } from '../src/catalog.mjs';
import { SessionService } from '../src/service.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { socket, until, testKey } from './helpers.mjs';

const path = '/host/videos/12345678-1234-1234-1234-123456789abc/edited.mp4';
test('generated video markers are explicit, role-specific and bounded', () => {
  const generated = videoMessage('Your edit', [path], 'assistant');
  assert.match(generated, /Generated video files/);
  assert.deepEqual(splitVideoMessage(generated, 'assistant'), { text: 'Your edit', paths: [path] });
  assert.deepEqual(splitVideoMessage(generated), { text: generated, paths: [] });
  const uploaded = videoMessage('Original', [path]);
  assert.deepEqual(splitVideoMessage(uploaded), { text: 'Original', paths: [path] });
  assert.equal(splitVideoMessage(uploaded, 'assistant').paths.length, 0);
  for (const role of ['toolResult', 'system', 'constructor']) assert.equal(splitVideoMessage(generated, role).paths.length, 0);
  for (const paths of [[path + '/../../secret'], ['/etc/hosts'], Array(5).fill(path), [path + '\nsecret']]) {
    assert.equal(splitVideoMessage(videoMessage('', paths, 'assistant'), 'assistant').paths.length, 0);
  }
  assert.equal(splitVideoMessage('```\n' + generated + '\n```', 'assistant').paths.length, 0);
});

test('generated videos use encrypted authenticated reads with conversation and file boundaries', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-generated-video-'));
  const root = join(dir, 'videos', randomUUID()); mkdirSync(root, { recursive: true });
  const video = join(root, 'edited.webm'), hidden = join(root, 'unshared.webm'), link = join(root, 'linked.webm');
  const bytes = readFileSync(new URL('./fixtures/video.webm', import.meta.url));
  writeFileSync(video, bytes); writeFileSync(hidden, bytes);
  const outside = join(dir, 'private.webm'); writeFileSync(outside, bytes); symlinkSync(outside, link);
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, [
    { type: 'session', id: randomUUID(), cwd: dir },
    { type: 'message', id: 'edit', parentId: null, message: { role: 'assistant', content: videoMessage('Done', [video, link], 'assistant') } },
    { type: 'message', id: 'tool', parentId: 'edit', message: { role: 'toolResult', toolCallId: 'read', content: videoMessage('', [hidden], 'assistant') } }
  ].map(JSON.stringify).join('\n') + '\n');
  const otherFile = join(dir, 'other.jsonl');
  writeFileSync(otherFile, JSON.stringify({ type: 'session', id: randomUUID(), cwd: dir }) + '\n');
  const saved = readSession(file), other = readSession(otherFile);
  const service = new SessionService({ dir, roots: [dir] });
  const relay = await startRelay({ hostToken: 'h'.repeat(40), clientToken: 'c'.repeat(40), publicUrl: 'http://localhost', port: 0 });
  const url = `ws://127.0.0.1:${relay.http.address().port}`;
  const disconnect = connectRelay(service, url, 'h'.repeat(40), { key: testKey, allowInsecure: true });
  let client;
  t.after(async () => { client?.ws.terminate(); disconnect(); await service.close(); await relay.close(); rmSync(dir, { recursive: true, force: true }); });
  await until(disconnect.connected);
  client = await socket(url + '/ws', 'c'.repeat(40), 'http://localhost', testKey);
  assert.equal((await client.request('videoRead', { sessionId: saved.id, path: video, offset: 0 })).ok, false);
  assert.equal((await client.request('watch', { sessionId: saved.id })).ok, true);
  const info = await client.request('videoRead', { sessionId: saved.id, path: video });
  assert.equal(info.ok, true); assert.equal(info.value.mimeType, 'video/webm');
  assert.equal(info.value.size, bytes.length);
  const response = await client.request('videoRead', { sessionId: saved.id, path: video, offset: 0 });
  assert.equal(response.ok, true); assert.deepEqual(Buffer.from(response.value.data, 'base64'), bytes);
  for (const request of [
    { path: hidden, offset: 0 }, { path: outside, offset: 0 }, { path: link, offset: 0 },
    { path: video, offset: -1 }, { path: video, offset: bytes.length }, { path: video, offset: 0.5 }
  ]) assert.equal((await client.request('videoRead', { sessionId: saved.id, ...request })).ok, false);
  assert.equal((await client.request('watch', { sessionId: other.id })).ok, true);
  assert.equal((await client.request('videoRead', { sessionId: saved.id, path: video, offset: 0 })).ok, false);
  assert.equal((await client.request('videoRead', { sessionId: other.id, path: video, offset: 0 })).ok, false);
  assert.equal((await client.request('watch', { sessionId: saved.id })).ok, true);
  rmSync(video);
  assert.equal((await client.request('videoRead', { sessionId: saved.id, path: video, offset: 0 })).ok, false);
});
