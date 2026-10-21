import { test, expect } from '@playwright/test';
import { browserOrigin } from '../browser-config.mjs';
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
      await expect(page.locator('.byline time')).toHaveAttribute('datetime', '2026-10-19');
      await expect(page.locator('#worker-gap')).toContainText('before either child reached the SDK');
      await expect(page.locator('#delegate-fix')).toContainText('complete canonical Pi base');
      await expect(page.locator('#delegate-fix')).toContainText('unchanged suffix of child instructions');
      await expect(page.locator('#worker-gap')).toContainText('Codex, SDK Haiku and SDK Opus');
      await expect(page.locator('.worker-figure')).toContainText('Retained resume stops here.');
      await expect(page.locator('#what-remains')).toContainText('Explicitly forced foreground delegates');
      await expect(page.locator('a[href$="/verification-inherited.json"]')).toHaveAttribute('href', 'https://github.com/peterlimg/pi-remote/blob/558dfed/experiments/claude-sdk-provider/verification-inherited.json');
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
        for (const [name, selector] of [['tools', '.tool-figure'], ['memories', '.memory-figure'], ['branches', '.branch-figure'], ['delegates', '#worker-gap'], ['workers', '.worker-figure']]) {
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
      await expect(page.getByRole('row', { name: /Inherited prompt projection/ })).toContainText('10');
      await expect(page.getByText('Nine selected rows passed', { exact: false })).toBeVisible();
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
  const packetDurations = await figure.locator('animateMotion').evaluateAll(elements => elements.map(element => element.getSimpleDuration()));
  expect(packetDurations).toHaveLength(8);
  for (const duration of packetDurations) expect(duration).toBeCloseTo(1.2, 3);
  expect(await page.locator('.page-front').evaluate(element => getComputedStyle(element).animationDuration)).toBe('5s');
  expect(await page.locator('.traveler').first().evaluate(element => getComputedStyle(element).animationDuration)).toBe('2.4s');
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
  const durations = await page.locator('[data-branch-path]').evaluateAll(paths => paths.flatMap(path => path.getAnimations()).map(animation => animation.effect.getTiming().duration));
  expect(durations.length).toBeGreaterThan(0); expect(durations.every(duration => duration === 300)).toBe(true);
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
    const page = await context.newPage(); await page.goto(browserOrigin + '/sdk-guide.html');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.operation-switch')).toBeHidden();
    await expect(page.locator('#operation-title')).toHaveText('Fork before later work');
    await page.getByText('The four history operations, precisely', { exact: true }).click();
    await expect(page.locator('details[open]')).toContainText('Compaction');
    await expect(page.locator('details[open]')).toContainText('Tree');
  } finally { await context.close(); }
});

test('the article exposes a static large-image preview to X without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, userAgent: 'Twitterbot/1.0' });
  try {
    const page = await context.newPage();
    expect((await page.goto(browserOrigin + '/sdk-guide.html')).status()).toBe(200);
    const canonical = 'https://claude-sdk-in-pi.vercel.app/';
    const title = 'Claude thinks. Pi does the work.';
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
    for (const [selector, content] of [
      ['meta[property="og:type"]', 'article'],
      ['meta[property="og:url"]', canonical],
      ['meta[property="og:title"]', title],
      ['meta[property="og:image:type"]', 'image/png'],
      ['meta[property="og:image:width"]', '1200'],
      ['meta[property="og:image:height"]', '600'],
      ['meta[name="twitter:card"]', 'summary_large_image'],
      ['meta[name="twitter:title"]', title]
    ]) await expect(page.locator(selector)).toHaveAttribute('content', content);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image).toBe(canonical + 'sdk-guide-social.png?v=assembly-1');
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', image);
    const alt = await page.locator('meta[property="og:image:alt"]').getAttribute('content');
    expect(alt).toContain('orange asterisk'); expect(alt).toContain('green Pi sculpture');
    expect(alt).toContain('Tools, permissions and history stay in Pi'); expect(alt.length).toBeLessThanOrEqual(420);
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', alt);
    const imagePath = new URL(image).pathname + new URL(image).search;
    const response = await context.request.get(browserOrigin + imagePath);
    expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('image/png');
    const bytes = await response.body();
    expect(bytes.length).toBeLessThan(5_000_000); expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1200); expect(bytes.readUInt32BE(20)).toBe(600);
    expect(bytes.includes(Buffer.from('impeccable:prompt\0Rendered from scripts/sdk-guide-social.html'))).toBe(true);
    await page.goto(browserOrigin + imagePath);
    await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 1200);
    await expect(page.locator('img')).toHaveJSProperty('naturalHeight', 600);
  } finally { await context.close(); }
});

test('the article assets are explicit and font permission stays scoped to the article', async ({ request }) => {
  for (const [path, type] of [['/sdk-guide.css', 'text/css'], ['/sdk-guide.js', 'text/javascript'], ['/sdk-guide-font.woff2', 'font/woff2']]) {
    const response = await request.get(path); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain(type);
  }
  expect((await request.get('/')).headers()['content-security-policy']).not.toContain('font-src');
  for (const path of ['/docs/provider-gaps.md', '/sdk-guide.html/extra', '/web/sdk-guide.js', '/sdk-guide-social.svg', '/scripts/sdk-guide-social.html', '/sdk-guide-social.html']) expect((await request.get(path)).status()).toBe(404);
});
