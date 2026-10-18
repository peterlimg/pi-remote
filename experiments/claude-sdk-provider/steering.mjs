// Opt-in E2E proof: a phone message arrives while a real Pi tool awaits release.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

const modelId = process.env.PI_SDK_TEST_MODEL ?? 'claude-opus-5-5';
const thinking = process.env.PI_SDK_TEST_THINKING ?? 'medium';
const stopAndContinue = process.env.PI_SDK_TEST_STOP === '1';
const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-steering-'));
const scratch = join(evidence, 'scratch'), sessions = join(scratch, 'sessions'), project = join(scratch, 'project');
for (const path of [sessions, project, join(scratch, 'agent')]) mkdirSync(path, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const logFile = join(evidence, 'fixture.jsonl'), gate = join(scratch, 'release');
const marker = 'SDK_MIDTURN_' + randomUUID();
const fixture = join(scratch, 'probe.ts');
writeFileSync(fixture, `import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from ${JSON.stringify(fileURLToPath(import.meta.resolve('typebox')))};
const log = row => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(row) + '\\n');
export default function(pi) {
  let sdkSessionId;
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.on('message_end', event => {
    const m=event.message;
    if(m.role==='assistant'&&m.provider==='claude-sdk') log({phase:'pi-usage',sdkSessionId,usage:m.usage});
  });
  pi.on('input', (event, ctx) => log({phase:'input', streamingBehavior:event.streamingBehavior, idle:ctx.isIdle()}));
  pi.on('provider_stream_event', event => {
    const e=event.data;
    if(e.type==='system'&&e.subtype==='init') {sdkSessionId=e.session_id;log({phase:'sdk-init',sessionId:e.session_id});}
    if(e.type==='result') log({phase:'sdk-result', subtype:e.subtype, cost:e.total_cost_usd, usage:e.modelUsage, uuids:e.user_message_uuids, uuid:e.user_message_uuid});
  });
  pi.registerTool({name:'probe', label:'Synthetic probe', description:'Return a synthetic token. Call once per requested label.',
    parameters:Type.Object({label:Type.String()}, {additionalProperties:false}),
    execute:async(id,input,signal) => {
      log({phase:'execution',id,label:input.label});
      if(input.label==='wait') {
        const deadline=Date.now()+45000;
        while(!existsSync(${JSON.stringify(gate)})) {if(Date.now()>deadline) throw new Error('Probe release timed out'); await delay(50,undefined,{signal});}
      }
      log({phase:'result',id,label:input.label});
      return {content:[{type:'text',text:'PROBE_'+input.label}],details:undefined};
    }
  });
}
`);
const file = join(sessions, 'synthetic.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
const config = { ...loadConfig(scratch), clientToken: 'browser-test-token-only-123456789012345' };
const entry = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const host = await startHost({ dir: scratch, config, roots: [sessions], port: 0, relayUrl: '', allowResume: true,
  workerOptions: { bin: process.execPath, prefix: [entry, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./index.ts', import.meta.url)), '-e', fixture, '--model', 'claude-sdk/'+modelId, '--thinking', thinking] } });
const rows = () => { try { return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const events = [], sent = [], received = [];
const result = { fixture: 'real Pi RPC, SDK, local host and mobile Chromium', model: modelId, thinking, stopAndContinue, pass: false };
let worker, browser, context, page;
console.log('Evidence: ' + evidence);
try {
  const id = sessionKey(file);
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  worker = host.service.live.get(id).worker;
  await worker.request('set_auto_compaction', { enabled: false });
  await worker.request('set_auto_retry', { enabled: false });
  worker.on('event', event => events.push(event));
  browser = await chromium.launch();
  context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  page.on('websocket', socket => {
    socket.on('framesent', frame => sent.push(JSON.parse(frame.payload)));
    socket.on('framereceived', frame => received.push(JSON.parse(frame.payload)));
  });
  await page.goto(`http://127.0.0.1:${host.http.address().port}`);
  await page.getByLabel('Private login link').fill(config.clientToken);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  await page.locator('#prompt').fill('Call probe exactly once with {"label":"wait"}. After its result reply ORIGINAL.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => rows().some(r => r.phase === 'execution' && r.label === 'wait'), { timeout: 60000 }).toBe(true);
  if (stopAndContinue) {
    await page.getByRole('button', { name: 'Abort turn' }).click();
    await expect.poll(() => events.some(e => e.type === 'agent_settled'), { timeout: 10000 }).toBe(true);
    const cancelled = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
    assert.equal(cancelled.stopReason, 'aborted');
    assert(!readFileSync(file, 'utf8').includes('claude-sdk-checkpoint'));
    result.firstTurnStoppedWithoutCheckpoint = true;
  }
  const instruction = stopAndContinue
    ? `Change of plan. The earlier tool was cancelled. Do not retry it. Call probe exactly once with {"label":"new"}, then reply only ${marker}.`
    : `Change of plan. After the pending tool completes, call probe exactly once with {"label":"new"}, then reply only ${marker}. Do not repeat the wait probe.`;
  const beforeContinuation = events.filter(e => e.type === 'agent_settled').length;
  await page.locator('#prompt').fill(instruction);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => {
    const command = sent.find(p => p.command?.text === instruction);
    return command && received.some(p => p.type === 'response' && p.id === command.id && p.ok);
  }, { timeout: 10000 }).toBe(true);
  if (!stopAndContinue) {
    assert(rows().some(r => r.phase === 'input' && r.streamingBehavior === 'steer' && r.idle === false));
    assert.equal(rows().filter(r => r.phase === 'result').length, 0);
    result.messageAcceptedWhileToolRunning = true;
    writeFileSync(gate, 'release');
  }
  await expect.poll(() => events.filter(e => e.type === 'agent_settled').length, { timeout: 60000 }).toBe(beforeContinuation + 1);
  const messages = events.filter(e => e.type === 'message_end').map(e => e.message);
  const last = messages.findLast(m => m.role === 'assistant');
  assert.equal(last.stopReason, 'stop', last.errorMessage);
  assert(last.content.filter(b => b.type === 'text').map(b => b.text).join('').includes(marker));
  assert.deepEqual(rows().filter(r => r.phase === 'execution').map(r => r.label), ['wait', 'new']);
  const calls = messages.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(b => b.type === 'toolCall'));
  const results = messages.filter(m => m.role === 'toolResult');
  assert.deepEqual(results.map(r => r.toolCallId).sort(), calls.map(c => c.id).sort());
  assert(results.every(r => r.isError === (stopAndContinue && r.toolCallId === calls.find(c => c.arguments.label === 'wait').id)));
  await expect(page.locator('#transcript')).toContainText(marker);
  await page.reload();
  await page.locator('#sessions button.session').click();
  await expect(page.locator('#transcript')).toContainText(marker);
  const settled = events.filter(e => e.type === 'agent_settled').length;
  await page.locator('#prompt').fill('Repeat only the exact SDK_MIDTURN marker from your last response. Do not call tools.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => events.filter(e => e.type === 'agent_settled').length, { timeout: 60000 }).toBe(settled + 1);
  const followUp = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
  assert.equal(followUp.stopReason, 'stop', followUp.errorMessage);
  assert.equal(followUp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim(), marker);
  assert.equal(rows().filter(r => r.phase === 'execution').length, 2);
  const epochs = rows().filter(r => r.phase === 'sdk-init').map(r => r.sessionId);
  assert.equal(new Set(epochs).size, stopAndContinue ? 2 : 1);
  const sdk = rows().findLast(r => r.phase === 'sdk-result');
  const ledger = rows().filter(r => r.phase === 'pi-usage' && r.sdkSessionId === epochs.at(-1)).map(r => r.usage);
  assert(Math.abs(ledger.reduce((sum, usage) => sum + usage.cost.total, 0) - sdk.cost) < 1e-10);
  for (const [pi, field] of Object.entries({ input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadInputTokens', cacheWrite: 'cacheCreationInputTokens' })) {
    assert.equal(ledger.reduce((sum, usage) => sum + usage[pi], 0), Object.values(sdk.usage).reduce((sum, usage) => sum + usage[field], 0));
  }
  result.newNativeContextAfterStop = stopAndContinue;
  result.usageScope = 'Current native SDK context; previous cancelled usage remains recorded in Pi.';
  result.sdkSessionReusedForFollowUp = true;
  result.cumulativeUsageMatched = true;
  result.callResultIdsMatched = true;
  result.executions = rows().filter(r => r.phase === 'execution').map(r => r.label);
  result.newInstructionFollowed = true;
  result.reloadPreservedConversation = true;
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
