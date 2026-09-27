import { test, expect } from '@playwright/test';

const file = { name: 'screenshot.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') };

for (const outcome of ['confirmed', 'unknown', 'timeout', 'edited', 'unsupported', 'logout']) test(`image send recovery: ${outcome}, without resending`, async ({ page }) => {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  const state = { id: 'images', title: 'Image recovery', cwd: '/project', status: 'idle', messages: [] };
  const commands = [], lookups = [];
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    const reply = value => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true, supportsCommandResults: !(outcome === 'unsupported' && commands.length) }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state })); reply();
    } else if (packet.op === 'command') {
      commands.push(packet);
      state.messages.push({ id: 'delivered', role: 'user', text: packet.command.text + '\n[image]' });
      state.status = 'working';
      ws.close({ code: 1012, reason: 'Connection interrupted before acknowledgement' });
    } else if (packet.op === 'commandResult') {
      lookups.push(packet);
      if (outcome !== 'timeout') reply(outcome === 'unknown'
        ? { ok: false, error: 'Delivery outcome is unknown. Inspect the conversation before sending again.' }
        : { ok: true, value: { accepted: true } });
    } else reply([]);
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Image recovery/ }).click();
  await page.locator('#prompt').fill('Describe this screenshot');
  await page.locator('#image-files').setInputFiles(file);
  await page.locator('#send').click();
  await expect(page.locator('#status')).toHaveText('Disconnected');
  if (outcome === 'edited') await page.locator('#prompt').fill('My next message');
  if (outcome === 'logout') {
    await page.locator('#back').click();
    await page.locator('#logout').click();
    await page.clock.runFor(40000);
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#attachments img')).toHaveCount(0);
    expect(commands).toHaveLength(1); expect(lookups).toHaveLength(0);
    return;
  }
  await page.clock.runFor(1100);
  await expect(page.locator('#transcript')).toContainText('Describe this screenshot');
  if (outcome === 'timeout') {
    await expect(page.locator('#send')).toBeDisabled();
    await page.clock.runFor(35000);
  }
  if (['unknown', 'timeout', 'unsupported'].includes(outcome)) {
    await expect(page.locator('#notice')).toContainText(outcome === 'timeout' ? 'No acknowledgement' : 'Delivery outcome is unknown');
    await expect(page.locator('#prompt')).toHaveValue('Describe this screenshot');
    await expect(page.locator('#attachments img')).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Remove ${file.name}` })).toBeEnabled();
    await expect(page.locator('#send')).toBeEnabled();
  } else {
    await expect(page.locator('#prompt')).toHaveValue(outcome === 'edited' ? 'My next message' : '');
    await expect(page.locator('#attachments')).toBeHidden();
    await expect(page.locator('#notice')).toBeHidden();
  }
  await expect(page.locator('#attach')).toBeEnabled();
  expect(commands).toHaveLength(1);
  expect(lookups).toHaveLength(outcome === 'unsupported' ? 0 : 1);
  if (lookups.length) {
    expect(lookups[0].sessionId).toBe(state.id);
    expect(lookups[0].requestId).toBe(commands[0].id);
  }
});
