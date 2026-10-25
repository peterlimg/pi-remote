import { test, expect } from '@playwright/test';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';
import { hostStatus, stopHost } from '../../src/control.mjs';
import { restartAndResume } from '../../scripts/restart-and-resume.mjs';

// Real host, JSONL indexing, browser and worker restoration; only Pi RPC is simulated.
test('a large session keeps its creation title through scans and host restarts', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-title-restart-')), sessions = join(dir, 'sessions'), project = join(dir, 'project');
  mkdirSync(sessions); mkdirSync(project);
  const file = join(sessions, 'named.jsonl'), title = 'Keep the creation title', config = loadConfig(dir);
  let host, port, parentId = null;
  const environment = { PI_REMOTE_SESSION_DIRS: sessions,
    PI_REMOTE_PI_BIN: fileURLToPath(new URL('../fixtures/lifecycle-pi.mjs', import.meta.url)), PI_LIFECYCLE_REPLAY_LOG: join(dir, 'rpc.jsonl') };
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const append = (id, entry) => {
    appendFileSync(file, JSON.stringify({ id, parentId, timestamp: new Date().toISOString(), ...entry }) + '\n'); parentId = id;
  };
  const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex');
  const options = { dir, config, roots: [sessions], relayUrl: '', allowResume: true };
  try {
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: project, timestamp: new Date().toISOString() }) + '\n');
    append('model', { type: 'model_change', provider: 'test', modelId: 'plain' });
    append('first', { type: 'message', message: { role: 'user', content: 'The original task', timestamp: 1 } });
    append('before-title', { type: 'custom', customType: 'fixture-padding', data: 'x'.repeat(70 * 1024) });
    append('creation-title', { type: 'session_info', name: title });
    for (let i = 0; i < 33; i++) append('padding-' + i, { type: 'custom', customType: 'fixture-padding', data: 'x'.repeat(1024 * 1024) });
    for (let i = 0; i < 101; i++) append('reply-' + i, { type: 'message', message: { role: 'assistant',
      content: i === 100 ? 'Saved reply' : 'Earlier reply ' + i, timestamp: 2 + i, stopReason: 'stop' } });
    expect(statSync(file).size).toBeGreaterThan(32 * 1024 * 1024);
    const original = digest(), id = sessionKey(file);
    host = await startHost({ ...options, port: 0 });
    port = host.http.address().port;
    const origin = 'http://127.0.0.1:' + port;
    Object.assign(config, { port, publicUrl: origin, relayUrl: '' });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
    expect((await host.service.view(id)).title).toBe(title);
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(origin + '/#token=' + config.clientToken);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.locator(`#sessions button.session[data-id="${id}"]`).click();
    await expect(page.locator('#title')).toHaveText(title);
    host.service.scan();
    expect(host.service.read(id).title).toBe(title);
    await expect(page.locator('#title')).toHaveText(title);
    await expect(page.locator('#transcript')).toContainText('Saved reply');

    await expect.poll(() => host.service.busyWorkers).toBe(0);
    const restarted = await restartAndResume(config, dir);
    expect(restarted.pid).not.toBe(process.pid);
    await expect.poll(async () => (await hostStatus(config, 'GET', dir, { idleOnly: true }))?.managedSessions.some(session => session.id === id)).toBe(true);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await expect(page.locator('#title')).toHaveText(title);
    await page.reload();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.locator(`#sessions button.session[data-id="${id}"]`).click();
    await expect(page.locator('#title')).toHaveText(title);
    expect(digest()).toBe(original);
    await page.screenshot({ path: testInfo.outputPath('title-after-host-restart.png') });

    // An explicit Pi rename still wins; automatic refreshes must not manufacture a new name.
    append('manual-title', { type: 'session_info', name: 'Intentional manual rename' });
    await expect(page.locator('#title')).toHaveText('Intentional manual rename', { timeout: 20000 });
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await expect(page.locator(`#sessions button.session[data-id="${id}"]`)).toContainText('Intentional manual rename');
  } finally {
    if (port) await stopHost(config, { idleOnly: true });
    await host?.close();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
