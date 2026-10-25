import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey, processExists } from '../../src/locks.mjs';
import { updateWorkers } from '../../scripts/restart-and-resume.mjs';

// Real host, guarded control API, detached update job and phone UI; only Pi/SDK inference is replayed.
test('worker updates wait for each session independently without interrupting tools or checkpoints', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-worker-update-')), sessions = join(dir, 'sessions'), project = join(dir, 'project');
  mkdirSync(sessions); mkdirSync(project);
  const logFile = join(dir, 'replay.jsonl'), config = loadConfig(dir);
  const environment = { PI_REMOTE_HOME: dir, PI_REMOTE_SESSION_DIRS: sessions, PI_REMOTE_RELAY_URL: '', PI_REMOTE_PORT: '', PI_REMOTE_PUBLIC_URL: '',
    PI_LIFECYCLE_REPLAY_LOG: logFile };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const files = ['Busy session', 'Idle session', 'Unsaved session'].map(title => {
    const file = join(sessions, title + '.jsonl');
    writeFileSync(file, [
      { type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project },
      { type: 'session_info', id: 'name', parentId: null, name: title }
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    return file;
  });
  const ids = files.map(sessionKey), script = fileURLToPath(new URL('../../scripts/restart-and-resume.mjs', import.meta.url));
  const host = await startHost({ dir, config, roots: [sessions], port: 0, relayUrl: '', workerOptions: {
    bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/lifecycle-pi.mjs', import.meta.url))]
  } });
  config.port = host.http.address().port;
  config.publicUrl = 'http://127.0.0.1:' + config.port;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  Object.assign(process.env, { PI_REMOTE_PORT: String(config.port), PI_REMOTE_PUBLIC_URL: config.publicUrl });
  const pid = id => host.service.live.get(id)?.worker?.process.pid;
  const phase = () => host.service.managedSessions.find(session => session.id === ids[0]);
  const rows = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  let child, queuedPid, stdout = '', stderr = '';
  try {
    for (const id of ids) expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    const originalPids = ids.map(pid), originalIdleHistory = digest(files[1]);
    // Pi allocates an empty session's filename before its first message is saved.
    rmSync(files[2]); host.service.scan();
    await assert.rejects(updateWorkers({ ...config, bridgeToken: 'wrong-fixture-token' }, dir), { code: 'EHOSTAUTH' });
    expect(ids.map(pid)).toEqual(originalPids);
    await page.goto(config.publicUrl + '/#token=' + config.clientToken);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.locator(`#sessions button.session[data-id="${ids[0]}"]`).click();
    await page.locator('#prompt').fill('pending');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#dialog')).toContainText('Allow replay probe?');

    child = spawn(process.execPath, [script, '--workers'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { stdout += data; queuedPid = Number(stdout.match(/pid (\d+)/)?.[1]) || undefined; });
    child.stderr.on('data', data => { stderr += data; });
    const done = new Promise(resolve => child.once('close', resolve));
    expect(await done, stderr).toBe(0);
    await expect.poll(() => !!pid(ids[1]) && pid(ids[1]) !== originalPids[1]).toBe(true);
    expect(pid(ids[0])).toBe(originalPids[0]);
    expect(processExists(originalPids[0])).toBe(true);
    expect(host.status().pid).toBe(process.pid);
    expect(host.status().closing).toBe(false);
    expect(digest(files[1])).toBe(originalIdleHistory);
    expect(pid(ids[2])).toBe(originalPids[2]);
    expect(existsSync(files[2])).toBe(false);
    await expect(page.locator('#dialog')).toContainText('Allow replay probe?');

    await page.locator('#dialog').getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => phase().phase).toBe('tools');
    expect(pid(ids[0])).toBe(originalPids[0]);
    writeFileSync(join(dir, 'tool-complete'), 'done');
    await expect.poll(() => phase().phase).toBe('checkpointing');
    expect(pid(ids[0])).toBe(originalPids[0]);
    writeFileSync(join(dir, 'checkpoint-save'), 'done');
    await expect.poll(() => phase().waitFor).toEqual(['settled']);
    expect(pid(ids[0])).toBe(originalPids[0]);
    writeFileSync(join(dir, 'turn-settle'), 'done');
    await expect.poll(() => !!pid(ids[0]) && pid(ids[0]) !== originalPids[0]).toBe(true);
    await expect.poll(() => existsSync(join(dir, 'restart.log')) && readFileSync(join(dir, 'restart.log'), 'utf8')
      .includes(`worker update finished (job ${queuedPid}): 2 updated`)).toBe(true);
    expect(host.status().pid).toBe(process.pid);
    expect(pid(ids[2])).toBe(originalPids[2]);
    expect(rows().filter(row => row.phase === 'execution').map(row => row.label)).toEqual(['pending']);

    // Reselect and reload through the phone, then use the replacement worker without replaying the tool.
    await page.reload();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.locator(`#sessions button.session[data-id="${ids[0]}"]`).click();
    await expect(page.locator('#title')).toHaveText('Busy session');
    await expect(page.locator('#transcript')).toContainText('REPLAY_CODE_pending');
    await page.locator('#prompt').fill('recall');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => phase().phase).toBe('ready');
    expect(rows().filter(row => row.phase === 'execution')).toHaveLength(1);
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.locator(`#sessions button.session[data-id="${ids[1]}"]`).click();
    await expect(page.locator('#title')).toHaveText('Idle session');
    expect(digest(files[1])).toBe(originalIdleHistory);
    await page.screenshot({ path: testInfo.outputPath('independent-worker-update.png') });
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    if (queuedPid) try {
      const args = execFileSync('ps', ['-p', String(queuedPid), '-o', 'args='], { encoding: 'utf8' });
      if (args.includes(script) && args.includes('--run-workers')) process.kill(queuedPid, 'SIGTERM');
    } catch {}
    await page.goto('about:blank');
    await host.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
