import { test, expect } from '@playwright/test';

test('simple celestial study animates silhouettes while keeping other characters out', async ({ page, browserName }, info) => {
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  const activate = async control => {
    if (browserName === 'webkit') { await control.focus(); await page.keyboard.press('Enter'); }
    else await control.click();
  };
  const drawing = node => node.innerHTML;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.goto('/session-motion-prototype.html?study=celestial');
  const list = page.locator('#celestial-sessions');
  const working = list.locator('[data-state=working]');
  const idle = list.locator('[data-state=ready]');
  await expect(working).toHaveCount(3);
  await expect(page.locator('#comparison [data-kind=miso], #comparison [data-kind=jelly]')).toHaveCount(0);
  await expect(page.locator('#lifecycle-study')).toBeHidden();
  const clipTargets = await page.locator('.celestial-bot clipPath use').evaluateAll(nodes => nodes.map(node =>
    node.ownerSVGElement.querySelector(node.getAttribute('href'))?.localName));
  expect(clipTargets.every(tag => ['path', 'circle'].includes(tag)), 'Eye clips must reference shapes, not groups').toBe(true);
  expect(await working.evaluateAll(nodes => nodes.every(node => node.offsetWidth === 32 && node.offsetHeight === 32))).toBe(true);
  const idleDrawing = await idle.evaluate(drawing);
  const orbit = list.locator('[data-kind=orbit]');
  await expect(orbit.locator('path, ellipse, circle')).toHaveCount(3);
  await expect(orbit.locator('.bot-body path')).toHaveAttribute('fill-rule', 'evenodd');
  const poses = await list.evaluate(async list => {
    const moon = list.querySelector('[data-kind=luna] .bot-body path');
    const tail = list.querySelector('[data-kind=comet] .character-comet-tail');
    const ring = list.querySelector('[data-kind=orbit] .bot-body path');
    const eye = list.querySelector('[data-kind=orbit] .bot-eye');
    const moons = new Set(), tails = new Set(), heights = [], faces = new Set();
    const start = performance.now();
    while (performance.now() - start < 4000) {
      moons.add(moon.getAttribute('d')); tails.add(tail.innerHTML);
      heights.push(ring.getBBox().height); faces.add(eye.getAttribute('opacity'));
      await new Promise(requestAnimationFrame);
    }
    return { moons: moons.size, tails: tails.size, min: Math.min(...heights), max: Math.max(...heights), faces: [...faces].sort() };
  });
  expect(poses.moons).toBeGreaterThan(20);
  expect(poses.tails).toBeGreaterThan(20);
  expect(poses.min).toBeLessThan(12);
  expect(poses.max).toBeGreaterThan(23);
  expect(poses.faces).toEqual(['0', '1']);
  expect(await idle.evaluate(drawing)).toBe(idleDrawing);
  await activate(page.getByRole('button', { name: 'Pause motion', exact: true }));
  await page.waitForTimeout(80);
  const paused = await list.evaluate(drawing);
  await page.waitForTimeout(150);
  expect(await list.evaluate(drawing)).toBe(paused);
  await page.screenshot({ path: info.outputPath('celestial-dark.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Preview light theme' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: info.outputPath('celestial-light.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Replay comparison' }));
  const restarted = await working.first().evaluate(drawing);
  await expect.poll(() => working.first().evaluate(drawing)).not.toBe(restarted);
  await activate(page.locator('.presence-comparisons summary'));
  for (const kind of ['Luna', 'Comet', 'Orbit']) {
    const section = page.getByRole('region', { name: kind, exact: true });
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator('[data-variant=current] .bot-figure')).toHaveCSS('animation-name', `character-${kind.toLowerCase()}`);
    const icon = section.locator('[data-variant=revised] .celestial-bot');
    expect(await icon.evaluate(node => node.offsetWidth)).toBe(64);
  }
  await page.screenshot({ path: info.outputPath('celestial-comparison.png'), fullPage: true });
  await expect(working.first()).not.toHaveClass(/in-view/);
  const offscreen = await working.first().evaluate(drawing);
  await page.waitForTimeout(150);
  expect(await working.first().evaluate(drawing)).toBe(offscreen);
  await page.getByRole('heading', { name: 'Luna, Comet & Orbit', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => working.first().evaluate(drawing)).not.toBe(offscreen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion enabled' })).toBeDisabled();
  await page.waitForTimeout(100);
  const reduced = await list.evaluate(drawing);
  await page.waitForTimeout(150);
  expect(await list.evaluate(drawing)).toBe(reduced);
  expect(await page.locator('#comparison').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('celestial-desktop.png'), fullPage: true });
  await activate(page.getByRole('link', { name: 'Back to B · Signature' }));
  await expect(page.locator('#page')).toHaveAttribute('data-set', 'signature');
  await expect(page.locator('#family .bot')).toHaveCount(8);
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
});
