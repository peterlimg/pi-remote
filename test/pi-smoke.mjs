import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
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
writeFileSync(trust, `import { writeFileSync } from 'node:fs';
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
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
  console.log('Real Pi smoke passed: extension load, registration, remote commands, bridge/worker compaction with simulated summaries, image delivery, remote off/on, dialogs, usage and mobile progress guidance at the real provider boundary. No external model calls.');
} catch (e) {
  console.error(stderr.slice(-6000)); console.error(JSON.stringify(messages.slice(-10)));
  throw e;
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited; clearTimeout(timer); await host.close(); rmSync(dir, { recursive: true, force: true });
}
