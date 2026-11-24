import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

test('fast mode button toggles worker status without sending the draft and survives reconnect', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-fast-')), file = join(dir, 'fast.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'fast', cwd: dir }) + '\n' +
    JSON.stringify({ type: 'message', id: 'first', message: { role: 'user', content: 'Check fast mode' } }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)), '--codex'] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const icon = page.getByRole('button', { name: 'Fast mode', exact: true });
    await expect(icon).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#prompt').fill('Unsent draft');
    await icon.tap();
    await expect(page.locator('#prompt')).toHaveValue('Unsent draft');
    await expect(icon).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('fast-mode-mobile.png') });
    await page.reload();
    await page.locator('#sessions button.session').click();
    await expect(icon).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: testInfo.outputPath('fast-mode-desktop-dark.png') });
    await icon.tap();
    await expect(icon).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await page.locator('#sessions button.session').click();
    await expect(icon).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
