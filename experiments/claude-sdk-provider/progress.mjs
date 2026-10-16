// Opt-in E2E: real SDK Opus, Pi RPC, local host and mobile browser. Only synthetic styles are inspected.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-progress-')), scratch = join(evidence, 'scratch');
for (const dir of [scratch, join(scratch, 'agent'), join(scratch, 'sessions')]) mkdirSync(dir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
const fixture = join(scratch, 'tools.ts');
writeFileSync(join(scratch, 'focus.css'), '.setting-control:focus { outline: 2px solid green; }\n');
writeFileSync(fixture, `import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from ${JSON.stringify(fileURLToPath(import.meta.resolve('typebox')))};
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.registerTool({ name: 'inspect_styles', label: 'Inspect styles', description: 'Read focus.css to inspect the picker focus styles.',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _input, signal) => {
      await delay(1500, undefined, { signal });
      return { content: [{ type: 'text', text: readFileSync(${JSON.stringify(join(scratch, 'focus.css'))}, 'utf8') }], details: undefined };
    }
  });
}
`);
const remote = fileURLToPath(new URL('../../extension/index.ts', import.meta.url));
const entry = fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const prefix = progress => [entry, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'inspect_styles',
  '-e', fileURLToPath(new URL('./index.ts', import.meta.url)), '-e', fixture, ...(progress ? ['-e', remote] : []),
  '--model', 'claude-sdk/claude-opus-5-5', '--thinking', 'medium'];
const files = ['New progress session', 'Existing SDK session'].map((name, i) => {
  const file = join(scratch, 'sessions', `${i}.jsonl`);
  writeFileSync(file, [
    { type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: scratch },
    { type: 'session_info', id: 'name', parentId: null, name }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return file;
});
const config = loadConfig(scratch);
const host = await startHost({ dir: scratch, config, port: 0, roots: [join(scratch, 'sessions')], relayUrl: '',
  workerOptions: { bin: process.execPath, prefix: prefix(true) } });
const result = { fixture: 'real SDK Opus Medium, Pi, host, Chromium and synthetic styles', turns: [] };
let active, worker, activeId, browser, context, page;
const observe = next => {
  worker = next;
  worker.on('event', event => {
    if (!active) return;
    const elapsed = Date.now() - active.startedAt;
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') active.firstTextMs ??= elapsed;
    if (event.type === 'tool_execution_start') { active.firstToolMs ??= elapsed; active.tools++; }
    if (event.type === 'tool_execution_end') active.firstToolEndMs ??= elapsed;
    if (event.type === 'agent_settled') active.settled = true;
  });
};
const open = async index => {
  const id = sessionKey(files[index]);
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  activeId = id; observe(host.service.live.get(id).worker);
  await page.getByRole('button', { name: new RegExp(index ? 'Existing SDK session' : 'New progress session') }).click();
  await expect(page.locator('#status')).toHaveText('idle');
};
const turn = async text => {
  const record = { startedAt: Date.now(), tools: 0, settled: false };
  active = record; result.turns.push(record);
  await page.locator('#prompt').fill(text);
  await page.locator('#send').click();
  await expect.poll(() => record.settled, { timeout: 90000 }).toBe(true);
  const message = host.service.read(activeId).messages.findLast(message => message.role === 'assistant');
  assert.equal(message?.stopReason, 'stop', message?.text || 'The turn must complete successfully');
  assert(message.text?.trim(), 'The turn must return readable assistant text');
  await expect(page.locator('#status')).toHaveText('idle');
  record.totalMs = Date.now() - record.startedAt;
  return record;
};
const restartWorker = async index => {
  const id = sessionKey(files[index]);
  await worker.close();
  await expect.poll(() => host.service.live.get(id)?.worker).toBe(undefined);
  host.service.workerOptions.prefix = prefix(true);
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  observe(host.service.live.get(id).worker);
  await expect(page.locator('#status')).toHaveText('idle');
};
console.log('Evidence: ' + evidence);
try {
  browser = await chromium.launch();
  context = await browser.newContext({ ...devices['iPhone 13'] });
  page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
  await open(0);
  const first = turn('Check focus.css and explain why tapping the model or effort button can leave an outline. Do not modify files.');
  await expect(page.locator('.message.assistant .message-text').first()).toHaveText(/\S/, { timeout: 60000 });
  const visibleMs = Date.now() - active.startedAt;
  await page.screenshot({ path: join(evidence, 'first-readable-progress.png') });
  const timings = await first;
  assert(timings.tools > 0, 'The model must inspect the synthetic styles');
  assert(timings.firstTextMs < timings.firstToolMs, 'Progress text must stream before the first tool call');
  assert(visibleMs < timings.firstToolEndMs, 'Readable progress must be visible before the tool finishes');
  timings.firstVisibleMs = visibleMs;
  await turn('Which CSS selector would you use instead? You already have the styles; do not call tools.');
  await restartWorker(0);
  await turn('Briefly repeat that selector. Do not call tools.');
  result.newSessionAndResume = true;
  await page.locator('#back').click();
  host.service.workerOptions.prefix = prefix(false);
  await open(1);
  await turn('Remember OLD_PROGRESS_MARKER. Reply only with that marker. Do not call tools.');
  await restartWorker(1);
  await turn('Reply only with the marker you remembered. Do not call tools.');
  await expect(page.locator('#transcript')).toContainText('OLD_PROGRESS_MARKER');
  result.existingCheckpointPreserved = true;
  await page.screenshot({ path: join(evidence, 'existing-session-preserved.png') });
  result.pass = true;
} catch (error) {
  result.pass = false; result.error = error.message;
  throw error;
} finally {
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); await host.close();
  rmSync(scratch, { recursive: true, force: true });
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
