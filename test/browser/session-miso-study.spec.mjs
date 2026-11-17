import { test, expect } from '@playwright/test';

test('Miso drawing study changes poses and expressions without changing live avatars', async ({ page, browserName }, info) => {
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  const activate = async control => {
    if (browserName === 'webkit') { await control.focus(); await page.keyboard.press('Enter'); }
    else await control.click();
  };
  const drawing = node => node.innerHTML;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto('/session-motion-prototype.html?study=miso');
  await expect(page.getByRole('heading', { name: 'Miso, redrawn' })).toBeVisible();
  await expect(page.locator('.miso-redraw')).toHaveCount(4);
  await expect(page.locator('#lifecycle-study')).toBeHidden();
  const list = page.locator('#miso-sessions');
  const working = list.locator('[data-variant=working] .miso-redraw');
  const idle = list.locator('[data-variant=idle] .miso-redraw');
  const current = list.locator('[data-variant=current] .bot');
  const idleDrawing = await idle.evaluate(drawing);
  const currentBody = await current.locator('.bot-figure > .bot-body').innerHTML();
  expect(currentBody).toContain('<rect');
  expect(await working.evaluate(node => [node.offsetWidth, node.offsetHeight])).toEqual([32, 32]);
  const poses = await working.evaluate(async node => {
    const left = node.querySelector('[data-part=pawLeft]'), right = node.querySelector('[data-part=pawRight]');
    const eye = node.querySelector('[data-part=eyeLeft]'), head = node.querySelector('[data-part=outline]');
    const heights = [], separation = [], shapes = new Set();
    const start = performance.now();
    while (performance.now() - start < 5100) {
      heights.push(eye.getBBox().height);
      separation.push(Number(left.getAttribute('cy')) - Number(right.getAttribute('cy')));
      shapes.add(head.getAttribute('d'));
      await new Promise(requestAnimationFrame);
    }
    return { eyeMin: Math.min(...heights), eyeMax: Math.max(...heights), pawMin: Math.min(...separation), pawMax: Math.max(...separation), shapes: shapes.size };
  });
  expect(poses.eyeMin).toBeLessThan(3.5);
  expect(poses.eyeMax).toBeGreaterThan(5);
  expect(poses.pawMin).toBeLessThan(-3);
  expect(poses.pawMax).toBeGreaterThan(3);
  expect(poses.shapes).toBeGreaterThan(20);
  expect(await idle.evaluate(drawing)).toBe(idleDrawing);
  await expect(current.locator('.bot-figure')).toHaveCSS('animation-name', 'character-miso');
  await activate(page.getByRole('button', { name: 'Pause motion', exact: true }));
  await page.waitForTimeout(80);
  const paused = await working.evaluate(drawing);
  await page.waitForTimeout(150);
  expect(await working.evaluate(drawing)).toBe(paused);
  await page.screenshot({ path: info.outputPath('miso-light.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Preview dark theme' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('miso-dark.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Replay comparison' }));
  await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const restarted = await working.evaluate(drawing);
  await expect.poll(() => working.evaluate(drawing)).not.toBe(restarted);
  await page.setViewportSize({ width: 390, height: 300 });
  await list.scrollIntoViewIfNeeded();
  const enlarged = page.locator('.miso-poses [data-state=working]');
  await expect(enlarged).not.toHaveClass(/in-view/);
  const offscreen = await enlarged.evaluate(drawing);
  await page.waitForTimeout(150);
  expect(await enlarged.evaluate(drawing)).toBe(offscreen);
  await page.getByRole('heading', { name: 'Miso, redrawn' }).scrollIntoViewIfNeeded();
  await enlarged.scrollIntoViewIfNeeded();
  await expect(enlarged).toHaveClass(/in-view/);
  await expect.poll(() => enlarged.evaluate(drawing)).not.toBe(offscreen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion enabled' })).toBeDisabled();
  await page.waitForTimeout(100);
  const reduced = await enlarged.evaluate(drawing);
  await page.waitForTimeout(150);
  expect(await enlarged.evaluate(drawing)).toBe(reduced);
  expect(await page.locator('#comparison').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('miso-desktop.png') });
  await activate(page.getByRole('link', { name: 'Back to B · Signature' }));
  await expect(page.locator('#page')).toHaveAttribute('data-set', 'signature');
  await expect(page.locator('.miso-redraw')).toHaveCount(0);
  await expect(page.locator('#family .bot')).toHaveCount(8);
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
});
