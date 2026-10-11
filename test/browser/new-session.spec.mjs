import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

test('new session picks from all projects by usage and starts an independent conversation', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-projects-'));
  const originals = new Map();
  for (const [name, count] of [['Popular', 24], ['Second', 3], ['Third', 2], ['Other', 1]]) {
    const cwd = join(dir, name); mkdirSync(cwd);
    for (let i = 0; i < count; i++) {
      const file = join(dir, `${name}-${i}.jsonl`);
      const text = JSON.stringify({ type: 'session', id: `${name}-${i}`, cwd }) + '\n';
      originals.set(file, text); writeFileSync(file, text);
      utimesSync(file, 1000 + i, 1000 + i);
    }
  }
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    const button = page.getByRole('button', { name: 'New session', exact: true });
    await expect(button).toBeEnabled();
    const search = await page.locator('#search-open').boundingBox(), create = await button.boundingBox();
    expect(create.x).toBeGreaterThan(search.x + search.width);
    expect(create.y + create.height).toBeLessThanOrEqual(page.viewportSize().height);
    await page.screenshot({ path: testInfo.outputPath('new-session-mobile.png') });
    await button.click();
    const picker = page.getByRole('dialog', { name: 'New session' });
    await expect(picker.locator('.project-option strong')).toHaveText(['Popular', 'Second', 'Third', 'Other']);
    await expect(picker.getByRole('heading', { name: 'Most used' })).toBeVisible();
    await expect(picker.getByRole('heading', { name: 'Other projects' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('project-picker-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: testInfo.outputPath('project-picker-desktop-dark.png') });
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await picker.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('no such project');
    await expect(page.locator('#project-status')).toHaveText('No matching projects.');
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('other');
    await expect(picker.locator('.project-option strong')).toHaveText(['Other']);
    rmSync(join(dir, 'Other'), { recursive: true });
    await picker.locator('.project-option').click();
    await expect(page.locator('#project-status')).not.toHaveText('Starting session…');
    await expect(picker).toBeVisible();
    await expect(page.locator('#project-close')).toBeEnabled();
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('popular');
    await picker.locator('.project-option').click();
    await expect(picker).not.toBeVisible();
    await expect(page.locator('#project-name')).toHaveText('Popular');
    await expect(page.locator('#prompt')).toBeEnabled();
    expect(host.service.live.size).toBe(1); // No saved conversation was resumed or replaced.
    const id = [...host.service.live.keys()][0];
    expect(host.service.read(id).messages).toEqual([]);
    await page.locator('#prompt').fill('A fresh project task');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#transcript')).toContainText('reply: A fresh project task');
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.locator('#sessions .session').filter({ hasText: 'A fresh project task' }).click();
    await expect(page.locator('#transcript')).toContainText('reply: A fresh project task');
    for (const [file, text] of originals) expect(readFileSync(file, 'utf8')).toBe(text);
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await button.click();
    await expect(picker.locator('.project-option').first()).toContainText('Popular');
    await page.keyboard.press('Escape');
    await expect(picker).not.toBeVisible();
    await expect(button).toBeFocused();
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('project list failure can be retried and an empty catalog explains how to add a project', async ({ page }) => {
  let fail = true;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsProjects: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [], total: 0, matched: 0 }));
    } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: !fail, error: 'Project list unavailable', value: [] }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.locator('#project-status')).toHaveText('Project list unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#project-status')).toHaveText('No projects yet. Start Pi in a project on your computer first.');
  await page.getByRole('button', { name: 'Close project picker' }).click();
  await expect(page.locator('#new-session')).toBeFocused();
});
