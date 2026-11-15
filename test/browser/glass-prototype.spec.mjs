import { test, expect } from '@playwright/test';

test('glass comparison reuses the controls without connecting to or changing sessions', async ({ page }, testInfo) => {
  const errors = [], mutations = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()); });
  await page.goto('/glass-prototype.html?variant=B');
  await expect(page.locator('#study-status')).toContainText('Sample only');
  await page.locator('#prompt').fill('Keep my draft sharp');
  await page.locator('#prompt').press('ArrowLeft');
  await expect(page).toHaveURL(/variant=B$/);
  await page.locator('#prompt').blur();
  const scroll = await page.locator('#transcript').evaluate(n => n.scrollTop);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const variant of ['B', 'C', 'A']) {
      await expect(page.locator('html')).toHaveAttribute('data-variant', variant);
      await expect(page.locator('#prompt')).toHaveValue('Keep my draft sharp');
      await page.locator('.session-info summary').click();
      await expect(page.locator('#project')).toBeVisible();
      const materials = await page.locator('.conversation-heading, .composer, .session-details, .coordinator-context').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return [style.backgroundColor, style.backgroundImage, style.boxShadow];
      }));
      for (const material of materials) expect(material).toEqual(materials[0]);
      for (const selector of ['.conversation-heading', '.composer', '.session-details', '.coordinator-context', '#settings-picker']) {
        await expect(page.locator(selector)).toHaveCSS('border-top-width', '1px');
        await expect(page.locator(selector)).not.toHaveCSS('box-shadow', /inset/);
      }
      await expect(page.locator('.composer-settings')).toHaveCSS('box-shadow', 'none');
      await expect(page.locator('#prompt')).toHaveCSS('filter', 'none');
      await expect(page.locator('#prompt')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: testInfo.outputPath(`${width}-${variant}-menu.png`) });
      await page.locator('.session-info summary').click();
      await page.locator('#usage-meter').click();
      await expect(page.locator('#picker-options')).toContainText('Account limits · sample');
      await page.screenshot({ path: testInfo.outputPath(`${width}-${variant}-usage.png`) });
      await page.locator('#picker-cancel').click();
      expect(await page.locator('#transcript').evaluate(n => n.scrollTop)).toBe(scroll);
      await page.locator('#next').click();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: testInfo.outputPath('light-composer.png') });
  await page.locator('#next').click();
  await expect(page.locator('html')).toHaveAttribute('data-variant', 'C');
  await page.locator('#usage-meter').click();
  await page.screenshot({ path: testInfo.outputPath('light-C-usage.png') });
  await expect(page.locator('#settings-picker')).not.toHaveCSS('box-shadow', /inset/);
  await page.locator('#picker-cancel').click();
  await page.locator('#previous').click();
  await page.locator('#coordinator-open').click();
  await expect(page.locator('#coordinator-task-list')).toContainText('Check mobile layout');
  await page.screenshot({ path: testInfo.outputPath('light-workers.png') });
  await page.keyboard.press('Escape');
  await page.locator('#model').click();
  await expect(page.locator('#picker-options')).toContainText('Opus 5.5 · selected');
  await page.locator('#picker-cancel').click();
  await page.locator('#send').click();
  await expect(page.locator('#study-status')).toHaveText('Sample draft only. Nothing was sent.');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(sockets).toEqual([]); expect(mutations).toEqual([]); expect(errors).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-variant', 'B');
  await expect(page.locator('#study-status')).toContainText('Sample only');
});
