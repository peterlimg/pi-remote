import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../src/service.mjs';
import { sessionWindow } from '../src/client-channel.mjs';
import { acquireSessionLock } from '../src/locks.mjs';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-session-actions-')), root = join(dir, 'sessions');
  mkdirSync(root);
  for (let i = 0; i < 25; i++) writeFileSync(join(root, `${i}.jsonl`), JSON.stringify({ type: 'session', id: String(i), cwd: dir }) + '\n' +
    JSON.stringify({ type: 'session_info', name: `Task ${i}` }) + '\n');
  const service = new SessionService({ dir, roots: [root] });
  t.after(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  const action = (id, value, request = randomUUID()) => service.sessionAction(id, request, value);
  return { dir, root, service, action };
}

test('pin and hide persist across host restarts, searches and list windows', async t => {
  const { dir, root, service, action } = setup(t);
  const oldest = service.matches().matches.at(-1), newest = service.matches().matches[0], scroll = sessionWindow(service);
  assert.equal(scroll.request({ limit: 20 }).changes.length, 20);
  assert.equal((await action(oldest.id, 'pin')).ok, true);
  assert.equal(service.list().sessions[0].id, oldest.id);
  assert.equal(service.projects()[0].sessionId, newest.id, 'Session pins must not change the project source');
  assert.equal(scroll.update().changes.find(row => row.id === oldest.id).pinned, true);
  assert.equal((await action(oldest.id, 'hide')).ok, true);
  const update = scroll.update();
  assert.ok(update.removed.includes(oldest.id));
  assert.equal(update.matched, 24);
  assert.deepEqual(update.hiddenSessions.map(row => row.id), [oldest.id]);
  assert.equal(service.list({ query: oldest.title }).hiddenSessions[0].id, oldest.id);
  assert.equal(service.list({ query: 'no match' }).hiddenSessions.length, 0);
  await action(newest.id, 'hide');
  assert.equal(service.projects()[0].sessionId, newest.id, 'Hiding a session must not remove its project');
  await action(newest.id, 'unhide');
  await service.close();
  const restarted = new SessionService({ dir, roots: [root] });
  try {
    assert.equal(restarted.list().hiddenSessions[0].pinned, true);
    assert.equal((await restarted.sessionAction(oldest.id, randomUUID(), 'unhide')).ok, true);
    assert.equal(restarted.list().sessions[0].id, oldest.id);
    assert.equal((await restarted.sessionAction(oldest.id, randomUUID(), 'unpin')).ok, true);
    assert.equal(restarted.list().hiddenSessions.length, 0);
    assert.equal(restarted.matches().matches.at(-1).id, oldest.id);
  } finally { await restarted.close(); }
});

test('delete removes only the saved conversation and a retry reads its receipt', async t => {
  const { dir, service, action } = setup(t), saved = service.matches().matches[0];
  const project = join(dir, 'source.txt'); writeFileSync(project, 'keep me');
  const request = randomUUID(), file = service.catalog.get(saved.id).file;
  assert.equal((await action(saved.id, 'delete', request)).ok, true);
  assert.equal(existsSync(file), false);
  assert.equal(readFileSync(project, 'utf8'), 'keep me');
  service.scan();
  assert.equal(service.matches().total, 24);
  assert.equal(service.catalog.has(saved.id), false);
  assert.equal((await action(saved.id, 'delete', request)).ok, true);
});

test('delete refuses live sessions, owned files and paths moved outside configured roots', async t => {
  const { dir, service, action } = setup(t), state = [...service.catalog.values()][0];
  for (const connection of [{ socket: {} }, { worker: {} }]) {
    service.live.set(state.id, { state, ...connection });
    assert.match((await action(state.id, 'delete')).error, /Close this session/);
    assert.ok(existsSync(state.file));
  }
  service.live.delete(state.id);
  const lock = acquireSessionLock(join(dir, 'locks'), state.id);
  try {
    assert.match((await action(state.id, 'delete')).error, /owned/);
    assert.ok(existsSync(state.file));
  } finally { lock.release(); }
  const outside = join(dir, 'outside.jsonl'); writeFileSync(outside, readFileSync(state.file));
  unlinkSync(state.file); symlinkSync(outside, state.file);
  assert.match((await action(state.id, 'delete')).error, /outside configured roots/);
  assert.ok(existsSync(outside));
  await assert.rejects(action('../escape', 'delete'), /Invalid session action/);
  await assert.rejects(action(state.id, 'anything'), /Invalid session action/);
});
