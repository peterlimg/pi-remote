// Opt-in live proof: real Pi RPC, real local host, mobile Chromium, synthetic tools only.
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

const modelId = process.env.PI_SDK_TEST_MODEL ?? 'claude-haiku-5-5';
assert(['claude-haiku-5-5', 'claude-opus-5-5'].includes(modelId), 'Choose a registered SDK test model');
const modelName = modelId === 'claude-opus-5-5' ? 'Claude SDK Opus 5.5 (experimental)' : 'Claude SDK Haiku 5.5 (experimental)';
const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-remote-'));
const scratch = join(evidence, 'scratch');
const sessions = join(scratch, 'sessions');
const project = join(scratch, 'project');
for (const folder of [sessions, project, join(scratch, 'agent')]) mkdirSync(folder, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const fixtureLog = join(evidence, 'fixture.jsonl');
const fixture = join(scratch, 'probe.ts');
writeFileSync(fixture, `import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from ${JSON.stringify(fileURLToPath(import.meta.resolve('typebox')))};
const log = row => appendFileSync(${JSON.stringify(fixtureLog)}, JSON.stringify(row) + '\\n');
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.on('provider_stream_event', event => {
    if (event.data.type === 'result') log({ phase: 'sdk-result', cost: event.data.total_cost_usd, usage: event.data.modelUsage });
  });
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'probe') return;
    log({ phase: 'permission', label: event.input.label, id: event.toolCallId });
    if (!await ctx.ui.confirm('Run synthetic probe?', event.input.label)) return { block: true, reason: 'Denied by Pi mobile test policy.' };
  });
  pi.registerTool({ name: 'probe', label: 'Synthetic probe', description: 'Return a synthetic token. Never retry errors.',
    parameters: Type.Object({ label: Type.String() }, { additionalProperties: false }),
    execute: async (id, input, signal) => {
      log({ phase: 'execution', label: input.label, id });
      if (input.label === 'abort') {
        try { await delay(30000, undefined, { signal }); }
        catch (error) { log({ phase: 'cancelled', id }); throw error; }
      }
      return { content: [{ type: 'text', text: 'SDK_BROWSER_TOKEN_' + id }], details: undefined };
    }
  });
}
`);
const file = join(sessions, 'synthetic.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
const config = { ...loadConfig(scratch), clientToken: 'browser-test-token-only-123456789012345' };
const entry = fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const host = await startHost({ dir: scratch, config, roots: [sessions], port: 0, relayUrl: '', allowResume: true,
  workerOptions: { bin: process.execPath, prefix: [entry, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./index.ts', import.meta.url)), '-e', fixture,
    '--model', 'anthropic/claude-haiku-5-5', '--thinking', 'off'] } });
const id = sessionKey(file);
const url = `http://127.0.0.1:${host.http.address().port}`;
const result = { fixture: 'real Pi RPC and SDK, synthetic in-memory tool', model: modelId, modelCommands: [], permissionAnswers: [], streamingUpdates: 0 };
const events = [];
const fixtureRows = () => { try { return readFileSync(fixtureLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
let browser, context, page, worker;
console.log(`Evidence: ${evidence}`);
try {
  assert.equal((await fetch(url + '/health')).status, 200);
  assert.equal(await (await fetch(url + '/app.js')).text(), readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8'));
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  worker = host.service.live.get(id).worker;
  await worker.request('set_auto_compaction', { enabled: false });
  await worker.request('set_auto_retry', { enabled: false });
  worker.on('event', event => {
    if (event.type === 'message_update') result.streamingUpdates++;
    events.push(event);
  });
  browser = await chromium.launch();
  context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  page.on('websocket', socket => socket.on('framesent', frame => {
    const packet = JSON.parse(frame.payload);
    if (packet.command?.type === 'setModel') result.modelCommands.push(packet.command);
    if (packet.op === 'answer') result.permissionAnswers.push(packet.answer);
  }));
  await page.goto(url);
  await page.getByLabel('Private login link').fill(config.clientToken);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  await page.locator('#model').click();
  const picker = page.getByRole('region', { name: 'Choose a model' });
  await picker.getByRole('button', { name: modelName, exact: true }).click();
  await expect(picker).toBeHidden();
  assert.deepEqual(result.modelCommands, [{ type: 'setModel', provider: 'claude-sdk', modelId }]);
  const selected = (await worker.request('get_state')).model;
  assert.equal(selected.provider, 'claude-sdk');
  assert.equal(selected.id, modelId);
  await page.locator('#model').click();
  await expect(picker.getByRole('button', { pressed: true })).toContainText(modelName);
  await page.getByRole('button', { name: 'Close model picker', exact: true }).click();
  for (const label of ['allow', 'deny', 'abort']) {
    const settledBefore = events.filter(e => e.type === 'agent_settled').length;
    await page.locator('#prompt').fill(`Call probe exactly once with {"label":"${label}"}. Do not retry. Then reply only with its returned token, or DENIED if Pi denies it.`);
    await page.getByRole('button', { name: 'Send message' }).click();
    const dialog = page.locator('#dialog');
    await expect(dialog).toContainText('Run synthetic probe?', { timeout: 60000 });
    await dialog.getByRole('button', { name: label === 'deny' ? 'Deny' : 'Allow', exact: true }).click();
    await expect(dialog).toBeHidden();
    if (label === 'abort') {
      await expect.poll(() => fixtureRows().some(r => r.phase === 'execution' && r.label === 'abort'), { timeout: 10000 }).toBe(true);
      const at = Date.now();
      await page.getByRole('button', { name: 'Abort turn' }).click();
      await expect.poll(() => events.filter(e => e.type === 'agent_settled').length, { timeout: 10000 }).toBe(settledBefore + 1);
      result.abortSettleMs = Date.now() - at;
      assert(result.abortSettleMs < 5000);
      const last = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
      assert.equal(last.stopReason, 'aborted');
      assert.deepEqual(last.content, []);
      assert(fixtureRows().some(r => r.phase === 'cancelled'));
    } else {
      await expect.poll(() => events.filter(e => e.type === 'agent_settled').length, { timeout: 60000 }).toBe(settledBefore + 1);
      const last = events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant').message;
      assert.equal(last.stopReason, 'stop', last.errorMessage);
      const text = last.content.map(b => b.text ?? '').join('');
      if (label === 'allow') assert(text.startsWith('SDK_BROWSER_TOKEN_'));
      else assert.equal(text.trim(), 'DENIED');
      await expect(page.locator('#transcript')).toContainText(text);
      await page.screenshot({ path: join(evidence, `${label}.png`), fullPage: true });
      if (label === 'deny') {
        result.statsBeforeAbort = await worker.request('get_session_stats');
        const sdk = fixtureRows().findLast(r => r.phase === 'sdk-result');
        assert(Math.abs(result.statsBeforeAbort.cost - sdk.cost) < 1e-10);
        const usage = Object.values(sdk.usage).reduce((a, u) => ({
          input: a.input + u.inputTokens, output: a.output + u.outputTokens,
          cacheRead: a.cacheRead + u.cacheReadInputTokens, cacheWrite: a.cacheWrite + u.cacheCreationInputTokens,
        }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
        for (const key of Object.keys(usage)) assert.equal(result.statsBeforeAbort.tokens[key], usage[key]);
      }
    }
    await expect(page.locator('#status')).toHaveText('idle');
  }
  const rows = fixtureRows();
  assert.equal(rows.filter(r => r.phase === 'permission').length, 3);
  assert.deepEqual(rows.filter(r => r.phase === 'execution').map(r => r.label), ['allow', 'abort']);
  assert.deepEqual(result.permissionAnswers.map(a => a.confirmed ?? false), [true, false, true]);
  assert(result.streamingUpdates > 0);
  result.stats = await worker.request('get_session_stats');
  result.sdkCostBeforeAbort = rows.findLast(r => r.phase === 'sdk-result').cost;
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  await expect(page.locator('#transcript')).toContainText('SDK_BROWSER_TOKEN_');
  await expect(page.locator('#transcript')).toContainText('DENIED');
  await page.screenshot({ path: join(evidence, 'after-reload.png'), fullPage: true });
  result.pass = true;
} catch (error) {
  result.pass = false;
  result.error = error.message;
  result.lastRpcEvents = events.slice(-8).map(e => ({ type: e.type, stopReason: e.message?.stopReason,
    error: e.message?.errorMessage, text: e.message?.content?.filter(b => b.type === 'text').map(b => b.text).join('') }));
  if (page) writeFileSync(join(evidence, 'failure.aria.txt'), await page.locator('body').ariaSnapshot());
  if (page) await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close();
  await host.close();
  result.workerClosed = worker?.closed ?? true;
  result.workerPid = worker?.process.pid;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
