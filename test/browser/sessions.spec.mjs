import { test, expect } from '@playwright/test';
import { summary } from '../../src/state.mjs';

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
  const publish = () => client.send(JSON.stringify({ type: 'sessions', sessions: states.map(summary) }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); publish(); }
      else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1, state: states.find(s => s.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  const online = page.getByRole('region', { name: 'Online', exact: true });
  const saved = page.getByRole('region', { name: 'Saved & offline', exact: true });
  await expect(online.locator('.session')).toHaveCount(3);
  await expect(saved.locator('.session')).toHaveCount(672);
  await expect(page.locator('#count')).toHaveText('675');
  await expect(page.locator('.session').first()).toContainText('Prepare the release notes');
  const login = online.getByRole('button', { name: /Fix login timing out/ });
  await expect(login.locator('.session-preview')).toHaveText('Pi: Checking the WebSocket authentication timeout.');
  await expect(login.locator('.session-state')).toHaveText('Working');
  await expect(login.locator('time')).toHaveAttribute('datetime', new Date(now - 60000).toISOString());
  await expect(online.locator('.session-state')).toHaveText(['Needs input', 'Working', 'Ready']);
  await expect(saved.locator('.session').first().locator('.session-preview')).toHaveCount(0);
  const noOverflow = async () => expect(await page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    return sidebar.scrollWidth <= sidebar.clientWidth && document.documentElement.scrollWidth <= innerWidth;
  })).toBe(true);
  await noOverflow();
  await page.screenshot({ path: 'test-results/sessions-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await noOverflow();
  await page.screenshot({ path: 'test-results/sessions-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 640 });
  await noOverflow();
  await page.locator('#search').fill('authentication');
  await expect(page.locator('.session')).toHaveCount(1);
  await expect(page.locator('#count')).toHaveText('1 / 675');
  await page.locator('#search').fill('no such task');
  await expect(page.locator('#list-empty')).toHaveText('No matching sessions. Try another task or project.');
  await page.locator('#search').fill('');
  await login.click();
  await expect(page.locator('#title')).toHaveText(states[0].messages[0].text);
  states[0].messages.push({ role: 'user', text: 'Now check logout' });
  states[0].status = 'idle'; states[0].updatedAt = now + 60000;
  publish();
  await expect(page.locator('#title')).toHaveText('Fix login timing out after the browser reconnects');
  await page.locator('#back').click();
  await expect(online.locator('.session').first()).toHaveAttribute('aria-current', 'true');
  await expect(online.locator('.session').first().locator('.session-state')).toHaveText('Ready');
  await expect(online.locator('.session').first().locator('.session-preview')).toHaveText('You: Now check logout');
});
