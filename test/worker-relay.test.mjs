import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../src/service.mjs';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until, testKey } from './helpers.mjs';
import { diffState, patchState } from '../web/protocol.js';

test('saved session resume is allowed by default, rejects existing owners, runs a worker and answers dialogs', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-worker-')), file = join(dir, 'saved.jsonl');
  writeFileSync(file, [
    { type: 'session', id: 'saved', cwd: dir },
    { type: 'message', id: 'prompt', parentId: null, message: { role: 'user', timestamp: 1, content: 'saved prompt' } }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const id = sessionKey(file);
  const service = new SessionService({ dir, roots: [dir],
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
    ...['usage', 'usage-settled', 'usage-working', 'fast'].map(name => ({ name, description: undefined, source: 'extension' })),
    { name: 'new', description: 'Start a new session in this project', source: 'remote' },
    { name: 'model', description: 'Switch model for this session', source: 'remote' }
  ]);
  assert.deepEqual(await service.getModels(id), { current: 'test/first', models: [
    { provider: 'test', id: 'first', name: 'First' }, { provider: 'test', id: 'org/second', name: 'Second' }
  ] });
  assert.equal((await service.command(id, randomUUID(), { type: 'setModel', provider: 'test', modelId: 'org/second' })).ok, true);
  assert.equal(service.read(id).model, 'test/org/second');
  assert.equal(service.read(id).thinkingLevel, 'medium');
  assert.equal((await service.command(id, randomUUID(), { type: 'setModel', provider: 'test', modelId: 'unknown' })).ok, false);
  assert.equal(service.read(id).model, 'test/org/second');
  assert.deepEqual(await service.command(id, randomUUID(), { type: 'setThinkingLevel', level: 'max' }), { ok: true, value: { thinkingLevel: 'high' } });
  assert.equal(service.read(id).thinkingLevel, 'high');
  assert.equal(service.read(id).model, 'test/org/second');
  assert.equal(service.read(id).messages.length, 1);
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
test('resume reads large saved branches without an RPC history copy and keeps lazy images and custom messages', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-large-history-')), file = join(dir, 'saved.jsonl');
  const image = { type: 'image', mimeType: 'image/png', data: 'a'.repeat(2 * 1024 * 1024) };
  const customImage = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
  const entries = [{ type: 'session', id: 'large', cwd: dir }];
  for (let i = 0; i < 5; i++) entries.push({ type: 'message', id: String(i), parentId: i ? String(i - 1) : null,
    message: { role: 'user', content: [{ type: 'text', text: 'preview ' + i }, image], timestamp: i } });
  entries.push({ type: 'message', id: 'abandoned', parentId: '0', message: { role: 'assistant', content: 'wrong branch' } },
    { type: 'custom_message', id: 'hidden', parentId: '4', display: false, content: 'private model context' },
    { type: 'custom_message', id: 'visible', parentId: 'hidden', display: true, timestamp: new Date().toISOString(), content: [{ type: 'text', text: 'visible extension message' }, customImage] });
  const saved = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  writeFileSync(file, saved);
  assert.ok(Buffer.byteLength(saved) > 8 * 1024 * 1024);
  const service = new SessionService({ dir, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  t.after(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  const id = sessionKey(file);
  const result = await service.resume(id, randomUUID()); // The fixture deliberately rejects get_messages.
  assert.equal(result.ok, true, result.error);
  const state = service.read(id);
  assert.equal(state.status, 'idle');
  assert.deepEqual(state.messages.map(message => message.text), ['preview 0', 'preview 1', 'preview 2', 'preview 3', 'preview 4', 'visible extension message']);
  for (const message of state.messages) assert.deepEqual(service.getImage(id, message.images[0].id), message.role === 'custom' ? customImage : image);
  assert.ok(JSON.stringify(state).length < 10000);
  assert.equal(readFileSync(file, 'utf8'), saved, 'resuming must not alter or strip saved images');
  assert.equal((await service.command(id, randomUUID(), { type: 'prompt', text: 'continue after large history' })).ok, true);
  await until(() => service.read(id).messages.some(message => message.text === 'reply: continue after large history'));
});

test('host restart restores every managed session with phone prompts, images and dialogs', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-restore-'));
  const config = loadConfig(dir);
  const options = { dir, config, port: 0, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } };
  for (const name of ['first', 'second', 'archive']) writeFileSync(join(dir, name + '.jsonl'),
    JSON.stringify({ type: 'session', id: name, cwd: dir }) + '\n');
  const ids = ['first', 'second'].map(name => sessionKey(join(dir, name + '.jsonl')));
  const archive = sessionKey(join(dir, 'archive.jsonl'));
  let host = await startHost(options);
  let client;
  t.after(async () => { client?.ws.terminate(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const id of ids) assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  const created = await host.service.newSession(ids[0], randomUUID());
  assert.equal(created.ok, true);
  ids.push(created.value.sessionId);
  await host.service.command(ids.at(-1), randomUUID(), { type: 'prompt', text: 'save new session' });
  await until(() => host.service.read(ids.at(-1)).status === 'idle');
  const pids = ids.map(id => host.service.live.get(id).worker.process.pid);
  await host.close();
  assert.equal(statSync(join(dir, 'resume-sessions.json')).mode & 0o777, 0o600);
  host = await startHost(options); // The normal background start has no --allow-resume flag.
  await until(() => ids.every(id => host.service.read(id).status === 'idle'));
  const port = host.http.address().port;
  client = await socket(`ws://127.0.0.1:${port}/ws`, config.clientToken, `http://127.0.0.1:${port}`);
  const list = (await client.request('list')).value;
  for (const [index, id] of ids.entries()) {
    assert.equal(list.sessions.find(session => session.id === id)?.status, 'idle');
    assert.notEqual(host.service.live.get(id).worker.process.pid, pids[index]);
    assert.equal((await client.request('watch', { sessionId: id })).ok, true);
    const snapshot = await until(() => client.messages.find(message => message.type === 'snapshot' && message.sessionId === id));
    assert.equal(snapshot.state.status, 'idle');
    for (const command of [{ type: 'prompt', text: 'after restart' },
      { type: 'prompt', text: 'image', images: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] }]) {
      assert.equal((await client.request('command', { sessionId: id, command })).value.ok, true);
      await until(() => host.service.read(id).messages.some(message => message.text === 'reply: ' + command.text));
    }
    assert.equal((await client.request('command', { sessionId: id, command: { type: 'prompt', text: 'ask' } })).value.ok, true);
    await until(() => host.service.read(id).dialog);
    assert.equal((await client.request('answer', { sessionId: id, answer: { dialogId: 'dialog-1', confirmed: true } })).value.ok, true);
    await until(() => host.service.read(id).messages.some(message => message.text === 'dialog answered'));
  }
  // Previously unopened sessions are resumable too, without spawning them all at startup.
  assert.equal(list.allowResume, true);
  assert.equal(list.sessions.find(session => session.id === archive).status, 'saved');
  assert.equal(list.sessions.find(session => session.id === archive).resumable, true);
  assert.equal((await client.request('resume', { sessionId: archive })).value.ok, true);
  assert.equal((await client.request('watch', { sessionId: archive })).ok, true);
  const snapshot = await until(() => client.messages.find(message => message.type === 'snapshot' && message.sessionId === archive));
  assert.equal(snapshot.state.status, 'idle');
  assert.equal((await client.request('command', { sessionId: archive, command: { type: 'prompt', text: 'archive after restart' } })).value.ok, true);
  await until(() => host.service.read(archive).messages.some(message => message.text === 'reply: archive after restart'));
});

test('restoration respects owners and roots, reports failures and continues restoring other sessions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-restore-lock-'));
  const files = ['owned', 'valid'].map(name => join(dir, name + '.jsonl'));
  for (const [index, file] of files.entries()) writeFileSync(file, JSON.stringify({ type: 'session', id: String(index), cwd: dir }) + '\n');
  const [owned, valid] = files.map(sessionKey), missing = 'b'.repeat(64);
  const lock = acquireLock(join(dir, 'locks'), owned, { file: files[0] });
  writeFileSync(join(dir, 'resume-sessions.json'), JSON.stringify([owned, missing, valid]));
  const host = await startHost({ dir, config: loadConfig(dir), port: 0, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  t.after(async () => { await host.close(); lock.release(); rmSync(dir, { recursive: true, force: true }); });
  await until(() => host.service.list().warnings.length === 2 && host.service.read(valid).status === 'idle');
  assert.equal(host.service.live.has(owned), false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'locks', owned + '.json'), 'utf8')).nonce, lock.owner.nonce);
  host.service.scan();
  assert.match(host.service.list().warnings.join('\n'), /owned or has a stale lock/);
  assert.match(host.service.list().warnings.join('\n'), /not found in configured roots/);
});

test('remote /new creates an independent session in the same working directory', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-new-')), file = join(dir, 'saved.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  const service = new SessionService({ dir, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  const oldId = sessionKey(file), requestId = randomUUID();
  const lock = acquireLock(join(dir, 'locks'), oldId, { file, instanceId: 'live' });
  t.after(async () => { await service.close(); lock.release(); rmSync(dir, { recursive: true, force: true }); });
  service.register({ readyState: 1, close() {} }, { id: oldId, file, cwd: dir, instanceId: 'live', status: 'idle', title: 'Old task', messages: [] }, lock.owner);
  const created = await service.newSession(oldId, requestId);
  assert.equal(created.ok, true);
  const id = created.value.sessionId;
  assert.notEqual(id, oldId);
  assert.equal(service.read(id).cwd, dir);
  assert.deepEqual(service.read(id).messages, []);
  assert.deepEqual(await service.getCommands(id), [
    { name: 'review', description: 'Review changes', source: 'extension' },
    ...['usage', 'usage-settled', 'usage-working', 'fast'].map(name => ({ name, description: undefined, source: 'extension' })),
    { name: 'new', description: 'Start a new session in this project', source: 'remote' },
    { name: 'model', description: 'Switch model for this session', source: 'remote' }
  ]);
  assert.equal((await service.newSession(oldId, requestId)).value.sessionId, id);
  assert.equal(service.live.size, 2);
  await service.command(id, randomUUID(), { type: 'setThinkingLevel', level: 'low' });
  assert.equal(service.read(id).thinkingLevel, 'low');
  assert.equal(service.read(oldId).thinkingLevel, undefined);
  await service.command(id, randomUUID(), { type: 'prompt', text: 'hello fresh session' });
  await until(() => service.read(id).messages.some(x => x.text === 'reply: hello fresh session'));
  assert.deepEqual(service.read(oldId).messages, []);
  await service.live.get(id).worker.close();
  await until(() => service.list().sessions.some(x => x.id === id && x.status === 'saved'));
});
test('new session from a saved project leaves the source saved; disabled resume refuses it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-project-')), file = join(dir, 'saved.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  const service = new SessionService({ dir, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  t.after(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  const sourceId = sessionKey(file);
  assert.deepEqual(service.projects(), [{ cwd: dir, sessionId: sourceId }]);
  service.allowResume = false;
  assert.match((await service.newSession(sourceId, randomUUID())).error, /disabled locally/);
  service.allowResume = true;
  const created = await service.newSession(sourceId, randomUUID());
  assert.equal(service.read(created.value.sessionId).cwd, dir);
  assert.equal(service.live.has(sourceId), false);
  await service.live.get(created.value.sessionId).worker.close();
});
test('new folder session creates a fresh dated folder per request and retries idempotently', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-folder-'));
  const service = new SessionService({ dir, roots: [join(dir, 'sessions')],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] } });
  t.after(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  const requestId = randomUUID();
  const first = await service.newProject(requestId), second = await service.newProject(randomUUID());
  assert.equal((await service.newProject(requestId)).value.sessionId, first.value.sessionId);
  const [a, b] = [first, second].map(x => service.read(x.value.sessionId).cwd);
  assert.match(a, /[\\/]projects[\\/]\d{4}-\d\d-\d\d-\d{4}(-2)?$/);
  assert.notEqual(a, b);
  assert.ok(statSync(a).isDirectory() && statSync(b).isDirectory());
  for (const x of [first, second]) await service.live.get(x.value.sessionId).worker.close();
});
test('relay carries browser requests and closes channels when the computer disconnects', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-relay-'));
  const service = new SessionService({ dir, roots: [] });
  const hostToken = 'h'.repeat(40), clientToken = 'c'.repeat(40);
  const relay = await startRelay({ hostToken, clientToken, publicUrl: 'http://localhost:9000', port: 0 });
  const port = relay.http.address().port;
  const disconnect = connectRelay(service, 'ws://127.0.0.1:' + port, hostToken, { key: testKey, allowInsecure: true });
  assert.equal(disconnect.connected(), false);
  let client;
  t.after(async () => { client?.ws.terminate(); disconnect(); await relay.close(); await service.close(); rmSync(dir, { recursive: true, force: true }); });
  // Wait for host authentication using the public client path; offline connections are closed.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      client = await socket('ws://127.0.0.1:' + port + '/ws', clientToken, 'http://localhost:9000', testKey);
      await until(() => client.messages.find(x => x.type === 'ready'), 300); break;
    } catch { client?.ws.terminate(); if (attempt === 9) throw new Error('Relay host never connected'); await new Promise(resolve => setTimeout(resolve, 100)); }
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
  // The worker clears dialogs with undefined; only the wire representation counts.
  const cleared = { ...after, dialog: undefined };
  assert.deepEqual(patchState(before, JSON.parse(JSON.stringify(diffState(before, cleared)))), after);
});
