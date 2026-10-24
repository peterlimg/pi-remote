// Opt-in E2E: real SDK/Codex turns, synthetic tools, browser reload and owned-worker recovery.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-handoff-'));
const scratch = join(evidence, 'scratch'), sessions = join(scratch, 'sessions'), project = join(scratch, 'project');
for (const path of [sessions, join(project, '.pi')]) mkdirSync(path, { recursive: true });
// Use the normal credential store through Pi, without copying or printing credentials.
const settingsFile = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'settings.json');
const settingsHash = () => createHash('sha256').update(readFileSync(settingsFile)).digest('hex');
const settingsBefore = settingsHash();
writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const markers = { sdk: 'SDK_HANDOFF_' + randomUUID(), gpt: 'GPT_HANDOFF_' + randomUUID(), note: 'GPT_NOTE_' + randomUUID(), bootstrap: 'GPT_BOOTSTRAP_' + randomUUID() };
const imageBrowser = await chromium.launch();
let image;
try {
  const imagePage = await imageBrowser.newPage({ viewport: { width: 320, height: 160 } });
  await imagePage.setContent('<style>body{margin:0;display:flex}div{width:160px;height:160px}</style><div style="background:red"></div><div style="background:blue"></div>');
  image = { type: 'image', mimeType: 'image/png', data: (await imagePage.screenshot()).toString('base64') };
} finally { await imageBrowser.close(); }
const logFile = join(evidence, 'fixture.jsonl'), fixture = join(scratch, 'probe.ts');
writeFileSync(fixture, `import { appendFileSync } from 'node:fs';
import { Type } from ${JSON.stringify(fileURLToPath(import.meta.resolve('typebox')))};
const log = row => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(row) + '\\n');
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.on('before_provider_request', event => {
    const p = event.payload;
    if (p?.model !== 'claude-opus-5-5' || !Array.isArray(p.prompt)) return;
    const header = p.prompt.find(b => b.type === 'text' && b.text.startsWith('Pi history not yet seen by this SDK conversation,'));
    const history = header ? JSON.parse(header.text.slice(header.text.indexOf('\\n') + 1, header.text.lastIndexOf('\\nEnd of historical context.'))) : [];
    log({ phase: 'sdk-input', handoff: Boolean(header), toolResultIds: history.filter(m => m.role === 'toolResult').map(m => m.id),
      images: p.prompt.filter(b => b.type === 'image').length,
      providerSignaturesPresent: /"(?:thinkingSignature|thoughtSignature|textSignature)":/.test(JSON.stringify(p.prompt)) });
  });
  pi.on('provider_stream_event', event => {
    const e = event.data;
    if (e.type === 'system' && e.subtype === 'init') log({ phase: 'sdk-init', sessionId: e.session_id });
    if (e.type === 'result') log({ phase: 'sdk-result', cost: e.total_cost_usd });
  });
  pi.registerTool({ name: 'probe', label: 'Synthetic probe', description: 'Return a synthetic code. Call once per requested label.',
    parameters: Type.Object({ label: Type.Union([Type.Literal('sdk'), Type.Literal('gpt')]) }, { additionalProperties: false }),
    execute: async (id, input) => { log({ phase: 'execution', id, label: input.label });
      return { content: [{ type: 'text', text: ${JSON.stringify(markers)}[input.label] }, ...(input.label === 'gpt' ? [${JSON.stringify(image)}] : [])], details: undefined }; }
  });
}
`);
const file = join(sessions, 'synthetic.jsonl');
writeFileSync(file, [
  { type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project },
  { type: 'session_info', id: 'name', parentId: null, name: 'Cross-provider recovery check' }
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const config = { ...loadConfig(scratch), clientToken: 'browser-test-token-only-123456789012345' };
const host = await startHost({ dir: scratch, config, roots: [sessions], port: 0, relayUrl: '', allowResume: true,
  workerOptions: { bin: 'pi', prefix: ['-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(import.meta.resolve('pi-claude-sdk/index.ts')), '-e', fixture,
    '-e', fileURLToPath(new URL('../../extension/index.ts', import.meta.url)), '--thinking', 'off'] } });
const rows = () => { try { return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const entries = () => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const events = [], id = sessionKey(file);
const result = { fixture: 'real Pi RPC, SDK Opus and Codex GPT-6.1 Sol, mobile Chromium, synthetic tools',
  piVersion: execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim(), pass: false };
let worker, browser, context, page;
const observe = value => { worker = value; worker.on('event', event => events.push(event)); };
console.log('Evidence: ' + evidence);
try {
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  observe(host.service.live.get(id).worker);
  const { models } = await worker.request('get_available_models');
  const sdk = models.find(m => m.provider === 'claude-sdk' && m.id === 'claude-opus-5-5');
  const gpt = models.find(m => m.provider === 'openai-codex' && m.id === 'gpt-6.1-sol');
  assert(sdk && gpt, 'Both official local logins must already be available; this check never starts login.');
  browser = await chromium.launch();
  context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${host.http.address().port}`);
  await page.getByLabel('Private login link').fill(config.clientToken);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  const select = async model => {
    const current = (await worker.request('get_state')).model;
    if (current.provider !== model.provider || current.id !== model.id) {
      await page.locator('#model').click();
      await page.getByRole('searchbox', { name: 'Search models', exact: true }).fill(model.id);
      const group = page.getByRole('region', { name: 'Choose a model' }).getByRole('region', { name: model.provider, exact: true });
      await group.getByRole('button', { name: model.name, exact: true }).click();
      await expect(page.getByRole('region', { name: 'Choose a model' })).toBeHidden();
    }
    await worker.request('set_thinking_level', { level: 'off' });
  };
  const send = async text => {
    const settled = events.filter(e => e.type === 'agent_settled').length;
    await page.locator('#prompt').fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => events.filter(e => e.type === 'agent_settled').length, { timeout: 120000 }).toBe(settled + 1);
    const reply = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
    assert.equal(reply.stopReason, 'stop', reply.errorMessage);
    return reply.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  };
  const recall = async includeNote => {
    const text = await send('Reply only with the SDK_HANDOFF and GPT_HANDOFF codes from the two completed tool results' +
      (includeNote ? ', and the GPT_NOTE code from our later conversation' : '') + ', plus the original GPT_BOOTSTRAP code. Then name the left and right colors in the GPT tool image. Do not call tools.');
    for (const key of includeNote ? ['sdk', 'gpt', 'note', 'bootstrap'] : ['sdk', 'gpt', 'bootstrap']) assert(text.includes(markers[key]), 'The SDK must retain ' + key);
    assert.match(text, /red/i); assert.match(text, /blue/i);
    assert.deepEqual(rows().filter(r => r.phase === 'execution').map(r => r.label), ['sdk', 'gpt']);
  };
  result.stage = 'initial-gpt-history';
  await select(gpt);
  assert((await send('Remember ' + markers.bootstrap + '. Reply only with that code. Do not call tools.')).includes(markers.bootstrap));
  result.stage = 'sdk-tool';
  await select(sdk);
  await send('Call probe exactly once with {"label":"sdk"}. Remember its returned code, then reply READY.');
  const initialHistory = readFileSync(file, 'utf8');
  result.initialGptHistoryAccepted = true;
  result.stage = 'gpt-tool';
  await select(gpt);
  await send('Call probe exactly once with {"label":"gpt"}. Remember its returned code. Do not repeat the SDK probe. Reply READY.');
  result.realGptTurn = true;
  const foreignHistory = entries();
  result.stage = 'return-to-sdk';
  await select(sdk);
  await recall(false);
  result.crossProviderRecall = true;
  result.stage = 'page-refresh';
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  await recall(false);
  result.refreshFollowUp = true;
  result.stage = 'restart-while-away';
  await select(gpt);
  assert((await send('Remember ' + markers.note + '. Reply only with that code. Do not call tools.')).includes(markers.note));
  const previousPid = worker.process.pid;
  await worker.close();
  await expect.poll(() => host.service.live.get(id)?.worker).toBe(undefined);
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  observe(host.service.live.get(id).worker);
  assert.notEqual(worker.process.pid, previousPid);
  await expect(page.locator('#status')).toHaveText('idle');
  await select(sdk);
  await recall(true);
  result.workerRestartWhileAway = true;
  result.stage = 'restart-after-sync';
  await worker.close();
  await expect.poll(() => host.service.live.get(id)?.worker).toBe(undefined);
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  observe(host.service.live.get(id).worker);
  await expect(page.locator('#status')).toHaveText('idle');
  await recall(true);
  result.workerRestartAfterSync = true;
  result.stage = 'recorded-local-rejection';
  await worker.close();
  await expect.poll(() => host.service.live.get(id)?.worker).toBe(undefined);
  const unavailable = 'Claude SDK session is no longer available. Start a new Pi session.';
  const rejected = [
    { role: 'user', content: 'A local retry was rejected before contacting the SDK.', timestamp: Date.now() },
    { role: 'assistant', api: 'claude-sdk', provider: 'claude-sdk', model: sdk.id, timestamp: Date.now(),
      content: [{ type: 'text', text: unavailable }], stopReason: 'error', errorMessage: unavailable,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
  ];
  let parentId = entries().at(-1).id;
  const appended = rejected.map(message => {
    const entry = { type: 'message', id: randomUUID().slice(0, 8), parentId, timestamp: new Date().toISOString(), message };
    parentId = entry.id; return entry;
  });
  writeFileSync(file, appended.map(entry => JSON.stringify(entry)).join('\n') + '\n', { flag: 'a' });
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  observe(host.service.live.get(id).worker);
  await expect(page.locator('#status')).toHaveText('idle');
  await recall(true);
  result.recordedLocalRejectionRecovered = true;
  assert(readFileSync(file, 'utf8').startsWith(initialHistory));
  result.originalHistoryUnchanged = true;
  assert.equal(new Set(rows().filter(r => r.phase === 'sdk-init').map(r => r.sessionId)).size, 1);
  const messages = entries().filter(e => e.type === 'message').map(e => e.message);
  const calls = messages.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(b => b.type === 'toolCall'));
  assert.deepEqual(messages.filter(m => m.role === 'toolResult').map(m => m.toolCallId).sort(), calls.map(c => c.id).sort());
  const piSdkCost = messages.filter(m => m.role === 'assistant' && m.provider === 'claude-sdk').reduce((sum, m) => sum + m.usage.cost.total, 0);
  assert(Math.abs(piSdkCost - rows().findLast(r => r.phase === 'sdk-result').cost) < 1e-10);
  result.oneNativeSession = true;
  result.toolExecutionLabels = rows().filter(r => r.phase === 'execution').map(r => r.label);
  result.callResultIdsMatched = true;
  result.sdkCumulativeCostMatched = true;
  result.foreignImageRetained = true;
  const handoffs = rows().filter(r => r.phase === 'sdk-input' && r.handoff);
  const gptToolId = rows().find(r => r.phase === 'execution' && r.label === 'gpt').id;
  assert.equal(handoffs.length, 4);
  assert.deepEqual(handoffs.flatMap(r => r.toolResultIds), [gptToolId]);
  assert.equal(handoffs.reduce((sum, r) => sum + r.images, 0), 1);
  assert(rows().filter(r => r.phase === 'sdk-input').every(r => !r.providerSignaturesPresent));
  result.foreignToolContextImportedOnce = true;
  result.providerSignaturesOmitted = true;
  result.stage = 'history-safety-guards';
  const goodHistory = entries();
  await worker.close();
  await expect.poll(() => host.service.live.get(id)?.worker).toBe(undefined);
  const checkHistory = async (name, history, expected) => {
    let parentId = null;
    const linked = structuredClone(history).map(entry => {
      if (entry.type !== 'session') { entry.parentId = parentId; parentId = entry.id; }
      return entry;
    });
    const badFile = join(sessions, name + '.jsonl');
    writeFileSync(badFile, linked.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const badId = sessionKey(badFile);
    host.service.scan();
    assert.equal((await host.service.resume(badId, randomUUID())).ok, true);
    observe(host.service.live.get(badId).worker);
    await worker.request('set_model', { provider: sdk.provider, modelId: sdk.id });
    const settled = events.filter(e => e.type === 'agent_settled').length;
    const nativeStarts = rows().filter(r => r.phase === 'sdk-init').length;
    const effects = rows().filter(r => r.phase === 'execution');
    await worker.request('prompt', { message: 'Do not call tools. Reply SAFE.' });
    await expect.poll(() => events.filter(e => e.type === 'agent_settled').length).toBe(settled + 1);
    const last = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
    assert.equal(last.stopReason, expected ? 'error' : 'stop', last.errorMessage);
    if (expected) assert.match(last.errorMessage, expected);
    assert.equal(rows().filter(r => r.phase === 'sdk-init').length, nativeStarts + (expected ? 0 : 1));
    assert.deepEqual(rows().filter(r => r.phase === 'execution'), effects);
    await worker.close();
  };
  const tampered = structuredClone(goodHistory);
  tampered.find(e => e.message?.role === 'toolResult').message.content[0].text = 'CORRUPTED';
  await checkHistory('tampered-prefix', tampered, /SDK history changed/);
  result.changedPrefixRejectedBeforeSdkStart = true;
  const gptCall = foreignHistory.filter(e => e.message?.role === 'assistant' && e.message.provider === 'openai-codex')
    .flatMap(e => e.message.content.filter(b => b.type === 'toolCall'))[0].id;
  await checkHistory('missing-tool-result', foreignHistory.filter(e => e.message?.toolCallId !== gptCall), /Incomplete cross-provider history|unresolved Pi tool calls/);
  result.missingForeignToolResultRejectedBeforeSdkStart = true;
  const uncertain = rejected.map(message => ({ type: 'message', id: randomUUID().slice(0, 8), timestamp: new Date().toISOString(),
    message: message.role === 'assistant' ? { ...message, errorMessage: 'Uncertain SDK failure.', content: [{ type: 'text', text: 'Uncertain SDK failure.' }] } : message }));
  await checkHistory('unknown-sdk-error', [...goodHistory, ...uncertain]);
  result.unknownSdkFailureRebuiltWithoutToolReplay = true;
  assert.equal(settingsHash(), settingsBefore);
  result.personalSettingsUnchanged = true;
  result.pass = true;
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr, { mode: 0o600 });
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close();
  await host.close();
  result.workerClosed = worker?.closed ?? true;
  result.personalSettingsUnchanged = settingsHash() === settingsBefore;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
