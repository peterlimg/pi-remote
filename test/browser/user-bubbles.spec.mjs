import { test, expect } from '@playwright/test';

test('user bubbles leave a left gutter and stay right-aligned at phone and desktop widths', async ({ page }, testInfo) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const messages = ['should have basic MD format rendering if response is', 'Short reply', 'x'.repeat(160)];
  for (const text of messages) {
    await page.locator('#prompt').fill(text);
    await page.locator('#send').click();
    await expect(page.locator('.message.user').last()).toHaveText(text);
    await expect(page.locator('#send')).toBeEnabled();
  }
  for (const [width, colorScheme] of [[390, 'light'], [320, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    for (const message of await page.locator('.message.user').all()) {
      const row = await message.boundingBox(), bubble = await message.locator('.message-text').boundingBox();
      expect(bubble.width).toBeLessThanOrEqual(row.width * .85 + 1);
      expect(bubble.x - row.x).toBeGreaterThanOrEqual(row.width * .15 - 1);
      expect(Math.abs(bubble.x + bubble.width - row.x - row.width)).toBeLessThan(1);
    }
    expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`user-bubbles-${width}.png`) });
  }
});
