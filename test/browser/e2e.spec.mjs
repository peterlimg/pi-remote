import { test, expect, devices } from '@playwright/test';
import { e2eKey } from '../../src/e2e.mjs';
import { browserOrigin } from '../browser-config.mjs';
import WebSocket from 'ws';

const token = 'browser-test-token-only-123456789012345';
const key = e2eKey({ clientToken: token, bridgeToken: 'browser-test-bridge-token-only-1234567890' });
const origin = 'https://phone.example';

// Forward a non-loopback HTTPS origin to the real fixture, like the phone's tunnel.
async function phone(context, standalone = true) {
  if (standalone) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await context.route(origin + '/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await context.request.get(browserOrigin + url.pathname + url.search) });
  });
  await context.routeWebSocket(origin.replace('https:', 'wss:') + '/**', socket => {
    const path = new URL(socket.url()).pathname;
    const host = new WebSocket(browserOrigin.replace('http:', 'ws:') + path, { origin: browserOrigin });
    const queued = [];
    socket.onMessage(data => host.readyState === WebSocket.OPEN ? host.send(data) : queued.push(data));
    host.on('open', () => queued.forEach(data => host.send(data)));
    host.on('message', data => socket.send(data.toString()));
    host.on('close', (code, reason) => socket.close({ code: code === 1006 ? 1011 : code, reason: reason.toString() }));
    host.on('error', () => socket.close());
    socket.onClose(() => host.terminate());
  });
}

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
  test.beforeEach(async ({ context }) => phone(context));

  test('a saved token-only URL keeps its matching encryption key', async ({ page }) => {
    await page.goto(origin + '/#token=' + token + '&key=' + key);
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    await expect(page.locator('#home-screen-hint')).toBeHidden();
    await page.goto(origin + '/#token=' + token);
    await page.reload();
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('#login-error')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
  });

  test('a partial link names the missing key and a complete link survives reopening', async ({ page, context }) => {
    await page.goto(origin + '/#token=' + token);
    await expect(page.locator('#login-error')).toHaveText('Link incomplete: paste the whole link including &key=');
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
    await page.getByText('Paste a private link instead', { exact: true }).click();
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

  test('a complete link repairs a partial login without reloading the app', async ({ page }) => {
    await page.goto(origin + '/#token=' + token);
    await expect(page.locator('#login-error')).toHaveText('Link incomplete: paste the whole link including &key=');
    await page.goto(origin + '/#token=' + token + '&key=' + key);
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible({ timeout: 2000 });
    expect(new URL(page.url()).hash).toBe('');
  });

  test('an incomplete different-token link cannot replace the saved login', async ({ page }) => {
    await page.goto(origin + '/#token=' + token + '&key=' + key);
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    await page.goto(origin + '/#token=different-token');
    await expect(page.locator('#login-error')).toHaveText('Link incomplete: paste the whole link including &key=');
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBe(token);
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
    await page.getByRole('button', { name: 'Back to saved login' }).click();
    await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  });

  test('pasted links tolerate HTML ampersands, a missing hash, whitespace and quotes', async ({ page }) => {
    await page.goto(origin);
    await page.getByText('Paste a private link instead', { exact: true }).click();
    for (const link of [
      `  "${origin}/#token=${token}&amp;key=${key}"  `,
      `${origin}/token=${token}&key=${key}`,
      `'token=${token}&key=${key}'`
    ]) {
      await page.getByLabel('Private login link').fill(link);
      await page.getByRole('button', { name: 'Connect to computer' }).click();
      await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
      await page.getByRole('button', { name: 'Sign out' }).click();
    }
    await page.getByLabel('Private login link').fill(origin + '/#token=' + token);
    await page.getByRole('button', { name: 'Connect to computer' }).click();
    await expect(page.locator('#login-error')).toHaveText('Link incomplete: paste the whole link including &key=');
    expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
  });
});

test('Safari saves a link and offers a short code for a separate Home Screen profile', async ({ page, context, browser }) => {
  await phone(context, false);
  await page.goto(origin + '/#token=' + token + '&key=' + key);
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  await expect(page.locator('#home-screen-message')).toHaveText('Login saved. Open Pi Remote from your Home Screen.');
  await expect(page.locator('#home-screen-code')).toContainText(/enter \d{6} there/);
  const code = (await page.locator('#home-screen-code').textContent()).match(/\d{6}/)[0];
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
  await page.reload();
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  const installed = await browser.newContext({ ...devices['iPhone 13'] });
  try {
    await phone(installed);
    const pwa = await installed.newPage();
    await pwa.goto(origin);
    await pwa.getByLabel('Pairing code', { exact: true }).fill(code);
    await pwa.getByRole('button', { name: 'Pair with computer' }).click();
    await expect(pwa.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
    expect(await pwa.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe(key);
    await expect(pwa.locator('#home-screen-hint')).toBeHidden();
  } finally { await installed.close(); }
});

test('malformed keys do not replace a login and wrong keys stay saved with a re-pair action', async ({ page }) => {
  await page.goto('/#token=' + token + '&key=short');
  await expect(page.locator('#login-error')).toHaveText(/encryption key is invalid/);
  await page.goto('/#token=' + token + '&key=' + 'A'.repeat(43));
  await expect(page.locator('#access-message')).toHaveText('Encryption check failed. Pair again.');
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-key'))).toBe('A'.repeat(43));
  await expect(page.getByRole('button', { name: 'Pair again', exact: true })).toBeVisible();
});
