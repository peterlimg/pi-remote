#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, devices, expect } from '@playwright/test';
import { socket, until, delay } from './helpers.mjs';
import { parseTaskInput, TASK_INPUT } from '../src/task-input.mjs';

const port = Number(process.env.PI_REMOTE_RECOVERY_TEST_PORT || 8815), url = 'http://127.0.0.1:' + port;
const listener = createServer();
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
await new Promise(resolve => listener.close(resolve));
const evidence = mkdtempSync(join(tmpdir(), 'pi-task-recovery-proof-')), scratch = join(evidence, 'scratch'); mkdirSync(scratch);
console.log('Evidence: ' + evidence);
const save = (file, value) => writeFileSync(join(evidence, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const lines = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const hash = text => createHash('sha256').update(text).digest('hex');
const env = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, PI_OFFLINE: '1', PI_RECOVERY_GIT: '1' };
for (const name of Object.keys(env)) if (name.startsWith('PI_REMOTE_')) delete env[name];
env.PI_REMOTE_COORDINATOR_TEST_PORT = String(port);
let root, running, browser, client, page, owner, starts = 0, effectPid;
const start = async () => {
  const log = openSync(join(evidence, 'host-' + (++starts) + '.log'), 'w');
  const child = spawn(process.execPath, ['test/coordinator-server.mjs'], { env: { ...env, ...(root ? { PI_COORDINATOR_FIXTURE_ROOT: root } : {}) }, stdio: ['ignore', 'pipe', log] }); closeSync(log);
  const ready = Promise.withResolvers(); let buffer = '';
  const exited = new Promise(resolve => child.once('exit', resolve)); running = { child, exited };
  child.stdout.on('data', chunk => {
    buffer += chunk; let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { const value = JSON.parse(line); if (value.fixture === 'coordinator') ready.resolve(value); } catch {}
    }
  });
  child.once('error', ready.reject); child.once('exit', () => ready.reject(new Error('Recovery fixture exited')));
  const timer = setTimeout(() => ready.reject(new Error('Recovery fixture startup timed out')), 25000);
  try { const value = await ready.promise; root = value.root; return value; } finally { clearTimeout(timer); }
};
const stop = async () => {
  const current = running; running = undefined; if (!current) return;
  current.child.kill('SIGTERM'); const timer = setTimeout(() => current.child.kill('SIGKILL'), 10000);
  try { await current.exited; } finally { clearTimeout(timer); }
};
const ledger = () => json(join(root, 'host', 'coordinator-tasks.json'));
const task = title => ledger().tasks.find(task => task.title === title);
const post = async (token, input) => {
  const response = await fetch(url + '/_pi/coordinator', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, requestId: hash(randomUUID()) }), signal: AbortSignal.timeout(30000) });
  return response.json();
};
const action = input => post(owner.token, input);
const assign = async (title, instruction, kind = 'investigation') => {
  const result = await action({ action: 'assign', title, instruction, kind }); assert.equal(result.ok, true, result.error); return task(title);
};
const envelopes = file => lines(file).filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => parseTaskInput(typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'))).filter(Boolean);
const settle = async title => until(() => task(title)?.state === 'reported' && task(title), 30000);
const capture = async name => { await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true }); save(name + '.aria.txt', await page.locator('body').ariaSnapshot()); };
try {
  const info = await start();
  client = await socket(url.replace('http:', 'ws:') + '/ws', 'browser-test-token-only-123456789012345', url);
  assert.equal((await client.request('newCoordinator', { sessionId: info.sources[0].id })).value.ok, true);
  owner = ledger().coordinators[0];
  const project = join(root, 'project');
  const git = args => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Recovery fixture base']);
  writeFileSync(join(project, 'parent-draft.txt'), 'Keep this local draft.\n'); const index = git(['ls-files', '--stage']);
  browser = await chromium.launch({ channel: process.env.PI_REMOTE_TEST_CHANNEL });
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page = await context.newPage(); await page.goto(url);
  await page.getByText('Paste a private link instead', { exact: true }).click();
  await page.getByLabel('Private login link').fill('browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Connect to computer', exact: true }).click();
  await page.getByRole('button', { name: /Coordinator verification project/ }).click();
  const counter = await assign('Recovery counter', 'Run the recovery counter fixture and continue from saved results.', 'code');
  const recovered = await settle(counter.title);
  assert.equal(recovered.id, counter.id); assert.equal(recovered.sessionId, counter.sessionId); assert.equal(recovered.workspace.path, counter.workspace.path);
  assert.equal(readFileSync(join(recovered.workspace.path, 'counter.txt'), 'utf8'), 'once\n');
  assert.equal(readFileSync(join(recovered.workspace.path, 'recovered.txt'), 'utf8'), 'Continued from saved results.\n');
  const counterRuns = envelopes(recovered.file);
  assert.equal(counterRuns.length, 2); assert.equal(counterRuns.flatMap(run => run.messages).length, 1);
  assert.notEqual(counterRuns[0].generation, counterRuns[1].generation);
  await page.locator('#coordinator-open').click();
  await page.getByRole('listitem', { name: counter.title, exact: true }).getByRole('button').click();
  await expect(page.locator('#coordinator-subtitle')).toHaveText('Result ready');
  await capture('same-task-recovered'); await page.getByRole('button', { name: 'Close workers', exact: true }).click();
  const review = (await action({ action: 'inspect', taskId: counter.id })).value.review;
  writeFileSync(join(root, 'lose-apply-receipt'), 'armed');
  assert.equal((await action({ action: 'integrate', taskId: counter.id, revision: review.revision })).ok, false);
  assert.equal(task(counter.title).workspace.integration, 'unknown');
  assert.equal(readFileSync(join(project, 'counter.txt'), 'utf8'), 'once\n');
  assert.equal((await action({ action: 'recover', taskId: counter.id, revision: review.revision })).ok, true);
  assert.equal(task(counter.title).state, 'completed');
  assert.equal(readFileSync(join(root, 'git-apply.log'), 'utf8'), 'applied\n');
  assert.equal(git(['ls-files', '--stage']), index); assert.equal(readFileSync(join(project, 'parent-draft.txt'), 'utf8'), 'Keep this local draft.\n');
  const inbox = await assign('Recovery inbox', 'Hold the recovery inbox fixture until restart.');
  await until(() => task(inbox.title).run?.read, 10000);
  assert.equal((await action({ action: 'message', taskId: inbox.id, text: 'Use the queued follow-up.' })).ok, true);
  const pendingId = task(inbox.title).inputs.at(-1).id;
  assert.equal(envelopes(inbox.file).flatMap(run => run.messages).filter(message => message.id === pendingId).length, 0);
  await page.locator('#coordinator-open').click(); await page.getByRole('listitem', { name: inbox.title, exact: true }).getByRole('button').click();
  await page.locator('#coordinator-log details[data-disclosure-id="task"] > summary').click();
  await expect(page.locator('#coordinator-log')).toContainText('1 instruction(s) waiting to be read.'); await capture('queued-input-waiting');
  await page.getByRole('button', { name: 'Close workers', exact: true }).click();
  const oldGeneration = task(inbox.title).generation;
  client.ws.terminate(); await stop(); await start();
  await until(() => task(inbox.title).state === 'working' && task(inbox.title).run?.read && task(inbox.title).generation !== oldGeneration, 30000);
  assert.equal((await post(inbox.token, { kind: 'result', generation: oldGeneration, text: 'A stale result must be rejected.' })).ok, false);
  assert.equal((await post(inbox.token, { kind: 'receipt', generation: task(inbox.title).generation, inputIds: [randomUUID()] })).ok, false);
  writeFileSync(join(root, 'release-inbox'), 'continue'); await settle(inbox.title);
  assert.equal(envelopes(inbox.file).flatMap(run => run.messages).filter(message => message.id === pendingId).length, 1);
  assert.equal(task(inbox.title).inputs.at(-1).settled, true);
  await page.reload(); await page.getByRole('button', { name: /Coordinator verification project/ }).click();
  await page.locator('#coordinator-open').click(); await page.getByRole('listitem', { name: inbox.title, exact: true }).getByRole('button').click();
  await expect(page.locator('#coordinator-subtitle')).toHaveText('Result ready'); await capture('queued-input-recovered');
  await page.getByRole('button', { name: 'Close workers', exact: true }).click();
  const budget = await assign('Recovery budget', 'Always fail the recovery budget fixture.');
  await until(() => task(budget.title).recovery?.phase === 'blocked', 30000);
  assert.equal(task(budget.title).recovery.attempts, 2);
  assert.equal(task(budget.title).events.filter(event => event.recovery).length, 1);
  assert.equal(envelopes(budget.file).length, 3);
  await action({ action: 'stop', taskId: budget.id });
  const stopped = await assign('Stop recovery race', 'Always fail the recovery budget fixture.');
  await until(() => ['recovering', 'unknown'].includes(task(stopped.title).state), 15000);
  assert.equal((await action({ action: 'stop', taskId: stopped.id })).ok, true);
  const stoppedRuns = envelopes(stopped.file).length;
  await delay(4500); assert.equal(task(stopped.title).state, 'stopped'); assert.equal(envelopes(stopped.file).length, stoppedRuns);
  const inconsistent = await assign('Mismatched saved input', 'Always fail the recovery budget fixture.');
  await until(() => task(inconsistent.title).state === 'recovering', 15000);
  const damaged = lines(inconsistent.file), savedInput = damaged.find(entry => entry.type === 'message' && entry.message.role === 'user');
  const value = parseTaskInput(savedInput.message.content[0].text); value.messages[0].text += ' altered on disk';
  savedInput.message.content[0].text = TASK_INPUT + JSON.stringify(value);
  writeFileSync(inconsistent.file, damaged.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await until(() => task(inconsistent.title).recovery?.phase === 'blocked', 15000);
  assert.match(task(inconsistent.title).error, /incomplete or inconsistent/); assert.equal(envelopes(inconsistent.file).length, 1);
  writeFileSync(join(root, 'hold-workspace-check'), 'armed');
  const checking = await assign('Stop during saved-work check', 'Run the recovery counter fixture.', 'code');
  await until(() => existsSync(join(root, 'workspace-check-waiting')), 15000);
  assert.equal((await action({ action: 'stop', taskId: checking.id })).ok, true);
  rmSync(join(root, 'hold-workspace-check')); await delay(1500);
  assert.equal(task(checking.title).state, 'stopped'); assert.equal(envelopes(checking.file).length, 1);
  const uncertain = await assign('Uncertain tool', 'Run the uncertain write fixture.', 'code');
  const pidFile = join(uncertain.workspace.path, 'effect-pid.txt');
  await until(() => existsSync(pidFile), 15000); effectPid = Number(readFileSync(pidFile, 'utf8'));
  const pi = lines(join(root, 'provider.jsonl')).findLast(entry => entry.kind === 'boot' && entry.cwd === uncertain.workspace.cwd);
  assert(pi && Number.isSafeInteger(pi.pid)); process.kill(pi.pid, 'SIGKILL');
  await until(() => task(uncertain.title).recovery?.phase === 'blocked', 20000);
  assert.match(task(uncertain.title).error, /tool outcome/); assert.equal(task(uncertain.title).events.filter(event => event.recovery).length, 1);
  assert.equal(readFileSync(join(uncertain.workspace.path, 'partial-marker.txt'), 'utf8'), 'once\n');
  assert.equal(envelopes(uncertain.file).length, 1);
  await page.locator('#coordinator-open').click(); await page.getByRole('listitem', { name: uncertain.title, exact: true }).getByRole('button').click();
  await page.locator('#coordinator-log details[data-disclosure-id="task"] > summary').click();
  await expect(page.locator('#coordinator-log')).toContainText('A tool outcome is incomplete or uncertain.'); await capture('uncertain-tool-blocked');
  const capacity = [];
  for (const title of ['Capacity one', 'Capacity two']) capacity.push(await assign(title, 'Hold the recovery inbox fixture.'));
  const refused = await action({ action: 'recover', taskId: uncertain.id });
  assert.equal(refused.ok, false); assert.match(refused.error, /Two tasks/); assert.equal(task(uncertain.title).state, 'unknown');
  for (const item of capacity) assert.equal((await action({ action: 'stop', taskId: item.id })).ok, true);
  save('result.json', { passed: true, checks: ['same-session/worktree recovery', 'completed shell command not repeated', 'durable unread follow-up after restart', 'stale generation rejected', 'two-attempt budget and one escalation', 'Stop fences pending recovery and in-flight history/workspace checks', 'recovery obeys active-task capacity', 'mid-tool kill blocks replay', 'lost integration receipt reconciled without another apply', 'parent draft/index preserved'],
    excluded: ['paid-model judgment', 'physical Safari', 'power-loss durability', 'OS sandboxing'] });
} catch (error) {
  save('failure.txt', error.stack || String(error)); if (page && !page.isClosed()) await capture('failure').catch(() => {}); throw error;
} finally {
  client?.ws.terminate(); await browser?.close();
  if (effectPid) try { if (execFileSync('ps', ['-p', String(effectPid), '-o', 'args='], { encoding: 'utf8' }).includes('partial-marker.txt')) process.kill(effectPid, 'SIGKILL'); } catch {}
  await stop();
  if (root) {
    save('provider-audit.json', lines(join(root, 'provider.jsonl')));
    if (existsSync(join(root, 'host', 'coordinator-tasks.json'))) save('tasks.json', ledger().tasks.map(({ token, ...task }) => task));
    const pids = [...new Set(lines(join(root, 'provider.jsonl')).filter(entry => entry.kind === 'boot').map(entry => entry.pid))];
    await until(() => pids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }), 10000);
  }
  rmSync(scratch, { recursive: true, force: true }); save('cleanup.json', { stopped: true, scratchRemoved: true });
}
console.log('PASS: bounded task recovery, durable inputs, fenced reports, Stop races and uncertain-effect blocking.');
