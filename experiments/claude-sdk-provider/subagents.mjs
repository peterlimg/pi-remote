// Opt-in: real Pi, Claude SDK and pi-subagents through the mobile UI. Consumes Claude allowance.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

const background = process.env.PI_SDK_TEST_ASYNC === '1';
const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-subagents-')), scratch = join(evidence, 'scratch');
const sessions = join(scratch, 'sessions'), project = join(scratch, 'project'), agentDir = join(scratch, 'agent');
for (const path of [sessions, project, join(agentDir, 'agents')]) mkdirSync(path, { recursive: true });
const settings = join(homedir(), '.pi/agent/settings.json');
const settingsHash = () => existsSync(settings) ? createHash('sha256').update(readFileSync(settings)).digest('hex') : undefined;
const beforeSettings = settingsHash();
Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_SUBAGENTS_TEMP_ROOT: join(scratch, 'subagent-runtime'), PI_OFFLINE: '1', PI_TELEMETRY: '0' });
const sdk = fileURLToPath(import.meta.resolve('pi-claude-sdk/index.ts'));
const subagents = process.env.PI_SDK_TEST_SUBAGENTS || join(homedir(), '.pi/agent/git/github.com/nicobailon/pi-subagents/index.ts');
assert(existsSync(subagents), 'Install pi-subagents or set PI_SDK_TEST_SUBAGENTS.');
// Agent frontmatter uses scalar lists; a blank tools value means no child tools.
writeFileSync(join(agentDir, 'agents/sdk-probe.md'), `---
name: sdk-probe
description: Return a verification marker without tools or edits.
model: claude-sdk/claude-haiku-5-5
thinking: minimal
tools:
extensions:
  - ${sdk}
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
defaultContext: fresh
---
You are a read-only compatibility probe. Return only the requested marker. Do not call tools, edit files, delegate, or run commands.
`);
const logFile = join(evidence, 'native.jsonl'), observer = join(scratch, 'observer.ts');
writeFileSync(observer, `import {appendFileSync} from 'node:fs';
const log = row => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(row)+'\\n');
export default function(pi) {
 pi.on('project_trust',()=>({trusted:'yes'}));
 pi.on('before_provider_request',event=>{
  log({type:'payload',handoff:event.payload.prompt?.some(b=>b.type==='text'&&b.text.includes('Pi tool-set update.'))??false});
 });
 pi.on('provider_stream_event',event=>{
  const e=event.data;if(e.type==='system'&&e.subtype==='init') log({type:'init',session:e.session_id,tools:e.tools});
 });
}
`);
const file = join(sessions, 'subagents.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
const config = { ...loadConfig(scratch), clientToken: 'browser-test-token-only-123456789012345' };
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const host = await startHost({ dir: scratch, config, roots: [sessions], port: 0, relayUrl: '', allowResume: true,
  workerOptions: { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp',
    '--tools', 'subagents_enable,subagent,contact_supervisor,bg_wait', '-e', sdk, '-e', subagents, '-e', observer,
    '--model', 'openai-codex/gpt-5.5', '--thinking', background ? 'medium' : 'max'] } });
const rows = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const events = [], childMarker = 'CHILD_' + randomUUID(), secondMarker = 'CHILD_' + randomUUID(), parentMarker = 'PARENT_' + randomUUID();
const childMarkers = background ? [childMarker, secondMarker] : [childMarker];
const result = { fixture: 'Real Pi, SDK Haiku, pi-subagents, SDK fresh children, local host and mobile Chromium; no simulated model', background, pass: false };
let worker, browser, context;
console.log('Evidence: ' + evidence);
try {
  const id = sessionKey(file);
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  worker = host.service.live.get(id).worker;
  worker.on('event', event => events.push(event));
  await worker.request('set_auto_compaction', { enabled: false });
  await worker.request('set_auto_retry', { enabled: false });
  await worker.request('set_model', { provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
  browser = await chromium.launch(); context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${host.http.address().port}`);
  await page.getByLabel('Private login link').fill(config.clientToken);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  const parentSession = page.locator(`#sessions button.session[data-id="${id}"]`);
  await parentSession.click();
  const task = `Objective: test a fresh SDK child response in ${project}. Authority: no tools, file edits, commands or delegation. Return only ${childMarker}. Stop if unable.`;
  const foregroundPrompt = `Test Pi subagents, not Claude Code built-in agents. Call subagents_enable once, then launch exactly one sdk-probe child with task ${JSON.stringify(task)}, model "claude-sdk/claude-haiku-5-5", async false, output false, and options {"mission":false,"acceptance":{"level":"none","reason":"Disposable response-only probe; the host verifies its marker."}}. This synchronous probe must finish before your reply. Do not use other tools or change models. If anything fails, stop and report the exact failure without retrying. After the child succeeds, reply ${parentMarker} and its returned CHILD marker.`;
  const asyncPrompt = `Test asynchronous Pi subagents, not Claude Code agents. Enable subagents once. Launch exactly two sdk-probe children with two direct subagent calls, async true, output false, model "claude-sdk/claude-haiku-5-5", options {"mission":false,"acceptance":{"level":"none","reason":"Disposable response-only probes verified by the host."}}. Child one task: ${JSON.stringify(task)}. Child two task: ${JSON.stringify(task.replace(childMarker, secondMarker))}. Both are fresh read-only tasks with no tools or edits. After the launch receipts reply STARTED and yield. Do not call bg_wait, status or any other tools and never relaunch a child. Completion notifications will arrive automatically. When they arrive, acknowledge their actual outputs, and after both complete reply ${parentMarker} with both CHILD markers. If anything fails, report it without retrying.`;
  await page.locator('#prompt').fill(background ? asyncPrompt : foregroundPrompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => {
    const completed = events.filter(event => event.type === 'message_end' && event.message.role === 'assistant').map(event => event.message);
    const failure = completed.find(message => message.stopReason === 'error');
    if (failure) throw new Error(failure.errorMessage);
    const last = completed.at(-1), text = last?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
    return events.some(event => event.type === 'agent_settled') && (!background || text.includes(parentMarker) && childMarkers.every(marker => text.includes(marker)));
  }, { timeout: 180000 }).toBe(true);
  const messages = events.filter(event => event.type === 'message_end').map(event => event.message);
  const final = messages.findLast(message => message.role === 'assistant');
  assert.equal(final.stopReason, 'stop', final.errorMessage);
  const text = final.content.filter(block => block.type === 'text').map(block => block.text).join('');
  assert(text.includes(parentMarker) && text.includes(childMarker), text);
  const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'toolCall'));
  assert.equal(calls.filter(call => call.name === 'subagents_enable').length, 1);
  assert.equal(calls.filter(call => call.name === 'subagent' && call.arguments.agent === 'sdk-probe').length, childMarkers.length);
  if (background) assert(calls.filter(call => call.name === 'subagent').every(call => call.arguments.async === true));
  const results = messages.filter(message => message.role === 'toolResult');
  assert(results.every(message => !message.isError));
  assert.deepEqual(results.map(message => message.toolCallId).sort(), calls.map(call => call.id).sort());
  if (background) {
    const children = new Map();
    for (const name of readdirSync(scratch, { recursive: true }).filter(name => name.endsWith('.jsonl'))) {
      const path = join(scratch, name); if (path === file) continue;
      const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      if (lines[0]?.type !== 'session') continue;
      const messages = lines.flatMap(row => row.message?.role === 'assistant' ? [row.message] : []), last = messages.at(-1);
      if (!last || last.provider !== 'claude-sdk' || last.stopReason !== 'stop') continue;
      const output = last.content.filter(block => block.type === 'text').map(block => block.text).join('');
      if (!childMarkers.some(marker => output.includes(marker))) continue;
      assert(messages.every(message => !message.content.some(block => block.type === 'toolCall')));
      children.set(lines[0].id, last.model);
    }
    assert.equal(children.size, 2, 'Both real SDK child transcripts must finish without tools.');
    result.childModels = [...children.values()]; result.childToolCount = 0;
  } else {
    const artifacts = join(sessions, 'subagent-artifacts');
    const children = readdirSync(artifacts).filter(name => name.endsWith('_meta.json')).map(name => JSON.parse(readFileSync(join(artifacts, name), 'utf8')));
    assert.equal(children.length, 1);
    assert.equal(children[0].exitCode, 0); assert.equal(children[0].toolCount, 0);
    assert(children[0].model.startsWith('claude-sdk/claude-haiku-5-5'));
    assert(readFileSync(children[0].transcriptPath, 'utf8').includes('"provider":"claude-sdk"'));
    result.childModel = children[0].model; result.childToolCount = 0;
  }
  const epochs = rows().filter(row => row.type === 'init');
  assert(epochs[0].tools.includes('mcp__pi__subagents_enable') && !epochs[0].tools.includes('mcp__pi__subagent'));
  assert(epochs.at(-1).tools.includes('mcp__pi__subagent'));
  assert.equal(new Set(epochs.map(row => row.session)).size, 2);
  assert(rows().some(row => row.type === 'payload' && row.handoff));
  await expect(page.locator('#transcript')).toContainText(childMarker);
  await page.screenshot({ path: join(evidence, 'subagent-result.png'), fullPage: true });
  await page.reload(); await parentSession.click();
  await expect(page.locator('#transcript')).toContainText(childMarker);
  result.enableCount = 1; result.childLaunchCount = childMarkers.length;
  if (background) result.automaticCompletionAcknowledged = true;
  result.sdkContextHandoff = result.callResultIdsMatched = result.reloadPreservedResult = true;
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); await host.close();
  result.ownedWorkerClosed = worker?.closed ?? true; result.personalSettingsUnchanged = settingsHash() === beforeSettings;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
