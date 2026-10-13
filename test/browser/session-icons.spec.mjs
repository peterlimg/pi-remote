import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('session icons detect reviews, stay separate from status and support persistent per-session overrides', async ({ page }, testInfo) => {
  const states = [
    { id: 'review', title: 'Review betting legacy removal PR #28', status: 'waiting', cwd: '/projects/primezero', updatedAt: Date.now(), preview: 'Which branch should I review?', previewRole: 'assistant', messages: [] },
    { id: 'normal', title: 'Add session icons for PR review', status: 'idle', cwd: '/projects/pi-remote', updatedAt: Date.now() - 1000, messages: [] },
    { id: 'saved', title: 'Code review for PZ-731', status: 'saved', cwd: '/projects/primezero', updatedAt: Date.now() - 2000, messages: [] },
  ];
  let client;
  const publish = () => client.send(JSON.stringify({ type: 'sessions', sessions: states }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' })); publish();
      } else {
        if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(s => s.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  const review = page.locator('.session', { hasText: states[0].title });
  const normal = page.locator('.session', { hasText: states[1].title });
  const saved = page.locator('.session', { hasText: states[2].title });
  await expect(review.getByRole('img', { name: 'PR review', exact: true })).toBeVisible();
  await expect(saved.getByRole('img', { name: 'PR review', exact: true })).toBeVisible();
  await expect(normal.locator('.session-type-icon')).toHaveCount(0);
  await expect(review.locator('.session-icon')).toHaveAttribute('data-status', 'waiting');
  const statusBox = await review.locator('.session-icon').boundingBox();
  const typeBox = await review.locator('.session-type-icon').boundingBox();
  expect(typeBox.y).toBeGreaterThanOrEqual(statusBox.y + statusBox.height);
  expect(typeBox.width).toBe(16);
  await page.screenshot({ path: testInfo.outputPath('icons-mobile.png') });
  await writeFile(testInfo.outputPath('icons-mobile.aria.txt'), await page.locator('body').ariaSnapshot());

  const openSettings = async row => {
    await row.click();
    await page.getByLabel('Session details', { exact: true }).click();
  };
  const choice = page.getByLabel('Session icon', { exact: true });
  await openSettings(review);
  await choice.selectOption('none');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(review.locator('.session-type-icon')).toHaveCount(0);
  await page.reload();
  await expect(review.locator('.session-type-icon')).toHaveCount(0);
  await openSettings(review);
  await expect(choice).toHaveValue('none');
  await choice.selectOption('auto');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(review.getByRole('img', { name: 'PR review', exact: true })).toBeVisible();

  await openSettings(normal);
  await expect(choice).toHaveValue('auto');
  await choice.selectOption('review');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(normal.getByRole('img', { name: 'PR review', exact: true })).toBeVisible();
  await openSettings(normal);
  await choice.selectOption('custom');
  await page.getByLabel('Emoji', { exact: true }).fill('👩🏽‍💻');
  await page.screenshot({ path: testInfo.outputPath('icon-settings-mobile.png') });
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(normal.locator('.session-type-icon')).toHaveText('👩🏽‍💻');
  publish(); // Live list replacements must retain the device's choice.
  await expect(normal.locator('.session-type-icon')).toHaveText('👩🏽‍💻');
  await page.reload();
  await expect(normal.locator('.session-type-icon')).toHaveText('👩🏽‍💻');
  await expect(review.locator('.session-type-icon')).toHaveAttribute('aria-label', 'PR review');
  await openSettings(normal);
  await expect(choice).toHaveValue('custom');
  await expect(page.getByLabel('Emoji', { exact: true })).toHaveValue('👩🏽‍💻');
  await page.getByLabel('Emoji', { exact: true }).fill('🔎🐛');
  await expect(page.getByLabel('Emoji', { exact: true })).toHaveValue('🔎');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(normal.locator('.session-type-icon')).toHaveText('🔎');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(normal);
  await expect(page.locator('.session-details')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('icons-desktop-dark.png') });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.locator('.session-details').evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.x >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-session-icons'))).toBeNull();
});
