import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

test('closing usage reflects actual agent activity over the real host and RPC connection', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-usage-')), file = join(dir, 'usage.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'usage', cwd: dir }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const panel = page.getByRole('region', { name: 'Provider usage' });
    for (const [command, dismissal, expected] of [
      ['/usage', 'Close dialog', 'idle'],
      ['/usage', 'Escape', 'idle'],
      ['/usage-settled', 'Close dialog', 'idle'],
      ['/usage-working', 'Close dialog', 'working']
    ]) {
      await page.locator('#prompt').fill(command);
      await page.locator('#send').click();
      await expect(panel).toBeVisible();
      await expect(page.locator('#composer-send-status')).toBeHidden({ timeout: 1500 });
      await expect(page.locator('#status')).toHaveText('waiting');
      await expect(page.locator('#agent-activity')).toBeHidden();
      if (command === '/usage') {
        await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
      }
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await panel.getByRole('button', { name: dismissal, exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page.locator('#status')).toHaveText(expected, { timeout: 1500 });
      if (expected === 'idle') {
        await expect(page.locator('#agent-activity')).toBeHidden();
        await expect(page.locator('#abort')).toBeHidden();
        await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Type / for commands');
      } else {
        await expect(page.locator('#agent-activity')).toBeVisible();
        await expect(page.locator('#abort')).toBeVisible();
      }
    }
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
