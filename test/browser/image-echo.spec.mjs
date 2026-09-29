import { test, expect } from '@playwright/test';
import { cleanMessage } from '../../src/catalog.mjs';

const image = { type: 'image', mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=' };
const file = { name: 'screenshot.png', mimeType: image.mimeType, buffer: Buffer.from(image.data, 'base64') };

for (const earlyEcho of [true, false]) test(`image-only sends reconcile ${earlyEcho ? 'before acknowledgement' : 'after queueing identical images'}, not with older messages`, async ({ page }) => {
  const message = id => cleanMessage({ role: 'user', content: [image] }, id);
  const state = { id: 'echo', title: 'Image echo', cwd: '/project', status: 'working', messages: [message('old')] };
  let client, finish, requests = 0, version = 0;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const p = JSON.parse(raw);
    const reply = value => ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value }));
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (p.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version, state })); reply();
    } else if (p.op === 'command') finish = reply;
    else if (p.op === 'image') { requests++; reply(image); }
    else reply([]);
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Image echo', exact: false }).click();
  await expect.poll(() => page.locator('.thread-image img').evaluate(img => img.naturalWidth)).toBe(1);
  const echo = id => {
    state.messages.push(message(id));
    client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  };
  for (const [index, id] of ['first', 'second'].entries()) {
    await page.locator('#image-files').setInputFiles(file);
    await page.locator('#send').click();
    await expect(page.locator('.message.user')).toHaveCount(index + 2);
    await expect(page.locator('.message.user').last().locator('img')).toBeVisible();
    if (earlyEcho) {
      echo(id);
      await expect(page.locator('.message.user')).toHaveCount(state.messages.length);
      await expect(page.locator('.delivery-status')).toHaveCount(0);
    }
    await expect.poll(() => typeof finish).toBe('function');
    finish(); finish = undefined;
    await expect(page.locator('#composer-send-status')).toBeHidden();
  }
  if (!earlyEcho) {
    echo('first');
    await expect(page.locator('.delivery-status')).toHaveCount(1);
    // A second snapshot must not mistake the first echo for the second submission.
    client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
    await expect(page.locator('.message.user')).toHaveCount(3);
    await expect(page.locator('.delivery-status')).toHaveCount(1);
    echo('second');
    await expect(page.locator('.delivery-status')).toHaveCount(0);
    await expect(page.locator('.message.user')).toHaveCount(3);
  }
  expect(requests).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Image echo', exact: false }).click();
  await expect(page.locator('.message.user')).toHaveCount(3);
  await expect.poll(() => page.locator('.thread-image img').evaluateAll(images => images.length === 3 && images.every(img => img.naturalWidth > 0))).toBe(true);
});

test('a failed image retries when fresh session data arrives after persistence catches up', async ({ page }) => {
  const state = { id: 'retry', title: 'Image retry', cwd: '/project', status: 'working',
    messages: [cleanMessage({ role: 'user', content: [image] }, 'image')] };
  let client, requests = 0;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const p = JSON.parse(raw);
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (p.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state }));
      ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true }));
    } else if (p.op === 'image') {
      requests++;
      ws.send(JSON.stringify({ type: 'response', id: p.id, ok: requests > 1, value: image, error: 'Image is no longer available in this session' }));
    } else ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Image retry', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Image unavailable. Retry' })).toBeVisible();
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state: { ...state, status: 'idle' } }));
  await expect.poll(() => page.locator('.thread-image img').evaluate(img => img.naturalWidth)).toBe(1);
  expect(requests).toBe(2);
});
