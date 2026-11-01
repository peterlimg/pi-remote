import { test, expect } from '@playwright/test';

// Static art comparison only. Real served assets, no Pi sessions or model calls.
test('colourful shapes and warm companions preserve placement and accessible motion controls', async ({ page }, testInfo) => {
  const errors = [], sockets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  const route = '/session-icons-prototype.html';
  for (const [width, colorScheme] of [[390, 'dark'], [320, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    let baseline;
    for (const variant of ['colour', 'warm']) {
      await page.goto(`${route}?variant=${variant}`);
      await expect(page.locator('#page')).toHaveAttribute('data-variant', variant);
      await expect(page.locator('#comparison-icons tr')).toHaveCount(4);
      await expect(page.locator('#comparison-icons .study-icon')).toHaveCount(16);
      await expect(page.locator('#list .session')).toHaveCount(8);
      await expect(page.locator('#list .session-busy .session-indicators .study-icon[data-size="28"]')).toHaveCount(4);
      await expect(page.locator('#list .session-kind .study-icon[data-size="20"]')).toHaveCount(4);
      expect(await page.locator('#list .study-icon').evaluateAll((nodes, style) => nodes.every(node => node.dataset.style === style), variant)).toBe(true);
      const layout = await page.locator('#list .session').evaluateAll(rows => rows.map(row => {
        const box = row.getBoundingClientRect(), title = row.querySelector('strong').getBoundingClientRect();
        const icon = row.querySelector('.study-icon').getBoundingClientRect(), time = row.querySelector('.session-time').getBoundingClientRect();
        return { id: row.dataset.id, width: box.width, height: box.height, titleX: title.x, iconX: icon.x, iconY: icon.y - box.y,
          contained: row.scrollWidth <= row.clientWidth, placed: row.classList.contains('session-busy') ? icon.right <= title.x : icon.x - time.right >= 0 && icon.x - time.right <= 8 };
      }));
      expect(layout.every(row => row.contained && row.placed)).toBe(true);
      if (baseline) expect(layout).toEqual(baseline);
      baseline = layout;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('#comparison-icons .study-icon[data-style=colour][data-size="28"] .study-body').evaluateAll(nodes => {
        const colours = nodes.map(node => getComputedStyle(node).fill);
        const luminance = colour => {
          const [r, g, b] = colour.match(/\d+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
          return .2126 * r + .7152 * g + .0722 * b;
        };
        const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const background = luminance(getComputedStyle(document.documentElement).backgroundColor);
        const eyes = luminance(getComputedStyle(nodes[0].parentNode.querySelector('.study-eye')).fill);
        return new Set(colours).size === 4 && colours.every(colour => contrast(luminance(colour), background) >= 3 && contrast(luminance(colour), eyes) >= 3);
      })).toBe(true);
      await expect(page.locator('#comparison-icons .study-icon[data-style=warm] .study-warm-face')).toHaveCount(8);
      await expect(page.locator('#comparison-icons .study-icon[data-style=colour] .study-warm-face')).toHaveCount(0);
      await page.locator('.comparison').screenshot({ path: testInfo.outputPath(`comparison-${width}-${colorScheme}-${variant}.png`), animations: 'disabled' });
      await page.screenshot({ path: testInfo.outputPath(`${variant}-${width}-${colorScheme}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: 'Colourful', exact: true }).click();
  await expect(page).toHaveURL(/variant=colour$/);
  const selected = page.locator('.session[data-id=review-work]');
  await selected.click();
  await page.getByRole('button', { name: 'Next style' }).click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/variant=warm$/);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/variant=colour$/);
  await page.getByRole('button', { name: 'Preview light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#comparison-icons .study-icon[data-style=colour] .study-body').first()).toHaveCSS('fill', 'rgb(209, 104, 109)');
  await page.getByRole('button', { name: 'Preview dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const eyes = page.locator('#comparison-icons .study-icon[data-kind=review][data-style=colour][data-mood=working] .study-gaze');
  await eyes.scrollIntoViewIfNeeded();
  await expect(eyes).toHaveCSS('animation-name', 'study-read');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await expect(eyes).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await expect(eyes).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(eyes).toHaveCSS('animation-name', 'none');
  expect(await page.locator('.study-icon[data-mood=resting] *').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
  await page.reload();
  await expect(page.locator('#page')).toHaveAttribute('data-variant', 'colour');
  await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.goto(`${route}?variant=invalid`);
  await expect(page).toHaveURL(/variant=colour$/);
  expect(errors).toEqual([]); expect(sockets).toEqual([]);
  expect([...new Set(requests)].every(path => [route, '/session-icons-prototype.js', '/session-icons-prototype.css', '/style.css', '/icon.svg'].includes(path))).toBe(true);
});
