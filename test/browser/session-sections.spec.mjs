import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { socket, until } from '../helpers.mjs';

test('activity stays above a full page of pins, with bounded previews and live, paged collections', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-sections-')), root = join(dir, 'sessions');
  mkdirSync(root);
  const now = Date.now(), agents = [], locks = [];
  const seed = (title, index) => {
    const file = join(root, `${index}.jsonl`), timestamp = now - index * 60000;
    writeFileSync(file, [
      { type: 'session', version: 3, id: randomUUID(), cwd: '/projects/pi-remote', timestamp: new Date(timestamp).toISOString() },
      { type: 'session_info', id: 'name', parentId: null, name: title },
      { type: 'message', id: 'user', parentId: 'name', message: { role: 'user', content: title, timestamp } },
      { type: 'message', id: 'reply', parentId: 'user', message: { role: 'assistant', content: 'The changes are ready to review.', timestamp: timestamp + 1000 } }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    utimesSync(file, timestamp / 1000, timestamp / 1000);
    return file;
  };
  const pinnedTitles = ['Investigate Claude SDK session history and reconnect recovery', 'Pinned task 1', 'Review architecture of web app.js'];
  const pinned = Array.from({ length: 30 }, (_, i) => seed(pinnedTitles[i] ?? `Pinned task ${i}`, i));
  for (let i = 0; i < 45; i++) seed(`Recent task ${i}`, 100 + i);
  const titles = ['Review authentication flow', 'Design the sessions page', 'Investigate Claude SDK session'];
  const activeFiles = titles.map((title, i) => seed(title, 200 + i));
  writeFileSync(join(dir, 'pinned-sessions.json'), JSON.stringify([...pinned, activeFiles[2]].map(sessionKey)));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  let host;
  try {
    host = await startHost({ dir, config, port: 0, roots: [root], relayUrl: '' });
    const url = `http://127.0.0.1:${host.http.address().port}`;
    const connect = async (file, status) => {
      const state = { ...readSession(file), instanceId: randomUUID(), status };
      const lock = acquireLock(join(dir, 'locks'), state.id, { file, instanceId: state.instanceId }); locks.push(lock);
      const agent = await socket(url.replace('http:', 'ws:') + '/bridge', config.bridgeToken); agents.push(agent);
      agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
      agent.ws.on('message', raw => {
        const packet = JSON.parse(raw.toString());
        if (packet.type === 'command') agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { commands: [] } }));
      });
      await until(() => host.service.live.has(state.id));
      return { state, agent };
    };
    const active = [];
    for (const [i, file] of activeFiles.entries()) active.push(await connect(file, i === 0 ? 'waiting' : 'working'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + '/#token=' + config.clientToken);
    const nowGroup = page.getByRole('region', { name: 'Now', exact: true });
    const pinsGroup = page.getByRole('region', { name: 'Pinned', exact: true });
    const recentGroup = page.getByRole('region', { name: 'Recent', exact: true });
    await expect(nowGroup.locator('.session strong')).toHaveText(titles);
    await expect(pinsGroup.locator('.session strong')).toHaveText(pinnedTitles);
    await expect(pinsGroup.locator('.badge')).toHaveText('31');
    await expect(recentGroup.locator('.session')).toHaveCount(20);
    await expect(page.locator('#sessions .session')).toHaveCount(26);
    await expect(nowGroup.locator('.session').last().getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
    await expect(pinsGroup.locator('.session-preview').first()).toBeHidden();
    await expect(recentGroup.locator('.session-preview').first()).toBeVisible();
    await expect(pinsGroup.locator('time').first()).toBeVisible();
    const bounds = await nowGroup.boundingBox();
    expect(bounds.y + bounds.height).toBeLessThan(page.viewportSize().height - 70);
    const checkLayout = async () => {
      expect(await page.evaluate(() => {
        const sidebar = document.getElementById('sidebar');
        return sidebar.scrollWidth <= sidebar.clientWidth && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
      for (const group of [pinsGroup, recentGroup]) {
        await expect(group.locator('strong').first()).toHaveCSS('font-size', '17px');
        await expect(group.locator('strong').first()).toHaveCSS('-webkit-line-clamp', '2');
        await expect(group.locator('.session-meta').first()).toHaveCSS('font-size', '14px');
      }
      const review = pinsGroup.locator('.session').last();
      const icon = await review.getByRole('img', { name: 'PR review', exact: true }).boundingBox();
      const meta = await review.locator('.session-meta').boundingBox();
      expect(Math.abs(icon.y + icon.height / 2 - meta.y - meta.height / 2)).toBeLessThanOrEqual(1);
      expect(icon.x).toBeGreaterThanOrEqual(meta.x);
      const short = await pinsGroup.locator('.session').nth(1).boundingBox();
      const long = await pinsGroup.locator('.session').first().boundingBox();
      expect(long.height).toBeGreaterThan(short.height);
    };
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('activity-first-phone.png') });
    await page.setViewportSize({ width: 320, height: 720 });
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('activity-first-narrow.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('activity-first-desktop-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });

    await page.getByRole('button', { name: 'View all pinned sessions' }).click();
    const collection = page.getByRole('dialog', { name: 'Pinned sessions', exact: true });
    await expect(collection.locator('.session')).toHaveCount(20);
    await expect(collection.locator('.session-meta .session-type-icon')).toHaveCount(1);
    await collection.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(collection.locator('.session')).toHaveCount(31);
    // Pin/unpin uses the same gesture and real API inside the collection.
    const unpin = collection.locator('.session').filter({ hasText: 'Pinned task 29' });
    await unpin.scrollIntoViewIfNeeded();
    await unpin.evaluate(node => {
      const touch = x => [new Touch({ identifier: 1, target: node, clientX: x, clientY: 300 })];
      node.dispatchEvent(new TouchEvent('touchstart', { touches: touch(40), bubbles: true }));
      node.dispatchEvent(new TouchEvent('touchmove', { touches: touch(150), bubbles: true, cancelable: true }));
      node.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    });
    await expect(collection.locator('.session')).toHaveCount(30);
    expect(JSON.parse(readFileSync(join(dir, 'pinned-sessions.json'), 'utf8'))).not.toContain(sessionKey(pinned[29]));
    await page.getByRole('button', { name: 'Close sessions', exact: true }).click();
    await expect(collection).toBeHidden();
    await expect(pinsGroup.locator('.badge')).toHaveText('30');
    await expect(page.getByRole('button', { name: 'View all pinned sessions' })).toBeFocused();
    await expect(nowGroup.locator('.session strong')).toHaveText(titles);

    for (let i = 0; i < 5; i++) await connect(seed(`Additional active task ${i}`, 300 + i), i === 0 ? 'waiting' : 'working');
    await expect(nowGroup.locator('.badge')).toHaveText('8');
    await expect(nowGroup.locator('.session')).toHaveCount(3);
    await page.getByRole('button', { name: 'View all active sessions' }).click();
    const activity = page.getByRole('dialog', { name: 'Active sessions', exact: true });
    await expect(activity.locator('.session')).toHaveCount(8);
    await expect(activity.locator('.session').first()).toContainText('Review authentication flow');
    // A running row changes without losing its collection or its pin state.
    active[1].state.status = 'idle'; active[1].state.updatedAt = Date.now();
    active[1].agent.ws.send(JSON.stringify({ type: 'snapshot', state: active[1].state }));
    await expect(activity.locator('.session')).toHaveCount(7);
    await page.keyboard.press('Escape');
    await expect(activity).toBeHidden();
    await expect(nowGroup.locator('.badge')).toHaveText('7');
    await expect(pinsGroup.locator('.session')).toHaveCount(3);
    await recentGroup.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(recentGroup.locator('.session')).toHaveCount(40);

    await page.getByRole('button', { name: 'Search sessions', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search sessions', exact: true }).fill('Pinned task 28');
    await expect(page.locator('#sessions .session')).toHaveCount(1);
    await expect(page.locator('#sessions .session')).toContainText('Pinned task 28');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await expect(pinsGroup.locator('.session')).toHaveCount(3);
    await page.locator('#sidebar').evaluate(node => { node.scrollTop = 0; });
    await page.getByRole('button', { name: 'View all pinned sessions' }).click();
    await expect(collection.locator('.session')).toHaveCount(20);
    await collection.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(collection.locator('.session')).toHaveCount(30);
    await collection.getByRole('button', { name: /Pinned task 28/ }).click();
    await expect(collection).toBeHidden();
    await expect(page.locator('#title')).toHaveText('Pinned task 28');
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await expect(nowGroup.locator('.badge')).toHaveText('7');
    await page.reload();
    await expect(nowGroup.locator('.badge')).toHaveText('7');
    await expect(pinsGroup.locator('.badge')).toHaveText('30');
    await expect(pinsGroup.locator('.session')).toHaveCount(3);
    await testInfo.attach('activity-first', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    await page.close();
    agents.forEach(agent => agent.ws.terminate()); locks.forEach(lock => lock.release());
    await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
