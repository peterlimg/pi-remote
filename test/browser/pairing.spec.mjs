import { test, expect } from '@playwright/test';
import { e2eKey } from '../../src/e2e.mjs';

const token = 'browser-test-token-only-123456789012345';
const bridgeToken = 'browser-test-bridge-token-only-1234567890';
const key = e2eKey({ clientToken: token, bridgeToken });
const issue = async request => {
  const response = await request.post('/_pi/pair', { headers: { Authorization: 'Bearer ' + bridgeToken } });
  expect(response.status()).toBe(200);
  const pairing = await response.json();
  expect(pairing.code).toMatch(/^\d{6}$/);
  expect(pairing.expiresAt - Date.now()).toBeGreaterThan(59000);
  return pairing;
};
const enter = async (page, code) => {
  await page.getByLabel('Pairing code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Pair with computer' }).click();
};

test('a single-use code pairs with the host, saves the key and rejects reuse', async ({ page, request, context }, testInfo) => {
  const pairing = await issue(request), frames = [];
  page.on('websocket', ws => {
    if (new URL(ws.url()).pathname !== '/pair') return;
    ws.on('framesent', frame => frames.push(String(frame.payload)));
    ws.on('framereceived', frame => frames.push(String(frame.payload)));
  });
  await page.goto('/');
  const viewport = page.viewportSize();
  for (const [name, size] of [['mobile', viewport], ['desktop', { width: 1280, height: 900 }]]) {
    await page.setViewportSize(size);
    await expect(page.getByRole('button', { name: 'Pair with computer' })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`login-${name}.png`), fullPage: true });
  }
  await page.setViewportSize(viewport);
  await enter(page, pairing.code);
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBe(token);
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
  expect(frames.map(frame => JSON.parse(frame).type)).toEqual(['pair', 'pair', 'confirm', 'paired']);
  for (const frame of frames) {
    expect(frame).not.toContain(token); expect(frame).not.toContain(key);
    expect(frame).not.toContain('"code"');
  }
  await page.reload();
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(other.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBeNull();
  await enter(page, pairing.code);
  await expect(page.locator('#login-error')).toHaveText('Login expired, pair again');
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
});

test('a wrong code cannot return credentials', async ({ page, request }) => {
  const pairing = await issue(request);
  await page.goto('/');
  await enter(page, String((Number(pairing.code) + 1) % 1000000).padStart(6, '0'));
  await expect(page.locator('#login-error')).toHaveText('Login expired, pair again');
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
});

test('a code expires after 60 seconds and a fresh code can still pair', async ({ page, request }) => {
  test.setTimeout(80000);
  const pairing = await issue(request);
  await page.goto('/');
  // Real host time, not a mocked browser clock: exercise the server's expiry boundary.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, pairing.expiresAt - Date.now()) + 100));
  await enter(page, pairing.code);
  await expect(page.locator('#login-error')).toHaveText('Login expired, pair again');
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
  const fresh = await issue(request);
  await enter(page, fresh.code);
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
});

test('attempts are rate limited even when a new code is issued', async ({ page, request }) => {
  await page.goto('/');
  for (let i = 0; i < 6; i++) {
    const pairing = await issue(request);
    await enter(page, String((Number(pairing.code) + 1) % 1000000).padStart(6, '0'));
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pair with computer' })).toBeEnabled();
  }
  await expect(page.locator('#login-error')).toHaveText('Too many attempts. Wait a minute, then pair again.');
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
});

test('an encrypted network reconnect keeps both credentials and the draft', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeSocket = WebSocket;
    window.sockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); window.sockets.push(this); }
    };
  });
  await page.goto('/#token=' + token + '&key=' + key);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Keep this encrypted draft');
  await page.evaluate(() => window.sockets.at(-1).close(1000, 'Network changed'));
  await expect(page.locator('#connection')).toHaveText("Couldn't connect, retrying. Network changed");
  await expect(page.locator('#login')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBe(token);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await expect(page.locator('#prompt')).toHaveValue('Keep this encrypted draft');
});
