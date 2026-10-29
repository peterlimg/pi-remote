import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

// Only Pi is simulated. Exercise its current delta-only RPC wire format over a real child process,
// host, browser WebSocket and UI, and require partial text while the response is still unfinished.
test('RPC text and tool arguments reach the phone before the completed message', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-streaming-')), file = join(dir, 'session.jsonl');
  writeFileSync(file, [
    { type: 'session', id: 'streaming', cwd: dir },
    { type: 'session_info', id: 'name', parentId: null, name: 'Streaming reply' }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.getByRole('combobox', { name: 'Filter recent sessions' }).selectOption('offline');
    await page.getByRole('button', { name: /Streaming reply/ }).click();
    await page.locator('#resume').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await page.locator('#prompt').fill('stream response');
    await page.locator('#send').click();
    const replies = page.locator('.message.assistant'), text = replies.first().locator('.message-text');
    await expect(text).toHaveText('Reading');
    await expect(page.locator('#status')).toHaveText('working');
    await expect(page.locator('.task-duration')).toHaveCount(0);
    await expect(page.locator('#transcript')).not.toContainText('Private reasoning');
    await page.screenshot({ path: testInfo.outputPath('partial-reply-mobile.png') });
    await expect(text).toHaveText('Reading the source.');
    await expect(page.locator('#status')).toHaveText('working');
    await expect(text).toHaveText('Read the source.');
    const tool = page.locator('[data-tool-id="stream-read"]');
    await expect(tool).toHaveCount(1);
    await expect(tool.locator('.tool-status')).toHaveText('pending');
    await expect(text).toHaveText('Read the source. Checking the result.');
    await expect(page.locator('#status')).toHaveText('working');
    await expect(tool.locator('.tool-context')).toHaveText('web/app.js');
    await expect(tool.locator('.tool-input')).toContainText('"path": "web/app.js"');
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(text).toHaveText('Read the source. Checked the result.');
    await expect(replies).toHaveCount(2);
    await expect(replies.last()).toContainText('Done.');
    await expect(tool).toHaveCount(1);
    await expect(page.locator('#transcript')).not.toContainText('Private reasoning');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath('completed-reply-desktop.png') });
    // A later legacy full-message response must not append to the previous streaming message.
    await page.locator('#prompt').fill('hello again');
    await page.locator('#send').click();
    await expect(replies.last()).toContainText('reply: hello again');
    await expect(replies).toHaveCount(3);
    await expect(text).toHaveText('Read the source. Checked the result.');
    await testInfo.attach('streaming-conversation', { body: await page.locator('#transcript').ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
