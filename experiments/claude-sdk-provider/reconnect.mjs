// Opt-in E2E: refresh and picker-only provider changes must not end an idle SDK conversation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-reconnect-'));
const scratch = join(evidence, 'scratch'), sessions = join(scratch, 'sessions'), project = join(scratch, 'project');
for (const path of [sessions, project, join(scratch, 'agent')]) mkdirSync(path, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const marker = 'SDK_RECONNECT_' + randomUUID();
const logFile = join(evidence, 'fixture.jsonl'), fixture = join(scratch, 'probe.ts');
writeFileSync(fixture, `import { appendFileSync } from 'node:fs';
import { Type } from ${JSON.stringify(fileURLToPath(import.meta.resolve('typebox')))};
import { createProvider } from ${JSON.stringify(fileURLToPath(import.meta.resolve('@earendil-works/pi-ai')))};
import { getBuiltinModels } from ${JSON.stringify(fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/providers/all')))};
const log = row => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(row) + '\\n');
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.on('provider_stream_event', event => {
    if (event.data.type === 'system' && event.data.subtype === 'init') log({ phase: 'sdk-init', sessionId: event.data.session_id });
  });
  pi.registerTool({ name: 'probe', label: 'Synthetic probe', description: 'Return a synthetic code. Call only when explicitly requested.',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async id => { log({ phase: 'execution', id }); return { content: [{ type: 'text', text: ${JSON.stringify(marker)} }], details: undefined }; }
  });
  const model = getBuiltinModels('anthropic').find(m => m.id === 'claude-haiku-5-5');
  const forbidden = () => { log({ phase: 'control-inference' }); throw new Error('The selection-only provider must never run inference.'); };
  pi.registerProvider(createProvider({ id: 'selection-control', name: 'Selection-only control',
    auth: { apiKey: { name: 'Synthetic selection control', resolve: async () => ({ auth: {}, source: 'fixture' }) } },
    models: [{ ...model, provider: 'selection-control', api: 'selection-control', name: 'Selection-only control', baseUrl: '' }],
    api: { stream: forbidden, streamSimple: forbidden }
  }));
}
`);
const file = join(sessions, 'synthetic.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
const config = { ...loadConfig(scratch), clientToken: 'browser-test-token-only-123456789012345' };
const host = await startHost({ dir: scratch, config, roots: [sessions], port: 0, relayUrl: '', allowResume: true,
  workerOptions: { bin: 'pi', prefix: ['-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./index.ts', import.meta.url)), '-e', fixture,
    '--model', 'claude-sdk/claude-opus-5-5', '--thinking', 'off'] } });
const rows = () => { try { return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const events = [], id = sessionKey(file);
const result = { fixture: 'real Pi RPC, SDK, local host and mobile Chromium; selection-only alternative provider',
  piVersion: execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim(), pass: false };
let worker, browser, context, page;
console.log('Evidence: ' + evidence);
try {
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  worker = host.service.live.get(id).worker;
  await worker.request('set_auto_compaction', { enabled: false });
  await worker.request('set_auto_retry', { enabled: false });
  worker.on('event', event => events.push(event));
  browser = await chromium.launch();
  context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${host.http.address().port}`);
  await page.getByLabel('Private login link').fill(config.clientToken);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  const send = async text => {
    const settled = events.filter(e => e.type === 'agent_settled').length;
    await page.locator('#prompt').fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => events.filter(e => e.type === 'agent_settled').length, { timeout: 120000 }).toBe(settled + 1);
    const reply = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
    assert.equal(reply.stopReason, 'stop', reply.errorMessage);
    return reply.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  };
  const reload = async () => {
    await page.reload();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.locator('#sessions button.session').click();
  };
  const select = async name => {
    await page.locator('#model').click();
    await page.getByRole('searchbox', { name: 'Search models', exact: true }).fill(name);
    await page.getByRole('region', { name: 'Choose a model' }).getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Choose a model' })).toBeHidden();
  };
  result.stage = 'initial';
  await send('Call probe exactly once. Remember its returned code, then reply READY.');
  assert.equal(rows().filter(r => r.phase === 'execution').length, 1);
  assert(readFileSync(file, 'utf8').includes('claude-sdk-checkpoint'));
  result.stage = 'page-refresh';
  await reload();
  const recall = 'Reply only with the exact SDK_RECONNECT code from the tool result. Do not call tools.';
  assert.equal(await send(recall), marker);
  result.refreshFollowUp = true;
  result.stage = 'provider-switch-and-refresh';
  const originalPid = worker.process.pid;
  await select('Selection-only control');
  await select('Claude SDK Opus 5.5 (experimental)');
  await reload();
  assert.equal(await send(recall), marker);
  assert.equal(worker.process.pid, originalPid);
  result.idleProviderRoundTrip = true;
  assert.equal(rows().filter(r => r.phase === 'execution').length, 1);
  assert.equal(rows().filter(r => r.phase === 'control-inference').length, 0);
  assert.equal(new Set(rows().filter(r => r.phase === 'sdk-init').map(r => r.sessionId)).size, 1);
  const messages = events.filter(e => e.type === 'message_end').map(e => e.message);
  const calls = messages.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(b => b.type === 'toolCall'));
  const results = messages.filter(m => m.role === 'toolResult');
  assert.deepEqual(results.map(m => m.toolCallId), calls.map(c => c.id));
  result.callResultIdsMatched = true;
  result.oneNativeSession = true;
  result.oneToolExecution = true;
  result.noOtherProviderInference = true;
  result.pass = true;
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close();
  await host.close();
  result.workerClosed = worker?.closed ?? true;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
