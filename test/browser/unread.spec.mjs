import { test, expect } from '@playwright/test';
import { SessionService } from '../../src/service.mjs';

test('unread dots mark agent replies since the thread was last on screen and survive reloads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const state = { id: 'a', title: 'Fix login', cwd: '/projects/Rill', status: 'idle', updatedAt: 1000,
    messages: [{ role: 'user', text: 'Fix login' }, { role: 'assistant', text: 'Looking.' }] };
  const service = Object.assign(Object.create(SessionService.prototype),
    { catalog: new Map([[state.id, state]]), live: new Map(), warnings: [], allowResume: true });
  let client;
  const publish = () => client.send(JSON.stringify({ type: 'sessions', ...service.list() }));
  const reply = (role, text) => { state.messages.push({ role, text }); state.updatedAt += 1000; publish(); };
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); publish(); }
      else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1, state }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  const session = page.locator('.session');
  const dot = session.locator('.unread-dot');
  await expect(session).toHaveCount(1);
  await expect(dot).toHaveCount(0); // First sight counts as read.

  reply('assistant', 'Done.');
  await expect(dot).toHaveCount(1);
  await page.reload();
  await expect(session).toHaveCount(1);
  await expect(dot).toHaveCount(1);

  await session.click();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(dot).toHaveCount(0);
  reply('user', 'Thanks'); // Your own messages never mark a session unread.
  await expect(session.locator('.session-preview')).toContainText('Thanks');
  await expect(dot).toHaveCount(0);
  reply('assistant', 'Welcome.'); // Selected but off screen still counts as unread.
  await expect(dot).toHaveCount(1);
});
