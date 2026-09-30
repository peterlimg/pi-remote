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
  const activity = page.locator('#agent-activity');
  await expect(activity).toBeHidden();
  await page.evaluate(() => { Math.random = () => 0; });
  state.status = 'working'; snapshot();
  await expect(activity).toBeVisible();
  await expect(activity).toHaveText('Thinking…');
  await expect(activity).toHaveCSS('color', 'rgb(53, 103, 92)');
  await page.evaluate(() => { Math.random = () => 0.999; });
  await expect(activity).toHaveAttribute('role', 'status');
  await expect(activity.locator('svg')).toHaveCSS('animation-name', 'connection-spin');
  state.messages[1].text += ' The first run took longer.'; snapshot();
  await expect(activity).toBeVisible();
  state.tools = [{ id: 'timings', name: 'bash', status: 'working', text: 'Reading timing data…' }]; snapshot();
  await expect(page.locator('.tool')).toBeVisible();
  await expect(activity).toHaveText('Thinking…'); // Streaming updates must not shuffle the label.
  await page.locator('#prompt').fill('Keep checking');
  await expect(activity).toHaveText('Thinking…');
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
  state.status = 'working'; snapshot();
  await expect(activity).toBeVisible();
  await expect(activity).toHaveText('Piecing it together…');
  client.close({ code: 1012, reason: 'Computer disconnected' });
  await expect(activity).toBeHidden();
  await expect(page.locator('#composer-connection')).toBeVisible();
});
