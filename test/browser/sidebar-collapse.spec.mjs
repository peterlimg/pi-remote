import { test, expect } from '@playwright/test';

test('horizontal conversation swipes toggle Sessions without changing the draft', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Keep this draft');
  const toggle = page.locator('#sidebar-toggle');
  const cdp = browserName === 'chromium' && await page.context().newCDPSession(page);
  const swipe = async (dx, dy, canceled = false) => {
    const { x, y, width } = await page.locator('#transcript').boundingBox();
    const start = { x: Math.round(x + width - 10), y: Math.round(y + 130) };
    if (dx > 0) start.x = Math.round(x + 12);
    const end = { x: start.x + dx, y: start.y + dy };
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      await cdp.send('Input.dispatchTouchEvent', { type: canceled ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    } else await page.evaluate(({ start, end, canceled }) => {
      const target = document.elementFromPoint(start.x, start.y);
      for (const [type, point] of [['touchstart', start], ['touchmove', end], [canceled ? 'touchcancel' : 'touchend', end]]) {
        const touch = { clientX: point.x, clientY: point.y };
        target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          touches: /end|cancel/.test(type) ? [] : [touch], changedTouches: [touch]
        }));
      }
    }, { start, end, canceled });
  };
  for (const args of [[-30, 0], [-80, 70], [-100, 0, true]]) {
    await swipe(...args);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await swipe(-100, 0);
  await expect(page.locator('#sidebar')).toBeHidden();
  await swipe(100, 0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#title')).toHaveText('Project Alpha');
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
});

for (const [width, height] of [[744, 1133], [1133, 744], [844, 390], [568, 320]]) {
  test(`sessions and chat stay usable side by side at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width === 568 ? 'reduce' : 'no-preference' });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    const sidebar = page.locator('#sidebar'), toggle = page.locator('#sidebar-toggle');
    const main = page.locator('main'), prompt = page.locator('#prompt');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const rail = await sidebar.boundingBox(), button = await toggle.boundingBox(), chat = await main.boundingBox();
    expect(button.x + button.width).toBeLessThanOrEqual(rail.x + rail.width);
    expect(button.width).toBe(44);
    expect(chat.x).toBeCloseTo(rail.x + rail.width, 0);
    expect(chat.x + chat.width).toBeCloseTo(width, 0);
    await prompt.fill('Keep this draft');
    await expect(prompt).toBeFocused();
    await expect(sidebar).toBeVisible();
    const send = await page.locator('#send').boundingBox();
    expect(send.x + send.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath('split.png') });
    await page.getByRole('button', { name: /Project Beta/ }).click();
    await expect(page.locator('#title')).toHaveText('Project Beta');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(prompt).toHaveValue('Keep this draft');
    await toggle.press('Enter');
    await expect(sidebar).toBeHidden();
    await expect(sidebar).toHaveAttribute('inert', '');
    await expect(toggle.locator('path')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -3, 0)');
    expect(await toggle.evaluate(node => getComputedStyle(node, '::after').backgroundImage !== 'none')).toBe(width !== 568);
    if (width === 568) await expect(toggle.locator('path')).toHaveCSS('transition-duration', '0s');
    await expect.poll(async () => (await main.boundingBox()).width).toBe(width);
    await toggle.press('Enter');
    await expect.poll(async () => (await main.boundingBox()).x).toBe(chat.x);
    await expect(toggle.locator('path')).toHaveCSS('transform', 'none');
    await expect(prompt).toHaveValue('Keep this draft');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toBeHidden();
    await expect(sidebar).toBeHidden();
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await expect(sidebar).toBeVisible();
  });
}
