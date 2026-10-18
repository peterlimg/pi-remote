import { test, expect } from '@playwright/test';
import { pairingQr, pairingUrl } from '../../src/pairing.mjs';

const config = { publicUrl: 'http://127.0.0.1:8799', clientToken: 'browser-test-token-only-123456789012345',
  bridgeToken: 'browser-test-bridge-token-only-1234567890' };
const link = pairingUrl(config);
const code = value => pairingQr(value).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));

// Only the camera is simulated: real terminal QR pixels flow through a MediaStream and the shipped decoder.
async function camera(page, mode = 'allowed') {
  await page.addInitScript(mode => {
    const state = window.cameraFixture = { requests: [], tracks: [], lines: [] };
    const open = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
      const context = canvas.getContext('2d');
      const paint = () => {
        context.fillStyle = '#fff'; context.fillRect(0, 0, 640, 640);
        const scale = 4, lines = state.lines;
        const left = (640 - (lines[0]?.length || 0) * scale) / 2, top = (640 - lines.length * 2 * scale) / 2;
        for (let y = 0; y < lines.length * 2; y++) for (let x = 0; x < lines[0].length; x++) {
          const glyph = lines[Math.floor(y / 2)][x];
          const white = glyph === '█' || (y % 2 === 0 ? glyph === '▀' : glyph === '▄');
          context.fillStyle = white ? '#fff' : '#000';
          context.fillRect(left + x * scale, top + y * scale, scale, scale);
        }
      };
      paint();
      const stream = canvas.captureStream(10), timer = setInterval(paint, 100);
      for (const track of stream.getTracks()) {
        state.tracks.push(track);
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
      }
      return stream;
    };
    // Keep WebKit's mocked MediaDevices wrapper alive between scans.
    state.devices = navigator.mediaDevices;
    state.devices.getUserMedia = constraints => {
      state.requests.push(constraints);
      if (mode === 'denied') return Promise.reject(new DOMException('Camera denied', 'NotAllowedError'));
      if (mode === 'pending') return new Promise(resolve => { state.grant = () => resolve(open()); });
      return Promise.resolve(open());
    };
  }, mode);
}
const showCode = (page, value) => page.evaluate(lines => { window.cameraFixture.lines = lines; }, code(value));
const stopped = page => expect.poll(() => page.evaluate(() => window.cameraFixture.tracks.map(track => track.readyState))).toEqual(['ended']);

test('scan the terminal QR inside the app, stop the camera and remember the encrypted login', async ({ page, context }, testInfo) => {
  await camera(page);
  const sent = [], requests = [];
  page.on('request', request => requests.push({ path: new URL(request.url()).pathname, method: request.method() }));
  page.on('websocket', ws => ws.on('framesent', frame => sent.push(String(frame.payload))));
  await page.goto('/');
  expect(requests.some(request => ['/qr.js', '/jsqr.js'].includes(request.path))).toBe(false);
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan login QR' })).toBeVisible();
  await expect(page.locator('#qr-status')).toHaveText(/Point your camera/);
  await expect(page.locator('#qr-video')).toBeVisible();
  expect(await page.evaluate(() => window.cameraFixture.requests[0])).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
  await page.screenshot({ path: testInfo.outputPath('qr-mobile.png'), fullPage: true });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('qr-desktop.png'), fullPage: true });
  await page.setViewportSize(viewport);
  await showCode(page, link);
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  await expect(page.locator('#qr-scanner')).not.toBeVisible();
  await stopped(page);
  expect(JSON.parse(sent[0])).toMatchObject({ type: 'auth', e2e: true });
  expect(sent.slice(2).every(frame => !frame.includes('"op"'))).toBe(true);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  await reopened.getByRole('button', { name: 'Sign out' }).click();
  await expect(reopened.getByRole('button', { name: 'Scan QR code' })).toBeVisible();
});

test('reject incomplete and other-origin QR codes without sending credentials', async ({ page }) => {
  await camera(page);
  let sockets = 0;
  page.on('websocket', () => sockets++);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await showCode(page, config.publicUrl + '/#token=' + config.clientToken);
  await expect(page.locator('#qr-error')).toHaveText(/not a complete login QR/);
  await showCode(page, pairingUrl(config, 'https://another.example'));
  await expect(page.locator('#qr-error')).toHaveText(/different Pi Remote address/);
  expect(new URL(page.url()).origin).toBe(config.publicUrl);
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
  expect(sockets).toBe(0);
  await showCode(page, link);
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  await stopped(page);
});

test('denied camera permission keeps the paste-login fallback available', async ({ page }) => {
  await camera(page, 'denied');
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.locator('#qr-error')).toHaveText(/Camera access was denied/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeEnabled();
  await page.getByLabel('Private login link').fill(link);
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
});

test('cancel stops a camera granted after the permission dialog was closed', async ({ page }) => {
  await camera(page, 'pending');
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect.poll(() => page.evaluate(() => window.cameraFixture.requests.length)).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.cameraFixture.grant());
  await stopped(page);
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-token'))).toBeNull();
});

test('cancel and backgrounding stop the active camera', async ({ page }) => {
  await camera(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.locator('#qr-status')).toHaveText(/Point your camera/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stopped(page);
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeFocused();
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.locator('#qr-scanner')).toBeVisible();
  await expect(page.locator('#qr-status')).toHaveText(/Point your camera/);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#qr-scanner')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.cameraFixture.tracks.map(track => track.readyState))).toEqual(['ended', 'ended']);
});

test('a slow-loading scanner never opens the camera after the app is backgrounded', async ({ page }) => {
  await camera(page);
  let moduleRequest;
  await page.route('**/qr.js', route => { moduleRequest = route; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect.poll(() => !!moduleRequest).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await moduleRequest.continue();
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeEnabled();
  expect(await page.evaluate(() => window.cameraFixture.requests.length)).toBe(0);
  await expect(page.locator('#qr-scanner')).not.toBeVisible();
});
