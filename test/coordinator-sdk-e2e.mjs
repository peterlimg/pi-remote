#!/usr/bin/env node
// Real host/Pi/MCP/task lifecycle. Default mode replays only the external SDK peer.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, openSync, closeSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { chromium, devices, expect } from '@playwright/test';
import { socket, until } from './helpers.mjs';

const live = process.env.PI_COORDINATOR_SDK_LIVE === '1';
const model = process.env.PI_COORDINATOR_SDK_MODEL || 'claude-sdk/claude-haiku-5-5';
assert(model.startsWith('claude-sdk/'));
const port = Number(process.env.PI_REMOTE_COORDINATOR_SDK_TEST_PORT || 8817), url = 'http://127.0.0.1:' + port;
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-worker-proof-'));
const root = mkdtempSync(join(evidence, 'pi-coordinator-fixture-'));
const project = join(root, 'project'), agent = join(root, 'agent'), sdkPackage = join(root, 'sdk-package');
for (const folder of [project, agent, sdkPackage, join(root, 'claude')]) mkdirSync(folder);
writeFileSync(join(root, '.coordinator-fixture.json'), JSON.stringify({ version: 1 }));
const marker = 'SDK_WORKER_MARKER_' + randomBytes(16).toString('hex');
writeFileSync(join(project, 'secret.txt'), marker + '\n');
const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=SDK fixture', '-c', 'user.email=sdk-fixture@example.invalid', ...args], { cwd: project, encoding: 'utf8' });
git(['-c', 'init.templateDir=', 'init', '-q']); git(['add', 'secret.txt']); git(['commit', '-qm', 'SDK fixture baseline']);
writeFileSync(join(sdkPackage, 'package.json'), JSON.stringify({ name: 'pi-claude-sdk', version: '0.1.1', type: 'module', pi: { extensions: ['./index.ts'] } }));
writeFileSync(join(sdkPackage, 'index.ts'), `export { default } from ${JSON.stringify(pathToFileURL(resolve('experiments/claude-sdk-provider/coordinator-peer.mjs')).href)};\n`);
const providerPackage = live ? resolve('experiments/claude-sdk-provider/node_modules/pi-claude-sdk') : sdkPackage;
writeFileSync(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'coordinator-fixture', defaultModel: 'fixture',
  defaultThinkingLevel: 'off', compaction: { enabled: false }, retry: { enabled: false },
  packages: [{ source: providerPackage, skills: [], prompts: [], themes: [] }] }));
const env = { ...process.env, PI_COORDINATOR_FIXTURE_ROOT: root, PI_REMOTE_COORDINATOR_TEST_PORT: String(port), PI_OFFLINE: '1' };
for (const key of Object.keys(env)) if (key.startsWith('PI_REMOTE_') && key !== 'PI_REMOTE_COORDINATOR_TEST_PORT') delete env[key];
if (!live) env.CLAUDE_CONFIG_DIR = join(root, 'claude');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const lines = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const ledger = () => existsSync(join(root, 'host', 'coordinator-tasks.json')) ? json(join(root, 'host', 'coordinator-tasks.json')) : { tasks: [], coordinators: [] };
const task = title => ledger().tasks.find(task => task.title === title);
const checkpoints = task => lines(task.file).filter(row => row.customType === 'claude-sdk-checkpoint');
const check = expect.configure({ timeout: 30000 });
const record = value => appendFileSync(join(evidence, 'actions.jsonl'), JSON.stringify({ at: Date.now(), ...value }) + '\n');
let running, browser, context, page, starts = 0;
const result = { live, model, pass: false, boundary: live ? 'real Claude SDK model' : 'only the external SDK peer is replayed', checks: [] };
console.log('Evidence: ' + evidence);
async function start() {
  const logFile = join(evidence, 'host-' + (++starts) + '.log'), log = openSync(logFile, 'w');
  const child = spawn(process.execPath, ['test/coordinator-server.mjs'], { env, stdio: ['ignore', 'pipe', log] }); closeSync(log);
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = Promise.withResolvers(); let buffer = '';
  child.stdout.on('data', chunk => {
    appendFileSync(logFile, chunk); buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const value = JSON.parse(line); if (value.fixture === 'coordinator') ready.resolve(value); } catch {}
    }
  });
  child.once('error', ready.reject); child.once('exit', () => ready.reject(new Error('Fixture exited: ' + logFile)));
  running = { child, exit };
  const timer = setTimeout(() => ready.reject(new Error('Fixture startup timed out: ' + logFile)), 30000);
  try {
    const info = await ready.promise;
    const doctorLog = openSync(join(evidence, 'doctor-' + starts + '.json'), 'w');
    try { execFileSync(process.execPath, ['test/coordinator-e2e.mjs', 'doctor', String(info.pid), url], { stdio: ['ignore', doctorLog, 'pipe'] }); }
    finally { closeSync(doctorLog); }
    return info;
  } finally { clearTimeout(timer); }
}
async function stop() {
  if (!running) return;
  const instance = running; running = undefined;
  instance.child.kill('SIGTERM');
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 10000);
  try { return await instance.exit; } finally { clearTimeout(timer); }
}
async function send(input) {
  record({ action: 'main-conversation', input });
  await page.locator('#prompt').fill('SDK proof: ' + JSON.stringify(input));
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
async function settled(title, state, previous = 0) {
  await until(() => {
    const failed = lines(join(root, 'provider.jsonl')).findLast(row => row.kind === 'request' && row.input?.startsWith('SDK proof: ') && row.results?.some(result => result.isError));
    if (failed) throw new Error('Parent tool failed: ' + JSON.stringify(failed.results));
    const current = task(title);
    return current?.state === state && checkpoints(current).length > previous;
  }, live ? 180000 : 30000);
  return task(title);
}
async function snapshot(name) {
  await page.screenshot({ path: join(evidence, name + '.png') });
  writeFileSync(join(evidence, name + '.aria.txt'), await page.locator('body').ariaSnapshot());
}
try {
  const info = await start();
  browser = await chromium.launch({ channel: process.env.PI_REMOTE_TEST_CHANNEL || undefined });
  context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark', reducedMotion: 'reduce' });
  page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByText('Paste a private link instead', { exact: true }).click();
  await page.getByLabel('Private login link').fill('browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Connect to computer', exact: true }).click();
  await page.getByRole('button', { name: /Coordinator verification project/ }).click();
  await check(page.locator('#app')).not.toHaveClass(/opening/);
  const source = info.sources.find(source => source.title === 'Coordinator verification project');
  const originalModel = lines(source.file).findLast(row => row.type === 'model_change');
  await send({ action: 'assign', title: 'SDK investigation', model, instruction: 'SDK_VERIFY_READ. Read secret.txt and remember its value privately. Verify that ../outside.txt and escape.txt are denied. Ask a question with task_report; do not include the secret in that question.' });
  let inspection = await settled('SDK investigation', 'waiting');
  assert(!inspection.question.includes(marker));
  assert.equal(inspection.providerExtension.path, realpathSync(join(providerPackage, 'index.ts')));
  await check(page.locator('#coordinator-open')).toBeVisible(); await page.locator('#coordinator-open').click();
  await check(page.locator('#coordinator-task-list')).toContainText('SDK investigation');
  await snapshot('sdk-worker-question');
  await page.getByRole('button', { name: 'Close workers', exact: true }).click();
  const count = checkpoints(inspection).length;
  await send({ action: 'message', taskId: inspection.id, text: 'SDK_VERIFY_REMEMBER. Report the stored value without reading files or running tools other than task_report.' });
  inspection = await settled('SDK investigation', 'reported', count);
  assert(inspection.result.includes(marker));
  const file = inspection.file, sessionId = inspection.sessionId, savedCount = checkpoints(inspection).length, prefix = readFileSync(inspection.file, 'utf8');
  result.checks.push('real restricted SDK report and tool-free checkpoint', 'question and scoped follow-up preserve private tool memory');

  await stop(); await start();
  await page.reload();
  await page.getByRole('button', { name: /Coordinator verification project/ }).click();
  await check(page.locator('#title')).toHaveText('Coordinator verification project');
  await send({ action: 'message', taskId: inspection.id, text: 'SDK_VERIFY_REMEMBER. After restart, report the same stored value without reading files or running tools other than task_report.' });
  inspection = await settled('SDK investigation', 'reported', savedCount);
  assert.equal(inspection.file, file); assert.equal(inspection.sessionId, sessionId); assert(inspection.result.includes(marker));
  assert(readFileSync(file, 'utf8').startsWith(prefix), 'Restart must retain the recorded SDK/Pi history byte-for-byte.');
  result.checks.push('host/process restart retains the same task and Pi session without replay');

  const before = ledger().tasks.length, owner = ledger().coordinators.find(owner => owner.id === inspection.coordinatorId);
  const oldPackage = join(root, 'old-sdk'); mkdirSync(oldPackage);
  writeFileSync(join(oldPackage, 'package.json'), JSON.stringify({ name: 'pi-claude-sdk', version: '0.1.0', pi: { extensions: ['./index.ts'] } }));
  writeFileSync(join(oldPackage, 'index.ts'), 'throw new Error("An incompatible provider must never load.");\n');
  for (const providerExtension of [undefined, { origin: 'package', baseDir: sdkPackage, path: join(project, 'secret.txt') },
    { origin: 'package', baseDir: oldPackage, path: join(oldPackage, 'index.ts') }]) {
    const response = await fetch(url + '/_pi/coordinator', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign', title: 'Must not launch', instruction: 'Invalid provider source.', model, providerExtension, requestId: randomBytes(32).toString('hex') }) });
    assert.equal(response.status, 400); const body = await response.json();
    assert.match(body.error, /pi-claude-sdk 0\.1\.1 or newer/); assert(!JSON.stringify(body).includes(root));
  }
  assert.equal(ledger().tasks.length, before);
  result.checks.push('missing or escaping SDK source fails before task creation with a safe public error');

  await send({ action: 'assign', kind: 'code', title: 'SDK coding', model, instruction: 'SDK_VERIFY_WRITE. Append exactly one once line followed by a newline to sdk-counter.txt. Create sdk-worker-note.txt containing exactly SDK coding worker verified. followed by one newline, then report the result. Do not change anything else.' });
  const coding = await settled('SDK coding', 'reported');
  assert.equal(readFileSync(join(coding.workspace.cwd, 'sdk-counter.txt'), 'utf8'), 'once\n');
  assert.equal(readFileSync(join(coding.workspace.cwd, 'sdk-worker-note.txt'), 'utf8'), 'SDK coding worker verified.\n');
  assert(!existsSync(join(project, 'sdk-counter.txt')));
  await send({ action: 'inspect', taskId: coding.id });
  await until(() => task('SDK coding').workspace.reviewedRevision, 30000);
  const revision = task('SDK coding').workspace.reviewedRevision;
  const diff = git(['diff', '--no-ext-diff', coding.workspace.base, revision]);
  writeFileSync(join(evidence, 'reviewed.diff'), diff);
  assert.deepEqual(git(['diff', '--name-only', coding.workspace.base, revision]).trim().split('\n').sort(), ['sdk-counter.txt', 'sdk-worker-note.txt']);
  assert.match(diff, /\+once/); assert.match(diff, /\+SDK coding worker verified\./);
  await send({ action: 'integrate', taskId: coding.id, revision });
  await until(() => task('SDK coding').workspace.integration === 'applied', 30000);
  assert.equal(readFileSync(join(project, 'sdk-counter.txt'), 'utf8'), 'once\n');
  result.checks.push('SDK code uses restricted Pi bash/write in its worktree and exact-reviewed integration');

  await send({ action: 'assign', title: 'SDK Stop', model, instruction: 'SDK_VERIFY_WAIT. Wait without taking any action until explicitly stopped. Do not report a result.' });
  await until(() => task('SDK Stop')?.state === 'working', 30000);
  if (!live) await until(() => lines(join(root, 'sdk-peer.jsonl')).some(row => row.kind === 'holding'), 30000);
  await send({ action: 'stop', taskId: task('SDK Stop').id });
  await until(() => task('SDK Stop').state === 'stopped', 30000);
  result.checks.push('task-specific Stop fences SDK execution');
  const client = await socket(url.replace('http:', 'ws:') + '/ws', 'browser-test-token-only-123456789012345', url);
  try {
    const denied = await client.request('command', { sessionId, command: { type: 'prompt', text: 'Bypass the coordinator.' } });
    assert.equal(denied.value?.ok, false); assert.match(denied.value.error, /Worker logs are read-only/);
  } finally { client.ws.terminate(); }
  assert.deepEqual(lines(source.file).findLast(row => row.type === 'model_change'), originalModel);
  assert.equal(readFileSync(join(project, 'secret.txt'), 'utf8'), marker + '\n');
  if (!live) {
    const events = lines(join(root, 'sdk-peer.jsonl'));
    assert.equal(events.filter(event => event.kind === 'call' && event.name === 'read' && event.arguments.path === 'secret.txt').length, 1);
    assert.equal(events.filter(event => event.kind === 'tool-result' && event.name === 'read' && event.isError).length, 2);
    for (const event of events.filter(event => event.kind === 'query')) assert.deepEqual([...event.names].sort(), event.names.length ?
      (event.role === 'coder' ? ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'task_report', 'write'] : ['find', 'grep', 'ls', 'read', 'task_report']) : []);
    assert(events.filter(event => event.kind === 'wrap-up').length >= 4);
    writeFileSync(join(evidence, 'sdk-peer.jsonl'), readFileSync(join(root, 'sdk-peer.jsonl')));
  }
  assert.deepEqual(errors, []);
  await snapshot('sdk-worker-integrated-and-stopped');
  result.checks.push('parent model unchanged; worker logs reject direct input; no SDK-native tools exposed');
  result.pass = true;
} catch (error) {
  result.error = error.stack;
  if (page) await snapshot('failure').catch(() => {});
  throw error;
} finally {
  await context?.close(); await browser?.close();
  const stopped = await stop();
  result.hostExit = stopped;
  for (const file of ['provider.jsonl', 'sdk-peer.jsonl']) if (existsSync(join(root, file))) writeFileSync(join(evidence, file), readFileSync(join(root, file)));
  if (!result.pass) writeFileSync(join(evidence, 'tasks.json'), JSON.stringify(ledger(), (key, value) => key === 'token' ? '<redacted>' : value, 2));
  const pids = new Set(lines(join(root, 'provider.jsonl')).map(row => row.pid).concat(lines(join(root, 'sdk-peer.jsonl')).map(row => row.pid)));
  const alive = [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  result.cleanup = { alive, ownFixtureRemoved: alive.length === 0 && result.pass, retainedFailureFixture: result.pass ? undefined : root };
  if (!alive.length && result.pass) rmSync(root, { recursive: true, force: true });
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence }, null, 2));
  assert.equal(alive.length, 0, 'Owned Pi processes must exit.');
  if (result.pass) assert.equal(stopped?.code, 0, 'The fixture must shut down cleanly.');
}
