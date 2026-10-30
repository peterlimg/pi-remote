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
  state.status = 'working'; snapshot();
  await expect(activity).toBeVisible();
  await expect(label).toHaveText('Working…');
  await expect(activity).toHaveCSS('color', 'rgb(53, 103, 92)');
  await expect(activity).toHaveAttribute('role', 'status');
  await expect(activity.locator('svg')).toHaveCSS('animation-name', 'connection-spin');
  const spinStart = () => activity.locator('svg').evaluate(async svg => {
    const animation = svg.getAnimations()[0];
    await animation.ready;
    return animation.startTime;
  });
  const started = await spinStart();
  state.messages[1].text += ' The first run took longer.'; snapshot();
  await expect(page.locator('#transcript')).toContainText('The first run took longer.');
  expect(await spinStart(), 'Streaming replies must not restart the working animation').toBe(started);
  state.tools = [{ id: 'timings', name: 'bash', status: 'working', text: 'Reading timing data…' }]; snapshot();
  const toolLabel = page.locator('.tool-activity-label');
  await expect(toolLabel).toHaveText('Running 1 command');
  expect(await spinStart(), 'Tool updates must not restart the working animation').toBe(started);
  // iOS Safari can show the dots with the spin named in CSS but no running animation; cancelling reproduces that state.
  await activity.locator('svg').evaluate(svg => svg.getAnimations()[0].cancel());
  await expect.poll(() => activity.locator('svg').evaluate(svg => svg.getAnimations()[0]?.playState), { message: 'A stalled spin must restart' }).toBe('running');
  await expect(page.locator('.tool-activity')).not.toHaveAttribute('open', '');
  await expect(toolLabel).toHaveCSS('opacity', '1');
  await expect(toolLabel).toHaveCSS('animation-name', 'none');
  await page.locator('#prompt').fill('Keep checking');
  await expect(label).toHaveText('Working…');
  const checkPosition = async () => expect(async () => {
    const row = await activity.boundingBox(), composer = await page.locator('#composer').boundingBox();
    expect(row.y + row.height).toBeLessThanOrEqual(composer.y);
    expect(row.x).toBeGreaterThanOrEqual(0);
    expect(row.x + row.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(composer.y + composer.height).toBeLessThanOrEqual(page.viewportSize().height);
  }).toPass();
  await checkPosition();
  await page.setViewportSize({ width: 320, height: 380 });
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
  await expect(activity).toHaveCSS('color', 'rgb(239, 237, 239)');
  await expect(toolLabel).toHaveCSS('opacity', '1');
  await checkPosition();
  for (const status of ['waiting', 'idle', 'saved', 'disconnected']) {
    state.status = status; snapshot();
    await expect(activity).toBeHidden();
  }
  state.status = 'working'; snapshot();
  await expect(activity).toBeVisible();
  await expect(label).toHaveText('Working…');
  client.close({ code: 1012, reason: 'Computer disconnected' });
  await expect(activity).toBeHidden();
  await expect(page.locator('#composer-connection')).toBeVisible();
});

test('activity keeps a stable label and shows elapsed seconds only while awaiting a reply', async ({ page }) => {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
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
  await expect(label).toHaveText('Working…');
  await page.clock.runFor(4999);
  await expect(timer).toBeHidden();
  await page.clock.runFor(1);
  await expect(timer).toHaveText(' · 5s');
  await page.clock.runFor(27000);
  await expect(label).toHaveText('Working…');
  await expect(timer).toHaveText(' · 32s');
  snapshot();
  await expect(activity).toMatchAriaSnapshot('- status: Working…');
  state.messages[0].text = 'The reply is arriving.'; snapshot();
  await expect(timer).toBeHidden();
  state.messages[0].text = '';
  state.tools = [{ id: 'read', name: 'read', status: 'working', text: 'Reading a file' }]; snapshot();
  await expect(timer).toBeHidden();
  state.tools[0].status = 'done'; snapshot();
  await expect(timer).toHaveText(' · 32s');
  state.status = 'idle'; snapshot();
  await expect(activity).toBeHidden();
});
