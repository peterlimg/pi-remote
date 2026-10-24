// Focused E2E for the throwaway preview, never the user's real host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, expect } from '@playwright/test';
const evidence = mkdtempSync(join(tmpdir(), 'pi-remote-style-preview-'));
const server = spawn(process.execPath, [new URL('../scripts/ui-style-prototype.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit']
});
const stopped = once(server, 'exit');
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview server did not start')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Preview server exited: ' + code)); });
    server.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  for (const path of ['/internal', '/bridge', '/config.json', '/scripts/ui-style-prototype.mjs', '/web/app.js']) {
    assert.equal((await fetch(url + path)).status, 404, path + ' must not be exposed');
  }
  assert.equal(await (await fetch(url + '/app.js')).text(), readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator('#sessions .session')).toHaveCount(8);
  const design = await page.locator('html').getAttribute('data-design');
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('sidebar').scrollWidth <= innerWidth));
  await noOverflow();
  await page.screenshot({ path: join(evidence, 'sessions-phone.png') });
  await page.getByRole('button', { name: 'storefront 2', exact: true }).click();
  await expect(page.locator('#sessions .session')).toHaveCount(2);
  await page.getByRole('button', { name: 'All 8', exact: true }).click();
  await expect(page.locator('#sessions .session')).toHaveCount(8);
  await page.getByRole('button', { name: /Polish the mobile workspace/ }).click();
  await expect(page.locator('#transcript')).toContainText('More room for the conversation.');
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await noOverflow();
  await page.screenshot({ path: join(evidence, 'conversation-phone.png') });
  await page.locator('#prompt').fill('Keep this sample draft');
  await page.locator('#title').click();
  await page.locator('#model').click();
  await expect(page.locator('#picker-options .picker-option')).toHaveCount(3);
  await page.screenshot({ path: join(evidence, 'model-sheet-phone.png') });
  if (design === 'floating') {
    await page.getByRole('button', { name: 'Effort tab', exact: true }).click();
    await expect(page.locator('#picker-title')).toHaveText('Reasoning effort');
    await page.screenshot({ path: join(evidence, 'effort-sheet-phone.png') });
    await page.getByRole('button', { name: 'Model tab', exact: true }).click();
  }
  await page.getByRole('button', { name: /Claude Opus 4.6/ }).click();
  await expect(page.locator('#model-name')).toHaveText('Opus 4.6');
  await expect(page.locator('#prompt')).toHaveValue('Keep this sample draft');
  await page.getByRole('button', { name: 'Next design' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-variant', 'original');
  await expect(page.locator('.prototype-filters')).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue('Keep this sample draft');
  await page.getByRole('button', { name: 'Next design' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-variant', design);
  await page.getByRole('button', { name: /Switch to .* theme/ }).click();
  await page.screenshot({ path: join(evidence, 'conversation-other-theme.png') });
  await page.setViewportSize({ width: 320, height: 720 });
  await noOverflow();
  await page.screenshot({ path: join(evidence, 'conversation-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await noOverflow();
  await page.screenshot({ path: join(evidence, 'workspace-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#prompt').fill('A sample message');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#transcript')).toContainText('Sample reply only.');
  await page.reload();
  await page.getByRole('button', { name: /Polish the mobile workspace/ }).click();
  await expect(page.locator('#model-name')).toHaveText('Sonnet 4.6');
  await expect(page.locator('#transcript')).not.toContainText('A sample message');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.locator('#project-picker')).toBeVisible();
  await page.screenshot({ path: join(evidence, 'project-sheet-phone.png') });
  await page.locator('.project-option').filter({ hasText: 'pi-remote' }).click();
  await expect(page.locator('#title')).toHaveText('New sample session');
  await expect(page.locator('#transcript')).toContainText('No Pi process, model call, or project folder was created.');
  await page.reload();
  await expect(page.locator('#sessions .session')).toHaveCount(8);
  assert.deepEqual(errors, []);
  await context.tracing.stop({ path: join(evidence, 'trace.zip') });
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, design, syntheticDataOnly: true }, null, 2));
  console.log('PASS: filters, conversation, model sheet, draft preservation, original comparison, themes, 320px/390px/desktop, and reset. Evidence: ' + evidence);
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill('SIGTERM');
  await stopped;
}
