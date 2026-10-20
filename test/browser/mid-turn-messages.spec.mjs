import { test, expect } from '@playwright/test';

async function messageSession(page, status = 'working') {
  const state = { id: 'mid-turn', title: 'Mid-turn messages', cwd: '/project', status, model: 'anthropic/claude-opus-4-1', thinkingLevel: 'high', messages: [
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
  await page.getByRole('button', { name: /Mid-turn messages/ }).click();
  return { state, commands, publish() {
    client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  } };
}

test('mid-turn text appears and sends immediately without queue or steering controls', async ({ page }, testInfo) => {
  const { state, commands, publish } = await messageSession(page);
  const prompt = page.locator('#prompt'), text = 'Try the simpler approach';
  const sent = page.locator('.message.user').filter({ hasText: text });
  await prompt.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  // No acknowledgement or conversation echo yet; the original turn is still working.
  await expect(sent).toHaveCount(1);
  await expect(sent.locator('.delivery-status')).toHaveText('Sending…');
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: 'prompt', text });
  await prompt.fill('My next draft');
  commands[0].reply();
  await expect(page.locator('#composer-send-status')).toBeHidden();
  await expect(sent.locator('.delivery-status')).toHaveCount(0);
  await expect(prompt).toHaveValue('My next draft');
  await expect(page.locator('#abort')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.locator('#send')).not.toContainText('Steer');
  state.messages.push({ id: 'stream', role: 'assistant', text: 'Still working on the original request…' });
  publish();
  await expect(page.locator('#transcript')).toContainText('Still working on the original request…');
  await expect(sent).toHaveText(text);
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Other session/ }).click();
  await expect(page.locator('#transcript')).not.toContainText(text);
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Mid-turn messages/ }).click();
  await expect(sent).toHaveText(text);
  await expect(prompt).toHaveValue('My next draft');
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  for (const [width, scheme] of [[390, 'light'], [320, 'dark'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('#send')).toBeInViewport();
    const send = await page.locator('#send').boundingBox(), reasoning = await page.locator('#reasoning-control').boundingBox();
    const actions = await page.locator('.composer-actions').boundingBox();
    expect(send.height).toBeGreaterThanOrEqual(44);
    if (Math.abs(reasoning.y - actions.y) < 1) expect(reasoning.x + reasoning.width).toBeLessThanOrEqual(actions.x + 1);
    else expect(reasoning.y + reasoning.height).toBeLessThanOrEqual(actions.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mid-turn-${width}-${scheme}.png`) });
  }
  await testInfo.attach('mid-turn-conversation', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => commands.length).toBe(2);
  commands[1].reply();
  await expect(page.locator('#composer-send-status')).toBeHidden();
  await expect(sent).toHaveCount(2);
  await expect(sent.locator('.delivery-status')).toHaveCount(0);
  for (const index of [1, 2]) {
    state.messages.push({ id: 'echo-' + index, role: 'user', text },
      { id: 'received-' + index, role: 'assistant', text: `Received update ${index}.` });
    publish();
    await expect(page.locator('#transcript')).toContainText(`Received update ${index}.`);
    await expect(sent).toHaveCount(2);
  }
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Mid-turn messages/ }).click();
  await expect(sent).toHaveCount(2);
});

test('failed text delivery restores the draft, and slash commands do not leave optimistic bubbles', async ({ page }) => {
  const { commands } = await messageSession(page);
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
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(2);
  commands[1].reply();
  await expect(page.locator('#composer-send-status')).toBeHidden();
  await expect(page.locator('.message.user')).toHaveCount(0);
});

test.describe('desktop delivery', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test('idle sends and mid-turn Alt+Enter both submit ordinary prompts', async ({ page }) => {
    const { state, commands, publish } = await messageSession(page, 'idle');
    const prompt = page.locator('#prompt');
    await prompt.fill('Start a new task');
    await prompt.press('Enter');
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].type).toBe('prompt');
    commands[0].reply();
    await expect(page.locator('#composer-send-status')).toBeHidden();
    await expect(page.locator('.delivery-status')).toHaveCount(0);
    state.status = 'working';
    state.messages.push({ id: 'start', role: 'user', text: 'Start a new task' }); publish();
    await prompt.fill('Consider this new information');
    await prompt.press('Alt+Enter');
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1].type).toBe('prompt');
    commands[1].reply();
    await expect(page.locator('#composer-send-status')).toBeHidden();
    await expect(page.locator('.delivery-status')).toHaveCount(0);
    await expect(page.locator('.message.user')).toHaveCount(2);
  });
});
