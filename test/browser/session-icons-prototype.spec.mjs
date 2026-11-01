import { test, expect } from '@playwright/test';

// Static UI prototype only. No Pi, login, session changes or transport.
test('original indicators stay separate from all four detail-line bot placements', async ({ page }, testInfo) => {
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  const route = '/session-icons-prototype.html';
  for (const [width, colorScheme] of [[390, 'dark'], [320, 'light'], [1280, 'light']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    for (const variant of ['A', 'B', 'C', 'D']) {
      await page.goto(`${route}?variant=${variant}`);
      await expect(page.locator('#page')).toHaveAttribute('data-variant', variant);
      await expect(page.locator('.session')).toHaveCount(9);
      await expect(page.locator('.session-indicators .bot')).toHaveCount(0);
      await expect(page.locator('.session-indicators .session-icon')).toHaveCount(9);
      await expect(page.locator('.session-body .bot')).toHaveCount(9);
      await expect(page.locator('.session-icon[data-unread] circle')).toHaveCSS('fill', 'rgb(10, 132, 255)');
      const layout = await page.locator('.session').evaluateAll(rows => rows.every(row => {
        const body = row.querySelector('.session-body').getBoundingClientRect();
        const title = row.querySelector('.session-top').getBoundingClientRect();
        const dot = row.querySelector('.session-icon').getBoundingClientRect();
        const bot = row.querySelector('.bot').getBoundingClientRect();
        return dot.right <= body.left && bot.top >= title.bottom && bot.left >= body.left && bot.right <= body.right + 1 && row.scrollWidth <= row.clientWidth;
      }));
      expect(layout).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (variant === 'C') await expect(page.locator('.bot-activity .bot')).toHaveCount(9);
      else await expect(page.locator('.session-meta .bot')).toHaveCount(9);
      if (variant === 'D') {
        await expect(page.locator('.session-preview')).toHaveCount(0);
        expect(await page.locator('.session').evaluateAll(rows => rows.every(row => {
          const meta = row.querySelector('.session-meta'), time = meta.querySelector('.session-time').getBoundingClientRect();
          const bot = meta.querySelector('.bot').getBoundingClientRect(), title = row.querySelector('strong');
          return bot.left - time.right >= 0 && bot.left - time.right <= 8 && Math.abs(bot.y + bot.height / 2 - time.y - time.height / 2) <= 1 && title.clientHeight <= 26;
        }))).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`${variant}-${width}-${colorScheme}.png`), fullPage: true });
    }
  }
  const fix = page.locator('.session[data-id=fix-model]');
  await fix.click();
  await expect(fix).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next design' }).click();
  await expect(page).toHaveURL(/variant=A$/);
  await expect(fix).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/variant=D$/);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/variant=A$/);
  await page.getByRole('button', { name: 'Play all bots', exact: true }).click();
  await expect(page.locator('.bot[data-mood=working]')).toHaveCount(9);
  await expect(page.locator('.session-icon[data-status=working]')).toHaveCount(9);
  await expect(fix.locator('.bot-antenna').first()).toHaveCSS('animation-name', 'bot-twitch');
  await page.reload();
  await expect(page.locator('#page')).toHaveAttribute('data-variant', 'A');
  await expect(page.getByRole('button', { name: 'Play all bots', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(fix.locator('.bot-antenna').first()).toHaveCSS('animation-name', 'none');
  await expect(fix.locator('.session-icon rect').first()).toHaveCSS('animation-name', 'none');
  await page.goto(`${route}?variant=invalid`);
  await expect(page).toHaveURL(/variant=D$/);
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
});
