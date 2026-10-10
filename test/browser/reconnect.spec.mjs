import { test, expect } from '@playwright/test';

const state = { id: 'reconnect', title: 'Reconnect test', cwd: '/project', status: 'idle', messages: [] };
const url = '/#token=browser-test-token-only-123456789012345';

async function freezeTime(page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

function answer(ws, packet) {
  if (packet.type === 'auth') {
    ws.send(JSON.stringify({ type: 'ready' }));
    ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
  } else if (packet.op === 'watch') {
    ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state }));
    ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
  } else if (packet.op !== 'command') {
    ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: packet.op === 'commands' ? [] : {} }));
  }
}

test('connecting stays in the composer and disappears on recovery without stale offline notices', async ({ page }) => {
  await freezeTime(page);
  const channels = [];
  await page.routeWebSocket('**/ws', ws => {
    channels.push(ws);
    const attempt = channels.length;
    ws.onMessage(raw => { if (attempt === 1) answer(ws, JSON.parse(raw)); });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Reconnect test/ }).click();
  const connecting = page.locator('#composer-connection');
  await expect(page.locator('#send')).toBeEnabled();
  await expect(connecting).toBeHidden();
  await page.locator('#prompt').fill('Keep this draft');
  channels[0].close({ code: 1012, reason: 'Computer disconnected' });
  await expect(page.locator('#send')).toBeDisabled();
  // Opening a cached session while offline used to leave a permanent warning.
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Reconnect test/ }).click();
  await expect(page.locator('#notice')).toBeHidden();
  await expect(connecting).toBeVisible();
  await expect(connecting).toHaveText('Connecting');
  await expect(page.locator('#composer-hint')).toBeHidden();
  // Connecting replaces the settings pill in the toolbar instead of sitting on the draft.
  const row = await connecting.boundingBox(), prompt = await page.locator('#prompt').boundingBox();
  expect(row.y).toBeGreaterThanOrEqual(prompt.y + prompt.height);
  await expect(page.locator('.composer-settings')).toBeHidden();
  await page.clock.runFor(1100);
  await expect.poll(() => channels.length).toBe(2);
  channels[1].send(JSON.stringify({ type: 'notice', error: 'Computer is offline' }));
  await expect(page.locator('#notice')).toBeHidden();
  await expect(connecting).toBeVisible();
  channels[1].send(JSON.stringify({ type: 'notice', error: 'An unrelated warning' }));
  await expect(page.locator('#notice')).toHaveText('An unrelated warning');
  channels[1].send(JSON.stringify({ type: 'ready' }));
  await expect(connecting).toBeHidden();
  await expect(page.locator('#send')).toBeEnabled();
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await expect(page.locator('#notice')).toHaveText('An unrelated warning');
});

test('a silent reconnect times out, preserves drafts, and re-watches without replaying a command', async ({ page }) => {
  await freezeTime(page);
  const channels = [], commands = [], watches = [];
  await page.routeWebSocket('**/ws', ws => {
    channels.push(ws);
    const attempt = channels.length;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.op === 'command') commands.push(packet);
      if (packet.op === 'watch') watches.push(packet.sessionId);
      if (attempt !== 2) answer(ws, packet); // Accept the retry's transport, but never acknowledge auth.
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Reconnect test/ }).click();
  await expect(page.locator('#send')).toBeEnabled();
  await page.locator('#prompt').fill('Do not send twice');
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(1);
  channels[0].close({ code: 1012, reason: 'Deploy' });
  await expect(page.locator('#status')).toHaveText('Disconnected');
  await page.clock.runFor(1100);
  await expect.poll(() => channels.length).toBe(2);
  await expect(page.locator('#connection')).toHaveText('Connecting…');
  await page.clock.runFor(24000);
  await expect.poll(() => channels.length, { timeout: 2000 }).toBe(3);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await expect(page.locator('#send')).toBeEnabled();
  await expect(page.locator('#prompt')).toHaveValue('Do not send twice');
  await expect(page.locator('#notice')).toContainText('Delivery may have occurred');
  expect(watches).toEqual([state.id, state.id]);
  expect(commands).toHaveLength(1);
});

test('a half-open connection is detected by heartbeat and resumes on network or foreground return', async ({ page }) => {
  await freezeTime(page);
  const channels = [];
  let silent = false, pings = 0;
  await page.routeWebSocket('**/ws', ws => {
    channels.push(ws);
    const attempt = channels.length;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.op === 'ping') pings++;
      if (!(attempt === 1 && silent)) answer(ws, packet);
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Reconnect test/ }).click();
  await page.locator('#prompt').fill('Keep my draft');
  silent = true; // No close event, as when a phone loses its network.
  await page.clock.runFor(20000);
  await expect.poll(() => pings).toBe(1);
  await page.clock.runFor(11000);
  await expect.poll(() => channels.length).toBe(2);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await expect(page.locator('#prompt')).toHaveValue('Keep my draft');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => channels.length).toBe(3);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  // A brief hide, like iOS edge-swipe back, keeps the live socket and only pings it.
  const setVisibility = state => page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await page.clock.runFor(1000);
  await setVisibility('visible');
  await expect.poll(() => pings).toBe(2);
  expect(channels).toHaveLength(3);
  await expect(page.locator('#connection')).toBeHidden();
  await setVisibility('hidden');
  await page.clock.runFor(6000);
  await setVisibility('visible');
  await expect.poll(() => channels.length).toBe(4);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await expect(page.locator('#prompt')).toHaveValue('Keep my draft');
  channels.at(-1).close({ code: 1008, reason: 'Authentication failed' });
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login-error')).toHaveText('Authentication failed');
  await page.clock.runFor(60000);
  expect(channels).toHaveLength(4);
});

test('a hung handshake is replaced without waiting for close; stale events and logout cannot revive it', async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript(() => {
    window.testSockets = [];
    window.WebSocket = class extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      constructor() { super(); window.testSockets.push(this); }
      send() {}
      close() { this.readyState = 2; } // Black-holed close handshake never emits close.
    };
  });
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('Connecting…');
  await page.clock.runFor(21000);
  expect(await page.evaluate(() => window.testSockets.length)).toBe(2);
  await page.evaluate(state => {
    const [old, current] = window.testSockets;
    current.readyState = 1;
    current.dispatchEvent(new Event('open'));
    current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) }));
    current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'sessions', sessions: [state] }) }));
    old.dispatchEvent(new Event('open'));
    old.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'sessions', sessions: [] }) }));
    old.dispatchEvent(new Event('error'));
    old.dispatchEvent(new CloseEvent('close', { code: 1008, reason: 'Stale authentication error' }));
  }, state);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await expect(page.locator('#sessions .session')).toHaveCount(1);
  await page.locator('#logout').click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(60000);
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => window.testSockets.length)).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('pi-remote-token'))).toBeNull();
});
