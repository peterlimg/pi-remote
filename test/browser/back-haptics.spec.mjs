import { test, expect } from '@playwright/test';

for (const standalone of [false, true]) {
  test(`Back taps use the iOS switch fallback in ${standalone ? 'home-screen' : 'browser'} mode`, async ({ page }) => {
    await page.addInitScript(standalone => {
      Object.defineProperty(navigator, 'standalone', { value: standalone });
      Object.defineProperty(navigator, 'vibrate', { value: undefined });
      window.hapticSwitches = 0;
      document.addEventListener('change', event => {
        if (event.target.matches('input[type=checkbox][switch]')) window.hapticSwitches++;
      }, true);
    }, standalone);
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Project Alpha/ }).tap();
    await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
    expect(await page.evaluate(() => window.hapticSwitches)).toBe(1);
    await page.getByRole('button', { name: 'Show sessions' }).tap();
    await expect(page.locator('#app')).not.toHaveClass(/viewing/);
    expect(await page.evaluate(() => window.hapticSwitches)).toBe(2);
    await expect(page.locator('body > label input[switch]')).toHaveCount(0);
    await expect(page.locator('#swipe-haptic-edge')).toBeHidden();
  });
}
