import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = '/codemode-prototype.html';
const variants = ['purpose', 'recap', 'source'];
const assets = [route, '/codemode-prototype.css', '/codemode-prototype.js', '/style.css', '/icon.svg'];
const capture = async (page, name) => {
  if (!process.env.PI_CODEMODE_EVIDENCE) return;
  mkdirSync(process.env.PI_CODEMODE_EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(process.env.PI_CODEMODE_EVIDENCE, name + '.png'), fullPage: true });
};
const openActivity = async page => {
  const activity = page.locator('.cm-activity');
  if (!await activity.evaluate(node => node.open)) await activity.locator(':scope > summary').click();
  return activity;
};

for (const view of [
  { name: 'phone-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { name: 'narrow', viewport: { width: 320, height: 740 }, colorScheme: 'light' },
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' }
]) {
  test.describe(view.name, () => {
    test.use({ viewport: view.viewport, colorScheme: view.colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    test('all summaries fit one collapsed row without connecting or executing', async ({ page }) => {
      const errors = [], sockets = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('websocket', socket => sockets.push(socket.url()));
      page.on('request', request => requests.push(new URL(request.url()).pathname));
      for (const variant of variants) {
        await page.goto(`${route}?variant=${variant}`);
        await expect(page.locator(`.cm-${variant}`)).toBeVisible();
        await expect(page.getByRole('main')).toContainText('working indicator');
        await expect(page.locator('.cm-activity')).toHaveJSProperty('open', false);
        await expect(page.locator('.cm-activity > summary')).toContainText('Codemode · ');
        await expect(page.locator('.cm-run').first()).not.toBeVisible();
        await expect(page.getByText('Prototype · Sample data', { exact: true })).toBeVisible();
        await expect(page.locator('#composer')).toBeVisible();
        expect(await page.locator('#composer').evaluate(node => !!node.closest('[inert]'))).toBe(true);
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          threadOverflow: document.querySelector('#study-thread').scrollWidth > document.querySelector('#study-thread').clientWidth,
          activityHeight: document.querySelector('.cm-activity').getBoundingClientRect().height,
          composerBottom: document.querySelector('#composer').getBoundingClientRect().bottom,
          switcherTop: document.querySelector('.study-switcher').getBoundingClientRect().top,
          targets: [...document.querySelectorAll('.study-switcher button, .cm-detail summary')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect().height)
        }));
        expect(geometry.overflow).toBe(false);
        expect(geometry.threadOverflow).toBe(false);
        expect(geometry.activityHeight).toBe(44);
        expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.switcherTop);
        expect(geometry.targets.every(height => height >= 44)).toBe(true);
        await capture(page, `${view.name}-${variant}`);
      }
      expect(sockets).toEqual([]);
      expect(requests.every(path => assets.includes(path))).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

test('variant and state comparison are shareable, reload-stable and keyboard accessible', async ({ page }) => {
  await page.goto(`${route}?variant=purpose`);
  await expect(page.locator('#variant-label')).toContainText('A · Action words');
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=recap/);
  await expect(page.locator('.cm-run').first()).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.cm-recap')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-source')).toBeVisible();
  await page.getByLabel('Sample run state').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.cm-source')).toBeVisible();
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page.locator('.cm-purpose')).toBeVisible();
  await page.getByRole('button', { name: 'Previous prototype' }).click();
  await expect(page.locator('.cm-source')).toBeVisible();
  await page.goto(`${route}?variant=unknown&state=__proto__`);
  await expect(page.locator('.cm-purpose')).toBeVisible();
  await expect(page.getByLabel('Sample run state')).toHaveValue('done');
  await page.getByRole('button', { name: 'About these prototypes' }).click();
  await expect(page.locator('#study-info')).toBeVisible();
  await expect(page.locator('#study-info')).toContainText('not a structured stream of inner tool calls');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-purpose')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#study-info')).not.toBeVisible();
});

for (const variant of variants) {
  test(`${variant} opens output before script and distinguishes running, failure and empty samples`, async ({ page }) => {
    await page.goto(`${route}?variant=${variant}`);
    const activity = await openActivity(page);
    const first = page.locator('.cm-run[data-run="read"]');
    const final = page.locator('.cm-run[data-run="check"]');
    if (!await first.evaluate(node => node.open)) {
      await first.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
    }
    await expect(first.locator('.cm-output')).toBeVisible();
    await expect(first.locator('.cm-script pre')).not.toBeVisible();
    await first.locator('.cm-script > summary').click();
    await expect(first.locator('.cm-script pre')).toContainText('tools.read');
    await expect(first.locator('.cm-script pre')).toBeVisible();
    await capture(page, `${variant}-evidence`);
    await activity.locator(':scope > summary').click();
    await expect(first.locator('.cm-output')).not.toBeVisible();
    await activity.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('.cm-output')).toBeVisible();
    await page.getByLabel('Sample run state').selectOption('working');
    await expect(page).toHaveURL(/state=working/);
    await expect(activity).toHaveJSProperty('open', false);
    expect(await activity.evaluate(node => node.getBoundingClientRect().height)).toBe(44);
    await openActivity(page);
    await expect(final).toHaveAttribute('data-status', 'working');
    await final.locator(':scope > summary').click();
    await expect(final.locator('.cm-output')).toContainText('No final result yet');
    await expect(final.locator('.cm-time')).toHaveText('Running');
    await expect(activity.locator(':scope > summary')).not.toContainText(/steps complete|Checked session list/);
    await final.scrollIntoViewIfNeeded();
    await capture(page, `${variant}-working`);
    await page.getByLabel('Sample run state').selectOption('error');
    await expect(activity).toHaveJSProperty('open', false);
    expect(await activity.evaluate(node => node.getBoundingClientRect().height)).toBe(44);
    await expect(activity.locator(':scope > summary')).toContainText('failed');
    await expect(final.locator('.cm-output')).not.toBeVisible();
    await capture(page, `${variant}-error-collapsed`);
    await openActivity(page);
    await expect(final).toHaveAttribute('data-status', 'error');
    await final.locator(':scope > summary').click();
    await expect(final.locator('.cm-output')).toHaveText('Expected the working indicator to remain visible.\n1 failed. Exit code 1.');
    await final.scrollIntoViewIfNeeded();
    await capture(page, `${variant}-error`);
    expect(await page.locator('#study-thread').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.reload();
    await expect(final).toHaveAttribute('data-status', 'error');
    await page.getByLabel('Sample run state').selectOption('empty');
    await expect(page.locator('.cm-run')).toHaveCount(0);
    await expect(activity.locator(':scope > summary')).toContainText('No activity yet');
    await page.getByLabel('Sample run state').selectOption('done');
    await expect(page.locator('.cm-run')).toHaveCount(3);
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
