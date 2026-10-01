import { test, expect } from '@playwright/test';
import { e2eKey } from '../../src/e2e.mjs';

const token = 'browser-test-token-only-123456789012345';
const key = e2eKey({ clientToken: token, bridgeToken: 'browser-test-bridge-token-only-1234567890' });

test('an encrypted login link seals every frame after the handshake', async ({ page }) => {
  const sent = [], received = [];
  page.on('websocket', ws => {
    ws.on('framesent', frame => sent.push(String(frame.payload)));
    ws.on('framereceived', frame => received.push(String(frame.payload)));
  });
  await page.goto('/#token=' + token + '&key=' + key);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
  expect(JSON.parse(sent[0])).toMatchObject({ type: 'auth', e2e: true });
  expect(JSON.parse(sent[1]).type).toBe('hello');
  expect(JSON.parse(received[0]).type).toBe('hello');
  expect(sent.length).toBeGreaterThan(2);
  for (const frame of [...sent.slice(2), ...received.slice(1)]) expect(frame).not.toMatch(/Project Alpha|"op"|"type"/);
});

test('a malformed or wrong encryption key signs out with a rescan prompt', async ({ page }) => {
  await page.goto('/#token=' + token + '&key=short');
  await expect(page.locator('#login-error')).toHaveText(/no encryption key/);
  await page.goto('/#token=' + token + '&key=' + 'A'.repeat(43));
  await page.reload();
  await expect(page.locator('#login-error')).toHaveText(/Encryption check failed/);
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBeNull();
});
