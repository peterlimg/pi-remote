import { test, expect } from '@playwright/test';

test('worker control prototypes compare running states without connecting to sessions', async ({ page }, info) => {
  const errors = [], sockets = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()); });
  await page.goto('/coordinator-prototype.html?study=control&variant=A&running=0');
  await expect(page.locator('#control-state')).toHaveText('Sample only · 0 running / 2 workers');
  await expect(page.locator('#voice-record .voice-stop-icon')).toBeHidden();
  await page.locator('#prompt').fill('Keep my draft');
  await page.locator('#prompt').press('ArrowRight');
  await expect(page.locator('body')).toHaveAttribute('data-control-variant', 'A');
  for (const [width, theme] of [[390, 'dark'], [320, 'light'], [1440, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#control-theme').click();
    for (const variant of ['A', 'B', 'C']) {
      await expect(page.locator('body')).toHaveAttribute('data-control-variant', variant);
      for (const running of [0, 1, 2]) {
        await page.locator(`button[data-running="${running}"]`).click();
        const trigger = page.locator('#coordinator-open');
        await expect(trigger).toHaveAccessibleName(`Workers, ${running} running, ${2 - running} not running`);
        await expect(trigger).not.toContainText('Idle');
        await expect(page.locator(`button[data-running="${running}"]`)).toHaveAttribute('aria-pressed', 'true');
        if (variant === 'B') await expect(trigger.locator('.control-indicator')).toHaveText(String(running));
        if (variant === 'C') await expect(trigger.locator('i[data-running=true]')).toHaveCount(running);
        const box = await trigger.boundingBox(), composer = await page.locator('#composer').boundingBox(), dots = await page.locator('#session-swipe').boundingBox();
        expect(box.height).toBe(44); expect(box.width).toBeLessThan(145);
        expect(Math.abs(box.x + box.width / 2 - composer.x - composer.width / 2)).toBeLessThanOrEqual(1);
        expect(dots.y + dots.height).toBeLessThanOrEqual(box.y + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(composer.y + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: info.outputPath(`${width}-${theme}-${variant}-${running}.png`) });
      }
      await page.locator('#coordinator-open').click();
      await expect(page.locator('#coordinator-sheet')).toBeVisible();
      await expect(page.locator('#coordinator-task-list small')).toHaveText(['Working', 'Working']);
      await page.locator('#coordinator-done').click();
      await expect(page.locator('#prompt')).toHaveValue('Keep my draft');
      await page.locator('#control-next').click();
    }
  }
  await page.locator('button[data-running="0"]').click();
  await page.locator('#coordinator-open').click();
  await expect(page.locator('#coordinator-task-list small')).toHaveText(['Not running', 'Not running']);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('button[data-running="1"]').click();
  await expect(page.locator('.control-indicator')).toHaveCSS('animation-name', 'none');
  await page.locator('#control-next').click();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-control-variant', 'B');
  await expect(page.locator('#control-state')).toHaveText('Sample only · 1 running / 2 workers');
  await page.locator('#voice-record').click();
  await expect(page.locator('#control-state')).toHaveText('Preview only. Nothing was sent or changed.');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(sockets).toEqual([]); expect(mutations).toEqual([]); expect(errors).toEqual([]);
});
