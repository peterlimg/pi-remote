import { test, expect } from '@playwright/test';
import { cleanMessage } from '../../src/catalog.mjs';

const file = { name: 'screenshot.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') };

for (const rejected of [false, true]) test(`slow image acknowledgement frees the editor and ${rejected ? 'restores failed content' : 'preserves the next draft'}`, async ({ page }) => {
  const state = { id: 'slow-send', title: 'Slow send', cwd: '/project', status: 'idle', messages: [] };
  const other = { ...state, id: 'other', title: 'Other session' };
  const commands = [];
  let finish, client, imageRequests = 0;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const p = JSON.parse(raw);
    const reply = (ok = true, error) => ws.send(JSON.stringify({ type: 'response', id: p.id, ok, error, value: [] }));
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state, other] }));
    } else if (p.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: p.sessionId, version: 0, state: p.sessionId === state.id ? state : other })); reply();
    } else if (p.op === 'command') { commands.push(p); finish = reply; }
    else if (p.op === 'image') { imageRequests++; reply(false, 'Image not saved yet'); }
    else reply();
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Slow send/ }).click();
  await page.locator('#prompt').fill('Describe this screenshot');
  await page.locator('#image-files').setInputFiles(file);
  await page.locator('#send').click();
  // No acknowledgement is sent yet, however long the network takes.
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#attachments')).toBeHidden();
  await expect(page.locator('#composer-send-status')).toHaveText('Sending 1 image…');
  const sent = page.locator('.message.user').filter({ hasText: 'Describe this screenshot' });
  await expect(sent).toHaveCount(1);
  await expect.poll(() => sent.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const preview = await sent.locator('img').boundingBox(), prompt = await sent.locator('.message-text').boundingBox();
  expect(preview.y + preview.height).toBeLessThan(prompt.y);
  expect(Math.abs(preview.x + preview.width - prompt.x - prompt.width)).toBeLessThan(2);
  await expect.poll(() => commands.length).toBe(1);
  await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#prompt').fill('My next message');
  await page.screenshot({ path: `test-results/sending-mobile-${rejected}.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `test-results/sending-desktop-${rejected}.png` });
  if (rejected) {
    await page.getByRole('button', { name: /Other session/ }).click();
    await page.locator('#prompt').fill('Other session draft');
    await expect(page.locator('#composer-send-status')).toBeHidden();
  }
  finish(!rejected, rejected ? 'Upload rejected' : undefined);
  if (rejected) {
    await expect(page.locator('#notice')).toContainText('Upload rejected');
    await expect(page.locator('#prompt')).toHaveValue('Other session draft');
    await page.getByRole('button', { name: /Slow send/ }).click();
  }
  await expect(page.locator('#composer-send-status')).toBeHidden();
  await expect(page.locator('#send')).toBeEnabled();
  await expect(page.locator('#prompt')).toHaveValue(rejected ? 'Describe this screenshot\n\nMy next message' : 'My next message');
  await expect(page.locator('#attachments img')).toHaveCount(rejected ? 1 : 0);
  if (rejected) await expect(sent).toHaveCount(0);
  else {
    // An acknowledgement is not the conversation echo. Keep the preview in between.
    await expect(sent).toHaveCount(1);
    await expect(sent.locator('.delivery-status')).toHaveText('Sent. Waiting for Pi…');
    state.messages.push(cleanMessage({ role: 'user', content: [
      { type: 'text', text: 'Describe this screenshot\n\n[Image: original 1170x2532, displayed at 924x2000. Multiply coordinates by 1.27 to map to original image.]' },
      { type: 'image', mimeType: file.mimeType, data: file.buffer.toString('base64') }
    ] }, 'echo'));
    client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
    await expect(sent).toHaveCount(1);
    await expect(sent.locator('.delivery-status')).toHaveCount(0);
    await expect(sent).not.toContainText('[Image:');
    await expect.poll(() => sent.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(imageRequests).toBe(0); // Do not replace the local preview with a not-yet-persisted image.
  }
  expect(commands).toHaveLength(1);
});
