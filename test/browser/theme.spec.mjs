import { test, expect } from '@playwright/test';

const colors = { light: 'rgb(250, 250, 248)', dark: 'rgb(16, 13, 16)' };
const chrome = { light: '#fafaf8', dark: '#100d10' };

for (const system of ['light', 'dark']) {
  test(`theme toggle overrides the ${system} device preference and survives reopening`, async ({ page, context }, testInfo) => {
    const opposite = system === 'light' ? 'dark' : 'light';
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ colorScheme: system });
    await page.setViewportSize({ width: system === 'light' ? 320 : 1280, height: 844 });
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Dark mode', exact: true });
    await expect(toggle).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('background-color', colors[system]);
    await expect(toggle).toHaveAttribute('aria-pressed', String(system === 'dark'));

    // Without a saved choice, changing the device preference still changes the app.
    await page.emulateMedia({ colorScheme: opposite });
    await expect(page.locator('html')).toHaveCSS('background-color', colors[opposite]);
    await expect(toggle).toHaveAttribute('aria-pressed', String(opposite === 'dark'));
    await toggle.click();
    await expect(page.locator('html')).toHaveCSS('background-color', colors[system]);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', chrome[system]);
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-theme'))).toBe(system);
    expect((await toggle.boundingBox()).width).toBeGreaterThanOrEqual(44);
    expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`login-${system}.png`), fullPage: true });

    await page.getByText('Paste a private link instead', { exact: true }).click();
    await page.getByLabel('Private login link').fill('browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: 'Connect to computer' }).click();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', String(system === 'dark'));
    await expect(page.locator('#sidebar')).toHaveCSS('background-color', system === 'dark' ? colors.dark : 'rgb(242, 243, 240)');
    await page.screenshot({ path: testInfo.outputPath(`sessions-${system}.png`), fullPage: true });

    await page.reload();
    await expect(toggle).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('background-color', colors[system]);
    const reopened = await context.newPage();
    await reopened.emulateMedia({ colorScheme: opposite });
    await reopened.goto('/');
    await expect(reopened.locator('#connection')).toHaveText('Computer connected');
    await expect(reopened.locator('html')).toHaveCSS('background-color', colors[system]);
    await expect(reopened.getByRole('button', { name: 'Dark mode', exact: true })).toHaveAttribute('aria-pressed', String(system === 'dark'));

    // Keyboard activation updates the other tab without a reload.
    await toggle.focus();
    await toggle.press('Enter');
    await expect(page.locator('html')).toHaveCSS('color-scheme', opposite);
    await expect(reopened.locator('html')).toHaveCSS('background-color', colors[opposite]);
    await expect(reopened.locator('meta[name="theme-color"]')).toHaveAttribute('content', chrome[opposite]);
    await page.emulateMedia({ colorScheme: system });
    await expect(page.locator('html')).toHaveCSS('background-color', colors[opposite]);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#login')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', String(opposite === 'dark'));
    await page.reload();
    await expect(toggle).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('background-color', colors[opposite]);
    expect(errors).toEqual([]);
  });
}
