import { test, expect } from '@playwright/test';

// Safari draws a focus ring for scripted focus that Chromium suppresses, so this runs in WebKit.
test.use({ browserName: 'webkit' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const file = { name: 'screenshot.png', mimeType: 'image/png', buffer: png };

test('removing an attachment by tap leaves no focus ring on the attach button', async ({ page }) => {
  const state = { id: 'Alpha', title: 'Alpha', cwd: '/project', status: 'idle', messages: [] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const p = JSON.parse(raw);
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else {
      if (p.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
    }
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Alpha/ }).click();
  const ring = () => page.locator('#attach').evaluate(attach => attach.matches(':has(:focus-visible)'));
  const remove = page.getByRole('button', { name: `Remove ${file.name}` });
  await page.locator('#image-files').setInputFiles(file);
  await remove.tap();
  await expect(page.locator('#image-files')).toBeFocused();
  expect(await ring()).toBe(false);
  await page.locator('#image-files').setInputFiles(file);
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#image-files')).toBeFocused();
  expect(await ring()).toBe(true); // Keyboard users still see where focus went.
});
