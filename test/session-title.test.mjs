import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSessionTitles, sessionTitle } from '../src/session-title.mjs';
import { readSession, cleanMessage } from '../src/catalog.mjs';
import { summary, initialState, applyEvent } from '../src/state.mjs';
import { until } from './helpers.mjs';

const response = title => ({ stopReason: 'stop', content: [{ type: 'text', text: title }] });
function setup(t, result = async () => response('Review bonus claim reconciliation')) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-title-')), file = join(dir, 'session.jsonl');
  const entries = [
    { type: 'session', id: 'session', cwd: dir },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'Can you review the bonus claim reconciliation, especially how pending claims are matched?' } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Private reasoning' }, { type: 'text', text: 'I will check claim reconciliation.' }, { type: 'toolCall', arguments: { secret: 'private-tool-input' } }] } }
  ];
  writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map(), calls = [], notices = [], published = [];
  let name;
  const pi = {
    on: (event, handler) => handlers.set(event, handler), getSessionName: () => name,
    setSessionName(value) {
      name = value;
      const entry = { type: 'session_info', id: 'name-' + entries.length, parentId: entries.at(-1).id, name };
      entries.push(entry); appendFileSync(file, JSON.stringify(entry) + '\n');
    }
  };
  const ctx = { model: { id: 'configured-model', provider: 'configured-provider' }, sessionManager: { getBranch: () => entries },
    modelRegistry: { streamSimple(model, context, options) { calls.push({ model, context, options }); return { result }; } },
    ui: { notify: text => notices.push(text) } };
  registerSessionTitles(pi, title => published.push(title));
  return { pi, ctx, calls, notices, published, entries, file, emit: event => handlers.get(event)({}, ctx) };
}

test('task titles use the configured model once and persist for saved sessions without exposing tool/thinking content', async t => {
  const app = setup(t);
  app.emit('session_start');
  await until(() => app.published.length);
  assert.equal(app.pi.getSessionName(), 'Review bonus claim reconciliation');
  assert.equal(readSession(app.file).title, 'Review bonus claim reconciliation');
  assert.equal(summary(readSession(app.file)).title, 'Review bonus claim reconciliation');
  const call = app.calls[0];
  assert.equal(call.model, app.ctx.model);
  assert.equal(call.options.maxTokens, 120);
  const input = JSON.stringify(call.context);
  assert.match(input, /bonus claim reconciliation/);
  assert.ok(!input.includes('private-tool-input') && !input.includes('Private reasoning'));
  app.entries.push({ type: 'message', message: { role: 'user', content: 'yes, push it' } });
  app.emit('agent_end'); app.emit('session_start');
  assert.equal(app.calls.length, 1);
  assert.equal(app.pi.getSessionName(), 'Review bonus claim reconciliation');
});

test('new sessions wait for a task and concurrent turns cannot start duplicate title calls', async t => {
  let resolve;
  const app = setup(t, () => new Promise(done => { resolve = done; }));
  const messages = app.entries.splice(1);
  app.emit('session_start'); assert.equal(app.calls.length, 0);
  app.entries.push(...messages);
  app.emit('agent_end'); app.emit('agent_end');
  assert.equal(app.calls.length, 1);
  resolve(response('Review bonus claim reconciliation'));
  await until(() => app.published.length);
});

test('manual names and session switches win over delayed title results', async t => {
  let resolve;
  const app = setup(t, () => new Promise(done => { resolve = done; }));
  app.emit('session_start');
  app.pi.setSessionName('My release checklist');
  resolve(response('Generated title'));
  await new Promise(done => setImmediate(done));
  assert.equal(app.pi.getSessionName(), 'My release checklist');
  assert.equal(app.published.length, 0);
  app.emit('session_start'); assert.equal(app.calls.length, 1);
  app.pi.setSessionName('');
  app.emit('session_start');
  app.emit('session_shutdown');
  assert.equal(app.calls.at(-1).options.signal.aborted, true);
  resolve(response('Wrong session title'));
  await new Promise(done => setImmediate(done));
  assert.equal(app.pi.getSessionName(), '');
  assert.equal(app.notices.length, 0);
});

test('invalid output, provider failure and older Pi keep browsing usable without retry loops', async t => {
  for (const result of [() => response('x'.repeat(81)), () => response('Title\nExplanation'),
    () => ({ ...response('Partial title'), stopReason: 'length' }), () => { throw new Error('secret-provider-error'); }]) {
    const app = setup(t, result);
    app.emit('session_start');
    await until(() => app.notices.length);
    assert.equal(app.pi.getSessionName(), undefined);
    assert.ok(!app.notices[0].includes('secret-provider-error'));
    app.emit('agent_end'); assert.equal(app.calls.length, 1);
  }
  const app = setup(t);
  delete app.ctx.modelRegistry.streamSimple;
  app.emit('session_start');
  assert.equal(app.calls.length, 0);
});

const skillPrompt = (request = '', body = 'Private skill instructions') =>
  `<skill name="code-review" location="/private/skills/code-review/SKILL.md">\n${body}\n</skill>\n\n${request}`;

test('skill titles and previews use the request for live, saved and old bridge sessions', t => {
  const text = skillPrompt('Review PR #26');
  const app = setup(t);
  app.entries[1].message.content = text;
  writeFileSync(app.file, app.entries.slice(0, 2).map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const saved = readSession(app.file);
  assert.equal(saved.title, 'Review PR #26');
  assert.equal(summary(saved).preview, 'Review PR #26');
  const state = initialState({});
  applyEvent(state, { type: 'message_end', message: { role: 'user', content: text, timestamp: 1 } });
  assert.equal(state.title, 'Review PR #26');
  const oldTitle = text.replace(/\s+/g, ' ').slice(0, 79) + '…';
  assert.equal(summary({ ...state, title: oldTitle }).title, 'Review PR #26');
  assert.equal(sessionTitle('My review', state.messages), 'My review');
  const followup = cleanMessage({ role: 'user', content: 'yes, push it' }, 'followup');
  assert.equal(sessionTitle(oldTitle, [followup]), 'Skill: code-review');
  for (const content of [skillPrompt(), skillPrompt('', 'Private skill instructions\n'.repeat(1500))]) {
    const message = cleanMessage({ role: 'user', content }, 'skill');
    const result = summary(initialState({}, [message]));
    assert.equal(result.title, 'Skill: code-review');
    assert.equal(result.preview, 'Skill: code-review');
    assert.equal(message.text, content.slice(0, 24000));
  }
});

test('model naming strips skill instructions before shortening the input', async t => {
  const app = setup(t);
  app.entries[1].message.content = skillPrompt('Review PR #26', 'Private skill instructions\n'.repeat(1500));
  app.emit('session_start');
  await until(() => app.published.length);
  const input = JSON.parse(app.calls[0].context.messages[1].content);
  assert.deepEqual(input[0], { role: 'user', text: 'Review PR #26' });
  assert.ok(!JSON.stringify(input).includes('Private skill instructions'));
});

test('fallback task titles stay tied to the original request after follow-ups and history trimming', () => {
  const state = initialState({ title: 'Pi · project' });
  applyEvent(state, { type: 'message_end', message: { role: 'user', content: 'Review bonus claim reconciliation', timestamp: 1 } });
  for (let i = 2; i < 105; i++) applyEvent(state, { type: 'message_end', message: { role: 'user', content: 'yes', timestamp: i } });
  assert.equal(summary(state).title, 'Review bonus claim reconciliation');
  assert.equal(state.messages.length, 100);
});
