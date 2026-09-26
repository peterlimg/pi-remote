import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, sessionKey, unlockDead } from '../src/locks.mjs';
import { readSession, discover, cleanMessage } from '../src/catalog.mjs';
import { CommandJournal, commandList, validateCommand } from '../src/commands.mjs';
import { JsonLines } from '../src/rpc.mjs';
import { equalSecret, originAllowed } from '../src/config.mjs';
import { summary, initialState, applyEvent } from '../src/state.mjs';

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
test('composer metadata follows live model and reasoning changes and saved branch', t => {
  const state = initialState({ title: 'Pi · project', model: 'anthropic/opus', thinkingLevel: 'medium' });
  applyEvent(state, { type: 'model_select', model: { provider: 'openai', id: 'o3' } });
  applyEvent(state, { type: 'thinking_level_select', level: 'high' });
  assert.equal(state.model, 'openai/o3');
  assert.equal(state.thinkingLevel, 'high');
  const dir = temp(t), file = join(dir, 's.jsonl');
  writeFileSync(file, [
    { type: 'session', id: 's', cwd: dir },
    { type: 'model_change', id: 'old', parentId: null, provider: 'anthropic', modelId: 'old' },
    { type: 'model_change', id: 'new', parentId: 'old', provider: 'openai', modelId: 'o3' },
    { type: 'thinking_level_change', id: 'level', parentId: 'new', thinkingLevel: 'high' },
    { type: 'model_change', id: 'abandoned', parentId: 'old', provider: 'other', modelId: 'wrong' },
    { type: 'message', id: 'leaf', parentId: 'level', message: { role: 'user', content: 'continue' } }
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.equal(readSession(file).model, 'openai/o3');
  assert.equal(readSession(file).thinkingLevel, 'high');
});
test('discovery skips unrelated JSONL but still warns about damaged Pi sessions', t => {
  const dir = temp(t);
  const header = JSON.stringify({ type: 'session', id: 'saved', cwd: dir });
  writeFileSync(join(dir, 'saved_worker_transcript.jsonl'), header + '\n');
  const transcript = join(dir, 'worker_transcript.jsonl');
  writeFileSync(transcript, JSON.stringify({ recordType: 'message', role: 'assistant', text: 'worker output', cwd: dir }) + '\n');
  writeFileSync(join(dir, 'events.jsonl'), '{"event":"started"}\nunfinished record\n');
  writeFileSync(join(dir, 'missing-id.jsonl'), JSON.stringify({ type: 'session', cwd: dir }) + '\n');
  writeFileSync(join(dir, 'corrupt.jsonl'), header + '\ninvalid JSON\n');
  const { sessions, warnings } = discover([dir]);
  assert.deepEqual([...sessions.keys()], [sessionKey(join(dir, 'saved_worker_transcript.jsonl'))]);
  assert.deepEqual(warnings.sort(), [
    'corrupt.jsonl: Invalid session JSONL',
    'missing-id.jsonl: Not a Pi session'
  ]);
  assert.throws(() => readSession(transcript), /Not a Pi session/);
});
test('mobile messages keep tool calls separate from prose within the text limit', () => {
  const message = cleanMessage({ role: 'assistant', content: [
    { type: 'text', text: 'Checking the config.' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'config.json' } }
  ] }, 'assistant-1');
  assert.equal(message.text, 'Checking the config.');
  assert.deepEqual(message.toolCalls, [{ id: 'call-1', name: 'read', text: '{\n  "path": "config.json"\n}' }]);
  assert.equal(cleanMessage({ role: 'toolResult', toolCallId: 'call-1', content: 'ok' }, 'result').toolCallId, 'call-1');
  const large = cleanMessage({ role: 'assistant', content: [
    { type: 'text', text: 'x'.repeat(23000) },
    { type: 'toolCall', id: 'a', name: 'write', arguments: { content: 'y'.repeat(24000) } },
    { type: 'toolCall', id: 'b', name: 'read', arguments: { path: 'file' } }
  ] }, 'large');
  assert.equal(large.text.length + large.toolCalls.reduce((n, call) => n + call.text.length, 0), 24000);
  assert.equal(large.truncated, true);
});
test('session summaries distinguish unnamed work without sending full conversations', () => {
  const state = { id: 'session-a', title: 'Pi · Rill', cwd: '/projects/Rill', file: '/private/session.jsonl',
    status: 'working', messages: [
      { role: 'user', text: 'Old task' },
      { role: 'assistant', text: 'Old reply' },
      { role: 'user', text: 'Fix the\n login timeout' },
      { role: 'assistant', text: 'Checking the callback. ' + 'x'.repeat(300) },
      { role: 'toolResult', text: 'Internal output' }
    ], tools: [{ name: 'read' }] };
  const item = summary(state);
  assert.equal(item.title, 'Old task');
  assert.equal(item.previewRole, 'assistant');
  assert.match(item.preview, /^Checking the callback\./);
  assert.equal(item.preview.length, 160);
  assert.ok(item.preview.endsWith('…'));
  for (const key of ['messages', 'tools', 'file']) assert.equal(key in item, false);
  assert.equal(summary({ ...state, title: 'Release checklist' }).title, 'Release checklist');
  state.messages.push({ role: 'user', text: 'Now check logout' });
  assert.equal(summary(state).title, 'Old task');
  assert.equal(summary(state).previewRole, 'user');
  assert.equal(summary(state).preview, 'Now check logout');
  assert.equal(summary({ ...state, messages: [] }).preview, '');
  assert.equal(state.title, 'Pi · Rill');
});

test('new session is discoverable but cannot be sent as a prompt', () => {
  assert.deepEqual(commandList([], true), [{ name: 'new', description: 'Start a new session in this project', source: 'remote' }]);
  assert.deepEqual(commandList([], false), []);
  assert.throws(() => validateCommand({ type: 'prompt', text: '/new' }), /terminal/);
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
