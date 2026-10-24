import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

// Real host and browser; gate the Pi RPC handshake without running a model.
for (const projectless of [false, true]) test(`a new ${projectless ? 'projectless session' : 'project session'} opens before Pi is ready and keeps its draft`, async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-new-session-')), sessions = join(dir, 'sessions'), project = join(dir, 'project');
  mkdirSync(sessions); mkdirSync(project);
  const file = join(sessions, 'old.jsonl'), config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  writeFileSync(file, [
    { type: 'session', version: 3, id: 'old', cwd: project },
    { type: 'session_info', id: 'name', parentId: null, name: 'Original session' },
    { type: 'message', id: 'reply', parentId: 'name', message: { role: 'assistant', content: 'Original conversation' } }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const host = await startHost({ dir, config, roots: [sessions], port: 0, relayUrl: '', workerOptions: {
    bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)), '--startup-gate']
  } });
  host.service.tempDirs = []; // The disposable project must appear in the real project picker.
  const sourceId = sessionKey(file), watches = [];
  // Hold the follow-up subscription to prove startup needs no second round trip.
  await page.routeWebSocket('**/ws', ws => {
    const server = ws.connectToServer();
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (!watches.length && packet.op === 'watch' && packet.sessionId !== sourceId) watches.push(() => server.send(raw));
      else server.send(raw);
    });
  });
  try {
    await page.goto('http://127.0.0.1:' + host.http.address().port + '/#token=' + config.clientToken);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.getByRole('button', { name: /Original session/ }).click();
    await expect(page.locator('#transcript')).toContainText('Original conversation');
    await page.locator('#prompt').fill('Keep the original draft');
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: 'New session', exact: true }).tap();
    const picker = page.getByRole('dialog', { name: 'New session in…' });
    if (projectless) await picker.getByRole('button', { name: 'Start without a project' }).tap();
    else await picker.locator('.project-option').click();
    await expect(picker).toBeHidden({ timeout: 1000 });
    await expect(page.locator('#title')).toHaveText('Untitled session');
    await expect(page.locator('#transcript')).not.toContainText('Original conversation');
    await expect(page.locator('#prompt')).toBeEditable();
    await expect(page.locator('#prompt')).toHaveValue('');
    await expect(page.locator('#send')).toBeDisabled();
    await expect(page.locator('#composer-hint')).toContainText('Starting session');
    await expect(page.locator('#model')).toBeVisible({ timeout: 1000 });
    await expect(page.locator('#model-name')).toHaveText('Loading model…');
    await expect(page.locator('#model')).toBeDisabled();
    await expect(page.locator('#reasoning-control')).toBeHidden();
    await expect(page.locator('#prompt')).toBeFocused({ timeout: 1000 });
    await expect(page.locator('#image-files')).toBeDisabled();
    await page.evaluate(() => {
      window.startupLoadingScreens = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.matches('.conversation-loading')) window.startupLoadingScreens.push(node.textContent);
        }
      }).observe(document.getElementById('transcript'), { childList: true });
    });
    if (projectless) await expect(page.locator('#project-name')).toBeHidden();
    else await expect(page.locator('#project-name')).toHaveText('project');
    await page.locator('#prompt').fill('Draft written during startup');
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    await page.screenshot({ path: testInfo.outputPath('draft-during-startup.png') });
    if (!projectless) {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.locator('#connection')).toHaveText('Computer connected');
      await expect(page.locator('#prompt')).toHaveValue('Draft written during startup');
      await expect(page.locator('#notice')).toBeHidden();
    }
    if (projectless) {
      // Finishing in the background must not pull the user out of another conversation.
      await page.getByRole('button', { name: 'Show sessions' }).click();
      await page.getByRole('button', { name: /Original session/ }).click();
      await expect(page.locator('#prompt')).toHaveValue('Keep the original draft');
    }
    await expect.poll(() => host.service.starting.size).toBe(1);
    const cwd = projectless ? join(dir, 'projects', readdirSync(join(dir, 'projects'))[0]) : project;
    writeFileSync(join(cwd, 'startup-ready'), 'ready');
    await expect.poll(() => host.service.starting.size).toBe(0);
    const fresh = [...host.service.live.keys()].find(id => id !== sourceId);
    expect(fresh).toBeTruthy();
    if (projectless) {
      await expect(page.locator('#title')).toHaveText('Original session');
      await page.getByRole('button', { name: 'Show sessions' }).click();
      await page.locator(`#sessions .session[data-id="${fresh}"]`).click();
    }
    await expect.poll(() => watches.length).toBe(1);
    await expect(page.locator('#send')).toBeEnabled();
    expect(await page.evaluate(() => window.startupLoadingScreens)).toEqual([]);
    if (!projectless) await expect(page.locator('#prompt')).toBeFocused();
    await expect(page.locator('#model-name')).toHaveText('First');
    await expect(page.locator('#model')).toBeEnabled();
    await expect(page.locator('#reasoning-control')).toBeVisible();
    await expect(page.locator('#reasoning-value')).toHaveText('Medium');
    await expect(page.locator('#prompt')).toHaveValue('Draft written during startup');
    await expect(page.locator('#composer-hint')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('ready-before-watch.png') });
    watches.forEach(release => release());
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#transcript')).toContainText('reply: Draft written during startup');
    expect(host.service.read(sourceId).messages.map(message => message.text)).toEqual(['Original conversation']);
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: /Original session/ }).click();
    await expect(page.locator('#prompt')).toHaveValue('Keep the original draft');
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.locator(`#sessions .session[data-id="${fresh}"]`).click();
    await expect(page.locator('#transcript')).toContainText('reply: Draft written during startup');
  } finally {
    await page.goto('about:blank');
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
