import { test, expect } from '@playwright/test';

async function queuedSession(page, status = 'working') {
  const state = { id: 'queued', title: 'Queued messages', cwd: '/project', status, model: 'anthropic/claude-opus-4-1', thinkingLevel: 'high', messages: [
    { id: 'initial', role: 'assistant', text: 'Working on the original request.' }
  ] };
  const other = { id: 'other', title: 'Other session', cwd: '/other', status: 'idle', messages: [] };
  const commands = [];
  let client, version = 0;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const packet = JSON.parse(raw);
    const reply = (ok = true, error) => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok, error, value: [] }));
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state, other] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version,
        state: packet.sessionId === state.id ? state : other }));
      reply();
    } else if (packet.op === 'command') commands.push({ ...packet.command, reply });
    else reply();
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Queued messages/ }).click();
  return { state, commands, publish() {
    client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  } };
}

test('mid-turn text appears immediately and stays queued until Pi echoes each message', async ({ page }, testInfo) => {
  const { state, commands, publish } = await queuedSession(page);
  const prompt = page.locator('#prompt'), text = 'Try the simpler approach';
  const sent = page.locator('.message.user').filter({ hasText: text });
  await prompt.fill(text);
  await page.locator('#send').click();
  // The agent has not acknowledged or echoed the message, and its turn is still working.
  await expect(sent).toHaveCount(1);
  await expect(sent.locator('.delivery-status')).toHaveText('Sending…');
  await expect.poll(() => commands.length).toBe(1);
  await prompt.fill('My next draft');
  commands[0].reply();
  await expect(sent.locator('.delivery-status')).toHaveText('Queued to steer');
  await expect(prompt).toHaveValue('My next draft');
  await expect(page.locator('#abort')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Steer message' })).toBeVisible();
  await expect(page.locator('#send')).toContainText('Steer');
  expect(commands[0].type).toBe('prompt'); // The existing prompt transport steers a running Pi turn.
  state.messages.push({ id: 'stream', role: 'assistant', text: 'Still working on the original request…' });
  publish();
  await expect(sent.locator('.delivery-status')).toHaveText('Queued to steer');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Other session/ }).click();
  await expect(page.locator('#transcript')).not.toContainText(text);
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Queued messages/ }).click();
  await expect(sent.locator('.delivery-status')).toHaveText('Queued to steer');
  await expect(prompt).toHaveValue('My next draft');
  for (const [width, scheme] of [[390, 'light'], [320, 'dark'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('#send')).toBeInViewport();
    const send = await page.locator('#send').boundingBox(), reasoning = await page.locator('#reasoning-control').boundingBox();
    const actions = await page.locator('.composer-actions').boundingBox();
    expect(send.height).toBeGreaterThanOrEqual(44);
    expect(reasoning.x + reasoning.width).toBeLessThanOrEqual(actions.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`queued-${width}-${scheme}.png`) });
  }
  await testInfo.attach('queued-conversation', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.fill(text);
  await page.getByRole('button', { name: 'Steer message' }).click();
  await expect.poll(() => commands.length).toBe(2);
  commands[1].reply();
  await expect(sent).toHaveCount(2);
  await expect(sent.locator('.delivery-status')).toHaveText(['Queued to steer', 'Queued to steer']);
  state.messages.push({ id: 'echo-1', role: 'user', text }); publish();
  await expect(sent).toHaveCount(2);
  await expect(sent.locator('.delivery-status')).toHaveCount(1);
  state.messages.push({ id: 'echo-2', role: 'user', text }); publish();
  await expect(sent).toHaveCount(2);
  await expect(sent.locator('.delivery-status')).toHaveCount(0);
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Queued messages/ }).click();
  await expect(sent).toHaveCount(2);
});

test('failed text delivery restores the draft, and slash commands do not leave queued bubbles', async ({ page }) => {
  const { commands } = await queuedSession(page);
  await page.locator('#prompt').fill('Please change direction');
  await page.locator('#send').click();
  await expect(page.locator('.message.user')).toHaveCount(1);
  await expect.poll(() => commands.length).toBe(1);
  await page.locator('#prompt').fill('Keep this next draft');
  commands[0].reply(false, 'Message rejected');
  await expect(page.locator('#notice')).toHaveText('Message rejected');
  await expect(page.locator('.message.user')).toHaveCount(0);
  await expect(page.locator('#prompt')).toHaveValue('Please change direction\n\nKeep this next draft');
  await page.locator('#prompt').fill('/review');
  await expect(page.locator('#send')).toHaveAccessibleName('Send message');
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(2);
  commands[1].reply();
  await expect(page.locator('#composer-send-status')).toBeHidden();
  await expect(page.locator('.message.user')).toHaveCount(0);
});

test.describe('desktop delivery', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test('idle sends and mid-turn follow-ups keep distinct delivery labels', async ({ page }) => {
    const { state, commands, publish } = await queuedSession(page, 'idle');
    const prompt = page.locator('#prompt');
    await prompt.fill('Start a new task');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => commands.length).toBe(1);
    commands[0].reply();
    await expect(page.locator('.delivery-status')).toHaveText('Sent. Waiting for Pi…');
    state.status = 'working';
    state.messages.push({ id: 'start', role: 'user', text: 'Start a new task' }); publish();
    await expect(page.locator('.delivery-status')).toHaveCount(0);
    await prompt.fill('Do this after the current turn');
    await prompt.press('Alt+Enter');
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1].type).toBe('followUp');
    commands[1].reply();
    await expect(page.locator('.delivery-status')).toHaveText('Queued for next turn');
    state.messages.push({ id: 'follow-up', role: 'user', text: 'Do this after the current turn' }); publish();
    await expect(page.locator('.delivery-status')).toHaveCount(0);
    await expect(page.locator('.message.user')).toHaveCount(2);
  });
});
