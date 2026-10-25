import { test, expect } from '@playwright/test';

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`opening a session responds before its conversation arrives with motion ${reducedMotion}`, async ({ page }, testInfo) => {
    const errors = [], watches = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.vibrations = [];
      navigator.vibrate = duration => { window.vibrations.push(duration); return true; };
    });
    await page.emulateMedia({ reducedMotion });
    const states = ['Alpha', 'Beta'].map(name => ({ id: name, title: `Task ${name}`, cwd: '/projects/app',
      status: 'idle', updatedAt: Date.now(), messages: [{ id: name, role: 'assistant', text: `Reply for ${name}` }] }));
    await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (packet.op === 'watch') watches.push({ ws, packet });
      else if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    }));
    const deliver = index => {
      const { ws, packet } = watches[index];
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1,
        state: states.find(state => state.id === packet.sessionId) }));
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
    };
    await page.goto('/#token=browser-test-token-only-123456789012345');
    expect(await page.evaluate(() => window.vibrations)).toEqual([]);
    await page.getByRole('button', { name: /Task Alpha/ }).tap();
    expect(await page.evaluate(() => window.vibrations)).toEqual([10]);
    const moving = await page.locator('main').evaluate(main => main.getAnimations().some(animation =>
      animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none')));
    expect(moving).toBe(reducedMotion === 'no-preference');
    await expect(page.locator('#title')).toHaveText('Task Alpha');
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible();
    await expect.poll(() => watches.length).toBe(1);
    await expect(page.locator('#transcript')).toHaveAttribute('aria-busy', 'true');
    await page.screenshot({ path: testInfo.outputPath('opening-session.png') });
    await page.getByRole('button', { name: 'Show sessions' }).dispatchEvent('click');
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    await expect(page.locator('#sidebar')).toHaveJSProperty('inert', false);
    await page.getByRole('button', { name: /Task Beta/ }).tap();
    expect(await page.evaluate(() => window.vibrations)).toEqual([10, 10, 10]);
    await expect.poll(() => watches.length).toBe(2);
    deliver(0); // A late Alpha response must not clear Beta's loading state.
    await expect(page.locator('#title')).toHaveText('Task Beta');
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible();
    await expect(page.locator('#transcript')).not.toContainText('Reply for Alpha');
    deliver(1);
    await expect(page.locator('#transcript')).toContainText('Reply for Beta');
    await expect(page.locator('#transcript')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeHidden();
    expect(await page.evaluate(() => window.vibrations)).toEqual([10, 10, 10]);
    await page.locator('#prompt').fill('Draft for Beta');
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: /Task Beta/ }).tap();
    expect(await page.evaluate(() => window.vibrations)).toEqual([10, 10, 10, 10, 10]);
    await expect(page.locator('#transcript')).toContainText('Reply for Beta');
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeHidden();
    await expect(page.locator('#prompt')).toHaveValue('Draft for Beta');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: /Task Alpha/ }).click();
    expect(await page.evaluate(() => window.vibrations)).toEqual([10, 10, 10, 10, 10, 10]);
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#transcript')).toContainText('Reply for Alpha');
    await expect(page.locator('main')).toHaveCSS('transform', 'none');
    await page.screenshot({ path: testInfo.outputPath('session-desktop.png') });
    await testInfo.attach('session-desktop', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    expect(errors).toEqual([]);
  });
}

test('a failed conversation load stops the spinner and can be retried from the list', async ({ page }) => {
  let fail = true;
  const state = { id: 'retry', title: 'Retry session', cwd: '/projects/app', status: 'idle', messages: [] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      if (fail) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: false, error: 'Session unavailable' }));
      else {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      }
    } else if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Retry session/ }).tap();
  await expect(page.locator('#notice')).toHaveText('Session unavailable');
  await expect(page.locator('#transcript')).toHaveText('Could not load conversation. Go back and try again.');
  await expect(page.locator('#transcript')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('Loading conversation…', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  fail = false;
  await page.getByRole('button', { name: /Retry session/ }).tap();
  await expect(page.locator('#transcript .message, #transcript .hint, #transcript .conversation-loading')).toHaveCount(0);
  await expect(page.locator('#agent-activity')).toBeHidden();
  await expect(page.locator('#transcript')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#notice')).toBeHidden();
});
