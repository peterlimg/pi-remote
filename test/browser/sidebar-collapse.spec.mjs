import { test, expect } from '@playwright/test';

for (const [width, height] of [[744, 1133], [1133, 744], [844, 390], [568, 320]]) {
  test(`sessions and chat stay usable side by side at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width === 568 ? 'reduce' : 'no-preference' });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    const sidebar = page.locator('#sidebar'), toggle = page.locator('#sidebar-toggle');
    const main = page.locator('main'), prompt = page.locator('#prompt');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const rail = await sidebar.boundingBox(), button = await toggle.boundingBox(), chat = await main.boundingBox();
    expect(button.x + button.width).toBeLessThanOrEqual(rail.x + rail.width);
    expect(button.width).toBe(44);
    expect(chat.x).toBeCloseTo(rail.x + rail.width, 0);
    expect(chat.x + chat.width).toBeCloseTo(width, 0);
    await prompt.fill('Keep this draft');
    await expect(prompt).toBeFocused();
    await expect(sidebar).toBeVisible();
    const send = await page.locator('#send').boundingBox();
    expect(send.x + send.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath('split.png') });
    await page.getByRole('button', { name: /Project Beta/ }).click();
    await expect(page.locator('#title')).toHaveText('Project Beta');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(prompt).toHaveValue('Keep this draft');
    await toggle.press('Enter');
    await expect(sidebar).toBeHidden();
    await expect(sidebar).toHaveAttribute('inert', '');
    await expect.poll(async () => (await main.boundingBox()).width).toBe(width);
    await toggle.press('Enter');
    await expect.poll(async () => (await main.boundingBox()).x).toBe(chat.x);
    await expect(prompt).toHaveValue('Keep this draft');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toBeHidden();
    await expect(sidebar).toBeHidden();
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await expect(sidebar).toBeVisible();
  });
}
