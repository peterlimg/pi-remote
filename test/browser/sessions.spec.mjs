import { test, expect } from '@playwright/test';
import { SessionService } from '../../src/service.mjs';
import { sessionWindow } from '../../src/client-channel.mjs';

test('same-project sessions show their tasks, previews, status and activity without overflowing', async ({ page }) => {
  let client;
  const now = Date.UTC(2026, 6, 21, 15, 45);
  const states = [
    { id: 'login', title: 'Pi · Rill', cwd: '/projects/Rill', status: 'working', updatedAt: now - 60000,
      messages: [{ role: 'user', text: 'Fix login timing out after the browser reconnects' }, { role: 'assistant', text: 'Checking the WebSocket authentication timeout.' }] },
    { id: 'release', title: 'Pi · Rill', cwd: '/projects/Rill', status: 'waiting', updatedAt: now,
      messages: [{ role: 'user', text: 'Prepare the release notes for the new dashboard' }, { role: 'assistant', text: 'Which version should I use for this release?' }] },
    { id: 'named', title: 'Mobile session picker', cwd: '/projects/' + 'long-directory-'.repeat(20), status: 'idle', updatedAt: now - 120000,
      messages: [{ role: 'user', text: 'Make sessions easier to distinguish' }, { role: 'assistant', text: 'Task previews and activity times are ready.' }] },
    ...Array.from({ length: 672 }, (_, i) => ({ id: 'saved-' + i, title: 'Pi · Rill', cwd: '/projects/Rill', status: 'saved', updatedAt: now - i * 3600000,
      messages: [{ role: 'user', text: i === 0 ? 'Investigate slow database migrations' : 'Review dashboard changes, session ' + (i + 1) }] }))
  ];
  const service = Object.assign(Object.create(SessionService.prototype),
    { catalog: new Map(states.map(state => [state.id, state])), live: new Map(), warnings: [], allowResume: true });
  let scroll, failList = false;
  const requests = [];
  // Mirrors the host channel: whole pages until the phone scrolls or searches, then diffs.
  const publish = () => {
    const update = scroll.active ? scroll.update() : service.list();
    if (update) client.send(JSON.stringify({ type: 'sessions', ...update }));
  };
  await page.routeWebSocket('**/ws', ws => {
    client = ws; scroll = sessionWindow(service);
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); publish(); }
      else if (packet.op === 'list') {
        requests.push(packet);
        if (failList) { ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: false, error: 'List unavailable' })); return; }
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: scroll.request(packet) }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1, state: states.find(s => s.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  const online = page.getByRole('region', { name: 'Online', exact: true });
  const saved = page.getByRole('region', { name: 'Saved & offline', exact: true });
  await expect(online.locator('.session')).toHaveCount(3);
  await expect(saved.locator('.session')).toHaveCount(17);
  await expect(page.locator('.session')).toHaveCount(20);
  await expect(page.locator('#list-page')).toBeHidden();
  expect(requests).toHaveLength(0); // No eager fetch of the remaining pages.
  await expect(page.locator('.brand h2')).toHaveText('Sessions');
  await expect(page.locator('.brand .badge')).toHaveCount(0);
  await expect(page.locator('.session').first()).toContainText('Prepare the release notes');
  const login = online.getByRole('button', { name: /Fix login timing out/ });
  await expect(login.locator('.session-preview')).toHaveText('Pi: Checking the WebSocket authentication timeout.');
  await expect(login.locator('.session-state')).toHaveText('Working');
  await expect(login.locator('time')).toHaveAttribute('datetime', new Date(now - 60000).toISOString());
  await expect(online.locator('.session-state')).toHaveText(['Needs input', 'Working']);
  await expect(saved.locator('.session').first().locator('.session-preview')).toHaveCount(0);
  const noOverflow = async () => expect(await page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    return sidebar.scrollWidth <= sidebar.clientWidth && document.documentElement.scrollWidth <= innerWidth;
  })).toBe(true);
  await noOverflow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await noOverflow();
  await page.setViewportSize({ width: 320, height: 640 });
  await noOverflow();
  await page.locator('.session').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.session')).toHaveCount(40);
  publish(); // Live updates keep the grown list.
  await expect(page.locator('.session')).toHaveCount(40);
  await page.getByRole('button', { name: 'Search sessions' }).click();
  await page.locator('#search').fill('session 672');
  await expect(page.locator('.session')).toHaveCount(1);
  await expect(page.locator('.session')).toContainText('session 672');
  await page.locator('#search').fill('authentication');
  await expect(page.locator('.session')).toHaveCount(1);
  await page.locator('#search').fill('no such task');
  await expect(page.locator('#list-empty')).toHaveText('No matching sessions. Try another task or project.');
  const bar = await page.locator('#search-bar').boundingBox(); // An empty list must not pull search up to the top.
  expect(bar.y + bar.height).toBeGreaterThan(page.viewportSize().height - 24);
  failList = true;
  await page.getByRole('button', { name: 'Close search' }).click(); // Closing clears the filter.
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search sessions' })).toBeFocused();
  await page.getByRole('button', { name: 'Search sessions' }).click();
  await page.locator('#search').blur(); // Leaving an empty search folds it away.
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.locator('#list-page')).toHaveText('Could not load sessions. Try again.');
  failList = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.session')).toHaveCount(20);
  await login.click();
  await expect(page.locator('#title')).toHaveText(states[0].messages[0].text);
  states[0].messages.push({ role: 'user', text: 'Now check logout' });
  states[0].status = 'idle'; states[0].updatedAt = now + 60000;
  publish();
  await expect(page.locator('#title')).toHaveText('Fix login timing out after the browser reconnects');
  await page.locator('#back').click();
  await expect(online.locator('.session').first()).toHaveAttribute('aria-current', 'true');
  await expect(online.locator('.session').first().locator('.session-state')).toHaveCount(0);
  await expect(online.locator('.session').first().locator('.session-preview')).toHaveText('You: Now check logout');
});

test('new session button lists recent projects, hides projectless folders and starts sessions in either', async ({ page }) => {
  const states = [{ id: 'old', title: 'Old task', cwd: '/Users/me/beta', status: 'saved', messages: [] }];
  const operations = [];
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', blankDir: '/Users/me/.pi/remote/projects' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (packet.op === 'projects') {
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true,
          value: [...['beta', 'alpha', 'c', 'd', 'e', 'f', 'g'].map((name, i) => ({ cwd: '/Users/me/' + name, sessionId: i ? name : 'old' })),
            { cwd: '/Users/me/.pi/remote/projects/2026-10-11-2133', sessionId: 'blank' }] }));
      } else if (packet.op === 'new' || packet.op === 'newProject') {
        operations.push(packet);
        const cwd = packet.op === 'new' ? '/Users/me/beta' : '/Users/me/.pi/remote/projects/2026-10-12-0900';
        states.push({ id: 'fresh' + operations.length, title: 'Untitled session', cwd, status: 'idle', messages: [] });
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: { ok: true, value: { sessionId: 'fresh' + operations.length } } }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(x => x.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'New session' }).tap();
  const picker = page.getByRole('dialog', { name: 'New session in…' }), options = picker.locator('#project-options');
  await expect(options.locator('.project-option-name')).toHaveText(['beta', 'alpha', 'c', 'd', 'e', 'f', 'g']);
  await picker.getByRole('searchbox', { name: 'Search projects' }).fill('G');
  await expect(options.locator('.project-option-name')).toHaveText(['g']);
  await picker.getByRole('searchbox', { name: 'Search projects' }).fill('zzz');
  await expect(picker.locator('#project-status')).toHaveText('No matching projects');
  await picker.getByRole('searchbox', { name: 'Search projects' }).fill('');
  await expect(options.locator('.project-option-path').first()).toHaveText('~/beta');
  await picker.getByRole('button', { name: 'Pin e' }).tap();
  await expect(options.locator('.project-option-name')).toHaveText(['e', 'beta', 'alpha', 'c', 'd', 'f', 'g']);
  await expect(picker.getByRole('button', { name: 'Pin e' })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('button', { name: 'Pin e' })).not.toBeFocused();
  await picker.getByRole('button', { name: 'Close' }).tap();
  await page.getByRole('button', { name: 'New session' }).tap();
  await expect(options.locator('.project-option-name')).toHaveText(['e', 'beta', 'alpha', 'c', 'd', 'f', 'g']);
  await page.locator('#project-picker-title').evaluate(node => {
    const touch = y => [new Touch({ identifier: 1, target: node, clientX: 100, clientY: y })];
    for (const [type, y] of [['touchstart', 400], ['touchmove', 700]]) node.dispatchEvent(new TouchEvent(type, { touches: touch(y), bubbles: true, cancelable: true }));
    node.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  });
  await expect(picker).toBeHidden();
  await page.getByRole('button', { name: 'New session' }).tap();
  await picker.locator('.project-option', { hasText: 'beta' }).tap();
  await expect(picker).toBeHidden();
  await expect(page.locator('#title')).toHaveText('Untitled session');
  expect(operations.map(x => x.sessionId)).toEqual(['old']);
  await page.locator('#back').click();
  await page.getByRole('button', { name: 'New session' }).tap();
  await picker.getByRole('button', { name: 'Start without a project' }).tap();
  await expect(picker).toBeHidden();
  expect(operations.map(x => x.op)).toEqual(['new', 'newProject']);
  await expect(page.locator('#project-name')).toBeHidden();
  await page.locator('#back').click();
  await expect(page.locator('.session', { hasText: 'Untitled session' }).last().locator('.session-project')).toHaveCount(0);
  await page.getByRole('button', { name: 'New session' }).tap();
  await expect(picker.getByRole('button', { name: 'Start without a project' })).toBeEnabled();
});
