import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

test('fast mode indicator follows worker status, survives reconnect and disappears when disabled', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-fast-')), file = join(dir, 'fast.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'fast', cwd: dir }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const icon = page.getByRole('img', { name: 'Fast mode enabled' });
    await expect(icon).toBeHidden();
    await page.locator('#prompt').fill('/fast');
    await page.locator('#send').click();
    await expect(icon).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fast-mode-mobile.png') });
    await page.reload();
    await page.locator('#sessions button.session').click();
    await expect(icon).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: testInfo.outputPath('fast-mode-desktop-dark.png') });
    await page.locator('#prompt').fill('/fast');
    await page.locator('#send').click();
    await expect(icon).toBeHidden();
    await page.reload();
    await page.locator('#sessions button.session').click();
    await expect(icon).toBeHidden();
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
