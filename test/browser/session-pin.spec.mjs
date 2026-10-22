import { test, expect } from '@playwright/test';

test('session details can pin and unpin by keyboard, preserving drafts and running work across reload', async ({ page }) => {
  const pins = [], commands = [];
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString());
    if (packet.op === 'pin') pins.push(packet);
    if (packet.op === 'command') commands.push(packet);
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#status')).toHaveText(/^(idle|working)$/);
  const status = await page.locator('#status').textContent();
  await page.locator('#prompt').fill('Keep this draft while pinning');
  await page.locator('.session-info summary').press('Enter');
  await page.getByRole('button', { name: 'Pin session', exact: true }).press('Enter');
  await expect.poll(() => pins.length).toBe(1);
  await expect(page.locator('#project')).toBeHidden();
  await page.locator('.session-info summary').press('Enter');
  await expect(page.getByRole('button', { name: 'Unpin session', exact: true })).toBeVisible();
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft while pinning');
  await expect(page.locator('#status')).toHaveText(status);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(page.getByRole('button', { name: /Project Alpha/ }).getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Project Beta/ }).getByRole('img', { name: 'Pinned', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('.session-info summary').press('Enter');
  await page.getByRole('button', { name: 'Unpin session', exact: true }).press('Enter');
  await expect.poll(() => pins.length).toBe(2);
  expect(pins.map(packet => ({ sessionId: packet.sessionId, pinned: packet.pinned }))).toEqual([
    { sessionId: pins[0].sessionId, pinned: true }, { sessionId: pins[0].sessionId, pinned: false }
  ]);
  await page.locator('.session-info summary').press('Enter');
  await expect(page.getByRole('button', { name: 'Pin session', exact: true })).toBeVisible();
  await expect(page.locator('#status')).toHaveText(status);
  expect(commands).toEqual([]);
});
