// E2E: real host, restart jobs and mobile UI, with recorded Pi RPC events instead of paid SDK calls.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { hostStatus, stopHost } from '../src/control.mjs';
import { restartAndResume } from '../scripts/restart-and-resume.mjs';
import { sessionKey } from '../src/locks.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-lifecycle-e2e-'));
const scratch = join(evidence, 'scratch'), sessions = join(scratch, 'sessions'), project = join(scratch, 'project');
for (const path of [sessions, project]) mkdirSync(path, { recursive: true });
const logFile = join(evidence, 'replay.jsonl');
Object.assign(process.env, { PI_REMOTE_HOME: scratch, PI_REMOTE_SESSION_DIRS: sessions, PI_REMOTE_RELAY_URL: '',
  PI_REMOTE_PI_BIN: fileURLToPath(new URL('./fixtures/lifecycle-pi.mjs', import.meta.url)), PI_LIFECYCLE_REPLAY_LOG: logFile });
const file = join(sessions, 'synthetic.jsonl');
writeFileSync(file, [
  { type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project },
  { type: 'session_info', id: 'name', parentId: null, name: 'Lifecycle replay check' }
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const config = { ...loadConfig(scratch), clientToken: 'browser-test-token-only-123456789012345' };
const host = await startHost({ dir: scratch, config, roots: [sessions], port: 0, relayUrl: '' });
config.port = host.http.address().port;
config.publicUrl = 'http://127.0.0.1:' + config.port;
writeFileSync(join(scratch, 'config.json'), JSON.stringify(config), { mode: 0o600 });
Object.assign(process.env, { PI_REMOTE_PORT: String(config.port), PI_REMOTE_PUBLIC_URL: config.publicUrl });
const id = sessionKey(file), rows = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const transitions = [];
host.service.on('lifecycle', event => transitions.push(event));
const restartScript = process.env.PI_TEST_RESTART_SCRIPT ?? fileURLToPath(new URL('../scripts/restart-and-resume.mjs', import.meta.url));
const result = { fixture: 'real host, restart CLI/jobs, browser and filesystem; recorded Pi RPC replay, no model calls', pass: false };
let browser, context, page;
const jobs = [];
const restart = () => {
  const child = spawn(process.execPath, [restartScript], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const job = { child, stdout: '', stderr: '', queuedPid: undefined };
  child.stdout.on('data', data => { job.stdout += data; job.queuedPid = Number(job.stdout.match(/pid (\d+)/)?.[1]) || undefined; });
  child.stderr.on('data', data => { job.stderr += data; });
  job.done = new Promise(resolve => { child.once('error', () => resolve(-1)); child.once('close', resolve); });
  jobs.push(job); return job;
};
const state = async () => (await hostStatus(config)).managedSessions.find(item => item.id === id);
const openAfterRestart = async () => {
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected', { timeout: 15000 });
  await page.locator('#sessions button.session').click();
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15000 });
};
const text = () => {
  const entries = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  return entries.findLast(e => e.message?.role === 'assistant')?.message;
};
console.log('Evidence: ' + evidence);
try {
  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  browser = await chromium.launch();
  context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  await page.goto(config.publicUrl);
  await page.getByLabel('Private login link').fill(config.clientToken);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#sessions button.session').click();
  const send = async message => {
    await page.locator('#prompt').fill(message);
    await page.getByRole('button', { name: 'Send message' }).click();
  };
  result.stage = 'seed';
  await send('seed');
  await expect.poll(async () => (await state()).phase).toBe('ready');
  const originalHistory = readFileSync(file, 'utf8');
  result.stage = 'permission';
  await send('pending');
  await expect(page.locator('#dialog')).toContainText('Allow replay probe?');
  assert.equal((await state()).phase, 'input');
  const oldPid = host.status().pid, job = restart();
  await delay(500);
  assert(job.stdout || job.child.exitCode === null, 'The restart CLI must run, not silently skip its entry point.');
  assert.equal(host.status().closing, false, 'Restart must wait for a tool permission, not terminate its worker.');
  await assert.rejects(hostStatus(config, 'DELETE', scratch, { idleOnly: true }), { code: 'ERESTARTBUSY' });
  result.restartDeferredDuringPermission = true;
  result.atomicIdleStopRefusedBusyWorker = true;
  await page.locator('#dialog').getByRole('button', { name: 'Allow', exact: true }).click();
  result.stage = 'tool';
  await expect.poll(() => rows().filter(r => r.phase === 'execution' && r.label === 'pending').length).toBe(1);
  assert.equal((await state()).phase, 'tools');
  assert.equal((await host.service.command(id, randomUUID(), { type: 'steer', text: 'Recorded in-flight input' })).ok, true);
  assert.equal((await state()).phase, 'tools');
  assert.equal((await state()).pendingTools, 1);
  result.inFlightInputPreservesPendingTools = true;
  await delay(300);
  assert.equal(host.status().closing, false);
  result.restartDeferredDuringTool = true;
  writeFileSync(join(scratch, 'tool-complete'), 'done');
  result.stage = 'checkpoint';
  await expect.poll(async () => (await state()).phase).toBe('checkpointing');
  assert.equal(host.service.read(id).status, 'idle');
  assert.equal((await state()).restartSafe, false);
  await delay(300);
  assert.equal(host.status().closing, false);
  result.agentEndIsNotRestartSafe = true;
  writeFileSync(join(scratch, 'checkpoint-save'), 'done');
  await expect.poll(async () => (await state()).waitFor).toEqual(['settled']);
  await delay(300);
  assert.equal(host.status().closing, false);
  result.checkpointAloneIsNotRestartSafe = true;
  writeFileSync(join(scratch, 'turn-settle'), 'done');
  result.stage = 'restart-and-restore';
  await expect.poll(async () => { try { const s = await hostStatus(config); return s && s.pid !== oldPid && !s.closing; } catch { return false; } }, { timeout: 15000 }).toBe(true);
  assert.equal(await job.done, 0, job.stderr);
  await openAfterRestart();
  const previous = text().timestamp;
  await send('recall');
  await expect.poll(async () => (await state()).phase).toBe('ready');
  assert(text().timestamp > previous);
  assert(text().content[0].text.includes('REPLAY_CODE_seed') && text().content[0].text.includes('REPLAY_CODE_pending'));
  result.fullHostRestartRecovered = true;
  result.stage = 'idle-restart';
  const firstReplacement = (await hostStatus(config)).pid, idleJob = restart();
  await expect.poll(async () => { try { const s = await hostStatus(config); return s && s.pid !== firstReplacement && !s.closing; } catch { return false; } }, { timeout: 15000 }).toBe(true);
  assert.equal(await idleJob.done, 0, idleJob.stderr);
  await openAfterRestart();
  const beforeRecall = text().timestamp;
  await send('recall');
  await expect.poll(async () => (await state()).phase).toBe('ready');
  assert(text().timestamp > beforeRecall);
  assert.deepEqual(rows().filter(r => r.phase === 'execution').map(r => r.label), ['seed', 'pending']);
  assert(readFileSync(file, 'utf8').startsWith(originalHistory));
  assert(transitions.some(t => t.to === 'checkpointing' && t.waitFor.includes('checkpoint')));
  assert(transitions.some(t => t.to === 'checkpointing' && t.waitFor.join() === 'settled'));
  result.idleHostRestartRecovered = true;
  result.checkpointAndSettleOrderIndependent = true;
  result.noCompletedToolsReplayed = true;
  result.originalHistoryUnchanged = true;
  result.stage = 'non-sdk-and-rejected-request';
  await page.locator('#model').click();
  await page.getByRole('region', { name: 'Choose a model' }).getByRole('button', { name: 'Plain lifecycle replay', exact: true }).click();
  await send('plain');
  await expect.poll(async () => (await state()).phase).toBe('ready');
  result.nonSdkTurnNeedsOnlySettlement = true;
  await page.locator('#model').click();
  await page.getByRole('region', { name: 'Choose a model' }).getByRole('button', { name: 'SDK lifecycle replay', exact: true }).click();
  await send('reject');
  await expect.poll(async () => (await state()).blocked).toBe('request-rejected');
  assert.equal((await state()).restartSafe, true);
  result.rejectedRequestDoesNotLeaveRestartBusy = true;
  // Isolate the forced-stop case from the rejected dispatch's browser retry state.
  await openAfterRestart();
  result.stage = 'forced-interruption';
  await send('orphan');
  await expect.poll(() => rows().filter(r => r.phase === 'execution' && r.label === 'orphan').length).toBe(1);
  await stopHost(config);
  await restartAndResume(config, scratch);
  await openAfterRestart();
  await send('recall');
  await expect.poll(async () => (await state()).phase).toBe('blocked');
  assert.equal(text().stopReason, 'error');
  assert.match(text().errorMessage, /tool result is unknown/);
  assert.equal(rows().filter(r => r.phase === 'execution' && r.label === 'orphan').length, 1);
  result.forcedUnknownOutcomeStaysBlocked = true;
  result.lifecycleTrace = transitions;
  result.pass = true;
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  for (const job of jobs) {
    if (job.child.exitCode === null) job.child.kill('SIGTERM');
    if (job.queuedPid) {
      try {
        const args = execFileSync('ps', ['-p', String(job.queuedPid), '-o', 'args='], { encoding: 'utf8' });
        if (args.includes(restartScript) && args.includes('--run')) process.kill(job.queuedPid, 'SIGTERM');
      } catch {}
    }
    await job.done;
  }
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close();
  await stopHost(config).catch(() => {});
  await host.close();
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  const { lifecycleTrace, ...summary } = result;
  console.log(JSON.stringify({ ...summary, lifecycleTransitions: lifecycleTrace?.length, evidencePath: evidence }, null, 2));
}
