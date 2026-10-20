import { test, expect } from '@playwright/test';

test('image viewer supports full-screen zoom, pan and pull-down dismissal', async ({ page, context, browserName }, info) => {
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
  await touch('touchMove', [[center.x + 60, center.y + 120]]);
  await touch('touchEnd', []);
  expect((await image.boundingBox()).x).toBeCloseTo(magnified.x + 60);
  expect((await image.boundingBox()).y).toBeCloseTo(magnified.y + 120);
  await expect(viewer).toBeVisible();
  await page.screenshot({ path: info.outputPath('zoomed-mobile.png') });
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchCancel', []);
  await touch('touchStart', [[center.x - 160, center.y], [center.x + 160, center.y]]);
  await touch('touchMove', [[center.x - 40, center.y], [center.x + 40, center.y]]);
  await touch('touchEnd', []);
  await expect(zoom).toHaveText('100%');
  await expect.poll(() => image.boundingBox()).toEqual(initial);
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchMove', [[center.x, center.y + 160]]);
  await page.screenshot({ path: info.outputPath('pull-down-mobile.png') });
  await touch('touchEnd', []);
  await expect(viewer).toBeHidden();
  await page.getByRole('link', { name: 'Open landscape.png' }).tap();
  await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  for (const [label, dx, dy, end] of [
    ['short pull', 0, 40, 'touchEnd'], ['canceled pull', 0, 160, 'touchCancel'], ['sideways drag', 120, 100, 'touchEnd']
  ]) await test.step(label, async () => {
    await touch('touchStart', [[center.x, center.y]]);
    await touch('touchMove', [[center.x + dx, center.y + dy]]);
    await expect.poll(async () => (await viewer.boundingBox()).y).toBe(dx ? 0 : dy);
    await touch(end, []);
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });
  await touch('touchStart', [[center.x - 40, center.y]]);
  await touch('touchMove', [[center.x - 40, center.y + 100]]);
  await touch('touchStart', [[center.x - 40, center.y + 100], [center.x + 40, center.y + 100]]);
  await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await touch('touchMove', [[center.x - 80, center.y + 100], [center.x + 80, center.y + 100]]);
  await touch('touchEnd', []);
  await expect(viewer).toBeVisible();
  await expect(zoom).toHaveText('200%');
  await zoom.tap();
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
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchMove', [[center.x, center.y - 40]]);
  await touch('touchEnd', []);
  expect((await image.boundingBox()).y).toBeCloseTo(bounds.y - 40);
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchMove', [[center.x, center.y + 120]]);
  await touch('touchEnd', []);
  await expect(viewer).toBeVisible(); // Returning to the top pans, rather than dismissing mid-gesture.
  expect((await image.boundingBox()).y).toBeCloseTo(bounds.y);
  await touch('touchStart', [[center.x, center.y]]);
  await touch('touchMove', [[center.x, center.y + 160]]);
  await touch('touchEnd', []);
  await expect(viewer).toBeHidden();
  await page.getByRole('link', { name: 'Open portrait.png' }).tap();
  await expect.poll(() => viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await zoom.tap();
  await expect(zoom).toHaveText('100%');
  await cdp?.detach();
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

for (const [width, height] of [[1280, 900], [800, 800], [390, 1688]]) test(`${width}x${height} images open at phone width without horizontal cropping`, async ({ page }, info) => {
  await page.setViewportSize({ width, height });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const screenshot = await page.screenshot();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#image-files').setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: screenshot });
  const open = page.getByRole('link', { name: 'Open screenshot.png' });
  await open.tap();
  const viewer = page.getByRole('dialog', { name: 'Image', exact: true });
  const image = viewer.getByRole('img'), zoom = viewer.getByRole('button', { name: 'Reset image zoom' });
  await expect(image).toHaveCSS('object-fit', 'contain');
  const frame = await viewer.locator('.image-stage').boundingBox();
  // Measure the actual image pixels, not the full-size img element's letterboxing.
  const imageBounds = () => image.evaluate(img => {
    const box = img.parentElement.getBoundingClientRect(), transform = new DOMMatrix(getComputedStyle(img).transform);
    const fit = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const width = img.naturalWidth * fit * transform.a, height = img.naturalHeight * fit * transform.d;
    return { x: box.x + (box.width - width) / 2 + transform.e, y: box.y + (box.height - height) / 2 + transform.f, width, height };
  });
  await expect.poll(async () => (await imageBounds()).width).toBeCloseTo(frame.width, 1);
  const initial = await imageBounds();
  expect(initial.x).toBeCloseTo(frame.x, 1);
  expect(initial.x + initial.width).toBeCloseTo(frame.x + frame.width, 1);
  expect(initial.y).toBeCloseTo(frame.y + Math.max(0, (frame.height - initial.height) / 2), 1);
  await page.screenshot({ path: info.outputPath('fit-width-mobile.png') });
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).tap();
  await expect.poll(async () => (await imageBounds()).width).toBeCloseTo(frame.width * 2, 1);
  await zoom.tap();
  await expect(zoom).toHaveText('100%');
  const fitted = await imageBounds();
  expect(fitted.width).toBeLessThanOrEqual(frame.width + 1);
  expect(fitted.height).toBeLessThanOrEqual(frame.height + 1);
  await viewer.getByRole('button', { name: 'Close image' }).tap();
  await open.tap();
  await expect.poll(async () => (await imageBounds()).width).toBeCloseTo(frame.width, 1);
  expect((await imageBounds()).x).toBeCloseTo(frame.x, 1);
  await viewer.getByRole('button', { name: 'Close image' }).tap();
  await page.setViewportSize({ width: 1280, height: 900 });
  await open.click();
  await expect(zoom).toHaveText('100%');
  const desktopFrame = await viewer.locator('.image-stage').boundingBox(), desktop = await imageBounds();
  expect(desktop.width).toBeLessThanOrEqual(desktopFrame.width + 1);
  expect(desktop.height).toBeLessThanOrEqual(desktopFrame.height + 1);
  await page.screenshot({ path: info.outputPath('fit-image-desktop.png') });
  await info.attach('fit-width-image-viewer', { body: await viewer.ariaSnapshot(), contentType: 'text/plain' });
});
