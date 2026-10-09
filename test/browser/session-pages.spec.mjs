import { test, expect } from '@playwright/test';
import { SessionService } from '../../src/service.mjs';
import { sessionWindow } from '../../src/client-channel.mjs';

test('a relay-first upgrade still pages and searches an older host catalog', async ({ page }) => {
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type !== 'auth') throw new Error('Old hosts must not receive page requests');
    ws.send(JSON.stringify({ type: 'ready' }));
    ws.send(JSON.stringify({ type: 'sessions', sessions: Array.from({ length: 615 }, (_, i) => ({
      id: String(i), title: `Task ${i}`, cwd: '/projects/app', status: 'saved', updatedAt: 615 - i
    })) }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('.session')).toHaveCount(20);
  await page.locator('.session').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.session')).toHaveCount(40);
  await expect(page.locator('.session').last()).toContainText('Task 39');
  await page.getByRole('button', { name: 'Search sessions' }).click();
  await page.locator('#search').fill('Task 614');
  await expect(page.locator('.session')).toHaveCount(1);
  await expect(page.locator('.session')).toContainText('Task 614');
  await expect(page.locator('#count')).toHaveText('1 / 615');
});

test('search ignores stale replies, debounces typing, and restores its scroll window after reconnect', async ({ page }) => {
  const states = Array.from({ length: 45 }, (_, i) => ({ id: String(i), title: `Task ${i}`, cwd: '/projects/app',
    status: 'saved', updatedAt: 45 - i, messages: [] }));
  const service = Object.assign(Object.create(SessionService.prototype),
    { catalog: new Map(states.map(state => [state.id, state])), live: new Map(), warnings: [], allowResume: true });
  states[0].status = 'idle'; service.live.set('0', { state: states[0], socket: {} });
  let client, scroll, hold = false;
  const requests = [], replies = [];
  await page.routeWebSocket('**/ws', ws => {
    client = ws; scroll = sessionWindow(service);
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', ...service.list() }));
      } else if (packet.op === 'list') {
        requests.push(packet);
        const response = JSON.stringify({ type: 'response', id: packet.id, ok: true, value: scroll.request(packet) });
        const reply = () => ws.send(response);
        if (hold) replies.push(reply); else reply();
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1, state: states.find(state => state.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('.session')).toHaveCount(20);
  await page.locator('.session').first().click();
  await expect(page.locator('#resume')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.locator('.session').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.session')).toHaveCount(40);
  // The selected session can disconnect while the list is grown.
  states[0].status = 'disconnected'; service.live.get('0').socket = undefined;
  client.send(JSON.stringify({ type: 'snapshot', sessionId: '0', version: 1, state: states[0] }));
  await expect(page.locator('#resume')).toBeEnabled();
  client.close({ code: 1012, reason: 'Reconnect test' });
  await expect.poll(() => requests.filter(packet => packet.limit === 40).length).toBe(2);
  await expect(page.locator('.session')).toHaveCount(40);
  await page.locator('.session').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.session')).toHaveCount(45);
  await expect(page.locator('#list-page')).toBeHidden();
  // A live update carries just the changed row, even deep in the list.
  states[44].title = 'Renamed last task';
  const update = scroll.update();
  expect(update.changes.map(row => row.id)).toEqual(['44']);
  client.send(JSON.stringify({ type: 'sessions', ...update }));
  await expect(page.locator('.session').last()).toContainText('Renamed last task');
  await expect(page.locator('.session')).toHaveCount(45);
  await page.locator('.session').last().scrollIntoViewIfNeeded();
  expect(requests.filter(packet => packet.limit > 60)).toHaveLength(0); // Stops at the end.

  hold = true;
  await page.getByRole('button', { name: 'Search sessions' }).click();
  await page.locator('#search').fill('Task 44');
  await expect.poll(() => replies.length).toBe(1);
  const beforeTyping = requests.length;
  await page.locator('#search').pressSequentially('3', { delay: 10 });
  await page.locator('#search').fill('Task 43');
  await expect.poll(() => replies.length).toBe(2);
  expect(requests.length - beforeTyping).toBe(1);
  expect(requests.at(-1)).toMatchObject({ query: 'task 43', limit: 20 });
  // Replies arrive in request order; the superseded one must not stick.
  replies[0](); replies[1]();
  await expect(page.locator('.session')).toHaveCount(1);
  await expect(page.locator('.session')).toContainText('Task 43');
  client.send(JSON.stringify({ type: 'sessions', ...service.list({ query: 'task 44' }) }));
  await expect(page.locator('.session')).toContainText('Task 43');
  hold = false;
  client.close({ code: 1012, reason: 'Reconnect search' });
  await expect.poll(() => requests.filter(packet => packet.query === 'task 43').length).toBe(2);
  await expect(page.locator('#count')).toHaveText('1 / 45');
  await expect(page.locator('.session')).toContainText('Task 43');
});
