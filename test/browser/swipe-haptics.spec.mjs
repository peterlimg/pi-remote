import { test, expect } from '@playwright/test';

test.use({ browserName: 'webkit' });

for (const standalone of [false, true]) {
  test(`Safari's native swipe edge navigates and cancels safely in ${standalone ? 'home-screen' : 'browser'} mode`, async ({ page }, testInfo) => {
    await page.addInitScript(standalone => {
      Object.defineProperty(navigator, 'standalone', { value: standalone });
      window.scriptedSwitchClicks = 0;
      document.addEventListener('click', event => {
        if (event.target.matches('input[switch]:not(#swipe-haptic-input)')) window.scriptedSwitchClicks++;
      }, true);
    }, standalone);
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Project Alpha/ }).tap();
    await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    const edge = page.locator('#swipe-haptic-edge'), input = page.locator('#swipe-haptic-input');
    await expect(edge).toBeVisible();
    await expect(edge).toHaveCSS('opacity', '0');
    await expect(edge).toHaveAttribute('aria-hidden', 'true');
    await expect(input).toHaveJSProperty('tabIndex', -1);
    expect(await input.evaluate(node => node.switch)).toBe(true);
    const bounds = await edge.boundingBox(), y = bounds.y + bounds.height / 2;
    expect(bounds.width).toBe(24);
    expect(await page.evaluate(y => document.elementFromPoint(5, y)?.id, y)).toBe('swipe-haptic-input');
    expect(await page.evaluate(() => window.scriptedSwitchClicks)).toBe(1);

    // Synthetic touches verify navigation/cancellation, not the phone's physical haptic motor.
    for (const kind of ['short', 'vertical', 'multitouch', 'cancel']) {
      await input.evaluate((node, { kind, y }) => {
        const touch = (clientX, clientY = y, identifier = 1) => ({ clientX, clientY, identifier, target: node });
        const fire = (type, touches) => node.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches }));
        fire('touchstart', [touch(5)]);
        if (kind === 'vertical') fire('touchmove', [touch(6, y + 80)]);
        else fire('touchmove', [touch(kind === 'short' ? 50 : 180)]);
        if (kind === 'multitouch') fire('touchstart', [touch(180), touch(200, y, 2)]);
        fire(kind === 'cancel' ? 'touchcancel' : 'touchend', []);
      }, { kind, y });
      await expect(input).toBeEnabled();
      await expect(input).not.toBeChecked();
      await expect(page.locator('#app')).toHaveClass(/viewing/);
      await expect(page.locator('#app')).not.toHaveClass(/swiping/);
      await expect(page.locator('main')).toHaveCSS('transform', 'none');
    }
    const activity = page.locator('#transcript details.tool-activity').first();
    const summary = activity.locator(':scope > summary');
    await summary.evaluate(node => node.scrollIntoView({ block: 'center' }));
    const summaryBounds = await summary.boundingBox(), summaryY = summaryBounds.y + summaryBounds.height / 2;
    expect(summaryBounds.x).toBeLessThan(24);
    expect(summaryY).toBeGreaterThan(bounds.y);
    expect(summaryY).toBeLessThan(bounds.y + bounds.height);
    await page.touchscreen.tap(20, summaryY);
    await expect(activity).toHaveJSProperty('open', true);
    await expect(input).toBeEnabled();
    await input.evaluate((node, y) => {
      const fire = (type, x) => node.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        touches: [{ clientX: x, clientY: y, identifier: 1, target: node }],
      }));
      fire('touchstart', 5); fire('touchmove', 180);
    }, y);
    expect(await page.evaluate(y => document.elementFromPoint(5, y)?.id, y)).toBe('swipe-haptic-input');
    await page.screenshot({ path: testInfo.outputPath('native-swipe-edge.png') });
    await input.evaluate(node => node.dispatchEvent(Object.assign(new Event('touchend', { bubbles: true, cancelable: true }), { touches: [] })));
    await expect(page.locator('#app')).not.toHaveClass(/viewing/);
    await expect(edge).toBeHidden();
    expect(await page.evaluate(() => window.scriptedSwitchClicks)).toBe(1);
    await page.getByRole('button', { name: /Project Beta/ }).tap();
    await expect(page.locator('#transcript')).toContainText('Working on Project Beta');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(edge).toBeHidden();
    await expect(page.locator('#sidebar')).toBeVisible();
  });
}

test('Safari receives a trusted drag on the native switch itself', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).tap();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const input = page.locator('#swipe-haptic-input');
  await input.evaluate(node => node.addEventListener('change', event => { window.nativeSwitchChangeTrusted = event.isTrusted; }));
  const bounds = await page.locator('#swipe-haptic-edge').boundingBox(), y = bounds.y + bounds.height / 2;
  // WebKit's real mouse drag exercises native switch tracking; Playwright cannot send real iOS touch drags.
  await page.mouse.move(5, y); await page.mouse.down();
  await page.mouse.move(180, y, { steps: 8 }); await page.mouse.up();
  await expect(input).toBeChecked();
  expect(await page.evaluate(() => window.nativeSwitchChangeTrusted)).toBe(true);
});

test('non-touch Safari does not get an invisible gesture control', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, isMobile: false, hasTouch: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false);
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
    await expect(page.locator('#swipe-haptic-edge')).toHaveCount(0);
  } finally { await context.close(); }
});
