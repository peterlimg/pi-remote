import { test, expect } from '@playwright/test';

test('writing studies keep drafts across layouts without connecting to an agent', async ({ page }, testInfo) => {
  const errors = [], sockets = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()); });
  await page.goto('/composer-prototype.html?variant=A');
  const draft = page.getByLabel('Message draft');
  await draft.fill('Keep this draft');
  await page.getByRole('button', { name: 'Show formatting', exact: true }).click();
  await draft.focus();
  await draft.press('ControlOrMeta+A');
  await page.getByRole('button', { name: 'Bold selection' }).click();
  await expect(draft).toHaveValue('**Keep this draft**');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#inline-preview strong')).toHaveText('Keep this draft');
  await page.getByRole('button', { name: 'Next option' }).click();
  await expect(page).toHaveURL(/variant=B/);
  await expect(draft).toHaveValue('**Keep this draft**');
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page.getByLabel('Sample conversation')).toBeVisible();
  await page.getByRole('button', { name: 'Expand draft' }).click();
  await expect(page.getByLabel('Sample conversation')).toBeHidden();
  await page.getByRole('button', { name: 'Next option' }).click();
  await expect(page.locator('#live-preview strong')).toHaveText('Keep this draft');
  await draft.fill('<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))');
  await expect(page.locator('#live-preview img, #live-preview a')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try sending in prototype' }).click();
  await expect(page.getByRole('status')).toContainText('No agent was contacted');
  await expect(draft).not.toHaveValue('');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#live-preview h2')).toHaveText('Keep it small');
  for (const [width, height] of [[390, 844], [320, 568], [390, 440], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    for (const variant of ['A', 'B', 'C']) {
      await page.goto(`/composer-prototype.html?variant=${variant}`);
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const selector of ['#draft', '#send', '#previous', '#next']) {
          const box = await page.locator(selector).boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(height);
        }
        if (width === 390 && height === 844 || width === 1280 && colorScheme === 'light') {
          await page.screenshot({ path: testInfo.outputPath(`${variant}-${width}-${colorScheme}.png`) });
        }
      }
    }
  }
  await page.getByRole('button', { name: 'Next option' }).click();
  await expect(page).toHaveURL(/variant=A/);
  await page.getByRole('button', { name: 'Previous option' }).click();
  await expect(page).toHaveURL(/variant=C/);
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
  expect(mutations).toEqual([]);
});
