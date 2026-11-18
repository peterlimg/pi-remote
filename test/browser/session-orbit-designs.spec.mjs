import { test, expect } from '@playwright/test';

test('Orbit C tracks a moon only while working', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/session-motion-prototype.html?study=orbit-c');
  const working = page.getByRole('img', { name: 'Orbit C, working' });
  const idle = page.getByRole('img', { name: 'Orbit C, idle' });
  const original = await idle.innerHTML();
  expect((await working.boundingBox()).width).toBe(32);
  const gaze = working.locator('.bot-eye').first();
  const position = await gaze.getAttribute('transform'), expression = await gaze.getAttribute('d');
  await expect.poll(() => gaze.getAttribute('transform')).not.toBe(position);
  await expect.poll(() => gaze.getAttribute('d')).not.toBe(expression);
  for (const moon of await working.locator('.disc-moon').all()) await expect(moon).toHaveAttribute('opacity', '1');
  const disc = working.locator('.ring-design-disc').first();
  const tilt = () => disc.evaluate(path => path.parentNode.transform.baseVal.getItem(0).angle);
  await expect.poll(tilt, { intervals: [50] }).toBeLessThan(-25);
  await expect.poll(tilt, { intervals: [50] }).toBeGreaterThan(4);
  expect(await idle.innerHTML()).toBe(original);
  await page.screenshot({ path: info.outputPath('working-idle.png') });
  await page.getByRole('button', { name: 'Pause motion' }).press('Enter');
  const paused = await working.innerHTML();
  await page.waitForTimeout(180);
  expect(await working.innerHTML()).toBe(paused);
  await page.getByRole('button', { name: 'Resume motion' }).press('Enter');
  await expect.poll(() => working.innerHTML()).not.toBe(paused);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion enabled' })).toBeDisabled();
  const reduced = await working.innerHTML();
  await page.waitForTimeout(180);
  expect(await working.innerHTML()).toBe(reduced);
});

test('Orbit ring designs compare three still drawings at large and session sizes', async ({ page, browserName }, info) => {
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  const activate = async control => {
    if (browserName === 'webkit') { await control.focus(); await page.keyboard.press('Enter'); }
    else await control.click();
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/session-motion-prototype.html?study=orbit-rings');
  await expect(page.getByRole('heading', { name: 'Orbit ring designs' })).toBeVisible();
  await expect(page.locator('.ring-options figure')).toHaveCount(3);
  await expect(page.locator('#ring-design-sessions .session')).toHaveCount(5);
  const drawings = [];
  for (const key of ['A', 'B', 'C']) {
    const large = page.locator(`.ring-options [data-design=${key}]`);
    const small = page.locator(`#ring-design-sessions [data-design=${key}]`);
    expect(await large.evaluate(node => node.offsetWidth)).toBe(80);
    expect(await small.evaluate(node => node.offsetWidth)).toBe(32);
    expect(await large.innerHTML()).toBe(await small.innerHTML());
    await expect(large.locator('.bot-eye')).toHaveCount(2);
    drawings.push(await large.innerHTML());
  }
  expect(new Set(drawings).size).toBe(3);
  await expect(page.locator('#comparison canvas, #comparison linearGradient, #comparison radialGradient')).toHaveCount(0);
  expect(await page.locator('#comparison').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  const still = await page.locator('#comparison').innerHTML();
  await page.waitForTimeout(150);
  expect(await page.locator('#comparison').innerHTML()).toBe(still);
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeHidden();
  await page.screenshot({ path: info.outputPath('orbit-designs-dark.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Preview light theme' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: info.outputPath('orbit-designs-light.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await activate(page.getByRole('link', { name: 'Back to the motion preview' }));
  await expect(page.locator('#celestial-sessions')).toBeVisible();
  await expect(page.locator('#celestial-sessions [data-kind=orbit] .presence-ring')).toHaveCount(0);
  await expect(page.locator('#celestial-sessions [data-kind=orbit] .presence-moon')).toHaveCount(2);
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
});
