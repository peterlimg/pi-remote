import { test, expect } from '@playwright/test';

const file = { name: 'screenshot.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') };

for (const rejected of [false, true]) test(`slow image acknowledgement frees the editor and ${rejected ? 'restores failed content' : 'preserves the next draft'}`, async ({ page }) => {
  const state = { id: 'slow-send', title: 'Slow send', cwd: '/project', status: 'idle', messages: [] };
  const other = { ...state, id: 'other', title: 'Other session' };
  const commands = [];
  let finish;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const p = JSON.parse(raw);
    const reply = (ok = true, error) => ws.send(JSON.stringify({ type: 'response', id: p.id, ok, error, value: [] }));
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state, other] }));
    } else if (p.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: p.sessionId, version: 0, state: p.sessionId === state.id ? state : other })); reply();
    } else if (p.op === 'command') { commands.push(p); finish = reply; }
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
  expect(commands).toHaveLength(1);
});
