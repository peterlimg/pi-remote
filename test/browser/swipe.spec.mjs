import { test, expect } from '@playwright/test';
import { SessionService } from '../../src/service.mjs';
import { BridgeSession } from '../../src/live-session.mjs';
import { sessionWindow } from '../../src/client-channel.mjs';

for (const standalone of [false, true]) {
  test(`returning to sessions keeps the list still in ${standalone ? 'home-screen' : 'browser'} mode`, async ({ page }, testInfo) => {
    if (standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    const states = Array.from({ length: 24 }, (_, i) => ({ id: String(i), title: `Task ${i}`, cwd: '/project',
      status: i === 0 ? 'working' : 'idle', updatedAt: Date.now() - i * 1000,
      messages: [{ id: 'reply', role: 'assistant', text: `Reply for task ${i}` }] }));
    const service = Object.assign(Object.create(SessionService.prototype), {
      catalog: new Map(states.map(state => [state.id, state])), live: new Map(), pins: new Set(['1', '2', '3']), warnings: [],
    });
    service.live.set('0', new BridgeSession(states[0], {}, undefined, () => {}));
    let client, scroll;
    await page.routeWebSocket('**/ws', ws => {
      client = ws; scroll = sessionWindow(service);
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
    const sidebar = page.locator('#sidebar');
    const now = page.getByRole('region', { name: 'Now', exact: true });
    await expect(now).toBeVisible();
    for (const scrollTop of [0, 80]) {
      await sidebar.evaluate((node, top) => { node.scrollTop = top; }, scrollTop);
      const initialTop = await sidebar.evaluate(node => node.scrollTop);
      const initialNow = (await now.boundingBox()).y;
      await page.getByRole('region', { name: 'Pinned', exact: true }).getByRole('button', { name: /Task 2/ }).tap();
      await expect(page.locator('#transcript')).toContainText('Reply for task 2');
      await expect(page.locator('#app')).not.toHaveClass(/opening/);
      const nativePrevented = await page.locator('main').evaluate(main => {
        const fire = (type, x) => main.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          touches: [{ clientX: x, clientY: 300 }],
        }));
        const prevented = !fire('touchstart', 5);
        fire('touchmove', 180);
        return prevented;
      });
      expect(nativePrevented).toBe(true);
      // The swipe must reveal the live list, not the browser's older history screenshot.
      await expect(sidebar).toHaveCSS('visibility', 'visible');
      states[0].updatedAt += 1000;
      states[0].messages[0].text = `Working during swipe at ${scrollTop}`;
      client.send(JSON.stringify({ type: 'sessions', ...scroll.update() }));
      await expect(now).toContainText(`Working during swipe at ${scrollTop}`);
      await expect(sidebar).toHaveJSProperty('scrollTop', initialTop);
      expect((await now.boundingBox()).y).toBe(initialNow);
      await page.screenshot({ path: testInfo.outputPath(`swiping-sessions-${scrollTop}.png`) });
      await page.locator('main').dispatchEvent('touchend', { touches: [] });
      await expect(page.locator('#app')).not.toHaveClass(/viewing/);
      await expect.poll(() => page.evaluate(() => history.state)).toBeNull();
      await expect(sidebar).toHaveJSProperty('scrollTop', initialTop);
      expect((await now.boundingBox()).y).toBe(initialNow);
      await page.screenshot({ path: testInfo.outputPath(`returned-sessions-${scrollTop}.png`) });
    }
  });
}

for (const standalone of [false, true]) for (const interruption of ['short swipe', 'second touch', 'touchcancel', 'navigation during settling']) {
test(`${standalone ? 'home-screen' : 'browser'} swipe recovers from ${interruption} while a session is running`, async ({ page }, testInfo) => {
  if (standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  let client;
  const state = { id: 'running', title: 'Running session', cwd: '/project', status: 'working',
    messages: [{ id: 'reply', role: 'assistant', text: 'Still working' }] };
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      }
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Running session/ }).click();
  await expect(page.locator('#transcript')).toContainText('Still working');
  await page.clock.install();
  await page.locator('main').evaluate((main, interruption) => {
    const touch = (identifier, clientX) => ({ identifier, target: main, clientX, clientY: 300 });
    const fire = (type, touches, changedTouches = touches) => main.dispatchEvent(Object.assign(
      new Event(type, { bubbles: true, cancelable: true }), { touches, changedTouches }));
    fire('touchstart', [touch(1, 5)]);
    const x = ['short swipe', 'second touch'].includes(interruption) ? 57 : 300;
    fire('touchmove', [touch(1, x)]);
    if (interruption === 'second touch') {
      fire('touchstart', [touch(1, x), touch(2, 180)], [touch(2, 180)]);
      fire('touchend', [], [touch(1, x), touch(2, 180)]);
    } else fire(interruption === 'touchcancel' ? 'touchcancel' : 'touchend', [], [touch(1, x)]);
  }, interruption);
  if (['short swipe', 'touchcancel'].includes(interruption)) {
    await page.clock.runFor(250);
    await expect(page.locator('#prompt')).toBeVisible();
  }
  state.messages[0].text = 'Work continues';
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 2, state }));
  // Dispatch the button click before the 200ms settle timer can run.
  await page.getByRole('button', { name: 'Show sessions' }).dispatchEvent('click');
  await page.getByRole('button', { name: /Running session/ }).click();
  await page.clock.runFor(250);
  await expect(page.locator('#prompt')).toBeVisible();
  await expect(page.locator('#transcript')).toContainText('Work continues');
  await expect(page.locator('main')).toHaveCSS('transform', 'none');
  await expect(page.locator('#app')).not.toHaveClass(/swiping/);
  await page.screenshot({ path: testInfo.outputPath('reopened-session.png') });
  await testInfo.attach('reopened-session', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
});
}

test('edge swipes leave header controls and desktop navigation alone', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const start = node => !node.dispatchEvent(Object.assign(new Event('touchstart', { bubbles: true, cancelable: true }), {
    touches: [{ clientX: 5, clientY: 30 }],
  }));
  expect(await page.locator('#back').evaluate(start)).toBe(false);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(page.locator('#app')).not.toHaveClass(/viewing/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  expect(await page.locator('main').evaluate(start)).toBe(false);
  await page.locator('main').evaluate(main => {
    for (const type of ['touchmove', 'touchend']) main.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      touches: type === 'touchend' ? [] : [{ clientX: 300, clientY: 30 }],
    }));
  });
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
  await expect(page.locator('main')).toHaveCSS('transform', 'none');
});
