import { test, expect } from '@playwright/test';

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
