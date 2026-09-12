import { test, expect } from '@playwright/test';

const login = '/#token=browser-test-token-only-123456789012345';

test('dragging the composer cannot scroll the page after sending or resizing', async ({ page }) => {
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Long conversation\n'.repeat(80));
  await page.locator('#send').click();
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#transcript')).toContainText('Long conversation');
  const cdp = await page.context().newCDPSession(page);
  const drag = async (selector, distance) => {
    const box = await page.locator(selector).boundingBox();
    const x = box.x + box.width / 2;
    const y = Math.min(box.y + box.height / 2, page.viewportSize().height - 10);
    // Synthetic scroll gestures differ on Linux. Send the same touch path on every OS.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      // Slow down before release so momentum cannot leak into the next assertion.
      const offset = distance * (1 - (1 - step / 12) ** 3);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + offset }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (const height of [220, 844, 220, 844]) {
    await page.setViewportSize({ width: 390, height });
    await page.evaluate(() => scrollTo(0, 0));
    await drag('.composer-actions', -120);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const composer = await page.locator('#composer').boundingBox();
    expect(composer.y + composer.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
  }
  await page.locator('#transcript').evaluate(node => { node.scrollTop = 0; });
  await drag('#transcript', -150);
  await expect.poll(() => page.locator('#transcript').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const before = await page.locator('#transcript').evaluate(node => node.scrollTop);
  await drag('.composer-actions', -120);
  expect(await page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(before);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#prompt').fill('Scrollable draft\n'.repeat(20));
  await page.locator('#prompt').evaluate(node => { node.scrollTop = 0; });
  await drag('#prompt', -120);
  await expect.poll(() => page.locator('#prompt').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#prompt').fill('');
  await page.screenshot({ path: 'test-results/scroll-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.screenshot({ path: 'test-results/scroll-desktop.png' });
});

test('the app follows keyboard viewport changes without resizing the document', async ({ page }) => {
  // Desktop automation has no iOS keyboard. Exercise its visual viewport events separately.
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: innerHeight, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.changeViewport = (values, event = 'resize') => {
      Object.assign(viewport, values);
      viewport.dispatchEvent(new Event(event));
    };
  });
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Send with the keyboard open');
  await page.evaluate(() => window.changeViewport({ height: 350 }));
  await expect.poll(() => page.locator('#app').evaluate(node => node.getBoundingClientRect().height)).toBe(350);
  await page.evaluate(() => window.changeViewport({ offsetTop: 40 }, 'scroll'));
  expect((await page.locator('#app').boundingBox()).y).toBe(40);
  const composer = await page.locator('#composer').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(390);
  await page.locator('#send').click();
  await expect(page.locator('#prompt')).toHaveValue('');
  await page.evaluate(() => window.changeViewport({ height: 175, offsetTop: 90, scale: 2 }));
  expect((await page.locator('#app').boundingBox()).height).toBe(350);
  expect((await page.locator('#app').boundingBox()).y).toBe(40);
  await page.evaluate(() => window.changeViewport({ height: innerHeight, offsetTop: 0, scale: 1 }));
  await expect.poll(() => page.locator('#app').evaluate(node => node.getBoundingClientRect().top)).toBe(0);
  expect((await page.locator('#app').boundingBox()).height).toBe(page.viewportSize().height);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#back').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.locator('#logout').click();
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('static');
});
