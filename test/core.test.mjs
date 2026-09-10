import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, sessionKey, unlockDead } from '../src/locks.mjs';
import { readSession, discover } from '../src/catalog.mjs';
import { CommandJournal } from '../src/commands.mjs';
import { JsonLines } from '../src/rpc.mjs';
import { equalSecret, originAllowed } from '../src/config.mjs';

function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'pi-remote-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('ownership is exclusive and living owners cannot be unlocked', t => {
  const dir = temp(t), file = join(dir, 'session.jsonl'); writeFileSync(file, '');
  const key = sessionKey(file), lock = acquireLock(dir, key);
  assert.throws(() => acquireLock(dir, key), /owned/);
  assert.throws(() => unlockDead(dir, key), /still exists/);
  lock.release(); lock.release();
  acquireLock(dir, key).release();
});
test('future session paths have stable ownership after creation', t => {
  const dir = temp(t), file = join(dir, 'new', 'session.jsonl');
  const key = sessionKey(file);
  mkdirSync(join(dir, 'new')); writeFileSync(file, '');
  assert.equal(sessionKey(file), key);
});
test('saved history follows parent links and excludes abandoned branches', t => {
  const dir = temp(t), file = join(dir, 's.jsonl');
  const entries = [
    { type: 'session', id: 'session', cwd: dir },
    { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'first', timestamp: 1 } },
    { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: 'abandoned', timestamp: 2 } },
    { type: 'message', id: 'c', parentId: 'a', message: { role: 'assistant', content: [{ type: 'text', text: 'current' }], timestamp: 3 } }
  ];
  writeFileSync(file, entries.map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.deepEqual(readSession(file).messages.map(x => x.text), ['first', 'current']);
  assert.equal(discover([dir]).sessions.size, 1);
});
test('duplicate requests execute once across concurrency and journal restarts', async t => {
  const dir = temp(t), journal = new CommandJournal(dir); let count = 0;
  const action = async () => { count++; await new Promise(resolve => setTimeout(resolve, 20)); return 'accepted'; };
  const values = await Promise.all([
    journal.execute('s', 'request-123', { type: 'abort' }, action),
    journal.execute('s', 'request-123', { type: 'abort' }, action)
  ]);
  assert.equal(count, 1); assert.deepEqual(values[0], values[1]);
  await new CommandJournal(dir).execute('s', 'request-123', { type: 'abort' }, action);
  assert.equal(count, 1);
  await assert.rejects(() => journal.execute('s', 'request-123', { type: 'prompt' }, action), /different content/);
});
test('interrupted delivery is not replayed', async t => {
  const dir = temp(t), journal = new CommandJournal(dir);
  const original = journal.execute('s', 'request-xyz', {}, () => new Promise(() => {}));
  await assert.rejects(() => new CommandJournal(dir).execute('s', 'request-xyz', {}, () => assert.fail('must not execute')), /unknown/);
  void original;
});
test('RPC JSONL handles chunked UTF-8 and Unicode separators', () => {
  const values = [], parser = new JsonLines(value => values.push(value));
  const bytes = Buffer.from(JSON.stringify({ text: '中文\u2028line\u2029end' }) + '\r\n');
  for (let i = 0; i < bytes.length; i++) parser.push(bytes.subarray(i, i + 1));
  assert.deepEqual(values, [{ text: '中文\u2028line\u2029end' }]);
  assert.throws(() => new JsonLines(() => {}, 3).push(Buffer.from('12345')), /too large/);
});
test('authentication and origins fail closed', () => {
  assert.equal(equalSecret('a', 'a'), true); assert.equal(equalSecret('a', 'aa'), false);
  assert.equal(equalSecret(undefined, 'a'), false);
  assert.equal(originAllowed('https://evil.example', ['https://remote.example']), false);
  assert.equal(originAllowed(undefined, ['https://remote.example']), false);
});
