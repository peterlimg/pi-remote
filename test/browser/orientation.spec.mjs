import { test, expect } from '@playwright/test';

const login = '/#token=browser-test-token-only-123456789012345';

test('rotating vertical to horizontal and back preserves layout, bounds, and navigation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const app = page.locator('#app'), sidebar = page.locator('#sidebar'), main = page.locator('main');
  const prompt = page.locator('#prompt'), toggle = page.locator('#sidebar-toggle'), back = page.locator('#back');

  await prompt.fill('Draft across rotations');
  expect(await app.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });

  // Vertical -> horizontal (split view).
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await expect(sidebar).toBeVisible();
  await expect(toggle).toBeVisible();
  await expect(back).toBeHidden();
  await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  const landscapeRail = await sidebar.boundingBox(), landscapeMain = await main.boundingBox();
  expect(landscapeMain.x).toBeCloseTo(landscapeRail.x + landscapeRail.width, 0);
  expect(landscapeMain.x + landscapeMain.width).toBeCloseTo(844, 0);
  await expect(page.locator('#composer')).toBeInViewport();
  await expect(prompt).toHaveValue('Draft across rotations');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Collapse sidebar in horizontal, then rotate back to vertical.
  await toggle.click();
  await expect(sidebar).toBeHidden();
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect.poll(async () => (await main.boundingBox()).width).toBe(844);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await expect(toggle).toBeHidden();
  await expect(back).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expect(sidebar).not.toHaveAttribute('inert', '');
  await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(await main.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(page.locator('#composer')).toBeInViewport();
  await expect(prompt).toHaveValue('Draft across rotations');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Return to sessions in vertical, then turn horizontal again: sessions must not stay collapsed.
  await back.click();
  await expect(sidebar).toBeVisible();
  expect(await sidebar.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('iOS orientation glitches (sub-1 scale, stale offsets, delayed settling, mid-swipe rotate) recover cleanly', async ({ page }) => {
  await page.addInitScript(({ width, height }) => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width, height, offsetLeft: 0, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.setMockViewport = (values, event) => {
      Object.assign(viewport, values);
      if (event) viewport.dispatchEvent(new Event(event));
    };
  }, { width: 390, height: 844 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);

  const app = page.locator('#app'), main = page.locator('main');

  // Landscape -> portrait on iOS Safari can momentarily report scale < 1 and stale horizontal/vertical offsets.
  await page.evaluate(() => window.setMockViewport({ width: 844, height: 390, offsetLeft: 120, offsetTop: 260, scale: 0.46 }, 'resize'));
  expect(await app.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(page.locator('#composer')).toBeInViewport();

  // A transient >1 rotation scale that settles after orientationchange without another visualViewport resize must recover.
  await page.evaluate(() => window.setMockViewport({ width: 195, height: 390, offsetLeft: 40, offsetTop: 90, scale: 2 }, 'resize'));
  expect((await app.boundingBox()).width).toBe(195);
  await page.evaluate(() => {
    window.setMockViewport({ width: 390, height: 844, offsetLeft: 0, offsetTop: 0, scale: 1 });
    window.dispatchEvent(new Event('orientationchange'));
  });
  await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', '');

  // Rotating while an edge swipe is mid-drag must cancel the drag and restore split view cleanly.
  await page.evaluate(() => {
    const target = document.querySelector('main');
    const touch = x => [{ identifier: 1, target, clientX: x, clientY: 300 }];
    for (const [type, x] of [['touchstart', 5], ['touchmove', 20], ['touchmove', 120]]) {
      target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        touches: touch(x), changedTouches: touch(x),
      }));
    }
  });
  await expect(app).toHaveClass(/swiping/);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    window.setMockViewport({ width: 844, height: 390, offsetLeft: 0, offsetTop: 0, scale: 1 });
    window.dispatchEvent(new Event('orientationchange'));
  });
  await expect(app).not.toHaveClass(/swiping/);
  await expect(main).toHaveCSS('transform', 'none');
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect.poll(() => app.boundingBox()).toEqual({ x: 0, y: 0, width: 844, height: 390 });
});
