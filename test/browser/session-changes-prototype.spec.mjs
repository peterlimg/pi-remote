import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

for (const view of [
  { name: 'phone-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: 'phone-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { name: 'narrow', viewport: { width: 320, height: 740 }, colorScheme: 'light' },
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' }
]) {
  test.describe(view.name, () => {
    test.use({ viewport: view.viewport, colorScheme: view.colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    test('all layouts review only the sample session work in its actual locations', async ({ page }) => {
      const errors = [], sockets = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('websocket', socket => sockets.push(socket.url()));
      page.on('request', request => requests.push(request.url()));
      const capture = async name => {
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          contentBottom: document.querySelector('#prototype-view').getBoundingClientRect().bottom,
          switcherTop: document.querySelector('.prototype-switcher').getBoundingClientRect().top
        }));
        expect(geometry.overflow).toBe(false);
        expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.switcherTop);
        if (!process.env.PI_CHANGES_EVIDENCE) return;
        mkdirSync(process.env.PI_CHANGES_EVIDENCE, { recursive: true });
        await page.screenshot({ path: join(process.env.PI_CHANGES_EVIDENCE, `${view.name}-${name}.png`), fullPage: true });
      };
      expect((await page.goto('/session-changes-prototype.html?variant=A')).status()).toBe(200);
      const main = page.getByRole('main'), selector = page.getByLabel('Work happens in');
      await expect(page.getByText('Sample data only', { exact: true })).toBeVisible();
      await expect(main.locator('.file-diff')).toHaveCount(3);
      await expect(main.locator('.location-path')).toHaveText('~/workspace/pi-remote/.worktrees/mobile-nav');
      await expect(main.locator('.changes-overview .diff-stats')).toHaveText('+15−2');
      await capture('A');
      await main.locator('.file-diff').first().locator('summary').click();
      await expect(main.getByRole('region', { name: 'Diff for web/app.js' })).toContainText('showSessions();');
      await main.locator('.file-diff').last().locator('summary').click();
      await expect(main.locator('.file-diff').last()).toContainText('Committed · a41c8d2');
      await expect(main.locator('.file-list')).not.toContainText('README.md');
      await main.getByText('1 shared file needs review', { exact: true }).click();
      await expect(main.locator('.shared-edits')).toContainText('No attributed diff available');
      await expect(main.locator('.shared-edits .code-scroll')).toHaveCount(0);
      await page.getByRole('button', { name: 'How session changes are scoped' }).click();
      await expect(page.locator('#scope-explanation')).toContainText('Git status alone cannot establish ownership');
      await page.getByRole('button', { name: 'How session changes are scoped' }).click();
      await main.getByRole('button', { name: 'Conversation', exact: true }).click();
      await main.getByRole('button', { name: /View this session's 3 changed files/ }).click();
      await expect(main.locator('.file-diff')).toHaveCount(3);
      await selector.selectOption('project');
      await expect(main.locator('.location-kind')).toHaveText('Current checkout');
      await expect(main.locator('.location-path')).toHaveText('~/workspace/pi-remote');
      await selector.selectOption('worktree');
      await page.getByRole('button', { name: 'Next prototype' }).click();
      await expect(page.locator('#variant-label')).toHaveText('B · In the conversation');
      await capture('B');
      const review = main.getByRole('button', { name: /3 files changed in this session/ });
      await review.click();
      const sheet = page.getByRole('dialog', { name: 'Session changes', exact: true });
      await expect(sheet).toBeVisible();
      await sheet.locator('.file-diff').first().locator('summary').click();
      await expect(sheet.getByRole('region', { name: 'Diff for web/app.js' })).toBeVisible();
      await capture('B-diff');
      await page.keyboard.press('Escape');
      await expect(sheet).not.toBeVisible();
      await expect(review).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#variant-label')).toHaveText('C · Locations first');
      await capture('C');
      await selector.selectOption('nested');
      await expect(main.locator('.work-location')).toHaveCount(2);
      await capture('C-nested');
      await main.getByRole('button', { name: /phone Subdirectory/ }).click();
      await expect(main.locator('.file-diff')).toHaveCount(2);
      await expect(main.locator('.location-path')).toHaveText('~/workspace/product/apps/phone');
      await main.getByRole('button', { name: 'Work locations', exact: true }).click();
      await main.getByRole('button', { name: /navigation-tests Nested repository/ }).click();
      await expect(main.locator('.file-diff')).toHaveCount(1);
      await expect(main.locator('.file-state')).toContainText('Committed');
      await selector.selectOption('empty');
      await expect(main.getByRole('heading', { name: 'No captured changes yet' })).toBeVisible();
      await expect(main.locator('.file-diff')).toHaveCount(0);
      await expect(main.locator('.shared-edits')).toHaveCount(0);
      await capture('empty');
      await page.goto('/session-changes-prototype.html?variant=A&scenario=tasks');
      const tasks = main.locator('.task-change'), navigationTask = tasks.nth(0), loginTask = tasks.nth(1), coverageTask = tasks.nth(2);
      await expect(tasks).toHaveCount(3);
      await expect(main.locator('.changes-overview')).toContainText('3 tasks · 2 worktrees');
      await expect(main.locator('.changes-overview .diff-stats')).toHaveText('+24−4');
      await expect(main.locator('.task-change[open]')).toHaveCount(0);
      await capture('tasks-overview');
      await page.getByRole('button', { name: 'How session changes are scoped' }).click();
      await expect(page.locator('#scope-locations code')).toHaveText(['~/workspace/pi-remote/.worktrees/mobile-nav', '~/workspace/pi-remote/.worktrees/login-flow']);
      await page.getByRole('button', { name: 'How session changes are scoped' }).click();
      await navigationTask.locator(':scope > summary').click();
      await expect(navigationTask.locator('.file-diff')).toHaveCount(2);
      await expect(navigationTask.locator('.task-meta .worktree-badge')).toHaveText('mobile-nav');
      await expect(navigationTask.locator('.location-path')).toHaveCount(0);
      await capture('tasks-navigation');
      await navigationTask.locator('.file-diff').first().locator('summary').click();
      await expect(navigationTask.getByRole('region', { name: 'Diff for web/app.js' })).toContainText('showSessions();');
      await navigationTask.locator(':scope > summary').click();
      await loginTask.locator(':scope > summary').click();
      await loginTask.locator('.file-diff').first().locator('summary').click();
      await expect(loginTask.getByRole('region', { name: 'Diff for web/app.js' })).toContainText('code.trim()');
      await expect(loginTask.getByRole('region', { name: 'Diff for web/app.js' })).not.toContainText('showSessions();');
      await expect(loginTask.locator('.task-meta .worktree-badge')).toHaveText('login-flow');
      await expect(loginTask.locator('.location-path')).toHaveCount(0);
      await loginTask.scrollIntoViewIfNeeded();
      await capture('tasks-login-diff');
      await loginTask.locator(':scope > summary').click();
      await coverageTask.locator(':scope > summary').click();
      await expect(coverageTask.locator('.task-location')).toHaveCount(2);
      await expect(coverageTask.locator('.location-name strong')).toHaveText(['mobile-nav', 'login-flow']);
      await expect(coverageTask.locator('.file-state')).toHaveText(['Committed · a41c8d2', 'Committed · b57de10']);
      await coverageTask.scrollIntoViewIfNeeded();
      await capture('tasks-cross-worktree');
      await coverageTask.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      await expect(coverageTask).not.toHaveAttribute('open', '');
      expect(errors).toEqual([]); expect(sockets).toEqual([]);
      expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
    });
  });
}

test('variant links survive reload, arrows wrap, and selectors keep their keyboard controls', async ({ page }) => {
  await page.goto('/session-changes-prototype.html?variant=B&scenario=nested');
  await expect(page.locator('#variant-label')).toHaveText('B · In the conversation');
  await expect(page.getByLabel('Work happens in')).toHaveValue('nested');
  await page.reload();
  await expect(page.locator('#variant-label')).toHaveText('B · In the conversation');
  await page.getByRole('button', { name: 'Previous prototype' }).click();
  await expect(page).toHaveURL(/variant=A/);
  await page.getByRole('button', { name: 'Previous prototype' }).click();
  await expect(page).toHaveURL(/variant=C/);
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=A/);
  await page.getByLabel('Work happens in').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#variant-label')).toHaveText('A · Changes tab');
  await page.goto('/session-changes-prototype.html?variant=invalid&scenario=__proto__');
  await expect(page.locator('#variant-label')).toHaveText('A · Changes tab');
  await expect(page.getByLabel('Work happens in')).toHaveValue('worktree');
});

test('only the explicit prototype assets are served, without relaxing the content policy', async ({ request }) => {
  for (const [suffix, type] of [['html', 'text/html'], ['css', 'text/css'], ['js', 'text/javascript']]) {
    const response = await request.get('/session-changes-prototype.' + suffix);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(type);
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
  for (const path of ['/web/session-changes-prototype.js', '/session-changes-prototype.html/extra', '/docs/tasks/']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
