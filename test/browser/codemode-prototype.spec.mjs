import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = '/codemode-prototype.html';
const assets = [route, '/codemode-prototype.css', '/codemode-prototype.js',
  '/codemode-sol-prototype.css', '/codemode-sol-prototype.js',
  '/codemode-astra-prototype.css', '/codemode-astra-prototype.js', '/style.css', '/icon.svg'];
const capture = async (page, name) => {
  if (!process.env.PI_CODEMODE_EVIDENCE) return;
  mkdirSync(process.env.PI_CODEMODE_EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(process.env.PI_CODEMODE_EVIDENCE, name + '.png'), fullPage: true });
};

for (const view of [
  { name: 'phone-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { name: 'narrow', viewport: { width: 320, height: 740 }, colorScheme: 'light' },
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' }
]) {
  test.describe(view.name, () => {
    test.use({ viewport: view.viewport, colorScheme: view.colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    test('both independent designs fit the conversation without connecting or executing', async ({ page }) => {
      const errors = [], sockets = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('websocket', socket => sockets.push(socket.url()));
      page.on('request', request => requests.push(new URL(request.url()).pathname));
      for (const model of ['sol', 'astra']) {
        await page.goto(`${route}?variant=${model}`);
        await expect(page.locator(`.cm-${model}`)).toBeVisible();
        await expect(page.getByRole('main')).toContainText('codemode');
        await expect(page.getByRole('main')).toContainText('manual icons and emoji');
        await expect(page.getByRole('main')).toContainText(/10m\s?28s/);
        await expect(page.getByText('Prototype · Sample data', { exact: true })).toBeVisible();
        await expect(page.locator('#composer')).toBeVisible();
        expect(await page.locator('#composer').evaluate(node => !!node.closest('[inert]'))).toBe(true);
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          threadOverflow: document.querySelector('#study-thread').scrollWidth > document.querySelector('#study-thread').clientWidth,
          composerBottom: document.querySelector('#composer').getBoundingClientRect().bottom,
          switcherTop: document.querySelector('.study-switcher').getBoundingClientRect().top
        }));
        expect(geometry.overflow).toBe(false);
        expect(geometry.threadOverflow).toBe(false);
        expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.switcherTop);
        await capture(page, `${view.name}-${model}`);
      }
      expect(sockets).toEqual([]);
      expect(requests.every(path => assets.includes(path))).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

test('model and state comparison are shareable, reload-stable and keyboard accessible', async ({ page }) => {
  await page.goto(`${route}?variant=sol`);
  await expect(page.locator('#variant-label')).toContainText('Sol 6.1 · Max');
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=astra/);
  await expect(page.locator('#variant-label')).toContainText('Astra 6 · High');
  await page.reload();
  await expect(page.locator('.cm-astra')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-sol')).toBeVisible();
  await page.getByLabel('Sample run state').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.cm-sol')).toBeVisible();
  await page.getByRole('button', { name: 'Previous prototype' }).click();
  await expect(page.locator('.cm-astra')).toBeVisible();
  await page.goto(`${route}?variant=unknown&state=__proto__`);
  await expect(page.locator('.cm-sol')).toBeVisible();
  await expect(page.getByLabel('Sample run state')).toHaveValue('done');
  await page.getByRole('button', { name: 'About these prototypes' }).click();
  await expect(page.locator('#study-info')).toBeVisible();
  await expect(page.locator('#study-info')).toContainText('not a structured stream of inner tool calls');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-sol')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#study-info')).not.toBeVisible();
});

for (const model of ['sol', 'astra']) {
  test(`${model} opens evidence with keyboard and shows running, failure and empty samples`, async ({ page }) => {
    await page.goto(`${route}?variant=${model}`);
    const activity = page.locator(model === 'sol' ? '.cm-sol-activity' : '.cm-astra-ledger');
    const first = page.locator(model === 'sol' ? '.cm-sol-run[data-run="read"]' : '.cm-astra-run[data-run="1"]');
    const final = page.locator(model === 'sol' ? '.cm-sol-run[data-run="browser"]' : '.cm-astra-run[data-run="5"]');
    await first.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('pre').first()).toBeVisible();
    await first.locator('details summary').click();
    await expect(first.locator('pre').last()).toBeVisible();
    await expect(first.locator('pre').last()).toContainText('tools.read');
    await capture(page, `${model}-evidence`);
    await activity.locator(':scope > summary').click();
    await expect(first.locator('pre').first()).not.toBeVisible();
    await activity.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('pre').first()).toBeVisible();
    await page.getByLabel('Sample run state').selectOption('working');
    await expect(page).toHaveURL(/state=working/);
    await expect(final).toHaveAttribute('data-status', 'working');
    await expect(final.locator('pre').first()).toBeVisible();
    await expect(final.locator('pre').first()).toContainText('No final result yet');
    await final.scrollIntoViewIfNeeded();
    await capture(page, `${model}-working`);
    await page.getByLabel('Sample run state').selectOption('error');
    await expect(final).toHaveAttribute('data-status', 'error');
    await expect(final.locator('pre').first()).toBeVisible();
    await expect(final.locator('pre').first()).toHaveText('Expected the default character to stay the same after rename. 1 failed, 4 passed.');
    await final.scrollIntoViewIfNeeded();
    await capture(page, `${model}-error`);
    expect(await page.locator('#study-thread').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.reload();
    await expect(final).toHaveAttribute('data-status', 'error');
    await page.getByLabel('Sample run state').selectOption('empty');
    await expect(page.locator(`.cm-${model}-run`)).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText(/No (codemode )?runs/);
    await page.getByLabel('Sample run state').selectOption('done');
    await expect(page.locator(`.cm-${model}-run`)).toHaveCount(5);
  });
}

test('only explicit study assets are served and the production composer is unchanged', async ({ request }) => {
  for (const path of assets) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
  }
  for (const path of ['/web/codemode-prototype.js', '/codemode-prototype.html/extra', '/codemode-private.json']) {
    expect((await request.get(path)).status()).toBe(404);
  }
  const composer = source => source.match(/      <form id="composer"[\s\S]*?      <\/form>/)[0];
  expect(composer(readFileSync('web/codemode-prototype.html', 'utf8'))).toBe(composer(readFileSync('web/index.html', 'utf8')));
});
