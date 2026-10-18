import { test, expect } from '@playwright/test';
import { e2eKey } from '../../src/e2e.mjs';
import WebSocket from 'ws';

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

test.describe('Home Screen access', () => {
  const origin = 'https://phone.example';
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    // Forward a non-loopback HTTPS origin to the real fixture, like the phone's tunnel.
    await context.route(origin + '/**', async route => {
      const url = new URL(route.request().url());
      await route.fulfill({ response: await context.request.get('http://127.0.0.1:8799' + url.pathname + url.search) });
    });
    await context.routeWebSocket(origin.replace('https:', 'wss:') + '/ws', socket => {
      const host = new WebSocket('ws://127.0.0.1:8799/ws', { origin: 'http://127.0.0.1:8799' });
      const queued = [];
      socket.onMessage(data => host.readyState === WebSocket.OPEN ? host.send(data) : queued.push(data));
      host.on('open', () => queued.forEach(data => host.send(data)));
      host.on('message', data => socket.send(data.toString()));
      host.on('close', () => socket.close());
      host.on('error', () => socket.close());
      socket.onClose(() => host.terminate());
    });
  });

  test('a saved token-only URL keeps its matching encryption key', async ({ page }) => {
    await page.goto(origin + '/#token=' + token + '&key=' + key);
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    // An older shortcut can reopen its original token-only URL instead of the cleaned address.
    await page.goto(origin + '/#token=' + token);
    await page.reload();
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('#login-error')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
  });

  test('pasting a complete link repairs a fresh profile and survives reopening', async ({ page, context }) => {
    await page.goto(origin + '/#token=' + token);
    await expect(page.locator('#login-error')).toHaveText(/no encryption key/);
    await page.getByLabel('Private login link').fill(origin + '/#token=' + token + '&key=' + key);
    await page.getByRole('button', { name: 'Connect to computer' }).click();
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    await expect(page.locator('#login-error')).toBeHidden();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(origin);
    await expect(reopened.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    expect(await reopened.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
  });

  test('a complete link repairs a failed login without reloading the open app', async ({ page }) => {
    await page.goto(origin + '/#token=' + token);
    await expect(page.locator('#login-error')).toHaveText(/no encryption key/);
    await page.goto(origin + '/#token=' + token + '&key=' + key);
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible({ timeout: 2000 });
    expect(new URL(page.url()).hash).toBe('');
  });

  test('a different token cannot inherit the saved encryption key', async ({ page }) => {
    await page.goto(origin + '/#token=' + token + '&key=' + key);
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    await page.goto(origin + '/#token=different-token');
    await expect(page.locator('#login-error')).toHaveText(/no encryption key/);
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBeNull();
  });
});

test('a malformed or wrong encryption key signs out with a rescan prompt', async ({ page }) => {
  await page.goto('/#token=' + token + '&key=short');
  await expect(page.locator('#login-error')).toHaveText(/no encryption key/);
  await page.goto('/#token=' + token + '&key=' + 'A'.repeat(43));
  await expect(page.locator('#login-error')).toHaveText(/Encryption check failed/);
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBeNull();
});
