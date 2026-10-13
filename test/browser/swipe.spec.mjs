import { test, expect } from '@playwright/test';

for (const interruption of ['second touch', 'touchcancel', 'navigation during settling']) {
test(`home-screen swipe recovers from ${interruption} while a session is running`, async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
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
    const touch = (identifier, clientX) => new Touch({ identifier, target: main, clientX, clientY: 300 });
    const fire = (type, touches, changedTouches = touches) => main.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches, changedTouches,
    }));
    fire('touchstart', [touch(1, 5)]);
    const x = interruption === 'second touch' ? 57 : 300;
    fire('touchmove', [touch(1, x)]);
    if (interruption === 'second touch') {
      fire('touchstart', [touch(1, x), touch(2, 180)], [touch(2, 180)]);
      fire('touchend', [], [touch(1, x), touch(2, 180)]);
    } else fire(interruption === 'touchcancel' ? 'touchcancel' : 'touchend', [], [touch(1, x)]);
  }, interruption);
  if (interruption === 'touchcancel') {
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
