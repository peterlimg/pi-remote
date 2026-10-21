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
  const typeBox = await review.locator('.session-project .session-type-icon').boundingBox();
  const metaBox = await review.locator('.session-meta').boundingBox();
  expect(Math.abs(typeBox.y + typeBox.height / 2 - metaBox.y - metaBox.height / 2)).toBeLessThanOrEqual(1);
  expect(typeBox.width).toBe(16);
  await page.screenshot({ path: testInfo.outputPath('icons-mobile.png') });
  await writeFile(testInfo.outputPath('icons-mobile.aria.txt'), await page.locator('body').ariaSnapshot());

  const picker = page.getByRole('dialog', { name: 'Session icon', exact: true });
  const openSettings = async row => {
    await row.click();
    await page.getByLabel('Session details', { exact: true }).click();
    await expect(page.locator('.session-details input, .session-details select')).toHaveCount(0);
    expect((await page.locator('.session-details').boundingBox()).height).toBeLessThan(160);
    await page.getByRole('button', { name: /^Session icon / }).click();
    await expect(picker).toBeVisible();
    await expect(page.getByLabel('Emoji', { exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
  };
  const backToList = async () => {
    if (await picker.isVisible()) await picker.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Show sessions' }).click();
  };
  await openSettings(review);
  await page.screenshot({ path: testInfo.outputPath('icon-picker-mobile.png') });
  await picker.getByRole('button', { name: 'None', exact: true }).click();
  await backToList();
  await expect(review.locator('.session-type-icon')).toHaveCount(0);
  await page.reload();
  await expect(review.locator('.session-type-icon')).toHaveCount(0);
  await openSettings(review);
  await expect(picker.getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: 'Automatic', exact: true }).click();
  await backToList();
  await expect(review.getByRole('img', { name: 'PR review', exact: true })).toBeVisible();

  await openSettings(normal);
  await expect(picker.getByRole('button', { name: 'Automatic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: 'PR review', exact: true }).click();
  await backToList();
  await expect(normal.getByRole('img', { name: 'PR review', exact: true })).toBeVisible();
  await openSettings(normal);
  await picker.getByRole('button', { name: 'Star', exact: true }).tap();
  await expect(picker.getByRole('button', { name: 'Star', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('button', { name: 'Star', exact: true })).toHaveCSS('font-size', '24px');
  await expect(page.getByLabel('Emoji', { exact: true })).toBeHidden();
  await backToList();
  await expect(normal.locator('.session-project .session-type-icon')).toHaveText('⭐');
  await expect(normal.locator('.session-type-icon')).toHaveCSS('font-size', '12px');
  await page.screenshot({ path: testInfo.outputPath('small-list-emoji.png') });
  await openSettings(normal);
  await picker.getByRole('button', { name: /Other emoji/ }).click();
  await page.getByLabel('Emoji', { exact: true }).fill('👩🏽‍💻');
  // The first version never checked the reduced viewport when the iPhone keyboard opens.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { value: 360, configurable: true });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(picker.getByRole('button', { name: 'Use emoji', exact: true })).toBeInViewport();
  await expect(picker.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('icon-picker-keyboard-viewport.png') });
  await picker.getByRole('button', { name: 'Use emoji', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel('Session details', { exact: true })).toBeFocused();
  await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
  await backToList();
  await expect(normal.locator('.session-type-icon')).toHaveText('👩🏽‍💻');
  publish(); // Live list replacements must retain the device's choice.
  await expect(normal.locator('.session-type-icon')).toHaveText('👩🏽‍💻');
  await page.reload();
  await expect(normal.locator('.session-type-icon')).toHaveText('👩🏽‍💻');
  await expect(review.locator('.session-type-icon')).toHaveAttribute('aria-label', 'PR review');
  await openSettings(normal);
  await picker.getByRole('button', { name: /Other emoji/ }).click();
  await expect(page.getByLabel('Emoji', { exact: true })).toHaveValue('👩🏽‍💻');
  await page.getByLabel('Emoji', { exact: true }).fill('🔎🐛');
  await picker.getByRole('button', { name: 'Use emoji', exact: true }).click();
  await backToList();
  await expect(normal.locator('.session-type-icon')).toHaveText('🔎');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(normal);
  await expect(picker.getByRole('button', { name: 'Research', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('icons-desktop-dark.png') });
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await page.getByLabel('Session details', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('icon-menu-desktop-dark.png') });
  await page.getByRole('button', { name: /^Session icon / }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.locator('.icon-sheet').evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.x >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  await page.mouse.click(10, 10); // Tap outside the sheet.
  await expect(picker).toBeHidden();
  await backToList();
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-session-icons'))).toBeNull();
});
