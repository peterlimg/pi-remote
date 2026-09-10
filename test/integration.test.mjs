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
  agents[1].ws.send(JSON.stringify({ type: 'result', id: command.id, ok: true, value: { accepted: true } }));
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

test('actual extension registers, forwards prompts and releases ownership on shutdown', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-extension-'));
  const oldHome = process.env.PI_REMOTE_HOME;
  process.env.PI_REMOTE_HOME = dir;
  const config = loadConfig(dir), host = await startHost({ dir, config, port: 0, roots: [] });
  config.port = host.http.address().port;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  const file = join(dir, 'session.jsonl'); writeFileSync(file, '');
  const handlers = new Map(), prompts = [];
  const pi = {
    on(name, handler) { const list = handlers.get(name) || []; list.push(handler); handlers.set(name, list); },
    registerCommand() {}, getSessionName() { return 'Extension test'; },
    sendUserMessage(text, options) { prompts.push({ text, options }); }
  };
  const ctx = { cwd: dir, sessionManager: { getSessionFile: () => file, getSessionId: () => 'pi-id', getBranch: () => [] },
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
  const result = await host.service.command(id, randomUUID(), { type: 'followUp', text: 'do this next' });
  assert.equal(result.ok, true);
  assert.deepEqual(prompts, [{ text: 'do this next', options: { deliverAs: 'followUp' } }]);
  await emit('message_start', { type: 'message_start', message: { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'streamed' }] } });
  await until(() => host.service.read(id).messages.some(x => x.text === 'streamed'));
  await emit('session_shutdown');
  assert.throws(() => readFileSync(join(dir, 'locks', id + '.json')), /ENOENT/);
});
