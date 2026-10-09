import { test, expect } from '@playwright/test';

for (const [name, viewport, colorScheme, reducedMotion] of [
  ['phone', { width: 390, height: 844 }, 'light', 'no-preference'],
  ['phone-dark', { width: 390, height: 844 }, 'dark', 'no-preference'],
  ['desktop', { width: 1280, height: 800 }, 'light', 'no-preference'],
  ['small-reduced-motion', { width: 320, height: 568 }, 'dark', 'reduce'],
]) {
  test(`branded startup waits for sessions: ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme, reducedMotion });
    // Hold real host responses at the network boundary to inspect a slow startup.
    const held = [];
    let release;
    await page.routeWebSocket('**/ws', ws => {
      const server = ws.connectToServer();
      let waiting = true;
      server.onMessage(message => waiting ? held.push(message) : ws.send(message));
      release = () => { waiting = false; held.forEach(message => ws.send(message)); };
    });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    const boot = page.locator('#boot');
    await expect(boot.getByRole('img', { name: 'Pi agent logo' })).toBeVisible();
    await expect(boot.getByRole('status')).toHaveText('Connecting to your computer…');
    await expect(page.locator('#login')).toBeHidden();
    await expect(page.locator('#app')).toBeHidden();
    const content = await page.locator('.boot-content').boundingBox();
    expect(Math.abs(content.x + content.width / 2 - viewport.width / 2)).toBeLessThan(1);
    expect(content.y).toBeGreaterThan(viewport.height * .2);
    expect(content.y + content.height).toBeLessThan(viewport.height * .8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    if (reducedMotion === 'reduce') {
      await expect(boot.locator('.connection-spinner')).toHaveCSS('animation-name', 'none');
    }
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
    await expect.poll(() => held.some(message => JSON.parse(message).type === 'sessions')).toBe(true);
    release();
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    await expect(boot).toBeHidden();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
  });
}
