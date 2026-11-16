import { test, expect } from '@playwright/test';

test('shimmer palettes compare without changing live sessions', async ({ page }, info) => {
  const errors = [], sockets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/session-motion-prototype.html?study=shimmer&variant=A');
  await expect(page.getByRole('heading', { name: 'Working colors' })).toBeVisible();
  await expect(page.locator('.shimmer-choice')).toHaveCount(4);
  const working = page.locator('.shimmer-row .session-state').first();
  for (const [key, name, rgb] of [['A', 'Rose', '215, 139, 158'], ['B', 'Lilac', '177, 147, 219'], ['C', 'Coral', '213, 143, 127'], ['D', 'Orchid', '201, 137, 199']]) {
    await page.getByRole('button', { name: `${key} · ${name}`, exact: true }).click();
    await expect(page.locator('#label')).toHaveText(`${key} · ${name}`);
    await expect(working).toHaveCSS('background-image', new RegExp(`rgb\\(${rgb}\\)`));
    await expect(working).toHaveCSS('animation-duration', '1.4s');
    await expect(working).toHaveCSS('animation-play-state', 'running');
    expect(await working.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  }
  await page.getByRole('button', { name: 'Next color' }).click();
  await expect(page).toHaveURL(/variant=A/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'A · Rose', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const position = await working.evaluate(node => getComputedStyle(node).backgroundPositionX);
  await expect.poll(() => working.evaluate(node => getComputedStyle(node).backgroundPositionX)).not.toBe(position);
  await page.screenshot({ path: info.outputPath('shimmer-colors-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(working).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: 'Resume motion' }).click();
  await page.getByRole('button', { name: 'Preview light theme' }).click();
  await expect(working).toHaveCSS('background-image', /rgb\(163, 66, 97\)/);
  await page.screenshot({ path: info.outputPath('shimmer-colors-light.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(working).toHaveCSS('animation-name', 'none');
  await expect(working).toHaveCSS('color', 'rgb(163, 66, 97)');
  await expect(page.getByRole('button', { name: 'Reduced motion enabled' })).toBeDisabled();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
  expect(requests.every(path => ['/session-motion-prototype.html', '/session-motion-prototype.js', '/session-motion-prototype.css', '/style.css', '/icon.svg'].includes(path))).toBe(true);
  await page.goto('/session-motion-prototype.html?set=focused');
  await expect(page.getByRole('heading', { name: 'Working motion', exact: true })).toBeVisible();
  await expect(page.locator('.motion-comparison')).toHaveCount(4);
  expect(errors).toEqual([]);
});
