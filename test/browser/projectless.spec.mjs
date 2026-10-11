import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

test('a session started without a project sends its first message', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-projectless-')), config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [join(dir, 'sessions')], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.getByRole('button', { name: 'New session' }).tap();
    await page.getByRole('button', { name: 'Start without a project' }).tap();
    await page.locator('#prompt').fill('hello');
    await page.locator('#send').click();
    await expect(page.locator('#transcript')).toContainText('reply: hello');
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
