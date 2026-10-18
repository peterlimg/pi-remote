import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

for (const view of [
  { name: 'desktop-light', viewport: { width: 1440, height: 960 }, colorScheme: 'light' },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { name: 'narrow-light', viewport: { width: 320, height: 740 }, colorScheme: 'light' }
]) {
  test.describe(view.name, () => {
    test.use({ viewport: view.viewport, colorScheme: view.colorScheme, deviceScaleFactor: 1 });
    test('the SDK guide renders diagrams, navigates and expands without app access or scripts', async ({ page }) => {
      const failures = [], sockets = [], requests = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
      page.on('websocket', socket => sockets.push(socket.url()));
      page.on('request', request => requests.push(request.url()));
      const response = await page.goto('/sdk-guide.html');
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/html');
      expect(response.headers()['content-security-policy']).toContain("style-src 'self'");
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Claude SDK, with Pi still in control.');
      await expect(page.getByRole('heading', { name: 'The honest boundary today.' })).toBeAttached();
      await expect(page.locator('figure')).toHaveCount(10);
      await expect(page.locator('script')).toHaveCount(0);
      const connector = await page.locator('.entry-route .connector').boundingBox(), pi = await page.locator('.pi-node').boundingBox();
      expect(Math.abs(connector.x + connector.width / 2 - pi.x - pi.width / 2)).toBeLessThan(2);
      const contrast = await page.evaluate(() => {
        const rgb = color => color.match(/[\d.]+/g).map(Number);
        const luminance = color => rgb(color).slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        return ['main', '.node-label', '.sdk-node .node-label', 'figcaption', '.scope-note', '.warning', '.status.verified', '.status.guarded', '.status.blocked', '.status.neutral'].map(selector => {
          const element = document.querySelector(selector); let background = element;
          while (background.parentElement && rgb(getComputedStyle(background).backgroundColor)[3] === 0) background = background.parentElement;
          const fg = luminance(getComputedStyle(element).color), bg = luminance(getComputedStyle(background).backgroundColor);
          return { selector, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
        });
      });
      for (const color of contrast) expect(color.ratio, color.selector).toBeGreaterThanOrEqual(4.5);
      expect(await page.locator('main').evaluate(element => getComputedStyle(element).maxWidth)).toBe('1080px');
      const shape = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        badAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash),
        ids: [...document.querySelectorAll('[id]')].map(element => element.id)
      }));
      expect(shape.overflow).toBe(false);
      expect(shape.badAnchors).toEqual([]);
      expect(new Set(shape.ids).size).toBe(shape.ids.length);
      expect(sockets).toEqual([]);
      expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
      if (process.env.PI_GUIDE_EVIDENCE) {
        mkdirSync(process.env.PI_GUIDE_EVIDENCE, { recursive: true });
        await page.screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-top.png') });
        await page.screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-full.png'), fullPage: true });
        await page.locator('.overview-map').screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-ownership.png') });
        await page.locator('.worker-map').screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-workers.png') });
      }
      await page.getByRole('link', { name: 'Why is worker resume unfinished?', exact: true }).click();
      await expect(page).toHaveURL(/#workers$/);
      await expect(page.getByRole('heading', { name: 'Fresh workers work. Durable retained-worker continuation is unfinished.' })).toBeInViewport();
      const summary = page.getByText('What changed for malformed tool calls?', { exact: true });
      await summary.focus(); await page.keyboard.press('Enter');
      await expect(page.locator('details').filter({ has: summary })).toHaveAttribute('open', '');
      await expect(page.getByText(/The old bridge threw too early/)).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Claude SDK, with Pi still in control.');
      expect(failures).toEqual([]);
    });
  });
}

test('only the explicit public guide assets are served', async ({ request }) => {
  const css = await request.get('/sdk-guide.css');
  expect(css.status()).toBe(200);
  expect(css.headers()['content-type']).toContain('text/css');
  for (const path of ['/sdk-guide.js', '/docs/provider-gaps.md', '/sdk-guide.html/extra']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
