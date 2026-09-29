import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

test('inline usage automatically releases the extension and preserves actual agent activity', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-usage-')), file = join(dir, 'usage.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'usage', cwd: dir }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const summary = page.getByRole('article', { name: 'Provider usage' });
    for (const [index, [command, expected]] of [
      ['/usage', 'idle'],
      ['/usage', 'idle'],
      ['/usage-settled', 'idle'],
      ['/usage-working', 'working']
    ].entries()) {
      await page.locator('#prompt').fill(command);
      await page.locator('#send').click();
      await expect(summary).toHaveText(`Weekly limit: ${index + 1}% used · resets tomorrow`);
      await expect(page.locator('#dialog')).toBeHidden();
      await expect(page.locator('#composer-send-status')).toBeHidden({ timeout: 1500 });
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
