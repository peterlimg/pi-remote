import { test, expect } from '@playwright/test';

test('mobile navigation preserves drafts and sends to the selected session', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('#connection')).toContainText('Computer connected');
  await expect(page.locator('#sessions .session')).toHaveCount(2);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Alpha');
  await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
  await page.locator('#prompt').fill('draft for alpha');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Beta');
  await expect(page.locator('#prompt')).toHaveValue('');
  await page.locator('#prompt').fill('instruction for beta');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('instruction for beta');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#prompt')).toHaveValue('draft for alpha');
  await expect(page.locator('#transcript')).not.toContainText('instruction for beta');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(new URL(page.url()).hash).toBe('');
  await page.screenshot({ path: 'test-results/mobile-session.png', fullPage: true });
  expect(errors).toEqual([]);
});
