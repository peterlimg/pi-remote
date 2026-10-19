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
const queuedFork = process.env.PI_PARITY_FORK_QUEUED === '1';
const treeSummary = process.env.PI_PARITY_TREE_SUMMARY === '1', queuedTree = process.env.PI_PARITY_TREE_QUEUED === '1';
const childHooks = process.env.PI_PARITY_CHILD_HOOKS === '1';
const evidence = mkdtempSync(join(tmpdir(), 'pi-provider-parity-')), sessions = join(evidence, 'sessions');
mkdirSync(sessions); process.env.PI_SUBAGENTS_TEMP_ROOT = join(evidence, 'subagent-runtime');
const bin = process.env.PI_PARITY_BIN || 'pi', auditFile = join(evidence, 'audit.jsonl'), observer = join(evidence, 'observer.ts');
writeFileSync(observer, `import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const log=row=>appendFileSync(${JSON.stringify(auditFile)},JSON.stringify(row)+'\\n');
export default function(pi){
 pi.on('project_trust',()=>({trusted:'yes'}));
 let required;
 pi.on('session_start',async(_e,ctx)=>{
  if(!${childHooks})return;
  required?.dispose();
  const subagents=pi.getAllTools().find(t=>t.name==='subagents_enable'||t.name==='subagent');
  const sdk=pi.getCommands().find(c=>c.name==='claude-usage'&&c.source==='extension');
  if(!subagents||!sdk)throw new Error('Required SDK/subagents resources unavailable.');
  const module=await import(pathToFileURL(createRequire(subagents.sourceInfo.path).resolve('pi-subagents/required-child-extensions')).href);
  required=module.registerRequiredChildExtensions({sessionId:ctx.sessionManager.getSessionId(),extensions:[{id:'sdk-context-verification',path:sdk.sourceInfo.path}]});
  log({type:'child-hook-registration',session:ctx.sessionManager.getSessionId()});
 });
 pi.on('session_shutdown',()=>{required?.dispose();required=undefined;});
 pi.registerCommand('parity-tree',{description:'Owned tree-navigation verification',handler:async(args,ctx)=>{
  const {target,...options}=JSON.parse(args);
  try{const result=await ctx.navigateTree(target,options);log({type:'tree-result',target,...result,leafId:ctx.sessionManager.getLeafId()});}
  catch(error){log({type:'tree-result',target,error:error.message});}
 }});
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
const textOf = message => typeof message?.content === 'string' ? message.content : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
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
  piVersion: execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(), targets, compactionMode: autoCompaction ? 'automatic' : 'manual', forkMode: queuedFork ? 'queued-source' : 'completed-source', treeMode: { summary: treeSummary, queued: queuedTree }, childHooks, loadouts: {}, cases: [], pass: false };
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
async function reopen(path) {
  await worker.close(); await until(() => !host.service.live.get(id)?.worker, 'replaced worker closure', 15000);
  file = path; id = sessionKey(path); await host.service.scan();
  assert.equal((await host.service.resume(id, randomUUID())).ok, true); attach(host.service.live.get(id).worker);
  models = (await worker.request('get_available_models')).models; await openParent(); await select(currentTarget);
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
    if (name === 'fork-contract') writeFileSync(join(project, 'fork-release'), 'release after fixture failure');
    if (name === 'tree-contract') writeFileSync(join(project, 'tree-release'), 'release after fixture failure');
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
    writeFileSync(join(project, 'AGENTS.md'), `This is an isolated provider parity fixture. The loaded project policy marker is ${policy}.\nOnly this directory contains test data. Do not edit global settings, credentials, other repositories or files outside this directory. Do not commit or push fixture data. Only the foreground coding worker may edit worker-edit.mjs when its task explicitly requests it, and the retained-worker task may append its one requested line to retained-effects.log; all other child work and input files are read-only. Children must not delegate further.\n`);
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
    await step('parallel-inherited-delegates', async () => {
      await newSession('inherited-delegates');
      const fixture = join(project, 'delegate-inputs'); mkdirSync(fixture);
      for (const name of ['alpha', 'beta']) mkdirSync(join(fixture, name));
      execFileSync('git', ['init', '--quiet', '--initial-branch=fixture', fixture]);
      const subjects = Array.from({ length: 5 }, (_, index) => `DELEGATE_COMMIT_${index}_${randomUUID()}`);
      for (const subject of subjects) {
        writeFileSync(join(fixture, 'history.txt'), subject + '\n');
        execFileSync('git', ['-C', fixture, 'add', '--', 'history.txt']);
        execFileSync('git', ['-C', fixture, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
          '-c', 'user.name=SDK fixture', '-c', 'user.email=sdk-fixture@example.invalid', 'commit', '--quiet', '-m', subject]);
      }
      const before = new Set(readdirSync(evidence, { recursive: true }).filter(name => name.endsWith('.jsonl')));
      const reply = await send(`Test exactly two builtin delegate agents through one subagent call with workflow "parallel", args.tasks containing two entries with agent "delegate" and their task strings, and top-level async false. Leave child placement, context, model, thinking and acceptance at their normal profile defaults, inheriting this parent's ${currentTarget} model. Do not set child async values, use worker, custom profiles, external runners, altered instructions or extension overrides. Child one must use bash to count the non-hidden immediate subdirectories of ${fixture} and return DIR_COUNT=<number>. Child two must use bash to run git -C ${JSON.stringify(fixture)} log -5 --format=%s and return the five actual subjects. Both must also report the POLICY_ marker from their already-loaded project instructions. All child tasks are read-only: no edits, commits, staging, external requests or further delegation. The parent must not read or run commands against ${fixture}; use only the actual child outputs. If anything fails, report the exact failure and stop without retries, model switches or fallback runners.`);
      const launches = parentCalls().filter(call => call.name === 'subagent' && !call.arguments.action);
      assert.equal(launches.length, 1); assert.equal(launches[0].arguments.workflow, 'parallel'); assert.equal(launches[0].arguments.async, false);
      const tasks = launches[0].arguments.args.tasks; assert.equal(tasks.length, 2);
      for (const task of tasks) {
        assert.equal(task.agent, 'delegate');
        assert(Object.keys(task).every(key => ['agent', 'task', 'key', 'label'].includes(key)), 'Delegate defaults must not be overridden.');
      }
      const completions = messagesAt(file).filter(m => m.role === 'toolResult' && m.toolName === 'subagent');
      assert(completions.length);
      for (const completion of completions) assert(!completion.isError, textOf(completion));
      assert(reply.includes('DIR_COUNT=2') && subjects.every(subject => reply.includes(subject)) && reply.includes(policy), reply);
      const children = new Map();
      for (const name of readdirSync(evidence, { recursive: true }).filter(name => name.endsWith('.jsonl') && !before.has(name))) {
        const rows = readFileSync(join(evidence, name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
        const header = rows[0]; if (header?.type !== 'session' || header.cwd !== project) continue;
        const messages = rows.flatMap(row => row.message ? [row.message] : []), replies = messages.filter(m => m.role === 'assistant');
        if (!replies.length || !messages.some(m => m.role === 'user' && textOf(m).includes(fixture))) continue;
        assert(replies.every(m => `${m.provider}/${m.model}` === currentTarget));
        assert.equal(replies.at(-1).stopReason, 'stop', replies.at(-1).errorMessage);
        assert(replies.flatMap(m => m.content).some(block => block.type === 'toolCall' && block.name === 'bash'));
        assert(textOf(replies.at(-1)).includes(policy), 'Each inherited delegate must retain the project instructions.');
        checkMessages(messages); children.set(header.id, messages);
      }
      assert.equal(children.size, 2, 'Require two distinct, successful real delegate conversations.');
      assert(!parentCalls().some(call => ['read', 'bash', 'fffind', 'ffgrep', 'find', 'grep', 'ls', 'edit', 'write'].includes(call.name) && JSON.stringify(call.arguments).includes(fixture)), 'Only children may inspect the task data.');
      const parentId = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]).id;
      result.loadouts[currentTarget] = audit().find(row => row.type === 'loadout' && row.session === parentId).tools.sort();
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
    await step('retained-standard-worker', async () => {
      await newSession('retained');
      const secret = 'WORKER_ONLY_' + randomUUID(), parent = 'PARENT_ONLY_' + randomUUID();
      const markerFile = join(project, 'retained-marker.txt'), code = join(project, 'worker-edit.mjs'), effects = join(project, 'retained-effects.log');
      writeFileSync(markerFile, secret + '\n'); writeFileSync(code, 'export const completed = false;\n'); writeFileSync(effects, '');
      const parentId = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]).id;
      if (childHooks) assert(audit().some(row => row.type === 'child-hook-registration' && row.session === parentId), 'The existing API must actually register the child extension.');
      await send(`Remember ${parent} in the parent only. Do not use tools or share this value with a child. Reply PARENT_READY.`);
      const task = `Work only in ${project}. Read ${markerFile} and remember its exact value privately. Do not print that value in this first completion report; a later explicit recall request may authorize printing it. Use edit to change only completed = false to completed = true in ${code}, then read it back. Append exactly ${JSON.stringify('worker-effect\n')} to ${effects} once and validate the module with node --check. No commits, staging, external requests or further delegation. Return your normal completion report with FIRST_PASS_DONE, without the private marker. Do not modify other task files; ordinary runtime metadata is allowed.`;
      const first = await send(`Launch exactly one builtin worker with fresh context, async false, output false, model ${currentTarget}. Keep its normal profile, default thinking, tools and acceptance; do not create custom agents or change extensions. Give it only this task: ${JSON.stringify(task)}. Do not read or edit its files in the parent or pass private parent facts. On failure stop without retrying or switching models.`);
      assert(first.includes('FIRST_PASS_DONE') && !first.includes(secret));
      const seed = messagesAt(file).findLast(m => m.role === 'toolResult' && m.toolName === 'subagent' && m.details?.results?.some(r => r.agent === 'worker'));
      const child = seed?.details.results.find(r => r.agent === 'worker'), runId = seed?.details.runId;
      assert(child?.sessionFile && runId); assert.equal(child.exitCode, 0, child.error);
      assert(!JSON.stringify(seed.content).includes(secret), 'The parent must not learn the child-only value from its first report.');
      checkChildren(new Set(), 1);
      assert.equal(readFileSync(code, 'utf8'), 'export const completed = true;\n'); assert.equal(readFileSync(effects, 'utf8'), 'worker-effect\n');
      const originalChild = readFileSync(child.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
      const checkpoint = rows => rows.findLast(r => r.customType === 'claude-sdk-checkpoint')?.data;
      const detail = { provider: currentTarget, checkpointBeforeResume: Boolean(checkpoint(originalChild)), resumed: false };
      (result.workerResumes ||= []).push(detail);
      await reopen(file);
      const resumeMessage = 'Without tools, file reads or edits, recall the exact WORKER_ONLY_ value you previously read. This explicitly authorizes printing it now. Include any PARENT_ONLY_ value only if it was actually present in your child conversation, otherwise say PARENT_ABSENT. Do not repeat previous work.';
      const before = events.length;
      await send(`Use subagent action status once for exact run ${runId}, then action resume with id ${runId} and message ${JSON.stringify(resumeMessage)}. Keep the retained worker contract. Do not launch a fresh child, change models/profiles/extensions or read worker/task files. Normal skill documentation reads are allowed. Yield after the resume receipt and acknowledge its actual automatic completion notice. On failure report it without retrying or switching models.`);
      await until(() => {
        const rows = readFileSync(child.sessionFile, 'utf8').trim().split('\n').map(JSON.parse), added = rows.slice(originalChild.length);
        const failure = added.find(r => r.message?.role === 'assistant' && r.message.stopReason === 'error');
        if (failure) throw new Error('Resumed worker: ' + failure.message.errorMessage);
        const denied = events.slice(before).find(e => e.type === 'message_end' && e.message.role === 'toolResult' && e.message.toolName === 'subagent' && e.message.isError);
        if (denied) throw new Error('Resume rejected: ' + textOf(denied.message));
        return textOf(added.findLast(r => r.message?.role === 'assistant')?.message).includes(secret);
      }, 'retained worker recall', 240000);
      const all = readFileSync(child.sessionFile, 'utf8').trim().split('\n').map(JSON.parse), added = all.slice(originalChild.length);
      const answer = textOf(added.findLast(r => r.message?.role === 'assistant').message);
      assert(answer.includes(secret) && !answer.includes(parent));
      assert(!added.some(r => r.message?.role === 'assistant' && r.message.content.some(b => b.type === 'toolCall')));
      assert.equal(readFileSync(effects, 'utf8'), 'worker-effect\n'); assert.equal(readFileSync(code, 'utf8'), 'export const completed = true;\n');
      for (const row of originalChild) assert.deepEqual(all.find(r => r.id === row.id), row);
      checkMessages(all.flatMap(r => r.message ? [r.message] : []));
      if (currentTarget.startsWith('claude-sdk/')) {
        assert(checkpoint(originalChild) && checkpoint(all)); assert.equal(checkpoint(all).piSessionId, all[0].id);
        if (added.some(row => row.message?.role === 'system' && Object.keys(row.message.sections || {}).some(key => key !== 'tools'))) {
          assert.notEqual(checkpoint(all).sdkSessionId, checkpoint(originalChild).sdkSessionId, 'Changed instructions require a fresh native context, not silent reuse.');
        }
      }
      assert(!parentCalls().some(call => ['read', 'edit', 'write', 'bash'].includes(call.name) &&
        ['retained-marker.txt', 'worker-edit.mjs', 'retained-effects.log', child.sessionFile].some(path => JSON.stringify(call.arguments).includes(path))), 'The parent must not access child task files; normal skill/documentation reads remain allowed.');
      assert(parentCalls().filter(call => call.name === 'subagent' && call.arguments.action === 'resume').every(call => !JSON.stringify(call.arguments).includes(parent)));
      await until(() => textOf(last()).includes(secret), 'resumed worker completion notice', 60000);
      const count = parentCalls().length; await reopen(file);
      const recall = await send('Without tools, repeat the PARENT_ONLY_ value from your own first message and the WORKER_ONLY_ value from the completed worker notice.');
      assert(recall.includes(parent) && recall.includes(secret)); assert.equal(parentCalls().length, count);
      detail.resumed = true;
      result.loadouts[currentTarget] = audit().find(r => r.type === 'loadout' && r.session === parentId).tools.sort();
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
      const marker = 'CLONE_' + randomUUID(), input = join(project, 'clone-marker.txt'), effect = join(project, 'clone-effects.log');
      const cloneMemory = 'COPY_ONLY_' + randomUUID(), originalMemory = 'ORIGINAL_ONLY_' + randomUUID();
      writeFileSync(input, marker + '\n'); writeFileSync(effect, '');
      await newSession('clone');
      const reply = await send(`Use bash to append exactly one line "effect" to ${effect}, once only. Read ${input} and remember its exact CLONE_ value. For this acknowledgement only, reply READY without the marker. You may repeat the value verbatim when I ask later. Do not repeat completed work.`);
      assert(!reply.includes(marker));
      const original = file, bytes = readFileSync(original, 'utf8'), calls = parentCalls().length;
      const loadout = audit().find(row => row.type === 'loadout' && row.session === JSON.parse(bytes.split('\n')[0]).id);
      assert(['read', 'bash', 'edit', 'write'].every(name => loadout?.tools?.includes(name)), 'Clones must use the normal parent tools.');
      result.loadouts[currentTarget] = loadout.tools.sort();
      const native = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse).findLast(row => row.customType === 'claude-sdk-checkpoint')?.data.sdkSessionId;
      const originalNative = native(original);
      const cloned = await worker.request('clone'); assert.equal(cloned.cancelled, false, 'Cloning must not be cancelled by the provider.');
      const copy = (await worker.request('get_state')).sessionFile; assert.notEqual(copy, original);
      assert.equal(readFileSync(original, 'utf8'), bytes, 'Cloning must leave the original byte-identical.');
      // RPC replaces its active session; close it before letting the host own either saved file again.
      await reopen(copy);
      assert((await send('Repeat the original CLONE_ value verbatim, without tools or repeating completed work.')).includes(marker));
      assert((await send(`Remember ${cloneMemory} in this chat. Without tools, repeat that marker and the original CLONE_ value.`)).includes(marker));
      const copyNative = native(copy), copyBytes = readFileSync(copy, 'utf8');
      if (currentTarget.startsWith('claude-sdk/')) { assert(originalNative && copyNative); assert.notEqual(copyNative, originalNative); }
      assert.equal(readFileSync(original, 'utf8'), bytes);
      await reopen(original);
      const sourceReply = await send(`Remember ${originalMemory} in this chat. Without tools, repeat that marker and the original CLONE_ value. Do not invent values from other chats.`);
      assert(sourceReply.includes(marker) && sourceReply.includes(originalMemory) && !sourceReply.includes(cloneMemory));
      assert.equal(readFileSync(copy, 'utf8'), copyBytes);
      if (originalNative) assert.equal(native(original), originalNative);
      const sourceBytes = readFileSync(original, 'utf8');
      await reopen(copy);
      const copyReply = await send('Without tools, repeat the original CLONE_ value and this chat\'s COPY_ONLY_ marker. Do not invent values from other chats.');
      assert(copyReply.includes(marker) && copyReply.includes(cloneMemory) && !copyReply.includes(originalMemory));
      assert.equal(readFileSync(original, 'utf8'), sourceBytes); if (copyNative) assert.equal(native(copy), copyNative);
      await reopen(original);
      const again = await send('Without tools, repeat the original CLONE_ value and this chat\'s ORIGINAL_ONLY_ marker. Do not invent values from other chats.');
      assert(again.includes(marker) && again.includes(originalMemory) && !again.includes(cloneMemory));
      assert.equal(parentCalls().length, calls, 'Neither branch may replay tools after cloning or restart.');
      assert.equal(readFileSync(effect, 'utf8'), 'effect\n');
    });
    await step('fork-contract', async () => {
      const marker = 'FORK_' + randomUUID(), late = 'LATER_' + randomUUID(), own = 'BRANCH_ONLY_' + randomUUID();
      const input = join(project, 'fork-marker.txt'), effect = join(project, 'fork-effects.log'), gate = join(project, 'fork-release');
      writeFileSync(input, marker + '\n'); writeFileSync(effect, ''); await newSession('fork');
      const first = `Use bash to append exactly one line "early" to ${effect}, once only. Use read to read ${input} and remember its FORK_ value. ${queuedFork ? `Then use bash to wait until ${gate} exists, using a bounded read-only loop with a 120-second timeout and no writes.` : ''} For this acknowledgement only, reply READY without the value. You may repeat it verbatim later. Do not repeat completed work.`;
      const later = `Remember ${late}. Use bash to append exactly one line "late" to ${effect}, once only. For this acknowledgement only, reply READY without any marker. You may repeat markers verbatim later. Do not repeat earlier tools.`;
      if (queuedFork) {
        const start = events.length;
        await page.locator('#prompt').fill(first); await page.getByRole('button', { name: 'Send message' }).click();
        await until(() => events.slice(start).some(event => event.type === 'tool_execution_start' && event.toolName === 'bash' && JSON.stringify(event.args).includes('fork-release')), 'source tool wait before steering');
        await page.locator('#prompt').fill(later); await page.getByRole('button', { name: 'Send message' }).click();
        await until(async () => (await worker.request('get_state')).pendingMessageCount > 0, 'queued source message');
        writeFileSync(gate, 'release');
        await until(() => events.slice(start).some(event => event.type === 'agent_settled'), 'combined source settlement');
        assert.equal(last()?.stopReason, 'stop', last()?.errorMessage);
      } else { await send(first); await send(later); }
      const original = file, originalBytes = readFileSync(original, 'utf8');
      const entries = originalBytes.trim().split('\n').map(JSON.parse), point = entries.find(row => row.message?.role === 'user' && textOf(row.message) === later);
      assert(point); const selectedIndex = entries.indexOf(point), calls = parentCalls().length;
      if (queuedFork && currentTarget.startsWith('claude-sdk/')) assert(!entries.slice(0, selectedIndex).some(row => row.customType === 'claude-sdk-checkpoint'));
      const loadout = audit().find(row => row.type === 'loadout' && row.session === entries[0].id); assert(loadout?.tools?.includes('read') && loadout.tools.includes('bash'));
      result.loadouts[currentTarget] = loadout.tools.sort();
      const native = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse).findLast(row => row.customType === 'claude-sdk-checkpoint')?.data.sdkSessionId;
      const originalNative = native(original);
      const forked = await worker.request('fork', { entryId: point.id }); assert.equal(forked.cancelled, false); assert.equal(forked.text, later);
      const branch = (await worker.request('get_state')).sessionFile; assert.notEqual(branch, original);
      assert.equal(readFileSync(original, 'utf8'), originalBytes); assert(!readFileSync(branch, 'utf8').includes(late));
      assert.equal(readFileSync(effect, 'utf8'), 'early\nlate\n', 'Choosing old history must not rewind current files.');
      await reopen(branch);
      const reply = await send(`This branch starts before my later message. Files have not been rewound. Without tools or repeating any work, repeat the original FORK_ value and remember ${own}. Do not invent missing LATER_ values.`);
      assert(reply.includes(marker) && !reply.includes(late)); assert.equal(readFileSync(original, 'utf8'), originalBytes);
      const branchNative = native(branch), branchBytes = readFileSync(branch, 'utf8');
      if (originalNative) assert(branchNative && branchNative !== originalNative);
      await reopen(original);
      const sourceReply = await send('Without tools, repeat the FORK_ and LATER_ values in this chat. Do not invent values from other branches.');
      assert(sourceReply.includes(marker) && sourceReply.includes(late) && !sourceReply.includes(own));
      assert.equal(readFileSync(branch, 'utf8'), branchBytes); if (originalNative) assert.equal(native(original), originalNative);
      const sourceBytes = readFileSync(original, 'utf8'); await reopen(branch);
      const again = await send('Without tools, repeat this branch\'s FORK_ and BRANCH_ONLY_ values. Do not invent missing LATER_ values.');
      assert(again.includes(marker) && again.includes(own) && !again.includes(late));
      assert.equal(readFileSync(original, 'utf8'), sourceBytes); if (branchNative) assert.equal(native(branch), branchNative);
      assert.equal(parentCalls().length, calls); assert.equal(readFileSync(effect, 'utf8'), 'early\nlate\n');
    });
    await step('tree-contract', async () => {
      await newSession('tree');
      const marker = 'TREE_' + randomUUID(), later = 'LATER_ONLY_' + randomUUID(), own = 'BRANCH_ONLY_' + randomUUID();
      const effects = join(project, 'tree-effects.log'), gate = join(project, 'tree-release');
      writeFileSync(join(project, 'tree-marker.txt'), marker); writeFileSync(effects, '');
      const first = send(`Append exactly ${JSON.stringify('early\n')} to ${effects} once, then read ${join(project, 'tree-marker.txt')}. Keep its exact value in memory. Do not print the value in this turn. This one-turn restriction does not prohibit a later explicit recall request. ${queuedTree ? `Then execute a bounded, read-only wait of up to 120 seconds for ${gate} to exist. Do not create the release file or modify anything during the wait.` : ''} Reply TREE_READY without printing the value.`);
      const laterRequest = `Remember ${later}. Append exactly ${JSON.stringify('late\n')} to ${effects}, exactly once. Then reply LATER_READY. Do not read the marker again. You may print remembered values when I explicitly request them later.`;
      if (queuedTree) {
        await until(() => events.some(e => e.type === 'tool_execution_start' && e.toolName === 'bash' && JSON.stringify(e.args).includes('tree-release')), 'tree source wait before steering');
        await page.locator('#prompt').fill(laterRequest); await page.getByRole('button', { name: 'Send message' }).click();
        await until(async () => (await worker.request('get_state')).pendingMessageCount > 0, 'queued tree source input');
        writeFileSync(gate, 'release'); await first;
      } else { await first; await send(laterRequest); }
      const rows = () => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
      const selectedPoint = rows().find(row => row.message?.role === 'user' && textOf(row.message) === laterRequest);
      assert(selectedPoint); await until(() => readFileSync(effects, 'utf8') === 'early\nlate\n', 'both source effects');
      const oldLeaf = (await worker.request('get_tree')).leafId, before = rows(), calls = parentCalls().length;
      const checkpoint = () => rows().findLast(row => row.customType === 'claude-sdk-checkpoint')?.data.sdkSessionId;
      const originalNative = checkpoint();
      if (queuedTree && currentTarget.startsWith('claude-sdk/')) assert(!before.slice(0, before.indexOf(selectedPoint)).some(row => row.customType === 'claude-sdk-checkpoint'));
      const loadout = audit().find(row => row.type === 'loadout' && row.session === before[0].id); assert(loadout?.tools.length >= 6);
      result.loadouts[currentTarget] = loadout.tools.sort();
      const navigate = async (target, summarize = false) => {
        const offset = audit().length;
        await worker.request('prompt', { message: '/parity-tree ' + JSON.stringify({ target, summarize, label: 'parity-tree-point', customInstructions: 'Preserve exact TREE_ and LATER_ONLY_ values from the transcript and recorded file outcomes. No tool replay or filesystem rollback.' }) });
        const receipt = audit().slice(offset).find(row => row.type === 'tree-result'); assert(receipt && !receipt.error, receipt?.error || 'Missing tree result'); assert.equal(receipt.cancelled, false);
        await reopen(file);
      };
      await navigate(treeSummary ? selectedPoint.parentId : selectedPoint.id, treeSummary);
      if (treeSummary) assert(rows().some(row => row.type === 'branch_summary' && row.summary.includes(later)), 'The real Pi summary must preserve the later private value when requested.');
      const recall = await send('Without tools, repeat the exact TREE_ value from the selected history. Also repeat the LATER_ONLY_ value only if this branch contains it, otherwise say ABSENT. This explicitly authorizes printing those remembered values.');
      assert(recall.includes(marker)); assert.equal(recall.includes(later), treeSummary);
      await send(`Remember ${own} in this branch. Do not use tools. Reply BRANCH_READY.`);
      const branchLeaf = (await worker.request('get_tree')).leafId, branchNative = checkpoint();
      if (originalNative) assert.notEqual(branchNative, originalNative);
      await reopen(file); const branchRecall = await send('Without tools, repeat the TREE_ and BRANCH_ONLY_ values this branch remembers.');
      assert(branchRecall.includes(marker) && branchRecall.includes(own)); if (branchNative) assert.equal(checkpoint(), branchNative);
      await navigate(oldLeaf);
      const originalRecall = await send('Without tools, repeat the TREE_ and LATER_ONLY_ values from this branch. Include a BRANCH_ONLY_ value only if this selected history actually contains one, otherwise say ABSENT.');
      assert(originalRecall.includes(marker) && originalRecall.includes(later) && !originalRecall.includes(own));
      const returnedNative = checkpoint(); if (returnedNative) { assert.notEqual(returnedNative, originalNative); assert.notEqual(returnedNative, branchNative); }
      await reopen(file); assert((await send('Without tools, repeat the TREE_ and LATER_ONLY_ values from this branch.')).includes(later));
      if (returnedNative) assert.equal(checkpoint(), returnedNative);
      await navigate(branchLeaf);
      const final = await send('Without tools, repeat the TREE_ and BRANCH_ONLY_ values from this branch. Include LATER_ONLY_ only if it is present in this selected history.');
      assert(final.includes(marker) && final.includes(own)); assert.equal(final.includes(later), treeSummary);
      assert.equal(parentCalls().length, calls); assert.equal(readFileSync(effects, 'utf8'), 'early\nlate\n');
      for (const entry of before) assert.deepEqual(rows().find(row => row.id === entry.id), entry, 'Every old audit entry must remain unchanged.');
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
