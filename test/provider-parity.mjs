// Paid, opt-in provider contract: identical phone/Pi journeys, normal resources, real models and worker agents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit, devices, expect } from '@playwright/test';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { sessionKey } from '../src/locks.mjs';

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const settingsFile = join(agentDir, 'settings.json');
const settingsBytes = existsSync(settingsFile) ? readFileSync(settingsFile) : Buffer.from('{}');
const settings = JSON.parse(settingsBytes);
const baseline = `${settings.defaultProvider || 'openai-codex'}/${settings.defaultModel || 'gpt-6.1-sol'}`;
const targets = (process.env.PI_PARITY_MODELS || `${baseline},claude-sdk/claude-haiku-5-5`).split(',');
const selected = process.env.PI_PARITY_CASES?.split(',');
const autoCompaction = process.env.PI_PARITY_COMPACTION_AUTO === '1';
const evidence = mkdtempSync(join(tmpdir(), 'pi-provider-parity-')), sessions = join(evidence, 'sessions');
mkdirSync(sessions); process.env.PI_SUBAGENTS_TEMP_ROOT = join(evidence, 'subagent-runtime');
const bin = process.env.PI_PARITY_BIN || 'pi', auditFile = join(evidence, 'audit.jsonl'), observer = join(evidence, 'observer.ts');
writeFileSync(observer, `import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
const log=row=>appendFileSync(${JSON.stringify(auditFile)},JSON.stringify(row)+'\\n');
export default function(pi){
 pi.on('project_trust',()=>({trusted:'yes'}));
 pi.on('before_agent_start',(_e,ctx)=>log({type:'loadout',session:ctx.sessionManager.getSessionId(),tools:pi.getActiveTools()}));
 pi.on('tool_call',(e,ctx)=>{
  const path=e.input?.path||e.input?.file_path;
  log({type:'call',session:ctx.sessionManager.getSessionId(),id:e.toolCallId,name:e.toolName,path});
  if(e.toolName==='write'&&path&&resolve(ctx.cwd,path).endsWith('/denied.txt'))return {block:true,reason:'Provider parity policy denies this file. Do not retry through another tool.'};
 });
 pi.on('provider_stream_event',e=>{const d=e.data;if(d.type==='system'&&d.subtype==='init')log({type:'sdk-init',session:d.session_id,tools:d.tools});});
}
`);
const token = 'browser-test-token-only-123456789012345';
const host = await startHost({ dir: join(evidence, 'host'), config: { ...loadConfig(join(evidence, 'host')), clientToken: token }, roots: [sessions], port: 0, relayUrl: '', allowResume: true,
  workerOptions: { bin, prefix: ['--approve', '--model', baseline, '--thinking', 'medium', '-e', observer] } });
const url = `http://127.0.0.1:${host.http.address().port}`;
const audit = () => existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const textOf = message => message?.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
const childArtifacts = () => existsSync(join(sessions, 'subagent-artifacts')) ? readdirSync(join(sessions, 'subagent-artifacts')).filter(name => name.endsWith('_meta.json')) : [];
const messagesAt = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse).flatMap(row => row.message ? [row.message] : []);
function checkChildren(before, count, stoppedAt = 0) {
  // Foreground output:false retains a canonical session; async completion publishes transcript metadata.
  const children = count === 1 ? messagesAt(file).flatMap(m => m.role === 'toolResult' ? m.details?.results || [] : [])
    : childArtifacts().filter(name => !before.has(name)).map(name => JSON.parse(readFileSync(join(sessions, 'subagent-artifacts', name), 'utf8')));
  assert.equal(children.length, count, 'One actual completion record is required for each child.');
  for (const child of children) {
    assert.equal(child.agent, 'worker'); assert.equal(child.exitCode, 0, child.error);
    const messages = messagesAt(child.sessionFile || child.transcriptPath);
    const tools = messages.find(m => m.role === 'system')?.toolsAdded?.map(tool => tool.name) || [];
    assert(['read', 'bash', 'edit', 'write'].every(name => tools.includes(name)), 'Normal worker tools must not be stripped.');
    const replies = messages.filter(m => m.role === 'assistant'); assert(replies.length);
    assert(replies.every(m => m.provider === currentTarget.split('/')[0]));
    assert.equal(replies.at(-1).stopReason, 'stop', replies.at(-1).errorMessage);
    assert.equal(replies.at(-1).thinkingLevel, 'high', 'Keep the builtin worker profile default.');
    const calls = replies.flatMap(m => m.content).filter(block => block.type === 'toolCall');
    assert((count === 1 ? ['read', 'edit', 'bash'] : ['read', 'bash']).every(name => calls.some(call => call.name === name)));
    if (stoppedAt) {
      const gate = calls.find(call => call.name === 'bash' && call.arguments.command?.includes('background-release'));
      assert(gate, 'The child must actually execute its wait gate.');
      const receipt = messages.find(m => m.role === 'toolResult' && m.toolCallId === gate.id);
      assert(receipt && !receipt.isError && receipt.timestamp >= stoppedAt, 'Both child gates must complete after the parent Stop.');
    }
    checkMessages(messages);
  }
}
function checkMessages(messages) {
  const calls = messages.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(block => block.type === 'toolCall'));
  const receipts = messages.filter(m => m.role === 'toolResult');
  assert.equal(new Set(calls.map(call => call.id)).size, calls.length, 'A model must not reuse tool-call IDs.');
  assert.equal(receipts.length, calls.length, 'Every recorded call needs one Pi result.');
  for (const call of calls) assert.equal(receipts.filter(r => r.toolCallId === call.id && r.toolName === call.name).length, 1);
  for (const message of messages.filter(m => m.role === 'assistant')) {
    const usage = message.usage; assert(usage);
    assert(['input', 'output', 'cacheRead', 'cacheWrite'].every(key => Number.isInteger(usage[key]) && usage[key] >= 0));
    assert.equal(usage.totalTokens, usage.input + usage.output + usage.cacheRead + usage.cacheWrite);
    assert(Number.isFinite(usage.cost.total) && usage.cost.total >= 0);
  }
}
const result = { fixture: 'Real phone UI, Pi, normal personal/project resources, builtin worker profiles and model services; no model/agent mocks or credential copies',
  piVersion: execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(), targets, compactionMode: autoCompaction ? 'automatic' : 'manual', loadouts: {}, cases: [], pass: false };
let browser, context, page, worker, file, id, project, events = [], models, currentTarget;
async function until(check, label, ms = 180000) {
  const end = Date.now() + ms;
  while (!await check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 100)); }
}
function parentCalls() { return events.filter(e => e.type === 'message_end' && e.message.role === 'assistant').flatMap(e => e.message.content.filter(b => b.type === 'toolCall')); }
function last() { return events.findLast(e => e.type === 'message_end' && e.message.role === 'assistant')?.message; }
function attach(value) { worker = value; worker.on('event', event => events.push(event)); }
async function select(spec) {
  const split = spec.indexOf('/'), provider = spec.slice(0, split), modelId = spec.slice(split + 1);
  const model = models.find(m => m.provider === provider && m.id === modelId);
  assert(model, `Model unavailable: ${spec}. No login or model fallback is attempted.`);
  const state = await worker.request('get_state');
  if (state.model?.provider !== provider || state.model?.id !== modelId) {
    await page.locator('#model').click();
    await page.getByRole('searchbox', { name: 'Search models', exact: true }).fill(modelId);
    const picker = page.getByRole('region', { name: 'Choose a model' });
    await picker.getByRole('region', { name: provider, exact: true }).getByRole('button', { name: model.name, exact: true }).click();
    await expect(picker).toBeHidden();
  }
  await worker.request('set_thinking_level', { level: 'medium' });
}
async function openParent() {
  await page.reload(); await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator(`#sessions button.session[data-id="${id}"]`).click();
}
async function newSession(label) {
  if (worker && !worker.closed) await worker.close();
  events = [];
  file = join(sessions, `${currentTarget.replaceAll('/', '-')}-${label}.jsonl`);
  writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
  id = sessionKey(file); await host.service.scan();
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  attach(host.service.live.get(id).worker);
  models = (await worker.request('get_available_models')).models;
  await openParent(); await select(currentTarget);
}
async function send(prompt) {
  const start = events.length;
  await page.locator('#prompt').fill(prompt); await page.getByRole('button', { name: 'Send message' }).click();
  await until(() => events.slice(start).some(e => e.type === 'agent_settled'), 'model settlement');
  const response = last(); assert.equal(response?.stopReason, 'stop', response?.errorMessage);
  return textOf(response);
}
async function step(name, run) {
  const row = { provider: currentTarget, name, status: selected && !selected.includes(name) ? 'skipped' : 'running' }; result.cases.push(row);
  if (row.status === 'skipped') return;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ provider: currentTarget, step: name, status: 'running' }));
  try { await run(); row.status = 'passed'; }
  catch (error) {
    row.status = 'failed'; row.error = error.message; row.stack = error.stack;
    if (name === 'parallel-background-workers-and-notices') writeFileSync(join(project, 'background-release'), 'release after fixture failure');
    await page?.screenshot({ path: join(evidence, `${currentTarget.replaceAll('/', '-')}-${name}.png`), fullPage: true }).catch(() => {});
    if (worker && !worker.closed) await worker.command({ type: 'abort' }).catch(() => {});
  }
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ provider: currentTarget, step: name, status: row.status, error: row.error }));
}
console.log('Evidence: ' + evidence);
try {
  browser = await chromium.launch(); context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true }); page = await context.newPage();
  await page.goto(url); await page.getByLabel('Private login link').fill(token);
  await page.getByRole('button', { name: 'Connect to computer' }).click(); await expect(page.locator('#connection')).toHaveText('Computer connected');
  for (currentTarget of targets) {
    project = join(evidence, currentTarget.replaceAll('/', '-')); mkdirSync(project);
    const policy = 'POLICY_' + randomUUID(), memory = 'MEMORY_' + randomUUID(), a = 'A_' + randomUUID(), b = 'B_' + randomUUID();
    const childValues = ['FG_' + randomUUID(), 'ASYNC_A_' + randomUUID(), 'ASYNC_B_' + randomUUID()];
    writeFileSync(join(project, 'AGENTS.md'), `This is an isolated provider parity fixture. The loaded project policy marker is ${policy}.\nOnly this directory contains test data. Do not edit global settings, credentials, other repositories or files outside this directory. Do not commit or push fixture data. Only the foreground coding worker may edit worker-edit.mjs when its task explicitly requests it; all other child work and input files are read-only. Children must not delegate further.\n`);
    for (const [index, name] of ['foreground.txt', 'async-a.txt', 'async-b.txt'].entries()) writeFileSync(join(project, name), childValues[index]);
    await newSession('core');
    await step('instructions-and-messages', async () => {
      const reply = await send(`Remember ${memory}. Reply with that marker and the POLICY marker from your already-loaded project instructions.`);
      assert(reply.includes(memory) && reply.includes(policy));
      const loadout = audit().find(row => row.type === 'loadout' && row.session === JSON.parse(readFileSync(file, 'utf8').split('\n')[0]).id);
      assert(loadout?.tools?.length >= 6, 'Normal tools must load; do not replace them with a minimal probe profile.');
      result.loadouts[currentTarget] = loadout.tools.sort();
    });
    await step('real-file-tools', async () => {
      const path = join(project, 'roundtrip.txt');
      await send(`Use the normal file tools to write ${JSON.stringify(a + '\nsecond line\n')} to ${path}, read it, then edit only ${a} to ${b}, preserving the rest, and read it again. Do not use shell commands or rewrite the whole file instead of editing. Report the final contents.`);
      assert.equal(readFileSync(path, 'utf8'), b + '\nsecond line\n');
      const calls = parentCalls(); assert(calls.some(call => call.name === 'write') && calls.some(call => call.name === 'edit') && calls.some(call => call.name === 'read'));
    });
    await step('permission-denial', async () => {
      const path = join(project, 'denied.txt');
      const reply = await send(`Try the write tool once to create ${path} with DENIED_TEST. A Pi policy will deny it. If denied, report DENIED and stop. Do not retry through edit, bash or any other tool.`);
      assert(!existsSync(path)); assert.match(reply, /denied/i);
      const denied = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).findLast(row => row.message?.role === 'toolResult');
      assert.equal(denied.message.isError, true);
    });
    await step('reload-and-history', async () => {
      await openParent(); const before = parentCalls().length;
      const reply = await send('Without tools, repeat the MEMORY marker from our first message and the final B_ value from roundtrip.txt.');
      assert(reply.includes(memory) && reply.includes(b)); assert.equal(parentCalls().length, before);
    });
    await step('webkit-reopen', async () => {
      const safari = await webkit.launch();
      try {
        const view = await safari.newContext({ ...devices['iPhone 13'] }), tab = await view.newPage();
        await tab.goto(url); await tab.getByLabel('Private login link').fill(token);
        await tab.getByRole('button', { name: 'Connect to computer' }).click();
        await expect(tab.locator('#connection')).toHaveText('Computer connected');
        await tab.locator(`#sessions button.session[data-id="${id}"]`).click();
        await expect(tab.locator('#transcript')).toContainText(b);
      } finally { await safari.close(); }
    });
    await step('real-provider-roundtrip', async () => {
      const other = currentTarget === baseline ? 'claude-sdk/claude-haiku-5-5' : baseline;
      await select(other); const note = 'FOREIGN_' + randomUUID();
      assert((await send(`Remember ${note}; reply with it without tools.`)).includes(note));
      await select(currentTarget); const before = parentCalls().length;
      const reply = await send('Without tools, repeat the MEMORY and FOREIGN markers already in this chat.');
      assert(reply.includes(memory) && reply.includes(note)); assert.equal(parentCalls().length, before);
    });
    await step('owned-worker-restart', async () => {
      const oldPid = worker.process.pid; await worker.close();
      await until(() => !host.service.live.get(id)?.worker, 'owned worker closure', 15000);
      assert.equal((await host.service.resume(id, randomUUID())).ok, true); attach(host.service.live.get(id).worker);
      assert.notEqual(worker.process.pid, oldPid); models = (await worker.request('get_available_models')).models;
      await openParent(); await select(currentTarget); const before = parentCalls().length;
      assert((await send('Without tools, repeat the MEMORY marker from this chat.')).includes(memory)); assert.equal(parentCalls().length, before);
    });
    await step('foreground-standard-worker', async () => {
      const code = join(project, 'worker-edit.mjs'); writeFileSync(code, 'export const marker = "before";\n');
      await newSession('foreground'); const before = new Set(childArtifacts());
      const reply = await send(`Use Pi subagents to launch exactly one standard worker in a fresh foreground context, async false, model ${currentTarget} (keep the worker profile's default thinking). Do not create a custom agent or alter profiles/extensions. Its task is to read ${join(project, 'foreground.txt')}, edit only ${code} by replacing the marker literal "before" with the actual input file contents (trim newline), read back the change, and validate it with node --check. Return its normal completion report and the actual marker. Only worker-edit.mjs may change; no commits, staging, external requests or further delegation. The parent must not read or edit these files itself. On failure report it without retrying or switching models.`);
      assert(reply.includes(childValues[0]));
      assert.equal(readFileSync(code, 'utf8'), `export const marker = "${childValues[0]}";\n`);
      assert.equal(parentCalls().filter(call => call.name === 'subagent' && !call.arguments.action).length, 1);
      assert(!parentCalls().some(call => call.name === 'read' && JSON.stringify(call.arguments).includes('foreground.txt')));
      checkChildren(before, 1);
      const calls = parentCalls().length;
      assert((await send('Without tools, repeat the FG_ value the worker actually read.')).includes(childValues[0]));
      assert.equal(parentCalls().length, calls);
    });
    await step('parallel-background-workers-and-notices', async () => {
      await newSession('background'); const before = new Set(childArtifacts()), gate = join(project, 'background-release');
      await send(`Launch exactly two standard worker subagents with two direct calls, async true, fresh contexts, model ${currentTarget} (keep the worker profile's default thinking). Do not create custom agents or alter profiles/extensions. Each is read-only and must first use bash to wait until the harness creates ${gate} (test -f loop, 120-second timeout, no writes), then read its own file and report the actual contents plus its normal completion report. First file: ${join(project, 'async-a.txt')}. Second file: ${join(project, 'async-b.txt')}. No edits, commits, outside requests or further delegation. Do not read those files in the parent. Reply STARTED after launch receipts and yield. Do not call bg_wait or relaunch. When automatic completion notices arrive, acknowledge both actual outputs. Report failures without retrying or switching models.`);
      const interruption = events.length;
      await page.locator('#prompt').fill('The background children must continue. Use bash to run sleep 30 in the parent; do not relaunch children or read their files.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await until(() => events.slice(interruption).some(event => event.type === 'tool_execution_start' && event.toolName === 'bash'), 'parent command while children are active');
      await page.getByRole('button', { name: 'Abort turn' }).click();
      await until(() => events.slice(interruption).some(event => event.type === 'agent_settled'), 'parent Stop with background work', 15000);
      const stoppedAt = Date.now();
      assert.equal(childArtifacts().filter(path => !before.has(path)).length, 0, 'Both children must remain pending until the harness releases their read-only gate.');
      const afterStop = events.length;
      await send('The parent command was cancelled. Do not repeat it or relaunch anything. Reply CONTINUED, then acknowledge both background outputs when their automatic notices arrive. Do not use tools.');
      writeFileSync(gate, 'release');
      await until(() => {
        const error = events.slice(afterStop).find(e => e.type === 'message_end' && e.message.role === 'assistant' && e.message.stopReason === 'error');
        if (error) throw new Error(error.message.errorMessage);
        return childValues.slice(1).every(value => textOf(last()).includes(value));
      }, 'both automatic child completion acknowledgements', 240000);
      const launches = parentCalls().filter(call => call.name === 'subagent' && call.arguments.agent === 'worker');
      assert.equal(launches.length, 2); assert(launches.every(call => call.arguments.async === true));
      checkChildren(before, 2, stoppedAt);
      await openParent(); await expect(page.locator('#transcript')).toContainText(childValues[1]); await expect(page.locator('#transcript')).toContainText(childValues[2]);
      const calls = parentCalls().length;
      await worker.close(); await until(() => !host.service.live.get(id)?.worker, 'completed background parent closure', 15000);
      assert.equal((await host.service.resume(id, randomUUID())).ok, true); attach(host.service.live.get(id).worker);
      await openParent();
      const reply = await send('Without tools or relaunches, repeat both ASYNC_A_ and ASYNC_B_ values already reported in this chat.');
      assert(childValues.slice(1).every(value => reply.includes(value))); assert.equal(parentCalls().length, calls);
    });
    await step('stop-first-turn-and-new-message', async () => {
      await newSession('stop'); const start = events.length;
      await page.locator('#prompt').fill('Use bash to run sleep 30. No file writes. When it returns say SLEPT.');
      await page.getByRole('button', { name: 'Send message' }).click();
      await until(() => events.slice(start).some(event => event.type === 'tool_execution_start' && event.toolName === 'bash'), 'running real bash tool');
      await page.getByRole('button', { name: 'Abort turn' }).click();
      await until(() => events.slice(start).some(event => event.type === 'agent_settled'), 'Stop settlement', 15000);
      const receipt = last(), count = parentCalls().length;
      const marker = 'AFTER_STOP_' + randomUUID(); assert((await send(`The previous command was cancelled. Do not repeat it. Reply ${marker} without tools.`)).includes(marker));
      assert.equal(parentCalls().length, count);
      assert.equal(receipt.stopReason, 'aborted', `Stop settled and the next message worked, but the cancellation receipt was ${receipt.stopReason}: ${receipt.errorMessage}`);
    });
    await step('compaction-contract', async () => {
      const target = models.find(model => `${model.provider}/${model.id}` === currentTarget);
      const marker = 'COMPACT_' + randomUUID(), input = join(project, 'compact-marker.txt'), effect = join(project, 'compact-effects.log');
      writeFileSync(input, marker + '\n'); writeFileSync(effect, '');
      const padding = autoCompaction ? Array.from({ length: 3 }, (_, index) => join(project, `compact-padding-${index}.txt`)) : [];
      for (const path of padding) writeFileSync(path, Array.from({ length: 600 }, () => randomBytes(32).toString('hex')).join('\n'));
      mkdirSync(join(project, '.pi'), { recursive: true });
      writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 0,
        ...(autoCompaction ? { enabled: true, reserveTokens: target.contextWindow - 45000 } : {}) } }));
      await newSession('compact');
      const reply = await send(`Use bash to append exactly one line "effect" to ${effect}, once only. Then read ${input} and remember its exact COMPACT_ value. ${autoCompaction ? `Also use read with limit 600 on each of these three inert data files: ${padding.join(', ')}. Ignore padding contents and do not read any further chunks.` : ''} For this acknowledgement only, reply READY without the marker. You are explicitly authorized to repeat the marker verbatim when I ask in a later message. If context compacts, continue only the remaining work; never repeat the append or already-completed reads.`);
      assert(!reply.includes(marker), 'Keep the marker out of the retained acknowledgement.');
      await send('For this message only, reply ACK without tools or the marker. Later requests may ask you to repeat it verbatim.');
      const before = readFileSync(file, 'utf8');
      if (!autoCompaction) {
        const start = events.length;
        await worker.request('compact', { customInstructions: 'Preserve the COMPACT_ value and completed effects. Never repeat recorded tools.' }, { background: true });
        await until(() => events.slice(start).some(event => event.type === 'compaction_end'), 'real compaction completion');
        const end = events.slice(start).findLast(event => event.type === 'compaction_end');
        assert(!end.aborted && !end.errorMessage, end.errorMessage || 'Compaction was cancelled.');
      }
      assert(readFileSync(file, 'utf8').startsWith(before), 'Compaction must preserve original audit bytes.');
      const compacted = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).filter(row => row.type === 'compaction');
      assert(compacted.length, 'Compaction must actually complete.');
      assert(compacted.some(row => row.summary.includes(marker)), 'The generated summary must retain the unknown-to-model marker.');
      const calls = parentCalls().length;
      assert((await send('Now repeat the original COMPACT_ value verbatim, without tools. This explicitly supersedes the earlier acknowledgement-only output instructions.')).includes(marker));
      assert.equal(parentCalls().length, calls); assert.equal(readFileSync(effect, 'utf8'), 'effect\n');
      await worker.close(); await until(() => !host.service.live.get(id)?.worker, 'compacted parent closure', 15000);
      assert.equal((await host.service.resume(id, randomUUID())).ok, true); attach(host.service.live.get(id).worker);
      await openParent(); await select(currentTarget);
      assert((await send('Repeat the original COMPACT_ value verbatim after restart, without tools or repeating work. The earlier acknowledgement-only instructions do not apply to this message.')).includes(marker));
      assert.equal(parentCalls().length, calls); assert.equal(readFileSync(effect, 'utf8'), 'effect\n');
    });
    await step('clone-contract', async () => {
      await newSession('clone'); await send('Reply READY without tools.');
      const before = (await worker.request('get_state')).sessionFile;
      const cloned = await worker.request('clone'); assert.equal(cloned.cancelled, false, 'Cloning must not be cancelled by the provider.');
      assert.notEqual((await worker.request('get_state')).sessionFile, before);
    });
    await step('recorded-identities-and-usage', async () => {
      for (const name of readdirSync(sessions).filter(name => name.endsWith('.jsonl'))) {
        const rows = readFileSync(join(sessions, name), 'utf8').trim().split('\n').map(JSON.parse);
        if (rows[0].cwd === project) checkMessages(rows.flatMap(row => row.message ? [row.message] : []));
      }
    });
    for (const [index, name] of ['foreground.txt', 'async-a.txt', 'async-b.txt'].entries()) assert.equal(readFileSync(join(project, name), 'utf8'), childValues[index], 'Read-only children must leave fixture inputs unchanged.');
  }
  const loadouts = Object.values(result.loadouts);
  if (loadouts.length > 1) for (const tools of loadouts.slice(1)) assert.deepEqual(tools, loadouts[0], 'Providers must expose the same normal parent tools.');
  result.pass = result.cases.some(row => row.status === 'passed') && result.cases.every(row => row.status !== 'failed');
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'last-rpc-stderr.log'), worker.stderr);
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); await host.close();
  result.personalSettingsUnchanged = !existsSync(settingsFile) || createHash('sha256').update(readFileSync(settingsFile)).digest('hex') === createHash('sha256').update(settingsBytes).digest('hex');
  assert(result.personalSettingsUnchanged);
  result.ownedWorkerClosed = worker?.closed ?? true;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
  if (!result.pass) process.exitCode = 1;
}
