import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

for (const view of [
  { name: 'desktop-light', viewport: { width: 1440, height: 960 }, colorScheme: 'light' },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { name: 'narrow-light', viewport: { width: 320, height: 740 }, colorScheme: 'light' }
]) {
  test.describe(view.name, () => {
    test.use({ viewport: view.viewport, colorScheme: view.colorScheme, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    test('the article renders locally, compares branches and keeps its SDK gap explicit', async ({ page }) => {
      const errors = [], sockets = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('websocket', socket => sockets.push(socket.url()));
      page.on('request', request => requests.push(request.url()));
      const response = await page.goto('/sdk-guide.html');
      expect(response.status()).toBe(200);
      expect(response.headers()['content-security-policy']).toContain("font-src 'self'");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Claude thinks.Pi does the work.');
      await expect(page.locator('figure')).toHaveCount(4);
      await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
      expect(await page.evaluate(() => document.fonts.check('600 20px Bricolage'))).toBe(true);
      expect(await page.getByRole('heading', { level: 1 }).evaluate(element => getComputedStyle(element).fontFamily)).toContain('Bricolage');
      const shape = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        badAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash),
        ids: [...document.querySelectorAll('[id]')].map(element => element.id)
      }));
      expect(shape.overflow).toBe(false); expect(shape.badAnchors).toEqual([]); expect(new Set(shape.ids).size).toBe(shape.ids.length);
      const contrast = await page.evaluate(() => {
        const rgb = color => color.match(/[\d.]+/g).map(Number);
        const lum = color => rgb(color).slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        return ['h1 span', '.prose', '.byline', 'figcaption', '.pi-word', '.sdk-word', '.guard-word', '.worker-figure figcaption'].map(selector => {
          const element = document.querySelector(selector); let background = element;
          while (background.parentElement && rgb(getComputedStyle(background).backgroundColor)[3] === 0) background = background.parentElement;
          const a = lum(getComputedStyle(element).color), b = lum(getComputedStyle(background).backgroundColor);
          return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        });
      });
      for (const color of contrast) expect(color.ratio, color.selector).toBeGreaterThanOrEqual(4.5);
      await page.getByRole('button', { name: 'Pause motion' }).click();
      if (process.env.PI_GUIDE_EVIDENCE) {
        mkdirSync(process.env.PI_GUIDE_EVIDENCE, { recursive: true });
        await page.screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-top.png') });
        await page.screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-full.png'), fullPage: true });
        for (const [name, selector] of [['tools', '.tool-figure'], ['memories', '.memory-figure'], ['branches', '.branch-figure'], ['workers', '.worker-figure']]) {
          await page.locator(selector).screenshot({ path: join(process.env.PI_GUIDE_EVIDENCE, view.name + '-' + name + '.png') });
        }
      }
      const branch = page.locator('.branch-figure');
      await branch.scrollIntoViewIfNeeded();
      for (const [name, title, owner] of [
        ['Compact', 'A shorter working context', 'Same conversation A'],
        ['Clone', 'A copy of the completed tip', 'A becomes a new B'],
        ['Tree', 'Another path in the same file', 'Same conversation A'],
        ['Fork', 'Fork before later work', 'A becomes a new B']
      ]) {
        await branch.getByRole('button', { name, exact: true }).click();
        await expect(page.locator('#operation-title')).toHaveText(title);
        await expect(page.locator('#operation-owner')).toHaveText(owner);
        await expect(branch.locator('.unchanged')).toHaveText('Both past effects still exist');
        await expect(branch.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
      }
      await branch.getByRole('button', { name: 'Tree', exact: true }).focus(); await page.keyboard.press('Space');
      await expect(page.locator('#operation-title')).toHaveText('Another path in the same file');
      const details = page.getByText('What the verification establishes', { exact: true });
      await details.focus(); await page.keyboard.press('Enter');
      await expect(page.locator('details').filter({ has: details })).toHaveAttribute('open', '');
      await expect(page.getByText('No all-green full parity run is recorded.', { exact: false })).toBeVisible();
      expect(sockets).toEqual([]);
      expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

test('motion pauses on demand and offscreen, with no animation under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/sdk-guide.html');
  const figure = page.locator('.tool-figure'), svg = figure.locator('svg:visible');
  await expect(figure).toHaveAttribute('data-playing', 'true');
  await expect.poll(() => svg.evaluate(element => element.getCurrentTime())).toBeGreaterThan(.1);
  const packet = svg.locator('.request-packet').first(), start = await packet.boundingBox();
  await expect.poll(async () => { const point = await packet.boundingBox(); return Math.hypot(point.x - start.x, point.y - start.y); }).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(figure).toHaveAttribute('data-playing', 'false');
  const frozen = await svg.evaluate(element => element.getCurrentTime());
  await page.waitForTimeout(160);
  expect(Math.abs(await svg.evaluate(element => element.getCurrentTime()) - frozen)).toBeLessThan(.03);
  await page.locator('.worker-figure').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Play motion' }).click();
  await expect(figure).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.worker-figure')).toHaveAttribute('data-playing', 'true');
  await page.locator('.branch-figure').getByRole('button', { name: 'Compact', exact: true }).click();
  expect(await page.locator('[data-branch-path]').evaluateAll(paths => paths.flatMap(path => path.getAnimations()).length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion' })).toBeDisabled();
  await expect(page.locator('[data-playing="true"]')).toHaveCount(0);
  await page.locator('.branch-figure').getByRole('button', { name: 'Clone', exact: true }).click();
  await expect(page.locator('#operation-title')).toHaveText('A copy of the completed tip');
  expect(await page.locator('[data-branch-path]').evaluateAll(paths => paths.flatMap(path => path.getAnimations()).length)).toBe(0);
});

test('the blog and native disclosure remain readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:8799/sdk-guide.html');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.operation-switch')).toBeHidden();
    await expect(page.locator('#operation-title')).toHaveText('Fork before later work');
    await page.getByText('The four history operations, precisely', { exact: true }).click();
    await expect(page.locator('details[open]')).toContainText('Compaction');
    await expect(page.locator('details[open]')).toContainText('Tree');
  } finally { await context.close(); }
});

test('the article assets are explicit and font permission stays scoped to the article', async ({ request }) => {
  for (const [path, type] of [['/sdk-guide.css', 'text/css'], ['/sdk-guide.js', 'text/javascript'], ['/sdk-guide-font.woff2', 'font/woff2']]) {
    const response = await request.get(path); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain(type);
  }
  expect((await request.get('/')).headers()['content-security-policy']).not.toContain('font-src');
  for (const path of ['/docs/provider-gaps.md', '/sdk-guide.html/extra', '/web/sdk-guide.js']) expect((await request.get(path)).status()).toBe(404);
});
