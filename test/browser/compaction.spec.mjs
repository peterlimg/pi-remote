import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

// Only Pi/model output is simulated; compaction events cross a real RPC child, host and browser socket.
test('compaction explains the wait and clears on retry, cancellation and failure', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-compaction-')), file = join(dir, 'session.jsonl');
  writeFileSync(file, [
    { type: 'session', id: 'compaction', cwd: dir },
    { type: 'session_info', id: 'name', parentId: null, name: 'Compaction notice' }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    const url = `http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`;
    await page.goto(url);
    await page.getByRole('combobox', { name: 'Filter recent sessions' }).selectOption('offline');
    await page.getByRole('button', { name: /Compaction notice/ }).click();
    await page.locator('#resume').click();
    await expect(page.locator('#status')).toHaveText('idle');
    const activity = page.locator('#agent-activity'), label = page.locator('#activity-label');
    const hint = page.locator('#composer-hint'), resultFile = join(dir, 'compaction-result.json');
    for (const outcome of [
      { willRetry: true, aborted: false },
      { willRetry: false, aborted: true },
      { willRetry: false, aborted: false, errorMessage: 'Synthetic summary failed' }
    ]) {
      rmSync(resultFile, { force: true });
      await page.locator('#prompt').fill('hold compaction');
      await page.locator('#send').click();
      await expect(label).toHaveText('Compacting conversation…');
      await expect(activity).toBeVisible();
      await expect(activity).toMatchAriaSnapshot('- status: Compacting conversation…');
      await expect(page.locator('#status')).toHaveText('working');
      await expect(hint).toHaveText('Summarizing earlier messages. New messages will wait.');
      await expect(page.locator('#abort')).toBeVisible();
      await expect(page.locator('#activity-time')).toBeHidden();
      if (outcome.willRetry) {
        await page.reload();
        await page.getByRole('button', { name: /Compaction notice/ }).click();
        await expect(label).toHaveText('Compacting conversation…');
        await page.locator('#prompt').fill('Keep this draft');
        for (const [width, height, colorScheme] of [[320, 568, 'light'], [1280, 900, 'dark']]) {
          await page.setViewportSize({ width, height });
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await activity.scrollIntoViewIfNeeded();
          await expect(activity).toBeVisible();
          await expect(hint).toBeVisible();
          expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
          expect(await page.locator('#composer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
          await page.screenshot({ path: testInfo.outputPath(`compaction-${width}.png`) });
        }
      }
      writeFileSync(resultFile, JSON.stringify(outcome));
      await expect(hint).toBeHidden();
      await expect(page.locator('#status')).toHaveText(outcome.willRetry ? 'working' : 'idle');
      if (outcome.willRetry) {
        await expect(label).not.toHaveText('Compacting conversation…');
        await expect(activity).toBeVisible();
        await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
      } else await expect(activity).toBeHidden();
    }
    await testInfo.attach('compaction-conversation', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
