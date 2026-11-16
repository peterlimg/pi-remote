import { test, expect } from '@playwright/test';
import { SessionService } from '../../src/service.mjs';

test('unread dots mark agent replies since the thread was last on screen and survive reloads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const state = { id: 'a', title: 'Fix login', cwd: '/projects/Rill', status: 'idle', updatedAt: 1000,
    messages: [{ role: 'user', text: 'Fix login' }, { role: 'assistant', text: 'Looking.' }] };
  const tasks = [];
  const service = Object.assign(Object.create(SessionService.prototype),
    { catalog: new Map([[state.id, state]]), live: new Map(), pins: new Set(), closedSessions: new Set(), warnings: [], allowResume: true, assistant: { id: 'assistant' },
      coordination: { taskForSession: () => undefined, describe: () => ({ role: 'coordinator', tasks }) } });
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
  const dot = session.locator('.session-icon[data-unread]');
  await expect(session).toHaveCount(1);
  await expect(session.locator('.session-indicators .bot svg')).toHaveCSS('width', '32px');
  await expect(dot).toHaveCount(0); // First sight counts as read.

  state.status = 'working';
  reply('assistant', 'Still checking.');
  await expect(session.locator('.session-state')).toHaveText('Working');
  await expect(session.locator('time')).toHaveAttribute('datetime', new Date(state.updatedAt).toISOString());
  await expect(dot).toHaveCount(0);
  await expect(session.locator('.bot-badge')).toHaveCount(0);
  await expect(session.locator('.sr-only', { hasText: 'New reply' })).toHaveCount(0);
  await page.reload();
  await expect(session.locator('.session-state')).toHaveText('Working');
  await expect(dot).toHaveCount(0);

  state.status = 'idle'; publish(); // Finishing reveals the unread reply without another timestamp change.
  await expect(dot).toHaveCount(1);
  await expect(dot.locator('.bot-badge circle')).toHaveCSS('fill', 'rgb(10, 132, 255)');
  await expect(session.locator('.sr-only', { hasText: 'New reply' })).toHaveCount(1);
  await page.reload();
  await expect(session).toHaveCount(1);
  await expect(dot).toHaveCount(1);

  await session.click();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(dot).toHaveCount(0);
  reply('user', 'Thanks'); // Your own messages never mark a session unread.
  await expect(session.locator('time')).toHaveAttribute('datetime', new Date(state.updatedAt).toISOString());
  await expect(session.locator('.session-preview')).toHaveCount(0);
  await expect(dot).toHaveCount(0);
  reply('assistant', 'Welcome.'); // Selected but off screen still counts as unread.
  await expect(dot).toHaveCount(1);
  tasks.push({ state: 'working' }); publish(); // Background workers count as working even when the main agent is idle.
  await expect(session.locator('.session-state')).toHaveText('Working');
  await expect(dot).toHaveCount(0);
  await expect(session.locator('.bot-badge')).toHaveCount(0);
  tasks.length = 0; publish();
  await expect(dot).toHaveCount(1);
});
