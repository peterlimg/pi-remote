import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pi-session-task-storage-')), sessions = join(dir, 'sessions');
  mkdirSync(sessions);
  const owners = [], tasks = [];
  for (const state of ['reported', 'waiting']) {
    const seed = name => {
      const file = join(sessions, name + '.jsonl'), timestamp = new Date().toISOString();
      writeFileSync(file, [
        { type: 'session', version: 3, id: randomUUID(), timestamp, cwd: dir },
        { type: 'session_info', id: 'name', parentId: null, timestamp, name },
        { type: 'model_change', id: 'model', parentId: 'name', timestamp, provider: 'formal', modelId: 'fixture' }
      ].map(entry => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 });
      return { file, id: sessionKey(file) };
    };
    const owner = { ...seed('Main ' + state), cwd: dir, title: 'Main ' + state, mode: 'session', token: randomUUID() };
    const worker = seed('pi-remote-task-' + randomUUID()), input = { id: randomUUID(), text: 'Original instruction', delivery: 'sent', read: true, settled: true };
    owners.push(owner);
    tasks.push({ id: randomUUID(), coordinatorId: owner.id, sessionId: worker.id, file: worker.file, cwd: dir, token: randomUUID(),
      title: 'Worker ' + state, instruction: input.text, state, protocol: 2, generation: randomUUID(), inputs: [input],
      ...(state === 'reported' ? { result: 'Original report' } : { question: 'Original question' }),
      events: [{ id: randomUUID(), kind: state === 'reported' ? 'result' : 'question', text: 'Original notification', delivery: 'sent' }] });
  }
  const legacy = join(dir, 'coordinator-tasks.json'), folder = join(dir, 'coordinator-tasks');
  writeFileSync(legacy, JSON.stringify({ version: 1, coordinators: owners, tasks }), { mode: 0o600 });
  mkdirSync(folder, { mode: 0o700 });
  const file = owner => join(folder, owner.id + '.json');
  const first = { version: 1, coordinator: owners[0], tasks: [tasks[0]] };
  writeFileSync(file(owners[0]), JSON.stringify(first), { mode: 0o600 });
  const config = loadConfig(dir);
  const start = () => startHost({ dir, config, roots: [sessions], port: 0, relayUrl: '' });
  const api = async (host, owner, input) => {
    const response = await fetch('http://127.0.0.1:' + host.http.address().port + '/_pi/coordinator', {
      method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + owner.token, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify({ ...input, requestId: createHash('sha256').update(randomUUID()).digest('hex') }) } : {}),
      signal: AbortSignal.timeout(5000)
    });
    return { status: response.status, body: await response.json() };
  };
  return { dir, owners, tasks, legacy, folder, file, first, start, api };
}

test('task state migrates into its owning main session and stays independent across updates and reload', async () => {
  const f = fixture(), original = readFileSync(f.legacy, 'utf8');
  let host;
  try {
    host = await f.start();
    expect(existsSync(f.legacy)).toBe(false);
    expect(readFileSync(f.legacy + '.migrated', 'utf8')).toBe(original);
    expect(statSync(f.folder).mode & 0o777).toBe(0o700);
    for (const [index, owner] of f.owners.entries()) {
      const stored = JSON.parse(readFileSync(f.file(owner), 'utf8'));
      expect(stored.coordinator).toEqual(owner);
      expect(stored.tasks).toHaveLength(1);
      expect(stored.tasks[0]).toMatchObject({ ...f.tasks[index], generation: expect.any(String) });
      expect(statSync(f.file(owner)).mode & 0o777).toBe(0o600);
      const visible = await f.api(host, owner);
      expect(visible.status).toBe(200);
      expect(visible.body.value.tasks.map(task => task.id)).toEqual([f.tasks[index].id]);
      expect(JSON.stringify(visible.body)).not.toContain(owner.token);
    }
    const other = readFileSync(f.file(f.owners[1]), 'utf8'), inode = statSync(f.file(f.owners[1])).ino;
    expect((await f.api(host, f.owners[0], { action: 'accept', taskId: f.tasks[0].id })).body.value.state).toBe('completed');
    expect(readFileSync(f.file(f.owners[1]), 'utf8')).toBe(other);
    expect(statSync(f.file(f.owners[1])).ino).toBe(inode);
    const denied = await f.api(host, f.owners[0], { action: 'inspect', taskId: f.tasks[1].id });
    expect(denied.body.ok).toBe(false); expect(denied.body.error).toMatch(/not found/i);
    expect((await f.api(host, f.owners[1], { action: 'stop', taskId: f.tasks[1].id })).body.value.state).toBe('stopped');
    await host.close(); host = undefined; host = await f.start();
    expect((await f.api(host, f.owners[0])).body.value.tasks[0]).toMatchObject({ state: 'completed', result: 'Original report' });
    expect((await f.api(host, f.owners[1])).body.value.tasks[0]).toMatchObject({ state: 'stopped', question: 'Original question' });
    expect(readFileSync(f.legacy + '.migrated', 'utf8')).toBe(original);
    expect(existsSync(f.legacy)).toBe(false);
  } finally { await host?.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a conflicting partial task migration fails closed without overwriting either copy', async () => {
  const f = fixture();
  f.first.tasks[0].result = 'A newer report must survive';
  writeFileSync(f.file(f.owners[0]), JSON.stringify(f.first), { mode: 0o600 });
  const original = readFileSync(f.legacy, 'utf8'), newer = readFileSync(f.file(f.owners[0]), 'utf8');
  let host;
  try {
    host = await f.start();
    const response = await f.api(host, f.owners[0]);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, error: 'Coordinator state could not be loaded. No coordinator work will be started.' });
    expect(readFileSync(f.legacy, 'utf8')).toBe(original);
    expect(readFileSync(f.file(f.owners[0]), 'utf8')).toBe(newer);
    expect(existsSync(f.file(f.owners[1]))).toBe(false);
    expect(existsSync(f.legacy + '.migrated')).toBe(false);
  } finally { await host?.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
