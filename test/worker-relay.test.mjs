import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../src/service.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until } from './helpers.mjs';
import { diffState, patchState } from '../web/protocol.js';

test('saved session resume rejects existing owners, runs a worker and answers dialogs', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-worker-')), file = join(dir, 'saved.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  const id = sessionKey(file);
  const service = new SessionService({ dir, roots: [dir], allowResume: true,
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  t.after(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  const lock = acquireLock(join(dir, 'locks'), id);
  assert.equal((await service.resume(id, randomUUID())).ok, false);
  lock.release();
  const result = await service.resume(id, randomUUID());
  assert.equal(result.ok, true);
  assert.equal(service.read(id).messages[0].text, 'saved prompt');
  appendFileSync(file, JSON.stringify({ type: 'session_info', id: 'name', parentId: null, name: 'Review bonus claim reconciliation' }) + '\n');
  let renamed = false;
  service.once('state', changed => { renamed = changed === id; });
  service.scan();
  assert.equal(service.list().sessions[0].title, 'Review bonus claim reconciliation');
  assert.equal(service.read(id).title, 'Review bonus claim reconciliation');
  assert.equal(renamed, true);
  assert.deepEqual(await service.getCommands(id), [
    { name: 'review', description: 'Review changes', source: 'extension' },
    { name: 'new', description: 'Start a new session in this project', source: 'remote' }
  ]);
  for (const type of ['prompt', 'steer', 'followUp']) {
    assert.equal((await service.command(id, randomUUID(), { type, text: '/review ' + type })).ok, true);
    await until(() => service.read(id).messages.some(x => x.text === 'reply: /review ' + type));
  }
  const pid = service.live.get(id).worker.process.pid;
  assert.equal((await service.resume(id, randomUUID())).ok, true);
  assert.equal(service.live.get(id).worker.process.pid, pid);
  await service.command(id, randomUUID(), { type: 'prompt', text: 'hello' });
  await until(() => service.read(id).messages.some(x => x.text === 'reply: hello'));
  await service.command(id, randomUUID(), { type: 'prompt', text: 'ask' });
  await until(() => service.read(id).dialog);
  const answer = await service.answer(id, randomUUID(), { dialogId: 'dialog-1', confirmed: true });
  assert.equal(answer.ok, true);
  await until(() => service.read(id).messages.some(x => x.text === 'dialog answered'));
});
test('remote /new creates an independent session in the same working directory', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-new-')), file = join(dir, 'saved.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  const service = new SessionService({ dir, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  const oldId = sessionKey(file), requestId = randomUUID();
  const lock = acquireLock(join(dir, 'locks'), oldId, { file, instanceId: 'live' });
  t.after(async () => { await service.close(); lock.release(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await service.newSession(oldId, randomUUID())).ok, false);
  service.register({ readyState: 1, close() {} }, { id: oldId, file, cwd: dir, instanceId: 'live', status: 'idle', title: 'Old task', messages: [] }, lock.owner);
  const created = await service.newSession(oldId, requestId);
  assert.equal(created.ok, true);
  const id = created.value.sessionId;
  assert.notEqual(id, oldId);
  assert.equal(service.read(id).cwd, dir);
  assert.deepEqual(service.read(id).messages, []);
  assert.deepEqual(await service.getCommands(id), [
    { name: 'review', description: 'Review changes', source: 'extension' },
    { name: 'new', description: 'Start a new session in this project', source: 'remote' }
  ]);
  assert.equal((await service.newSession(oldId, requestId)).value.sessionId, id);
  assert.equal(service.live.size, 2);
  await service.command(id, randomUUID(), { type: 'prompt', text: 'hello fresh session' });
  await until(() => service.read(id).messages.some(x => x.text === 'reply: hello fresh session'));
  assert.deepEqual(service.read(oldId).messages, []);
  await service.live.get(id).worker.close();
  await until(() => service.list().sessions.some(x => x.id === id && x.status === 'saved'));
});
test('relay carries browser requests and closes channels when the computer disconnects', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-relay-'));
  const service = new SessionService({ dir, roots: [] });
  const hostToken = 'h'.repeat(40), clientToken = 'c'.repeat(40);
  const relay = await startRelay({ hostToken, clientToken, publicUrl: 'http://localhost:9000', port: 0 });
  const port = relay.http.address().port;
  const disconnect = connectRelay(service, 'ws://127.0.0.1:' + port, hostToken, { allowInsecure: true });
  assert.equal(disconnect.connected(), false);
  let client;
  t.after(async () => { client?.ws.terminate(); disconnect(); await relay.close(); await service.close(); rmSync(dir, { recursive: true, force: true }); });
  // Wait for host authentication using the public client path; offline connections are closed.
  for (let attempt = 0; attempt < 10; attempt++) {
    client = await socket('ws://127.0.0.1:' + port + '/ws', clientToken, 'http://localhost:9000');
    try { await until(() => client.messages.find(x => x.type === 'ready'), 300); break; }
    catch { client.ws.terminate(); if (attempt === 9) throw new Error('Relay host never connected'); }
  }
  assert.equal((await client.request('list')).ok, true);
  assert.deepEqual((await client.request('ping')).value, { pong: true });
  assert.equal(disconnect.connected(), true);
  disconnect(); await until(() => client.ws.readyState === 3);
  assert.equal(disconnect.connected(), false);
});
test('mobile patches preserve order, branch resets and metadata removal', () => {
  const before = { id: 'a', messages: [{ id: '1', text: 'hello' }, { id: '2', text: 'old branch' }], dialog: { id: 'd' }, status: 'working' };
  const after = { id: 'a', messages: [{ id: '1', text: 'hello' }, { id: '3', text: 'new branch' }], status: 'idle' };
  const patch = diffState(before, after);
  assert.equal(patch.upsert.length, 1);
  assert.deepEqual(patchState(before, patch), after);
});
