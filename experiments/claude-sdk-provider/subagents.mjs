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

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-subagents-')), scratch = join(evidence, 'scratch');
const sessions = join(scratch, 'sessions'), project = join(scratch, 'project'), agentDir = join(scratch, 'agent');
for (const path of [sessions, project, join(agentDir, 'agents')]) mkdirSync(path, { recursive: true });
const settings = join(homedir(), '.pi/agent/settings.json');
const settingsHash = () => existsSync(settings) ? createHash('sha256').update(readFileSync(settings)).digest('hex') : undefined;
const beforeSettings = settingsHash();
Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0' });
const sdk = fileURLToPath(new URL('./index.ts', import.meta.url));
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
    '--model', 'openai-codex/gpt-5.5', '--thinking', 'max'] } });
const rows = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const events = [], childMarker = 'CHILD_' + randomUUID(), parentMarker = 'PARENT_' + randomUUID();
const result = { fixture: 'Real Pi, SDK Haiku Max, pi-subagents, SDK fresh child, local host and mobile Chromium; no simulated model', pass: false };
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
  await page.locator('#prompt').fill(`Test Pi subagents, not Claude Code built-in agents. Call subagents_enable once, then launch exactly one sdk-probe child with task ${JSON.stringify(task)}, model "claude-sdk/claude-haiku-5-5", async false, output false, and options {"mission":false,"acceptance":{"level":"none","reason":"Disposable response-only probe; the host verifies its marker."}}. This synchronous probe must finish before your reply. Do not use other tools or change models. If anything fails, stop and report the exact failure without retrying. After the child succeeds, reply ${parentMarker} and its returned CHILD marker.`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => events.some(event => event.type === 'agent_settled'), { timeout: 180000 }).toBe(true);
  const messages = events.filter(event => event.type === 'message_end').map(event => event.message);
  const final = messages.findLast(message => message.role === 'assistant');
  assert.equal(final.stopReason, 'stop', final.errorMessage);
  const text = final.content.filter(block => block.type === 'text').map(block => block.text).join('');
  assert(text.includes(parentMarker) && text.includes(childMarker), text);
  const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'toolCall'));
  assert.equal(calls.filter(call => call.name === 'subagents_enable').length, 1);
  assert.equal(calls.filter(call => call.name === 'subagent' && call.arguments.agent === 'sdk-probe').length, 1);
  const results = messages.filter(message => message.role === 'toolResult');
  assert(results.every(message => !message.isError));
  assert.deepEqual(results.map(message => message.toolCallId).sort(), calls.map(call => call.id).sort());
  const artifacts = join(sessions, 'subagent-artifacts');
  const children = readdirSync(artifacts).filter(name => name.endsWith('_meta.json')).map(name => JSON.parse(readFileSync(join(artifacts, name), 'utf8')));
  assert.equal(children.length, 1);
  assert.equal(children[0].exitCode, 0); assert.equal(children[0].toolCount, 0);
  assert(children[0].model.startsWith('claude-sdk/claude-haiku-5-5'));
  assert(readFileSync(children[0].transcriptPath, 'utf8').includes('"provider":"claude-sdk"'));
  result.childModel = children[0].model; result.childToolCount = 0;
  const epochs = rows().filter(row => row.type === 'init');
  assert(epochs[0].tools.includes('mcp__pi__subagents_enable') && !epochs[0].tools.includes('mcp__pi__subagent'));
  assert(epochs.at(-1).tools.includes('mcp__pi__subagent'));
  assert.equal(new Set(epochs.map(row => row.session)).size, 2);
  assert(rows().some(row => row.type === 'payload' && row.handoff));
  await expect(page.locator('#transcript')).toContainText(childMarker);
  await page.screenshot({ path: join(evidence, 'subagent-result.png'), fullPage: true });
  await page.reload(); await parentSession.click();
  await expect(page.locator('#transcript')).toContainText(childMarker);
  result.enableCount = result.childLaunchCount = 1;
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
