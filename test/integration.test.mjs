import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until } from './helpers.mjs';

test('two live sessions stay independent; history, ownership, dedup and disconnect work', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-host-'));
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [] });
  const port = host.http.address().port, base = 'ws://127.0.0.1:' + port;
  const sockets = [], locks = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); locks.forEach(lock => lock.release()); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const client = await socket(base + '/ws', config.clientToken, 'http://127.0.0.1:' + port);
  sockets.push(client.ws); await until(() => client.messages.find(x => x.type === 'ready'));
  assert.deepEqual((await client.request('ping')).value, { pong: true });
  const agents = [];
  for (const title of ['Session A', 'Session B']) {
    const file = join(dir, title + '.jsonl'); writeFileSync(file, '');
    const id = sessionKey(file), instanceId = randomUUID();
    const lock = acquireLock(join(dir, 'locks'), id, { file, instanceId }); locks.push(lock);
    const agent = await socket(base + '/bridge', config.bridgeToken); sockets.push(agent.ws);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state: { id, file, instanceId, cwd: dir, title, status: 'working', messages: [], tools: [], revision: 0, updatedAt: Date.now() } }));
    agents.push({ ...agent, id });
  }
  await until(() => host.service.live.size === 2);
  assert.equal((await client.request('watch', { sessionId: agents[0].id })).ok, true);
  assert.equal((await client.request('watch', { sessionId: agents[1].id })).ok, true);
  assert.equal(host.service.read(agents[0].id).status, 'working');
  const requestId = randomUUID();
  const packet = { op: 'command', id: requestId, sessionId: agents[1].id, command: { type: 'prompt', text: 'hello B' } };
  client.ws.send(JSON.stringify(packet));
  const command = await until(() => agents[1].messages.find(x => x.type === 'command'));
  assert.equal(agents[0].messages.filter(x => x.type === 'command').length, 0);
  const reconnected = await socket(base + '/ws', config.clientToken, 'http://127.0.0.1:' + port);
  sockets.push(reconnected.ws);
  const ready = await until(() => reconnected.messages.find(x => x.type === 'ready'));
  assert.equal(ready.supportsCommandResults, true);
  const receipt = reconnected.request('commandResult', { sessionId: agents[1].id, requestId });
  agents[1].ws.send(JSON.stringify({ type: 'result', id: command.id, ok: true, value: { accepted: true } }));
  assert.deepEqual((await receipt).value, { ok: true, value: { accepted: true } });
  const missing = await reconnected.request('commandResult', { sessionId: agents[1].id, requestId: 'never-sent' });
  assert.equal(missing.ok, false); assert.match(missing.error, /unknown/);
  await until(() => client.messages.find(x => x.id === requestId && x.type === 'response'));
  client.ws.send(JSON.stringify(packet));
  await until(() => client.messages.filter(x => x.id === requestId && x.type === 'response').length === 2);
  assert.equal(agents[1].messages.filter(x => x.type === 'command').length, 1);
  agents[0].ws.close();
  await until(() => host.service.read(agents[0].id).status === 'disconnected');
  const response = await client.request('command', { sessionId: agents[0].id, command: { type: 'abort' } });
  assert.equal(response.value.ok, false);
  const auth = await socket(base + '/ws', 'incorrect', 'http://127.0.0.1:' + port); sockets.push(auth.ws);
  await until(() => auth.ws.readyState === 3);
  assert.equal(auth.messages.some(x => x.type === 'sessions'), false);
  await assert.rejects(() => socket(base + '/ws', config.clientToken, 'https://evil.example'));
  const staticPage = await fetch('http://127.0.0.1:' + port + '/');
  assert.equal(staticPage.status, 200);
  assert.match(staticPage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('session pages and search stay bounded on initial load, updates and reconnect', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-pages-'));
  const config = loadConfig(dir), host = await startHost({ dir, config, port: 0, roots: [] });
  const clients = [];
  t.after(async () => { clients.forEach(client => client.ws.terminate()); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 675; i++) host.service.catalog.set(String(i), {
    id: String(i), title: `Task ${i}`, cwd: i === 674 ? '/projects/needle' : '/projects/app',
    status: i < 3 ? 'idle' : 'saved', updatedAt: i, messages: []
  });
  const port = host.http.address().port;
  const connect = async () => {
    const client = await socket(`ws://127.0.0.1:${port}/ws`, config.clientToken, `http://127.0.0.1:${port}`);
    clients.push(client); return client;
  };
  const client = await connect();
  const initial = await until(() => client.messages.find(x => x.type === 'sessions'));
  assert.equal(initial.sessions.length, 20);
  assert.equal(initial.total, 675);
  assert.equal(initial.matched, 675);
  assert.equal(initial.offset, 0);
  assert.deepEqual(initial.sessions.slice(0, 3).map(x => x.id), ['2', '1', '0']);
  const second = (await client.request('list', { offset: 20 })).value;
  assert.equal(second.sessions.length, 20);
  assert.equal(second.offset, 20);
  assert.equal(second.sessions.some(x => initial.sessions.some(y => x.id === y.id)), false);
  host.service.emit('list');
  const update = await until(() => client.messages.find(x => x.type === 'sessions' && x.offset === 20));
  assert.deepEqual(update.sessions, second.sessions);
  const window = (await client.request('list', { limit: 40 })).value;
  assert.equal(window.sessions.length, 40); assert.equal(window.limit, 40);
  host.service.emit('list');
  const grown = await until(() => client.messages.find(x => x.type === 'sessions' && x.limit === 40));
  assert.deepEqual(grown.sessions, window.sessions);
  const search = (await client.request('list', { query: ' NEEDLE ' })).value;
  assert.equal(search.total, 675); assert.equal(search.matched, 1);
  assert.deepEqual(search.sessions.map(x => x.id), ['674']);
  const empty = (await client.request('list', { query: 'missing' })).value;
  assert.equal(empty.sessions.length, 0);
  assert.equal(empty.matched, 0);
  const last = (await client.request('list', { offset: 660 })).value;
  assert.equal(last.sessions.length, 15);
  for (let i = 650; i < 675; i++) host.service.catalog.delete(String(i));
  const clamped = (await client.request('list', { offset: 660 })).value;
  assert.equal(clamped.offset, 640); assert.equal(clamped.requestOffset, 660);
  assert.equal(clamped.sessions.length, 10);
  for (const options of [{ offset: -1 }, { offset: 1.5 }, { offset: '20' }, { limit: 0 }, { limit: '40' }, { query: {} }, { query: 'a'.repeat(501) }]) {
    assert.equal((await client.request('list', options)).ok, false);
  }
  const reconnected = await connect();
  assert.equal((await until(() => reconnected.messages.find(x => x.type === 'sessions'))).sessions.length, 20);
});

test('actual extension registers, reattaches after host restart and releases ownership on shutdown', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-extension-'));
  const oldHome = process.env.PI_REMOTE_HOME;
  process.env.PI_REMOTE_HOME = dir;
  const config = loadConfig(dir);
  let host = await startHost({ dir, config, port: 0, roots: [] });
  config.port = host.http.address().port;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  const file = join(dir, 'session.jsonl'); writeFileSync(file, '');
  const handlers = new Map(), prompts = [], branch = [];
  let sessionName = 'Extension test', modelChanges = 0, rejectModel = false, thinkingLevel = 'medium', thinkingChanges = 0;
  const models = [
    { provider: 'test', id: 'first', name: 'First', headers: { Authorization: 'private' }, baseUrl: 'https://private.example' },
    { provider: 'test', id: 'org/second', name: 'Second' }
  ];
  const pi = {
    on(name, handler) { const list = handlers.get(name) || []; list.push(handler); handlers.set(name, list); },
    registerCommand() {}, getSessionName() { return sessionName; },
    setSessionName(name) { sessionName = name; },
    async setModel(model) { if (rejectModel) return false; modelChanges++; ctx.model = model; await emit('model_select', { type: 'model_select', model }); return true; },
    getThinkingLevel() { return thinkingLevel; },
    setThinkingLevel(level) { thinkingChanges++; thinkingLevel = level === 'max' ? 'high' : level; },
    getCommands() { return [
      { name: 'review', description: 'Review changes', source: 'extension', sourceInfo: { path: '/private/extension.ts' } },
      { name: 'skill:debug', description: 'Debug a failure', source: 'skill' },
      { name: 'summarize', description: 'Summarize changes', source: 'prompt' }
    ]; },
    sendUserMessage(text, options) { prompts.push({ text, options }); }
  };
  const ctx = { cwd: dir, sessionManager: { getSessionFile: () => file, getSessionId: () => 'pi-id', getBranch: () => branch },
    model: models[0], modelRegistry: { getAvailable: () => models },
    ui: { notify() {}, setStatus() {} }, abort() {} };
  const emit = async (name, event = {}) => { for (const handler of handlers.get(name) || []) await handler(event, ctx); };
  const extension = (await import('../extension/index.ts')).default;
  extension(pi);
  t.after(async () => {
    await emit('session_shutdown'); await host.close();
    if (oldHome === undefined) delete process.env.PI_REMOTE_HOME; else process.env.PI_REMOTE_HOME = oldHome;
    rmSync(dir, { recursive: true, force: true });
  });
  await emit('session_start');
  await until(() => host.service.live.size === 1);
  const id = sessionKey(file);
  await emit('model_select', { type: 'model_select', model: { provider: 'openai', id: 'o3' } });
  await emit('thinking_level_select', { type: 'thinking_level_select', level: 'high' });
  await until(() => host.service.read(id).model === 'openai/o3' && host.service.read(id).thinkingLevel === 'high');
  const result = await host.service.command(id, randomUUID(), { type: 'followUp', text: 'do this next' });
  assert.equal(result.ok, true);
  assert.deepEqual(prompts, [{ text: 'do this next', options: { deliverAs: 'followUp', expandPromptTemplates: true } }]);
  assert.deepEqual(await host.service.getCommands(id), [
    { name: 'review', description: 'Review changes', source: 'extension' },
    { name: 'skill:debug', description: 'Debug a failure', source: 'skill' },
    { name: 'summarize', description: 'Summarize changes', source: 'prompt' },
    { name: 'new', description: 'Start a new session in this project', source: 'remote' },
    { name: 'model', description: 'Switch model for this session', source: 'remote' }
  ]);
  const client = await socket('ws://127.0.0.1:' + config.port + '/ws', config.clientToken, 'http://127.0.0.1:' + config.port);
  t.after(() => client.ws.terminate());
  assert.deepEqual((await client.request('models', { sessionId: id })).value, { current: 'test/first', models: [
    { provider: 'test', id: 'first', name: 'First' }, { provider: 'test', id: 'org/second', name: 'Second' }
  ] });
  const modelRequest = randomUUID(), modelCommand = { type: 'setModel', provider: 'test', modelId: 'org/second' };
  assert.equal((await host.service.command(id, modelRequest, modelCommand)).ok, true);
  assert.equal((await host.service.command(id, modelRequest, modelCommand)).ok, true);
  assert.equal(modelChanges, 1);
  assert.equal(host.service.read(id).model, 'test/org/second');
  assert.equal(host.service.read(id).thinkingLevel, 'medium');
  assert.equal((await host.service.command(id, randomUUID(), { ...modelCommand, modelId: 'unknown' })).ok, false);
  const thinkingCommand = { type: 'setThinkingLevel', level: 'max' }, thinkingRequest = randomUUID();
  assert.deepEqual(await host.service.command(id, thinkingRequest, thinkingCommand), { ok: true, value: { thinkingLevel: 'high' } });
  await host.service.command(id, thinkingRequest, thinkingCommand);
  assert.equal(thinkingChanges, 1);
  await emit('agent_start', { type: 'agent_start' });
  await until(() => host.service.read(id).thinkingLevel === 'high' && host.service.read(id).status === 'working');
  assert.equal(host.service.read(id).model, 'test/org/second');
  assert.equal(prompts.length, 1);
  const priorLevel = thinkingLevel;
  const thinkingResponse = await client.request('command', { sessionId: id, command: { type: 'setThinkingLevel', level: 'invalid' } });
  assert.equal(thinkingResponse.ok, false);
  assert.equal(thinkingLevel, priorLevel);
  rejectModel = true;
  assert.match((await host.service.command(id, randomUUID(), { ...modelCommand, modelId: 'first' })).error, /authentication/);
  assert.equal(host.service.read(id).model, 'test/org/second');
  for (const text of ['/review src', '/skill:debug failure', '/summarize']) {
    assert.equal((await host.service.command(id, randomUUID(), { type: 'prompt', text })).ok, true);
    assert.deepEqual(prompts.at(-1), { text, options: { deliverAs: 'steer', expandPromptTemplates: true } });
  }
  const sent = prompts.length;
  for (const text of ['/settings', '/model test', '/']) {
    await assert.rejects(() => host.service.command(id, randomUUID(), { type: 'prompt', text }), /terminal|Choose a command/);
  }
  assert.equal(prompts.length, sent);
  // Above the old 1 MiB bridge limit, below the shared 2 MiB attachment budget.
  const images = [{ type: 'image', mimeType: 'image/png', data: Buffer.alloc(1200000).toString('base64') }];
  const imageCommand = { type: 'prompt', text: 'Look here', images };
  host.service.live.get(id).state.supportsImages = false;
  assert.match((await host.service.command(id, randomUUID(), imageCommand)).error, /Restart this Pi terminal/);
  assert.equal(prompts.length, sent);
  host.service.live.get(id).state.supportsImages = true;
  assert.equal((await client.request('command', { sessionId: id, command: imageCommand })).value.ok, true);
  assert.deepEqual(prompts.at(-1), { text: [{ type: 'text', text: 'Look here' }, ...images], options: { deliverAs: 'steer', expandPromptTemplates: true } });
  assert.equal((await host.service.command(id, randomUUID(), { ...imageCommand, type: 'followUp', text: '' })).ok, true);
  assert.deepEqual(prompts.at(-1), { text: images, options: { deliverAs: 'followUp', expandPromptTemplates: true } });
  await emit('message_start', { type: 'message_start', message: { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'streamed' }] } });
  await until(() => host.service.read(id).messages.some(x => x.text === 'streamed'));
  sessionName = undefined;
  branch.push({ type: 'message', message: { role: 'user', content: 'Please review bonus claim reconciliation' } });
  ctx.model = { id: 'test-model' };
  ctx.modelRegistry = { streamSimple: () => ({ result: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'Review bonus claim reconciliation' }] }) }) };
  await emit('agent_end', { type: 'agent_end' });
  await until(() => host.service.list().sessions[0].title === 'Review bonus claim reconciliation');
  sessionName = 'My manual task title';
  await emit('agent_start', { type: 'agent_start' });
  await until(() => host.service.list().sessions[0].title === 'My manual task title');
  await host.close();
  host = await startHost({ dir, config, roots: [] });
  await until(() => host.service.live.has(id));
  assert.equal(host.service.live.get(id).worker, undefined, 'A terminal keeps ownership across host restarts');
  assert.equal(host.service.read(id).supportsImages, true);
  assert.equal((await host.service.command(id, randomUUID(), imageCommand)).ok, true);
  assert.deepEqual(prompts.at(-1), { text: [{ type: 'text', text: 'Look here' }, ...images], options: { deliverAs: 'steer', expandPromptTemplates: true } });
  await emit('session_shutdown');
  assert.throws(() => readFileSync(join(dir, 'locks', id + '.json')), /ENOENT/);
});
