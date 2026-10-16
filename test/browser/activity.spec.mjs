import { test, expect } from '@playwright/test';

test('activity follows the selected agent through streaming, tools, waiting, completion and disconnect', async ({ page }) => {
  const state = { id: 'active', title: 'Review changes', cwd: '/project', status: 'idle', messages: [
    { id: 'user', role: 'user', text: 'Check how to fix the slow runs.' },
    { id: 'reply', role: 'assistant', text: 'I’ll check the timings from the last three runs.' }
  ] };
  const other = { id: 'other', title: 'Another session', cwd: '/project', status: 'idle', messages: [] };
  let client, version = 0;
  const snapshot = (value = state) => client.send(JSON.stringify({ type: 'snapshot', sessionId: value.id, version: ++version, state: value }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state, other] }));
      } else {
        if (p.op === 'watch') snapshot(p.sessionId === state.id ? state : other);
        ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Review changes/ }).click();
  const activity = page.locator('#agent-activity'), label = page.locator('#activity-label');
  await expect(activity).toBeHidden();
  await page.evaluate(() => { Math.random = () => 0; });
  state.status = 'working'; snapshot();
  await expect(activity).toBeVisible();
  await expect(label).toHaveText('Thinking…');
  await expect(activity).toHaveCSS('color', 'rgb(53, 103, 92)');
  await page.evaluate(() => { Math.random = () => 0.999; });
  await expect(activity).toHaveAttribute('role', 'status');
  await expect(activity.locator('svg')).toHaveCSS('animation-name', 'connection-spin');
  state.messages[1].text += ' The first run took longer.'; snapshot();
  await expect(activity).toBeVisible();
  state.tools = [{ id: 'timings', name: 'bash', status: 'working', text: 'Reading timing data…' }]; snapshot();
  await expect(page.locator('.tool-activity > summary')).toBeVisible();
  await expect(page.locator('.tool-activity-working')).toHaveCount(0);
  await expect(page.locator('.tool')).toBeHidden();
  await expect(label).toHaveText('Thinking…'); // Streaming updates must not rotate the label early.
  await page.locator('#prompt').fill('Keep checking');
  await expect(label).toHaveText('Thinking…');
  const checkPosition = async () => expect(async () => {
    const row = await activity.boundingBox(), composer = await page.locator('#composer').boundingBox();
    expect(row.y + row.height).toBeLessThanOrEqual(composer.y);
    expect(row.x).toBeGreaterThanOrEqual(0);
    expect(row.x + row.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(composer.y + composer.height).toBeLessThanOrEqual(page.viewportSize().height);
  }).toPass();
  await checkPosition();
  await page.setViewportSize({ width: 320, height: 380 }); // Narrow phone with its keyboard open.
  await checkPosition();
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Another session/ }).click();
  await expect(activity).toBeHidden();
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Review changes/ }).click();
  await expect(activity).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(activity.locator('svg')).toHaveCSS('animation-name', 'none');
  await expect(activity).toHaveCSS('color', 'rgb(156, 200, 189)');
  await checkPosition();
  for (const status of ['waiting', 'idle', 'saved', 'disconnected']) {
    state.status = status; snapshot();
    await expect(activity).toBeHidden();
  }
  const previousLabel = await label.textContent();
  state.status = 'working'; snapshot();
  await expect(activity).toBeVisible();
  await expect(label).not.toHaveText(previousLabel);
  client.close({ code: 1012, reason: 'Computer disconnected' });
  await expect(activity).toBeHidden();
  await expect(page.locator('#composer-connection')).toBeVisible();
});

test('thinking shows seconds after five seconds and rotates wording within the same turn', async ({ page }) => {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.addInitScript(() => { Math.random = () => 0; });
  const state = { id: 'thinking', title: 'A slow reply', cwd: '/project', status: 'working', messages: [
    { id: 'reply', role: 'assistant', text: '', timestamp: time.getTime(), stopReason: 'pending' }
  ] };
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else {
        if (packet.op === 'watch') snapshot();
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /A slow reply/ }).click();
  const activity = page.locator('#agent-activity'), label = page.locator('#activity-label'), timer = page.locator('#activity-time');
  await expect(label).toHaveText('Thinking…');
  await page.clock.runFor(4999);
  await expect(timer).toBeHidden();
  await page.clock.runFor(1);
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(' · 5s');
  await page.clock.runFor(2999);
  await expect(label).toHaveText('Thinking…');
  await page.clock.runFor(1);
  await expect(label).toHaveText('Pondering…');
  await expect(timer).toHaveText(' · 8s');
  snapshot(); // Re-renders must not reset the rotation clock.
  await expect(label).toHaveText('Pondering…');
  await page.clock.runFor(8000);
  await expect(label).toHaveText('Thinking…'); // Even fixed randomness must not repeat the previous phrase.
  await expect(timer).toHaveText(' · 16s');
  await page.evaluate(() => { Math.random = () => 0.999; });
  await page.clock.runFor(8000);
  await expect(label).toHaveText('Piecing it together…');
  await expect(timer).toHaveText(' · 24s');
  await page.clock.runFor(8000);
  await expect(label).toHaveText('Noodling on it…');
  await expect(activity).toMatchAriaSnapshot('- status: Working…'); // Rotating phrases must not cause repeated announcements.
  state.messages[0].text = 'The reply is arriving.'; snapshot();
  await expect(timer).toBeHidden();
  state.messages[0].text = '';
  state.tools = [{ id: 'read', name: 'read', status: 'working', text: 'Reading a file' }]; snapshot();
  await expect(timer).toBeHidden();
  state.tools[0].status = 'done'; snapshot();
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(' · 32s');
  state.status = 'idle'; snapshot();
  await expect(activity).toBeHidden();
});
