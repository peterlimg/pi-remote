import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
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
test('fast mode follows pi-usage status and clears on model changes', () => {
  const state = initialState({});
  const status = statusText => applyEvent(state, { type: 'extension_ui_request', method: 'setStatus', statusKey: 'usage', statusText });
  assert.equal(state.fastMode, undefined);
  state.updatedAt = 1;
  status('\u001b[32mcodex fast 80%\u001b[0m');
  assert.equal(state.fastMode, true);
  assert.equal(state.updatedAt, 1);
  applyEvent(state, { type: 'extension_ui_request', method: 'setStatus', statusKey: 'other', statusText: 'idle' });
  assert.equal(state.fastMode, true);
  for (const text of ['codex 80%', undefined, 'auth unavailable', 'codex faster']) {
    status('codex fast');
    status(text);
    assert.equal(state.fastMode, false);
  }
  status('codex fast');
  applyEvent(state, { type: 'model_select', model: { provider: 'test', id: 'other' } });
  assert.equal(state.fastMode, false);
});
test('discovery reparses only sessions whose file changed', t => {
  const dir = temp(t), file = join(dir, 'cached.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'cached', cwd: dir }) + '\n');
  const first = discover([dir]).sessions.get(sessionKey(file));
  assert.equal(discover([dir]).sessions.get(sessionKey(file)), first);
  appendFileSync(file, JSON.stringify({ type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: 'appended' } }) + '\n');
  const changed = discover([dir]).sessions.get(sessionKey(file));
  assert.notEqual(changed, first);
  assert.equal(changed.messages.at(-1).text, 'appended');
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
  assert.deepEqual(commandList([], true), [
    { name: 'new', description: 'Start a new session in this project', source: 'remote' },
    { name: 'model', description: 'Switch model for this session', source: 'remote' }
  ]);
  assert.deepEqual(commandList([], false), []);
  assert.throws(() => validateCommand({ type: 'prompt', text: '/new' }), /terminal/);
});

test('model switching accepts only bounded provider and model identifiers', () => {
  assert.deepEqual(validateCommand({ type: 'setModel', provider: 'test', modelId: 'org/model', headers: { secret: 'discard' } }),
    { type: 'setModel', provider: 'test', modelId: 'org/model' });
  for (const value of ['', ' ', null, {}, 'a b', 'x'.repeat(501)]) {
    assert.throws(() => validateCommand({ type: 'setModel', provider: value, modelId: 'id' }), /provider and model/);
    assert.throws(() => validateCommand({ type: 'setModel', provider: 'test', modelId: value }), /provider and model/);
  }
});

test('reasoning changes accept only Pi levels and discard unrelated fields', () => {
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.deepEqual(validateCommand({ type: 'setThinkingLevel', level, text: 'not a prompt' }), { type: 'setThinkingLevel', level });
  }
  for (const level of [undefined, null, {}, '', 'HIGH', ' high', 'extreme']) {
    assert.throws(() => validateCommand({ type: 'setThinkingLevel', level }), /Invalid reasoning effort/);
  }
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
test('delivery lookup waits for an in-flight result, survives restart and never executes missing requests', async t => {
  const dir = temp(t), journal = new CommandJournal(dir);
  let finish;
  const sent = journal.execute('s', 'request-lookup', {}, () => new Promise(resolve => { finish = resolve; }));
  const lookup = journal.result('s', 'request-lookup');
  finish('accepted');
  assert.deepEqual(await lookup, await sent);
  assert.deepEqual(await new CommandJournal(dir).result('s', 'request-lookup'), { ok: true, value: 'accepted' });
  await assert.rejects(() => journal.result('other-session', 'request-lookup'), /unknown/);
  await assert.rejects(() => journal.result('s', 'never-sent'), /unknown/);
  await assert.rejects(() => journal.result('s', '../bad'), /Invalid request ID/);
  await journal.execute('s', 'request-rejected', {}, () => { throw new Error('Rejected'); });
  assert.deepEqual(await journal.result('s', 'request-rejected'), { ok: false, error: 'Rejected' });
  void journal.execute('s', 'interrupted-request', {}, () => new Promise(() => {}));
  await assert.rejects(() => new CommandJournal(dir).result('s', 'interrupted-request'), /unknown/);
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
