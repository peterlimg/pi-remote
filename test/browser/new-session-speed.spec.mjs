import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

// Opt into the installed Pi to measure real startup, without sending a model prompt.
const realPi = process.env.PI_REMOTE_BENCHMARK_PI === '1';
for (const projectless of [false, true]) test(`prepared ${projectless ? 'projectless' : 'project'} sessions open ready with cached models`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-session-speed-')), project = join(dir, 'project'), sessions = join(dir, 'sessions');
  mkdirSync(project); mkdirSync(sessions);
  writeFileSync(join(sessions, 'source.jsonl'), [
    { type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project },
    { type: 'session_info', id: 'name', parentId: null, name: 'Speed fixture' }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const host = await startHost({ dir, config, roots: [sessions], port: 0, relayUrl: '', workerOptions: realPi ? {} : {
    bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)), '--startup-delay', '1000', '--persist-at-startup']
  } });
  host.service.tempDirs = [];
  const requests = new Map(), prepared = [], samples = [];
  page.on('websocket', ws => {
    ws.on('framesent', frame => {
      const packet = JSON.parse(String(frame.payload));
      if (packet.op) requests.set(packet.id, packet);
    });
    ws.on('framereceived', frame => {
      const packet = JSON.parse(String(frame.payload)), request = requests.get(packet.id);
      if (packet.type === 'response' && packet.ok && request?.op === 'prepareNew') prepared.push({ request, profile: packet.value });
    });
  });
  try {
    await page.goto('http://127.0.0.1:' + host.http.address().port + '/#token=' + config.clientToken);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    const open = async () => {
      await page.getByRole('button', { name: 'New session', exact: true }).tap();
      const picker = page.getByRole('dialog', { name: 'New session in…' });
      if (projectless) await picker.getByRole('button', { name: 'Start without a project' }).tap();
      else await picker.locator('.project-option').first().tap();
    };
    // A projectless first use establishes its own configuration, never another project's defaults.
    if (projectless) {
      await open();
      await expect(page.locator('#send')).toBeEnabled({ timeout: 20000 });
      await page.getByRole('button', { name: 'Show sessions' }).click();
    }
    for (let sample = 0; sample < 3; sample++) {
      await expect.poll(() => host.service.prepared?.blank === projectless && !!host.service.prepared?.models?.length, { timeout: 20000 }).toBe(true);
      await expect.poll(() => prepared.some(item => projectless === !item.request.sessionId), { timeout: 5000 }).toBe(true);
      expect(prepared.every(({ profile }) => profile.models.every(model => Object.keys(model).every(key => ['id', 'name', 'provider'].includes(key))))).toBe(true);
      const warmId = host.service.prepared.item.state.id;
      host.service.scan(); // Pi extensions can persist metadata before the first prompt.
      expect(host.service.catalog.has(warmId)).toBe(false);
      expect(host.service.live.has(warmId)).toBe(false);
      expect(host.service.live.size).toBe(projectless ? sample + 1 : sample);
      await page.getByRole('button', { name: 'New session', exact: true }).tap();
      const picker = page.getByRole('dialog', { name: 'New session in…' });
      const started = performance.now();
      if (projectless) await picker.getByRole('button', { name: 'Start without a project' }).tap();
      else await picker.locator('.project-option').first().tap();
      await page.waitForFunction(() => !document.getElementById('send').disabled && document.getElementById('model-name').textContent !== 'Model');
      const readyMs = Math.round(performance.now() - started);
      samples.push({ sample: sample + 1, readyMs });
      expect.soft(readyMs).toBeLessThan(500);
      expect(host.service.live.has(warmId)).toBe(true);
      await expect(page.locator('#model')).toBeEnabled();
      await expect(page.locator('#composer-hint')).toBeHidden();
      await page.locator('#prompt').fill('A draft stays in this new session');
      await expect(page.locator('#app')).not.toHaveClass(/opening/);
      await page.locator('#model').tap();
      await expect(page.locator('#picker-options .picker-option').first()).toBeVisible({ timeout: 500 });
      await page.getByRole('button', { name: 'Close model picker', exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`ready-${sample + 1}.png`) });
      await page.getByRole('button', { name: 'Show sessions' }).click();
    }
    // A context edit must discard the prepared runtime, not open a session with old instructions.
    await expect.poll(() => !!host.service.prepared?.models?.length, { timeout: 20000 }).toBe(true);
    const previous = host.service.prepared;
    writeFileSync(join(dir, 'AGENTS.md'), 'New sessions must read the updated verification instructions.\n');
    await open();
    await expect(page.locator('#send')).toBeEnabled({ timeout: 20000 });
    expect([...host.service.live.values()].at(-1).state.modelCacheKey).not.toBe(previous.key);
    expect(host.service.live.has(previous.item.state.id)).toBe(false);
    await expect.poll(() => previous.item.worker).toBeUndefined();
    console.log(JSON.stringify({ realPi, projectless, samples }));
    await testInfo.attach('new-session-timing.json', { body: JSON.stringify({ realPi, projectless, samples }, null, 2), contentType: 'application/json' });
  } finally {
    await page.goto('about:blank');
    const idle = host.service.prepared?.item;
    await host.close();
    expect(idle?.worker).toBeUndefined();
    if (idle?.state.file) expect(existsSync(idle.state.file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rejected preparation cannot remove an existing saved session', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-preparation-safety-')), project = join(dir, 'project'), sessions = join(dir, 'sessions');
  mkdirSync(project); mkdirSync(sessions);
  const file = join(sessions, 'saved.jsonl'), original = [
    { type: 'session', version: 3, id: randomUUID(), cwd: project },
    { type: 'session_info', id: 'name', parentId: null, name: 'Saved session' },
    { type: 'message', id: 'reply', parentId: 'name', message: { role: 'assistant', content: 'Saved conversation stays here' } }
  ].map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(file, original);
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const host = await startHost({ dir, config, roots: [sessions], port: 0, relayUrl: '', workerOptions: {
    bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)), '--startup-file', file]
  } });
  host.service.tempDirs = [];
  let error;
  page.on('websocket', ws => ws.on('framereceived', frame => {
    const packet = JSON.parse(String(frame.payload));
    if (packet.type === 'response' && !packet.ok) error = packet.error;
  }));
  try {
    await page.goto('http://127.0.0.1:' + host.http.address().port + '/#token=' + config.clientToken);
    await expect.poll(() => error).toBe('Pi did not provide a fresh session');
    expect(readFileSync(file, 'utf8')).toBe(original);
    await page.getByRole('button', { name: /Saved session/ }).click();
    await expect(page.locator('#transcript')).toContainText('Saved conversation stays here');
    expect(host.service.live.size).toBe(0);
  } finally {
    await page.goto('about:blank');
    await host.close();
    expect(readFileSync(file, 'utf8')).toBe(original);
    rmSync(dir, { recursive: true, force: true });
  }
});
