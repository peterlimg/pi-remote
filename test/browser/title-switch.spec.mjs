import { test, expect } from '@playwright/test';
import { SessionService } from '../../src/service.mjs';
import { BridgeSession } from '../../src/live-session.mjs';
import { sessionWindow } from '../../src/client-channel.mjs';

test('swiping or holding the title switches to neighbouring sessions', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const states = Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: `Task ${i}`, cwd: '/project',
    status: i === 0 ? 'working' : 'idle', updatedAt: Date.now() - i * 1000,
    messages: [{ id: 'reply', role: 'assistant', text: `Reply for task ${i}` }] }));
  const service = Object.assign(Object.create(SessionService.prototype), {
    catalog: new Map(states.map(state => [state.id, state])), live: new Map(), pins: new Set(), closedSessions: new Set(), warnings: [],
  });
  service.live.set('0', new BridgeSession(states[0], {}, undefined, () => {}));
  await page.routeWebSocket('**/ws', ws => {
    const scroll = sessionWindow(service);
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') ws.send(JSON.stringify({ type: 'ready', supportsSessionSections: true }));
      else if (packet.op === 'list') ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: scroll.request(packet) }));
      else {
        if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1,
          state: states.find(state => state.id === packet.sessionId) }));
        if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.locator('#sessions .session[data-id="2"]').tap();
  await expect(page.locator('#title')).toHaveText('Task 2');
  await expect(page.locator('#heading-prev')).toContainText('Task 1');
  await expect(page.locator('#heading-next')).toContainText('Task 3');
  await expect(page.locator('#session-dots i')).toHaveCount(6);
  const dot = () => page.locator('#session-dots b').evaluate(node => node.style.transform);
  expect(await dot()).toBe('translateX(16px)');
  // Five dots fit in a slightly taller pill; the dot beyond the window's end shrinks to hint at more.
  expect((await page.locator('#heading').boundingBox()).height).toBe(50);
  expect(await page.locator('#session-dots').evaluate(node => node.offsetWidth)).toBe(36);
  await expect(page.locator('#session-dots i.edge')).toHaveCount(1);
  await page.locator('.conversation-header').screenshot({ path: testInfo.outputPath('title-dots.png') });
  // Until the first swipe, the next title peeks in once.
  await expect.poll(() => page.locator('#heading-strip').evaluate(node => node.style.transform)).toBe('translateX(-20px)');
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await expect.poll(() => page.locator('#heading-strip').evaluate(node => node.style.transform)).toBe('');

  const box = await page.locator('#heading').boundingBox(), y = box.y + box.height / 2;
  const drag = async (from, to, during) => {
    await page.mouse.move(from, y); await page.mouse.down();
    await page.mouse.move(to, y, { steps: 8 }); await during?.(); await page.mouse.up();
  };
  // The bright dot follows the finger toward the next session.
  await drag(box.x + box.width - 20, box.x + 20, async () => expect(parseFloat((await dot()).slice(11))).toBeGreaterThan(18));
  await expect(page.locator('#title')).toHaveText('Task 3');
  await expect(page.locator('#transcript')).toContainText('Reply for task 3');
  expect(await dot()).toBe('translateX(24px)');
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-title-swipe-learned'))).toBe('1');
  // Swiping the other way returns to where you started.
  await drag(box.x + 20, box.x + box.width - 20);
  await expect(page.locator('#title')).toHaveText('Task 2');
  await expect(page.locator('#transcript')).toContainText('Reply for task 2');
  // A short drag snaps back instead of switching.
  await drag(box.x + box.width / 2, box.x + box.width / 2 + 20);
  await expect(page.locator('#title')).toHaveText('Task 2');
  expect(await dot()).toBe('translateX(16px)');

  await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down();
  await expect(page.locator('#nearby-sessions')).toBeVisible();
  await page.mouse.up();
  // Lifting the finger after the hold leaves the list open.
  await expect(page.locator('#nearby-sessions')).toBeVisible();
  await expect(page.locator('#nearby-sessions button')).toHaveCount(6);
  await expect(page.locator('#nearby-sessions [aria-current=true]')).toContainText('Task 2');
  await page.screenshot({ path: testInfo.outputPath('nearby-sessions.png') });
  await page.locator('#nearby-sessions button', { hasText: 'Task 1' }).tap();
  await expect(page.locator('#nearby-sessions')).toBeHidden();
  await expect(page.locator('#title')).toHaveText('Task 1');
  await expect(page.locator('#transcript')).toContainText('Reply for task 1');
  expect(errors).toEqual([]);
});
