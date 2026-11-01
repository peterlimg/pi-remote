import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const route = '/coordinator-prototype.html';
const names = { A: 'Conversation first', B: 'Attention first', C: 'Task strip' };
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
function observe(page) {
  const errors = [], sockets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  return () => {
    expect(errors).toEqual([]);
    expect(sockets).toEqual([]);
    const origin = new URL(page.url()).origin;
    const allowed = [route, '/coordinator-prototype.js', '/coordinator-prototype.css', '/style.css', '/icon.svg'];
    expect(requests.filter(request => new URL(request.url).origin !== origin || !allowed.includes(new URL(request.url).pathname) || request.method !== 'GET' || ['fetch', 'xhr', 'websocket'].includes(request.type))).toEqual([]);
  };
}
async function geometry(page) {
  const result = await page.evaluate(() => ({
    documentOverflow: scrollY !== 0 || document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    contentOverflow: [...document.querySelectorAll('.scroll-region, .selected-task')].some(element => element.scrollWidth > element.clientWidth),
    frameBottom: document.querySelector('.coordinator-frame').getBoundingClientRect().bottom,
    switcherTop: document.querySelector('.prototype-switcher').getBoundingClientRect().top,
    mainHeight: document.querySelector('#prototype-view').getBoundingClientRect().height,
    composerWidth: document.querySelector('#message-form').getBoundingClientRect().width
  }));
  expect(result.documentOverflow).toBe(false);
  expect(result.contentOverflow).toBe(false);
  expect(result.frameBottom).toBeLessThanOrEqual(result.switcherTop);
  expect(result.mainHeight).toBeGreaterThan(80);
  expect(result.composerWidth).toBeGreaterThan(250);
}
async function capture(page, name) {
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.demo-bar')).toBeInViewport();
  if (!process.env.PI_COORDINATOR_EVIDENCE) return;
  mkdirSync(process.env.PI_COORDINATOR_EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(process.env.PI_COORDINATOR_EVIDENCE, `${name}.png`), fullPage: true });
}

for (const view of [
  { name: 'phone-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { name: 'narrow', viewport: { width: 320, height: 740 }, colorScheme: 'light' },
  { name: 'desktop-light', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' },
  { name: 'desktop-dark', viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' }
]) {
  test.describe(view.name, () => {
    test.use({ viewport: view.viewport, colorScheme: view.colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    test('three distinct hierarchies fit without document or content overflow', async ({ page }) => {
      const assertIsolated = observe(page);
      for (const [key, name] of Object.entries(names)) {
        expect((await page.goto(`${route}?variant=${key}`)).status()).toBe(200);
        await expect(page.locator('#variant-label')).toHaveText(`${key} · ${name}`);
        await expect(page.getByText('Synthetic data · resets on reload', { exact: true })).toBeVisible();
        await expect(page.locator('#composer-target')).toHaveText('To Coordinator · new request');
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
        await expect(page.locator(key === 'A' ? '.layout-conversation .task-update' : key === 'B' ? '.attention-question' : '.task-strip').first()).toBeVisible();
        await geometry(page);
        if (view.name !== 'narrow') await capture(page, `${view.name}-${key}`);
      }
      assertIsolated();
    });
  });
}

for (const key of Object.keys(names)) {
  test(`variant ${key}: new work, targeted replies, permission, isolated stop, and sample inspection`, async ({ page }) => {
    const assertIsolated = observe(page);
    await page.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem', 'clear']) {
        Storage.prototype[name] = () => { throw new Error('Prototype must not use browser storage'); };
      }
    });
    await page.goto(`${route}?variant=${key}`);
    const main = page.getByRole('main');
    const openTask = async id => {
      if (key === 'B') await page.getByRole('button', { name: /^Needs you/ }).click();
      if (key === 'C') {
        await main.locator(`[data-action="select"][data-task="${id}"]`).click();
        await main.locator('.selected-task [data-action="open"]').click();
      } else await main.locator(`[data-action="open"][data-task="${id}"]`).first().click();
      await expect(main.getByRole('region', { name: `Task ${id} details` })).toBeVisible();
    };
    const back = () => page.locator('#return-coordinator').click();
    await page.getByLabel('To Coordinator · new request').fill('Review empty states <sample>');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(main).toContainText('In this demo, Task 5 takes that request.');
    await expect(main.locator('.user-message').last()).toContainText('Review empty states <sample>');
    if (key === 'C') {
      const before = await main.locator('.conversation-scroll').evaluate(element => element.scrollTop);
      expect(before).toBeGreaterThan(0);
      await main.locator('[data-action="select"][data-task="A"]').click();
      const after = await main.locator('.conversation-scroll').evaluate(element => ({ top: element.scrollTop, maximum: element.scrollHeight - element.clientHeight }));
      expect(after.top).toBeCloseTo(Math.min(before, after.maximum), 0);
    }
    await page.getByLabel('To Coordinator · new request').fill('Keep this coordinator draft.');
    await openTask('B');
    await main.getByRole('button', { name: 'Reply to B', exact: true }).click();
    await expect(page.locator('#composer-target')).toHaveText('To Task B · Login only');
    await expect(page.locator('#composer-note')).toHaveText('Demo reply only. Permission stays unanswered.');
    await page.getByLabel('To Task B · Login only').fill('Keep the labels short. This is not approval.');
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(main.locator('.task-reply')).toContainText('You → Worker B');
    await expect(main.locator('.task-reply')).toContainText('Keep the labels short. This is not approval.');
    await expect(main.locator('.task-reply')).toBeInViewport();
    await expect(page.locator('.coordinator-header')).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(main.locator('.detail-context .task-status')).toHaveText('Needs permission');
    if (key === 'B') await capture(page, 'phone-light-B-task-reply');
    await main.getByRole('button', { name: 'Sample session', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Worker B · sample session' })).toBeVisible();
    await expect(main).toContainText('Read-only synthetic transcript. Not a live connection.');
    await expect(main.locator('.user-message').last()).toContainText('Keep the labels short. This is not approval.');
    await expect(page.locator('#message-form')).toBeHidden();
    if (key === 'C') await capture(page, 'phone-light-C-sample-session');
    await main.getByRole('button', { name: 'Return to coordinator' }).click();
    await expect(page.getByLabel('To Coordinator · new request')).toHaveValue('Keep this coordinator draft.');
    await openTask('A');
    await expect(main.locator('.detail-context .task-status')).toHaveText('Running');
    await expect(main.locator('.task-replies')).toContainText('No replies in this demo yet.');
    await main.getByRole('button', { name: 'Stop Task A', exact: true }).click();
    const stop = page.getByRole('dialog', { name: 'Stop Task A only?' });
    await expect(stop).toBeVisible();
    await stop.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(main.locator('.detail-context .task-status')).toHaveText('Running');
    await main.getByRole('button', { name: 'Stop Task A', exact: true }).click();
    await stop.getByRole('button', { name: 'Stop Task A in demo', exact: true }).click();
    await expect(main.locator('.detail-context .task-status')).toHaveText('Stopped · unverified');
    await expect(main).toContainText('Nothing was rolled back, resumed, or verified.');
    if (key === 'A') await capture(page, 'phone-light-A-stopped-task');
    await back();
    await openTask('B');
    await expect(main.locator('.detail-context .task-status')).toHaveText('Needs permission');
    await expect(main.locator('.task-reply')).toHaveCount(1);
    await main.getByRole('button', { name: 'Review permission', exact: true }).click();
    const permission = page.getByRole('dialog', { name: 'Allow Task B to change saved login?' });
    await expect(permission).toBeVisible();
    await expect(permission.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(main.locator('.detail-context .task-status')).toHaveText('Needs permission');
    await main.getByRole('button', { name: 'Review permission', exact: true }).click();
    await permission.getByRole('button', { name: 'Keep saved format', exact: true }).click();
    await expect(main).toContainText('Saved format stays unchanged. Continuing with labels only.');
    await back();
    await openTask('C');
    await expect(main).toContainText('Synthetic measurements, not a real audit.');
    await main.getByRole('button', { name: 'Mark result as read', exact: true }).click();
    await expect(main.locator('.detail-context .task-status')).toHaveText('Result ready');
    await back();
    await openTask('5');
    await expect(main.locator('.detail-context .task-status')).toHaveText('Running');
    await expect(main).toContainText('No real worker was started');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.locator('#variant-label')).toHaveText(`${key} · ${names[key]}`);
    await expect(page.getByLabel('To Coordinator · new request')).toHaveValue('');
    await expect(main).not.toContainText('Review empty states <sample>');
    await openTask('A');
    await expect(main.locator('.detail-context .task-status')).toHaveText('Running');
    await back();
    await openTask('B');
    await expect(main.locator('.detail-context .task-status')).toHaveText('Needs permission');
    await expect(main.locator('.task-reply')).toHaveCount(0);
    // The allow path is also explicit, and does not claim real worker acknowledgement.
    await main.getByRole('button', { name: 'Review permission', exact: true }).click();
    await permission.getByRole('button', { name: 'Allow change in demo', exact: true }).click();
    await expect(main).toContainText('Format change explicitly allowed in this demo.');
    await expect(main).toContainText('not an actual permission or worker acknowledgement');
    assertIsolated();
  });
}

test('URL navigation wraps, survives reload, and leaves typing and modal arrow keys alone', async ({ page }) => {
  const assertIsolated = observe(page);
  await page.goto(`${route}?variant=B`);
  await page.reload();
  await expect(page.locator('#variant-label')).toHaveText('B · Attention first');
  await page.getByRole('button', { name: 'Previous prototype' }).click();
  await expect(page).toHaveURL(/variant=A/);
  await page.getByRole('button', { name: 'Previous prototype' }).click();
  await expect(page).toHaveURL(/variant=C/);
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=A/);
  await page.getByLabel('To Coordinator · new request').fill('Typing a request');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/variant=A/);
  await page.getByRole('button', { name: 'Reset', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/variant=C/);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/variant=A/);
  await page.getByRole('button', { name: 'Review permission', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/variant=A/);
  await page.keyboard.press('Escape');
  await page.goto(`${route}?variant=invalid`);
  await expect(page.locator('#variant-label')).toHaveText('A · Conversation first');
  await expect(page).toHaveURL(/variant=A/);
  assertIsolated();
});

test('the real static server exposes only the three fixed assets under the existing CSP', async ({ request }) => {
  for (const [suffix, type] of [['html', 'text/html'], ['css', 'text/css'], ['js', 'text/javascript']]) {
    const response = await request.get('/coordinator-prototype.' + suffix);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(type);
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
  for (const path of ['/web/coordinator-prototype.js', route + '/extra']) expect((await request.get(path)).status()).toBe(404);
});
