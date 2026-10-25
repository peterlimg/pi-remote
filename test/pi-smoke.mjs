import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { JsonLines, RpcWorker } from '../src/rpc.mjs';
import { until } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pi-remote-real-'));
const config = loadConfig(dir), host = await startHost({ dir, config, port: 0, roots: [dir] });
config.port = host.http.address().port; writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
const file = join(dir, 'real.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: dir }) + '\n' +
  [
    { type: 'session_info', id: 'fixture-name', parentId: null, name: 'Real Pi fixture' },
    { type: 'message', id: 'old-question', parentId: 'fixture-name', message: { role: 'user', content: 'Earlier task to summarize.', timestamp: 1 } },
    { type: 'message', id: 'recent-question', parentId: 'old-question', message: { role: 'user', content: 'Keep the recent task.', timestamp: 2 } }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
for (const name of ['agent', 'worker-agent']) {
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
}
const trust = join(dir, 'trust-test.ts');
const receivedImage = join(dir, 'received-image.json'), progressRequest = join(dir, 'progress-request.json');
const usageFailure = join(dir, 'usage-failure');
const titleCalls = join(dir, 'title-calls.jsonl'), titleRelease = join(dir, 'title-release'), titleSupported = join(dir, 'title-supported');
writeFileSync(trust, `import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
export function adapterForProvider(provider) { return { id: provider }; }
export async function resolveUsageAuth(ctx, adapter) {
  if (adapter.id !== ctx.model.provider) throw new Error('Usage must follow the selected provider');
  return { fingerprint: ctx.model.id };
}
export async function queryProviderUsage(adapter, auth, signal, timeout, guard) {
  if (!signal || timeout !== 10000 || !auth.fingerprint) throw new Error('Usage query must be authenticated and bounded');
  await guard();
  if (existsSync(${JSON.stringify(usageFailure)})) throw new Error('Internal provider failure with secret fixture-token');
  return '5-hour limit: [██░░] 75% left';
}
export function formatUsageReport(report, displayState) {
  if (displayState !== 'current') throw new Error('Usage must identify the current account');
  return report;
}
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.on('session_start', (_event, ctx) => { if (ctx.modelRegistry.streamSimple) writeFileSync(${JSON.stringify(titleSupported)}, 'supported'); });
  pi.on('session_before_compact', event => ({ compaction: {
    summary: 'Fixture summary: ' + (event.customInstructions || 'default'),
    firstKeptEntryId: event.preparation.firstKeptEntryId,
    tokensBefore: event.preparation.tokensBefore
  } }));
  pi.registerProvider('remote-progress-fixture', {
    api: 'remote-progress-fixture', apiKey: 'fixture-only', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'progress', name: 'Progress fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 }],
    streamSimple: (_model, context) => {
      writeFileSync(${JSON.stringify(progressRequest)}, JSON.stringify(context));
      throw new Error('Fixture stopped at the provider boundary. No external model calls.');
    }
  });
  pi.registerProvider('remote-title-fixture', {
    api: 'remote-title-fixture', apiKey: 'fixture-only', baseUrl: 'http://127.0.0.1:1',
    models: (process.env.PI_TITLE_CASE === 'no-small' ? ['main'] : ['main', 'gpt-5.6-luna', 'gpt-6-luna']).map((id, index) => ({ id, name: id, reasoning: false, input: ['text'],
      cost: { input: 3 - index, output: 3 - index, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 })),
    streamSimple: (model, context, options) => {
      const title = JSON.stringify(context).includes('Name this coding session'), mode = process.env.PI_TITLE_CASE || 'normal';
      appendFileSync(${JSON.stringify(titleCalls)}, JSON.stringify({ title, mode, model: model.id, context, sessionId: options?.sessionId }) + '\\n');
      const result = (async () => {
        if (title && mode === 'timeout' && model.id !== 'main') await new Promise(() => {});
        if (title && (mode === 'both-fail' || mode === 'rejected' && model.id !== 'main')) throw new Error('Private fixture provider rejection');
        while (!title && !existsSync(${JSON.stringify(titleRelease)})) { options?.signal?.throwIfAborted(); await delay(20); }
        return { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
          content: [{ type: 'text', text: title ? 'Fix mobile session navigation' : 'The main task is complete.' }], stopReason: 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      })();
      return { result: () => result, async *[Symbol.asyncIterator]() {
        const message = await result;
        yield { type: 'start', partial: message }; yield { type: 'done', reason: 'stop', message };
      } };
    }
  });
  for (const name of ['smoke-usage', 'usage']) pi.registerCommand(name, { handler: async (_args, ctx) => {
    await ctx.ui.select('Provider usage\\n5-hour limit: [██░░] 75% left', ['Close']);
  } });
  pi.on('input', event => {
    if (!event.images?.length) return;
    writeFileSync(${JSON.stringify(receivedImage)}, JSON.stringify(event));
    return { action: 'handled' }; // Inspect real Pi delivery without calling a model.
  });
}\n`);
const entry = process.env.PI_REMOTE_SMOKE_PI_ENTRY || resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const child = spawn(process.execPath, [entry, '--mode', 'rpc', '--session', file, '-e', resolve('extension/index.ts'), '-e', trust],
  { cwd: dir, env: { ...process.env, PI_REMOTE_WORKER: '', PI_REMOTE_HOME: dir,
    PI_CODING_AGENT_DIR: join(dir, 'agent'), ANTHROPIC_API_KEY: 'test-key-no-model-calls' }, stdio: ['pipe', 'pipe', 'pipe'] });
const messages = []; let stderr = '';
const parser = new JsonLines(message => messages.push(message));
child.stdout.on('data', data => parser.push(data));
child.stderr.on('data', data => { stderr += data.toString(); });
child.stdin.on('error', () => {});
const exited = new Promise(resolve => child.on('close', resolve));
try {
  await until(() => host.service.live.size === 1, 25000);
  child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
  const state = await until(() => messages.find(x => x.id === 'state' && x.type === 'response'));
  assert.equal(state.success, true);
  child.stdin.write(JSON.stringify({ id: 'stats', type: 'get_session_stats' }) + '\n');
  const stats = await until(() => messages.find(x => x.id === 'stats' && x.type === 'response'));
  const remoteUsage = await host.service.getUsage([...host.service.live.keys()][0]);
  assert.ok(remoteUsage.contextUsage.contextWindow > 0);
  assert.deepEqual(remoteUsage.contextUsage, stats.data.contextUsage);
  const bridgeUsage = await host.service.getUsage([...host.service.live.keys()][0], true);
  assert.equal(bridgeUsage.providerUsage?.title, 'Provider usage\n5-hour limit: [██░░] 75% left');
  assert.equal(messages.some(x => x.type === 'extension_ui_request' && x.method === 'select'), false);
  writeFileSync(usageFailure, '');
  const failedUsage = await host.service.getUsage([...host.service.live.keys()][0], true);
  assert.equal(failedUsage.providerUsage, undefined);
  assert.equal(failedUsage.providerMessage, 'Provider usage is temporarily unavailable. Try again.');
  assert.deepEqual(failedUsage.contextUsage, remoteUsage.contextUsage);
  rmSync(usageFailure);
  assert.equal((await host.service.getUsage([...host.service.live.keys()][0], true)).providerUsage.title, bridgeUsage.providerUsage.title);
  assert.equal(readFileSync(file, 'utf8').includes('/usage'), false, 'Read-only queries must not enter the conversation');
  child.stdin.write(JSON.stringify({ id: 'commands', type: 'get_commands' }) + '\n');
  const commands = await until(() => messages.find(x => x.id === 'commands' && x.type === 'response'));
  assert.ok(commands.data.commands.some(x => x.name === 'pi-remote'));
  const id = [...host.service.live.keys()][0];
  assert.ok((await host.service.getCommands(id)).some(x => x.name === 'pi-remote'));
  const { models } = await host.service.getModels(id);
  const model = models.find(model => model.provider === 'anthropic' && model.id.includes('sonnet-4'));
  assert.ok(model);
  assert.deepEqual(Object.keys(model).sort(), ['id', 'name', 'provider']);
  const switched = await host.service.command(id, randomUUID(), { type: 'setModel', provider: model.provider, modelId: model.id });
  assert.equal(switched.ok, true, switched.error);
  assert.equal(host.service.read(id).model, `${model.provider}/${model.id}`);
  const settingsFile = join(dir, 'agent', 'settings.json');
  const settingsBefore = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : '';
  const thinking = await host.service.command(id, randomUUID(), { type: 'setThinkingLevel', level: 'high' });
  assert.deepEqual(thinking, { ok: true, value: { thinkingLevel: 'high' } });
  assert.equal(host.service.read(id).thinkingLevel, 'high');
  assert.equal(existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : '', settingsBefore);
  const result = await host.service.command(id, randomUUID(), { type: 'prompt', text: '/pi-remote status' });
  assert.equal(result.ok, true);
  await until(() => messages.find(x => x.type === 'extension_ui_request' && x.method === 'notify' && /Pi Remote is running/.test(x.message)));
  const images = [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=' }];
  assert.equal((await host.service.command(id, randomUUID(), { type: 'prompt', text: '', images })).ok, true);
  await until(() => existsSync(receivedImage));
  assert.deepEqual(JSON.parse(readFileSync(receivedImage, 'utf8')).images, images);
  assert.ok((await host.service.getCommands(id)).some(command => command.name === 'compact' && command.source === 'remote'));
  const compactRequest = randomUUID(), compactCommand = { type: 'prompt', text: '/compact Focus on the bridge' };
  assert.equal((await host.service.command(id, compactRequest, compactCommand)).ok, true);
  await until(() => readFileSync(file, 'utf8').includes('Fixture summary: Focus on the bridge'));
  assert.equal((await host.service.command(id, compactRequest, compactCommand)).ok, true);
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(line => line.includes('"type":"compaction"')).length, 1);
  assert.equal((await host.service.command(id, randomUUID(), { type: 'prompt', text: '/compact' })).ok, true);
  await until(() => /Already compacted/.test(host.service.read(id).error || ''));
  child.stdin.write(JSON.stringify({ id: 'off', type: 'prompt', message: '/remote off' }) + '\n');
  await until(() => [...host.service.live.values()][0]?.state.status === 'disconnected');
  child.stdin.write(JSON.stringify({ id: 'on', type: 'prompt', message: '/remote on' }) + '\n');
  await until(() => [...host.service.live.values()][0]?.socket);
  const worker = new RpcWorker(file, dir, { bin: '/usr/bin/env', prefix: [
    'PI_CODING_AGENT_DIR=' + join(dir, 'worker-agent'), process.execPath, entry,
    '--no-extensions', '-e', resolve('extension/index.ts'), '-e', trust,
    '--provider', 'remote-progress-fixture', '--model', 'progress'
  ] });
  try {
    let dialog;
    worker.on('event', event => { if (event.type === 'extension_ui_request' && event.method === 'select') dialog = event; });
    const sent = worker.command({ type: 'prompt', text: '/smoke-usage' });
    await until(() => dialog, 25000);
    assert.deepEqual(await sent, { accepted: true }); // Must not wait for the user to close the dialog.
    worker.process.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: dialog.id, cancelled: true }) + '\n');
    await until(() => worker.pending.size === 0);
    dialog = undefined;
    const usage = await worker.command({ type: 'getUsage', includeProvider: true });
    assert.ok(usage.contextUsage.contextWindow > 0);
    assert.equal(usage.providerUsage.title, 'Provider usage\n5-hour limit: [██░░] 75% left');
    assert.equal(dialog, undefined); // The read-only query closes its own dialog before publishing events.
    await worker.command({ type: 'prompt', text: 'Check the composer focus styles.' });
    await until(() => existsSync(progressRequest), 25000);
    const request = readFileSync(progressRequest, 'utf8');
    for (const phrase of ['before the first tool call', 'every few tool calls', 'before long commands',
      'Do not expose private reasoning', 'Check the composer focus styles.']) {
      assert.ok(request.includes(phrase), 'Real Pi provider request must include: ' + phrase);
    }
    await until(() => worker.pending.size === 0);
    const faults = [];
    worker.on('fault', error => faults.push(error.message));
    assert.deepEqual(await worker.command({ type: 'compact', customInstructions: 'Focus on the worker' }), { accepted: true });
    await until(() => readFileSync(file, 'utf8').includes('Fixture summary: Focus on the worker'));
    await until(() => worker.pending.size === 0);
    await worker.command({ type: 'compact' });
    await until(() => faults.some(message => /Already compacted/.test(message)));
  } finally { await worker.close(); }
  const bare = new RpcWorker(file, dir, { bin: process.execPath, prefix: [entry, '--no-extensions'] });
  try {
    const usage = await bare.command({ type: 'getUsage', includeProvider: true });
    assert.ok(usage.contextUsage.contextWindow > 0);
    assert.equal(usage.providerUsage, undefined);
    assert.match(usage.providerMessage, /No provider usage extension/);
  } finally { await bare.close(); }
  if (existsSync(titleSupported)) {
    const namedFile = join(dir, 'title-session.jsonl');
    writeFileSync(namedFile, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: dir }) + '\n');
    const named = new RpcWorker(namedFile, dir, { bin: '/usr/bin/env', prefix: [
      'PI_CODING_AGENT_DIR=' + join(dir, 'worker-agent'), process.execPath, entry,
      '--no-extensions', '-e', resolve('extension/index.ts'), '-e', trust,
      '--provider', 'remote-title-fixture', '--model', 'main'
    ] });
    try {
      const events = []; named.on('event', event => events.push(event));
      const prompt = '<skill name="debug" location="/private/debug/SKILL.md">\nPrivate skill instructions\n</skill>\n\nPlease fix the mobile session navigation, especially going back to the session list.';
      await named.command({ type: 'prompt', text: prompt });
      await until(() => existsSync(titleCalls) && readFileSync(titleCalls, 'utf8').trim().split('\n').length === 2, 25000);
      let state;
      for (let attempt = 0; attempt < 100; attempt++) {
        state = await named.request('get_state');
        if (state.sessionName) break;
        await delay(20);
      }
      assert.equal(state.sessionName, 'Fix mobile session navigation');
      assert.equal(state.model.id, 'main', 'Naming must not change the conversation model');
      assert.equal(events.some(event => event.type === 'agent_end'), false, 'Naming must finish before the first main reply');
      const calls = readFileSync(titleCalls, 'utf8').trim().split('\n').map(JSON.parse), title = calls.find(call => call.title);
      assert.equal(title.model, 'gpt-6-luna', 'Use the lowest-cost small model on the same provider');
      assert.deepEqual(JSON.parse(title.context.messages[1].content), [{ role: 'user', text: prompt.split('</skill>')[1].trim() }]);
      assert.ok(title.sessionId && title.sessionId !== calls.find(call => !call.title).sessionId, 'Nested naming needs an isolated provider conversation');
      writeFileSync(titleRelease, 'release');
      await until(() => events.some(event => event.type === 'agent_settled'), 25000);
      assert.ok(readFileSync(namedFile, 'utf8').includes('"name":"Fix mobile session navigation"'));
      await named.request('set_session_name', { name: 'My manual task title' });
      events.length = 0;
      await named.command({ type: 'prompt', text: 'Now review the billing system instead.' });
      await until(() => events.some(event => event.type === 'agent_settled'), 25000);
      assert.equal((await named.request('get_state')).sessionName, 'My manual task title');
      assert.equal(readFileSync(titleCalls, 'utf8').trim().split('\n').map(JSON.parse).filter(call => call.title).length, 1);
      console.log('First-request small-model title E2E passed: early naming, isolated provider context, persistence and manual-name protection.');
    } finally { await named.close(); }
    for (const mode of ['rejected', 'timeout', 'both-fail', 'no-small']) {
      const file = join(dir, 'title-' + mode + '.jsonl');
      writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: dir }) + '\n');
      const worker = new RpcWorker(file, dir, { bin: '/usr/bin/env', prefix: [
        'PI_TITLE_CASE=' + mode, 'PI_CODING_AGENT_DIR=' + join(dir, 'worker-agent'), process.execPath, entry,
        '--no-extensions', '-e', resolve('extension/index.ts'), '-e', trust,
        '--provider', 'remote-title-fixture', '--model', 'main'
      ] });
      try {
        const events = []; let settledAt;
        worker.on('event', event => { events.push(event); if (event.type === 'agent_settled') settledAt ??= Date.now(); });
        const started = Date.now();
        await worker.command({ type: 'prompt', text: 'Fix mobile session navigation' });
        let state;
        do {
          state = await worker.request('get_state');
          if (state.sessionName || events.some(event => event.method === 'notify' && /Could not generate a task title/.test(event.message))) break;
          await delay(50);
        } while (Date.now() - started < 15000);
        assert.equal(state.sessionName, mode === 'both-fail' ? undefined : 'Fix mobile session navigation', mode);
        assert.equal(state.model.id, 'main');
        await until(() => events.some(event => event.type === 'agent_settled'));
        const namingCalls = () => readFileSync(titleCalls, 'utf8').trim().split('\n').map(JSON.parse).filter(call => call.mode === mode && call.title);
        assert.deepEqual(namingCalls().map(call => call.model), mode === 'no-small' ? ['main'] : ['gpt-6-luna', 'main']);
        assert.ok(!JSON.stringify(events).includes('Private fixture provider rejection'));
        if (mode === 'timeout') {
          assert.ok(settledAt - started < 7000, 'The main task must finish without waiting for the naming timeout');
          assert.ok(Date.now() - started < 15000, 'A provider ignoring abort must still fall back within the total budget');
        }
        await worker.command({ type: 'prompt', text: 'A follow-up must not keep retrying the title' });
        await until(() => events.filter(event => event.type === 'agent_settled').length === 2);
        assert.equal(namingCalls().length, mode === 'no-small' ? 1 : 2, 'Only one bounded naming attempt per session runtime');
      } finally { await worker.close(); }
    }
    console.log('Title fallback E2E passed: unsupported small model, ignored cancellation, both providers failing, and no small model.');
  } else console.log('SKIP title generation: this Pi version has no modelRegistry.streamSimple API.');
  console.log('Real Pi smoke passed: extension load, registration, remote commands, bridge/worker compaction with simulated summaries, image delivery, remote off/on, dialogs, usage and mobile progress guidance at the real provider boundary. No external model calls.');
} catch (e) {
  console.error(stderr.slice(-6000)); console.error(JSON.stringify(messages.slice(-10)));
  throw e;
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited; clearTimeout(timer); await host.close(); rmSync(dir, { recursive: true, force: true });
}
