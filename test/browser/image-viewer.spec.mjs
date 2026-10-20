import { test, expect } from '@playwright/test';

test('image viewer fills the screen and supports zooming and panning without dismissing', async ({ page, context, browserName }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const landscape = await page.screenshot();
  await page.setViewportSize({ width: 390, height: 844 });
  const portrait = await page.screenshot();
  await page.locator('#image-files').setInputFiles([
    { name: 'landscape.png', mimeType: 'image/png', buffer: landscape },
    { name: 'portrait.png', mimeType: 'image/png', buffer: portrait }
  ]);
  await page.getByRole('link', { name: 'Open landscape.png' }).tap();
  const viewer = page.getByRole('dialog', { name: 'Image', exact: true });
  const image = viewer.getByRole('img');
  await expect(image).toBeVisible();
  await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  const stage = viewer.locator('.image-stage');
  const zoom = viewer.getByRole('button', { name: 'Reset image zoom' });
  await zoom.tap();
  await expect(zoom).toHaveText('100%');
  const initial = await image.boundingBox();
  await expect(viewer.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).tap();
  await expect(zoom).toHaveText('200%');
  expect((await image.boundingBox()).width).toBeCloseTo(initial.width * 2);
  await zoom.tap();

  const bounds = await stage.boundingBox();
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  // Chromium sends real multi-touch input; WebKit's automation exposes only synthetic pointers.
  const cdp = browserName === 'chromium' ? await context.newCDPSession(page) : undefined;
  const touch = async (type, points) => {
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    else await stage.evaluate((node, { type, points }) => {
      const previous = window.viewerTouches || [];
      const kind = { touchStart: 'pointerdown', touchMove: 'pointermove', touchEnd: 'pointerup', touchCancel: 'pointercancel' }[type];
      for (const [id, [x, y]] of (type === 'touchEnd' || type === 'touchCancel' ? previous : points).entries()) {
        node.dispatchEvent(new PointerEvent(kind, { pointerId: id + 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
      }
      window.viewerTouches = points;
    }, { type, points });
  };
  await touch('touchStart', [[center.x - 40, center.y], [center.x + 40, center.y]]);
  await touch('touchMove', [[center.x - 160, center.y], [center.x + 160, center.y]]);
  await touch('touchEnd', []);
  await expect(zoom).toHaveText('400%');
  await expect(viewer).toBeVisible();
  const magnified = await image.boundingBox();
  expect(magnified.width).toBeCloseTo(initial.width * 4);
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchMove', [[center.x + 60, center.y + 40]]);
  await touch('touchEnd', []);
  expect((await image.boundingBox()).x).toBeCloseTo(magnified.x + 60);
  expect((await image.boundingBox()).y).toBeCloseTo(magnified.y + 40);
  await expect(viewer).toBeVisible();
  await page.screenshot({ path: info.outputPath('zoomed-mobile.png') });
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchCancel', []);
  await touch('touchStart', [[center.x - 160, center.y], [center.x + 160, center.y]]);
  await touch('touchMove', [[center.x - 40, center.y], [center.x + 40, center.y]]);
  await touch('touchEnd', []);
  await expect(zoom).toHaveText('100%');
  await expect.poll(() => image.boundingBox()).toEqual(initial);
  await cdp?.detach();
  await stage.tap();
  await expect(viewer).toBeVisible();
  await stage.dblclick();
  await expect(zoom).toHaveText('200%');
  await stage.dblclick();
  await expect(zoom).toHaveText('100%');
  await page.screenshot({ path: info.outputPath('fit-mobile.png') });

  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.keyboard.press('-');
  await expect(zoom).toHaveText('100%');
  await page.keyboard.press('+');
  await expect(zoom).toHaveText('200%');
  await page.keyboard.press('0');
  await expect(zoom).toHaveText('100%');
  for (let i = 0; i < 4; i++) await page.keyboard.press('+');
  await expect(zoom).toHaveText('800%');
  await expect(viewer.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Close image' }).tap();
  await expect(viewer).toBeHidden();
  await page.getByRole('link', { name: 'Open portrait.png' }).tap();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalHeight > img.naturalWidth)).toBe(true);
  await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect.poll(async () => Math.abs((await image.boundingBox()).y - (await stage.boundingBox()).y)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath('portrait-mobile.png') });
  await zoom.tap();
  await expect(zoom).toHaveText('100%');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 900 });
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const beforeDrag = await image.boundingBox();
  const desktopStage = await stage.boundingBox();
  await page.mouse.move(desktopStage.width / 2, desktopStage.y + desktopStage.height / 2);
  await page.mouse.down();
  await page.mouse.move(desktopStage.width / 2 + 50, desktopStage.y + desktopStage.height / 2 + 50);
  await page.mouse.up();
  expect((await image.boundingBox()).y).toBeCloseTo(beforeDrag.y + 50);
  await expect(viewer).toBeVisible();
  await page.screenshot({ path: info.outputPath('zoomed-desktop.png') });
  await info.attach('image-viewer', { body: await viewer.ariaSnapshot(), contentType: 'text/plain' });
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  expect(errors).toEqual([]);
});

test('desktop screenshots open at a readable size on phones with whole-image fit still available', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  const loginWidth = (await page.locator('#login').boundingBox()).width;
  const screenshot = await page.screenshot();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#image-files').setInputFiles({ name: 'desktop-login.png', mimeType: 'image/png', buffer: screenshot });
  await page.getByRole('link', { name: 'Open desktop-login.png' }).tap();
  const viewer = page.getByRole('dialog', { name: 'Image', exact: true });
  const image = viewer.getByRole('img');
  const displayedLoginWidth = () => image.evaluate((img, fraction) => {
    const stage = img.parentElement;
    const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
    return img.naturalWidth * fit * new DOMMatrix(getComputedStyle(img).transform).a * fraction;
  }, loginWidth / 1280);
  await expect.poll(displayedLoginWidth).toBeGreaterThanOrEqual(390 * .8);
  await expect(viewer.getByRole('button', { name: 'Zoom out', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('readable-default-mobile.png') });
  await viewer.getByRole('button', { name: 'Reset image zoom' }).tap();
  await expect(viewer.getByRole('button', { name: 'Reset image zoom' })).toHaveText('100%');
  await expect.poll(displayedLoginWidth).toBeCloseTo(loginWidth * 390 / 1280);
  await page.screenshot({ path: info.outputPath('whole-screenshot-mobile.png') });
  await viewer.getByRole('button', { name: 'Close image' }).tap();
  await page.getByRole('link', { name: 'Open desktop-login.png' }).tap();
  await expect.poll(displayedLoginWidth).toBeGreaterThanOrEqual(390 * .8);
  await viewer.getByRole('button', { name: 'Close image' }).tap();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: 'Open desktop-login.png' }).click();
  await expect(viewer.getByRole('button', { name: 'Reset image zoom' })).toHaveText('100%');
  await info.attach('readable-image-viewer', { body: await viewer.ariaSnapshot(), contentType: 'text/plain' });
});
