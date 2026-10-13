import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireSessionLock } from '../../src/locks.mjs';

async function swipe(page, row, dx, dy = 0, midway) {
  await expect(page.locator('#sessions')).toHaveAttribute('aria-busy', 'false');
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox(), x = box.x + box.width - 70, y = box.y + Math.min(35, box.height / 2);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }]
      });
      if (i === 4) await midway?.();
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

test('swipe actions pin, hide, restore and safely delete through the real host', async ({ page }, info) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-session-actions-browser-')), root = join(dir, 'sessions');
  mkdirSync(root);
  for (let i = 0; i < 25; i++) writeFileSync(join(root, `${i}.jsonl`), JSON.stringify({ type: 'session', id: String(i), cwd: dir }) + '\n' +
    JSON.stringify({ type: 'session_info', name: `Saved task ${i}` }) + '\n');
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const host = await startHost({ dir, config, port: 0, roots: [root], relayUrl: '' });
  const target = host.service.matches().matches.at(-1), file = host.service.catalog.get(target.id).file;
  const frames = [];
  let pushes = 0;
  page.on('websocket', ws => {
    ws.on('framesent', event => frames.push(JSON.parse(event.payload)));
    ws.on('framereceived', event => { if (JSON.parse(event.payload).type === 'sessions') pushes++; });
  });
  try {
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    // Find an older session beyond the first page, then pin it into that page.
    await page.getByRole('button', { name: 'Search sessions', exact: true }).tap();
    await page.getByRole('searchbox', { name: 'Search sessions' }).fill(target.title);
    const row = page.locator(`.session-row[data-id="${target.id}"]`);
    await expect(page.locator('.session')).toHaveCount(1);
    await expect(row).toBeVisible();
    await swipe(page, row, -190, 0, async () => {
      const before = pushes;
      host.service.catalog.get(target.id).updatedAt++;
      host.service.emit('list');
      await expect.poll(() => pushes).toBeGreaterThan(before);
    });
    await expect(row.getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
    await expect(row.locator('.session-more')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#app')).not.toHaveClass(/viewing/);
    await page.screenshot({ path: info.outputPath('mobile-swipe.png') });
    await row.getByRole('button', { name: 'Pin', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Pinned', exact: true })).toContainText(target.title);
    await page.getByRole('button', { name: 'Close search' }).tap();
    await expect(page.locator('.session').first()).toContainText(target.title);
    await page.reload();
    await expect(page.locator('.session').first()).toContainText(target.title);
    // Vertical gestures must scroll rather than open actions or select a session.
    await swipe(page, row, 4, 110);
    await expect(row.locator('.session-more')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#app')).not.toHaveClass(/viewing/);
    await row.getByRole('button', { name: 'Session actions' }).tap();
    await row.getByRole('button', { name: 'Hide', exact: true }).tap();
    const hidden = page.getByRole('region', { name: 'Hidden', exact: true });
    await expect(hidden.locator('summary')).toHaveText('Hidden1');
    await expect(row).toBeHidden();
    await page.reload();
    await expect(hidden.locator('summary')).toBeVisible();
    await hidden.locator('summary').tap();
    await expect(row).toBeVisible();
    await row.locator('.session').tap();
    await expect(page.locator('#title')).toHaveText(target.title);
    await page.getByRole('button', { name: 'Show sessions' }).tap();
    await row.getByRole('button', { name: 'Session actions' }).tap();
    await row.getByRole('button', { name: 'Unhide', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Pinned', exact: true })).toContainText(target.title);
    await expect(hidden).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await row.getByRole('button', { name: 'Session actions' }).focus();
    await page.keyboard.press('Enter');
    await page.screenshot({ path: info.outputPath('desktop-actions.png') });
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', { name: 'Unpin', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(row.locator('.session-more')).toHaveAttribute('aria-expanded', 'false');
    await row.getByRole('button', { name: 'Session actions' }).click();
    // Cancel is a no-op. A locked session stays intact and reports the host error in the list.
    page.once('dialog', dialog => dialog.dismiss());
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    expect(frames.filter(frame => frame.action === 'delete')).toHaveLength(0);
    const lock = acquireSessionLock(join(dir, 'locks'), target.id);
    try {
      page.once('dialog', dialog => dialog.accept());
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.locator('#session-action-status')).toContainText('owned');
      expect(existsSync(file)).toBe(true);
    } finally { lock.release(); }
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#title')).toHaveText('Pi Remote');
    expect(existsSync(file)).toBe(false);
    await page.reload();
    await expect(page.locator('.session').first()).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(frames.filter(frame => frame.op === 'sessionAction').map(frame => frame.action)).toEqual(['pin', 'hide', 'unhide', 'delete', 'delete']);
    await info.attach('session-actions', { body: JSON.stringify(frames.filter(frame => frame.op === 'sessionAction')), contentType: 'application/json' });
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
