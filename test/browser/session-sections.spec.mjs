import { test, expect } from '@playwright/test';
import { filterRecentSessions } from './session-filter.mjs';
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
    const online = await connect(seed('Older online task', 500), 'idle');
    const peer = await socket(url.replace('http:', 'ws:') + '/ws', config.clientToken, url);
    try {
      for (const availability of [null, {}, 'busy']) expect((await peer.request('list', { limit: 20, section: 'overview', availability })).ok).toBe(false);
      expect((await peer.request('list', { limit: 20, section: 'overview' })).value.matched).toBe(46);
      const empty = (await peer.request('list', { limit: 20, section: 'overview', availability: 'none' })).value;
      expect(empty).toMatchObject({ matched: 0, loaded: 0, groups: { now: 3, pinned: 31, recent: 0 } });
      expect(empty.changes).toHaveLength(6);
    } finally { peer.ws.terminate(); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(url + '/#token=' + config.clientToken);
    const nowGroup = page.getByRole('region', { name: 'Now', exact: true });
    const pinsGroup = page.getByRole('region', { name: 'Pinned', exact: true });
    const recentGroup = page.getByRole('region', { name: 'Recent', exact: true });
    await expect(nowGroup.locator('.session strong')).toHaveText(titles);
    await expect(pinsGroup.locator('.session strong')).toHaveText(pinnedTitles);
    await expect(pinsGroup.locator('.badge')).toHaveText('31');
    const filter = page.getByRole('button', { name: 'Filter recent sessions', exact: true });
    const menu = page.getByRole('dialog', { name: 'Filter recent sessions', exact: true });
    await expect(filter).toHaveAttribute('aria-expanded', 'false');
    await filter.press('Enter');
    await expect(menu.getByRole('checkbox', { name: 'Online', exact: true })).toBeChecked();
    await expect(menu.getByRole('checkbox', { name: 'Offline', exact: true })).not.toBeChecked();
    // The final selected status is gray and cannot be unchecked by tapping its label.
    const onlineChoice = menu.getByRole('checkbox', { name: 'Online', exact: true });
    const offlineChoice = menu.getByRole('checkbox', { name: 'Offline', exact: true });
    await expect(onlineChoice).toBeDisabled();
    await expect(offlineChoice).toBeEnabled();
    await expect(offlineChoice).toBeFocused();
    await expect(menu.getByText('Online', { exact: true })).toHaveCSS('color', await menu.locator('p').evaluate(node => getComputedStyle(node).color));
    const filterTop = (await filter.boundingBox()).y;
    const menuTop = (await menu.boundingBox()).y;
    await menu.getByText('Online', { exact: true }).tap({ force: true });
    await expect(onlineChoice).toBeChecked();
    await expect(recentGroup.locator('.badge')).toHaveText('1');
    await page.screenshot({ path: testInfo.outputPath('recent-required-status-phone.png') });
    expect((await filter.boundingBox()).y).toBeCloseTo(filterTop, 0);
    expect((await menu.boundingBox()).y).toBeCloseTo(menuTop, 0);
    await offlineChoice.press('Space');
    await expect(recentGroup.locator('.badge')).toHaveText('46');
    await expect(onlineChoice).toBeEnabled();
    await expect(offlineChoice).toBeEnabled();
    await offlineChoice.press('Space');
    await expect(recentGroup.locator('.badge')).toHaveText('1');
    await expect(onlineChoice).toBeDisabled();
    expect((await filter.boundingBox()).y).toBeCloseTo(filterTop, 0);
    expect((await menu.boundingBox()).y).toBeCloseTo(menuTop, 0);
    for (const total of ['46', '1']) {
      await menu.getByRole('checkbox', { name: 'Offline', exact: true }).tap();
      await expect(recentGroup.locator('.badge')).toHaveText(total);
      expect((await filter.boundingBox()).y).toBeCloseTo(filterTop, 0);
      expect((await menu.boundingBox()).y).toBeCloseTo(menuTop, 0);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(filter).toBeFocused();
    await filter.click();
    // A tap leaves focus alone so iOS draws no ring on the checkbox.
    await expect(menu).toBeVisible();
    await expect(offlineChoice).not.toBeFocused();
    await recentGroup.getByRole('heading', { name: 'Recent', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(recentGroup.locator('.session strong')).toHaveText(['Older online task']);
    await expect(recentGroup.locator('.badge')).toHaveText('1');
    await filter.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('recent-online-phone.png') });
    // Search still reaches offline histories while browsing Online.
    await page.getByRole('button', { name: 'Search sessions', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search sessions', exact: true }).fill('Recent task 44');
    await expect(page.locator('#sessions .session strong')).toHaveText(['Recent task 44']);
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await expect(page.locator('#recent-online')).toBeChecked();
    await expect(page.locator('#recent-offline')).not.toBeChecked();
    await expect(recentGroup.locator('.session strong')).toHaveText(['Older online task']);
    await filterRecentSessions(page, 'all');
    await expect(filter).toBeFocused();
    await expect(recentGroup.locator('.badge')).toHaveText('46');
    await expect(recentGroup.locator('.session')).toHaveCount(20);
    await recentGroup.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(recentGroup.locator('.session')).toHaveCount(40);
    await recentGroup.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(recentGroup.locator('.session')).toHaveCount(46);
    await expect(recentGroup.locator('.session').last()).toContainText('Older online task');
    await filterRecentSessions(page, 'offline');
    await expect(page.locator('#recent-offline')).toBeDisabled();
    await expect(page.locator('#recent-online')).toBeEnabled();
    await expect(recentGroup.locator('.badge')).toHaveText('45');
    await expect(recentGroup.locator('.session')).toHaveCount(20);
    await filterRecentSessions(page, 'online');
    await expect(recentGroup.locator('.session strong')).toHaveText(['Older online task']);
    online.agent.ws.terminate();
    await expect(recentGroup.locator('.session')).toHaveCount(0);
    await expect(recentGroup.locator('.recent-empty')).toContainText('No online sessions.');
    await expect(page.locator('#recent-online')).toBeChecked();
    await filterRecentSessions(page, 'offline');
    await expect(recentGroup.locator('.badge')).toHaveText('46');
    await expect(recentGroup.locator('.session')).toHaveCount(20);
    await expect(page.locator('#sessions .session')).toHaveCount(26);
    await expect(nowGroup.locator('.session').last().getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
    await expect(pinsGroup.locator('.session-preview').first()).toBeHidden();
    await expect(recentGroup.locator('.session-preview').first()).toBeVisible();
    await expect(pinsGroup.locator('time').first()).toBeVisible();
    await page.locator('#sidebar, #sessions').evaluateAll(nodes => nodes.forEach(node => { node.scrollTop = 0; }));
    const bounds = await nowGroup.boundingBox();
    expect(bounds.y + bounds.height).toBeLessThan(page.viewportSize().height - 70);
    await recentGroup.locator('.session').first().click();
    await expect(page.locator('#title')).toHaveText('Recent task 0');
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await expect(recentGroup.locator('.session').first()).toHaveAttribute('aria-current', 'true');
    const checkLayout = async () => {
      expect(await page.evaluate(() => {
        const sidebar = document.getElementById('sidebar');
        return sidebar.scrollWidth <= sidebar.clientWidth && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
      for (const group of [recentGroup, pinsGroup]) {
        await expect(group.locator('.session').first()).toHaveCSS('border-radius', '0px');
        await expect(group.locator('strong').first()).toHaveCSS('font-size', '17px');
        await expect(group.locator('strong').first()).toHaveCSS('-webkit-line-clamp', '2');
        await expect(group.locator('.session-meta').first()).toHaveCSS('font-size', '14px');
      }
      const review = pinsGroup.locator('.session').last();
      const icon = await review.getByRole('img', { name: 'PR review', exact: true }).boundingBox();
      const meta = await review.locator('.session-meta').boundingBox();
      expect(Math.abs(icon.y + icon.height / 2 - meta.y - meta.height / 2)).toBeLessThanOrEqual(1);
      expect(icon.x).toBeGreaterThanOrEqual(meta.x);
      await expect(filter).toHaveCSS('border-radius', '6px');
      const trigger = await filter.boundingBox(), glyph = await filter.locator('svg').boundingBox();
      expect(trigger.width).toBe(44); expect(trigger.height).toBe(44); expect(glyph.width).toBe(18);
      await filter.click();
      await expect(menu).toBeVisible();
      await expect(menu.locator('input:checked')).toHaveCSS('accent-color', 'rgb(10, 132, 255)');
      const popup = await menu.boundingBox();
      expect(popup.x).toBeGreaterThanOrEqual(8); expect(popup.y).toBeGreaterThanOrEqual(8);
      expect(popup.x + popup.width).toBeLessThanOrEqual(page.viewportSize().width - 8);
      expect(popup.y + popup.height).toBeLessThanOrEqual(page.viewportSize().height - 8);
      await page.screenshot({ path: testInfo.outputPath(`recent-filter-menu-${page.viewportSize().width}.png`) });
      await page.keyboard.press('Escape');
      await expect(filter).toBeFocused();
      const short = await pinsGroup.locator('.session').nth(1).boundingBox();
      const long = await pinsGroup.locator('.session').first().boundingBox();
      expect(long.height).toBeGreaterThan(short.height);
    };
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('activity-first-phone.png') });
    await page.setViewportSize({ width: 320, height: 720 });
    await page.emulateMedia({ colorScheme: 'light' });
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('activity-first-narrow.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('activity-first-desktop-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });

    await page.getByRole('button', { name: 'View all pinned sessions' }).press('Enter');
    const collection = page.getByRole('dialog', { name: 'Pinned sessions', exact: true });
    await expect(collection.locator('.session')).toHaveCount(20);
    await expect(collection.locator('.session-meta .session-type-icon')).toHaveCount(2);
    await collection.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(collection.locator('.session')).toHaveCount(31);
    // Pin/unpin uses the same gesture and real API inside the collection.
    const unpin = collection.locator('.session').filter({ hasText: 'Pinned task 29' });
    await unpin.scrollIntoViewIfNeeded();
    await unpin.evaluate(node => {
      // WebKit cannot construct Touch objects; simulate the same gesture in both engines.
      const touch = (type, x) => node.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        touches: x === undefined ? [] : [{ clientX: x, clientY: 300 }]
      }));
      touch('touchstart', 40); touch('touchmove', 150); touch('touchend');
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
    const selectedPin = sessionKey(pinned[28]);
    await expect(page.locator(`#sessions .session[data-id="${selectedPin}"]`)).toHaveCount(0);
    await page.locator('.session-info summary').press('Enter');
    await page.getByRole('button', { name: 'Unpin session', exact: true }).press('Enter');
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'pinned-sessions.json'), 'utf8')).includes(selectedPin)).toBe(false);
    await page.locator('.session-info summary').press('Enter');
    await page.getByRole('button', { name: 'Pin session', exact: true }).press('Enter');
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'pinned-sessions.json'), 'utf8')).includes(selectedPin)).toBe(true);
    await expect(page.locator(`#sessions .session[data-id="${selectedPin}"]`)).toHaveCount(0);
    await page.locator('.session-info summary').press('Enter');
    await expect(page.getByRole('button', { name: 'Unpin session', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await expect(nowGroup.locator('.badge')).toHaveText('7');
    await page.reload();
    await expect(nowGroup.locator('.badge')).toHaveText('7');
    await expect(pinsGroup.locator('.badge')).toHaveText('30');
    await expect(pinsGroup.locator('.session')).toHaveCount(3);
    await expect(page.locator('#recent-online')).toBeChecked();
    await expect(page.locator('#recent-offline')).not.toBeChecked();
    await expect(recentGroup.locator('.session strong')).toHaveText(['Design the sessions page']);
    await filterRecentSessions(page, 'offline');
    await recentGroup.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(recentGroup.locator('.session')).toHaveCount(40);
    await recentGroup.locator('.session').last().scrollIntoViewIfNeeded();
    await expect(recentGroup.locator('.session')).toHaveCount(47);
    await expect(recentGroup.locator('.session').last()).toContainText('Older online task');
    await expect(recentGroup.locator('.session').last()).toContainText('Offline');
    await filterRecentSessions(page, 'all');
    await expect(recentGroup.locator('.session')).toHaveCount(20);
    await expect(recentGroup.locator('.badge')).toHaveText('48');
    await testInfo.attach('activity-first', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    await page.close();
    agents.forEach(agent => agent.ws.terminate()); locks.forEach(lock => lock.release());
    await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
