import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

// Real host, sockets and RPC process; no model provider or production host.
test('phone reopens its session after restart and can send, attach and approve', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-phone-restart-'));
  const config = loadConfig(dir), file = join(dir, 'session.jsonl');
  writeFileSync(file, [
    { type: 'session', id: 'phone', cwd: dir },
    { type: 'session_info', id: 'name', parentId: null, name: 'Restart test' }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const options = { dir, config, roots: [dir],
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } };
  let host = await startHost({ ...options, port: 0 });
  try {
    config.port = host.http.address().port;
    await page.goto(`http://127.0.0.1:${config.port}/#token=${config.clientToken}`);
    await page.getByRole('button', { name: /Restart test/ }).click();
    await expect(page.locator('#resume')).toBeEnabled();
    await page.locator('#resume').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await host.close();
    host = await startHost(options);
    await page.reload();
    await page.getByRole('button', { name: /Restart test/ }).click();
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#resume')).toBeHidden();
    await expect(page.locator('#composer-hint')).toBeHidden();
    await page.locator('#prompt').fill('hello after restart');
    await page.locator('#send').click();
    await expect(page.locator('#transcript')).toContainText('reply: hello after restart');
    await page.locator('#prompt').fill('image after restart');
    await page.locator('#image-files').setInputFiles({ name: 'pixel.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
    await expect(page.locator('#attachments img')).toHaveCount(1);
    await page.locator('#send').click();
    await expect(page.locator('#transcript')).toContainText('reply: image after restart');
    await expect(page.locator('#attachments')).toBeHidden();
    await page.locator('#prompt').fill('ask');
    await page.locator('#send').click();
    await page.locator('#dialog').getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('dialog answered');
    await expect(page.locator('#dialog')).toBeHidden();
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
