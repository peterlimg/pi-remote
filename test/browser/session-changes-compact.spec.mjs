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
    test('flat review layouts preserve conversation access and worktree identity', async ({ page }) => {
      const errors = [], sockets = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('websocket', socket => sockets.push(socket.url()));
      const capture = async name => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        if (!process.env.PI_CHANGES_EVIDENCE) return;
        mkdirSync(process.env.PI_CHANGES_EVIDENCE, { recursive: true });
        await page.screenshot({ path: join(process.env.PI_CHANGES_EVIDENCE, `${view.name}-${name}.png`) });
      };
      await page.goto('/session-changes-prototype.html?variant=D&scenario=tasks');
      const main = page.getByRole('main'), task = main.getByRole('combobox', { name: 'Review task' });
      const code = () => main.getByRole('region', { name: 'Diff for web/app.js' });
      await expect(task).toHaveValue('1');
      await expect(code()).toContainText('code.trim()');
      await expect(main.locator('.review-location-details code')).toBeHidden();
      const badge = await main.locator('.review-heading .worktree-badge').boundingBox();
      const target = await main.getByLabel('Work location details').boundingBox();
      expect(badge.height).toBeLessThanOrEqual(24);
      expect(target.height).toBeGreaterThanOrEqual(44);
      await main.getByLabel('Work location details').click();
      await expect(main.locator('.review-location-details code')).toHaveText('~/workspace/pi-remote/.worktrees/login-flow');
      await main.getByLabel('Work location details').click();
      await task.selectOption('0');
      await expect(code()).toContainText('showSessions();');
      await expect(code()).not.toContainText('code.trim()');
      await task.selectOption('2');
      await expect(main.locator('.review-file-list button small')).toHaveText(['mobile-nav', 'login-flow']);
      await main.locator('[data-review-file="1"]').click();
      await expect(main.locator('.review-diff-state')).toContainText('Committed · b57de10');
      await task.selectOption('1');
      await capture('D');
      await main.getByRole('button', { name: 'Conversation', exact: true }).click();
      await expect(main.locator('.sample-transcript')).toBeVisible();
      await main.focus(); await page.keyboard.press('End');
      await expect(main.getByRole('button', { name: 'Changes 6', exact: true })).toBeInViewport();
      await capture('D-conversation');
      await main.getByRole('button', { name: 'Changes 6', exact: true }).click();
      await expect(code()).toContainText('code.trim()');
      await page.getByRole('button', { name: 'Next prototype' }).click();
      await expect(page.locator('#variant-label')).toHaveText('E · Chat + changes');
      await expect(main.locator('.linked-chat')).toBeInViewport();
      await expect(code()).toContainText('code.trim()');
      await capture('E');
      await main.getByRole('button', { name: 'Navigation', exact: true }).click();
      await expect(code()).toContainText('showSessions();');
      await main.getByRole('button', { name: 'Tests', exact: true }).click();
      await expect(main.getByRole('combobox', { name: 'File to review' }).locator('option')).toHaveText([
        'mobile-nav / test/browser/navigation.spec.mjs', 'login-flow / test/browser/pairing.spec.mjs'
      ]);
      await main.getByRole('combobox', { name: 'File to review' }).selectOption('1');
      await expect(main.locator('.review-diff-state')).toContainText('Committed · b57de10');
      await main.getByRole('button', { name: 'Hide changes' }).click();
      await expect(main.locator('.inline-review')).toHaveCount(0);
      await main.getByRole('button', { name: 'Review 6 session files' }).click();
      await expect(main.locator('.inline-review')).toBeVisible();
      await page.getByRole('button', { name: 'Next prototype' }).click();
      await expect(page.locator('#variant-label')).toHaveText('F · File browser');
      await expect(main.locator('.browser-file')).toHaveCount(6);
      await capture('F');
      await main.getByRole('combobox', { name: 'Filter worktrees' }).selectOption('1');
      await expect(main.locator('.browser-file')).toHaveCount(3);
      await expect(main.locator('.browser-location h3')).toHaveText('login-flow');
      await main.getByRole('combobox', { name: 'Filter worktrees' }).selectOption('-1');
      await main.getByRole('region', { name: 'Files in login-flow' }).getByRole('button', { name: /web\/app\.js/ }).click();
      await expect(main.locator('.inspector-context .worktree-badge')).toHaveText('login-flow');
      await expect(code()).toContainText('code.trim()');
      await expect(code()).not.toContainText('showSessions();');
      await capture('F-diff');
      await main.getByRole('button', { name: 'Conversation', exact: true }).click();
      await expect(main.locator('.sample-transcript')).toBeVisible();
      await main.getByRole('button', { name: 'Changes 6', exact: true }).click();
      await expect(code()).toContainText('code.trim()');
      await main.getByRole('button', { name: 'Back to files', exact: true }).click();
      await expect(main.locator('.browser-file')).toHaveCount(6);
      await page.getByRole('button', { name: 'Next prototype' }).click();
      await expect(page).toHaveURL(/variant=D/);
      await page.getByRole('button', { name: 'Previous prototype' }).click();
      await expect(page).toHaveURL(/variant=F/);
      await page.getByLabel('Work happens in').selectOption('empty');
      for (let index = 0; index < 3; index++) {
        await expect(main.getByRole('heading', { name: 'No captured changes yet' })).toBeVisible();
        await page.getByRole('button', { name: 'Next prototype' }).click();
      }
      expect(errors).toEqual([]); expect(sockets).toEqual([]);
    });
  });
}
