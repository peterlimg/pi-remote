import { test, expect } from '@playwright/test';
import { cleanMessage } from '../../src/catalog.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const file = { name: 'screenshot.png', mimeType: 'image/png', buffer: png };
test('thread images load lazily, survive updates, open full size and retry failures', async ({ page }) => {
  const image = { type: 'image', mimeType: 'image/png', data: png.toString('base64') };
  const state = { id: 'images', title: 'Screenshot review', cwd: '/project', status: 'idle', messages: [
    cleanMessage({ role: 'user', content: [{ type: 'text', text: 'Compare these screenshots.' }, image, image] }, 'user'),
    cleanMessage({ role: 'toolResult', toolName: 'read', toolCallId: 'read', content: [image] }, 'tool'),
    cleanMessage({ role: 'assistant', content: 'The images are attached above.' }, 'reply')
  ] };
  let client, requests = 0, fail = true;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state }));
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
    } else if (packet.op === 'image') {
      requests++;
      expect(packet.imageId).toBe(state.messages[0].images[0].id);
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: !fail, value: image, error: fail ? 'Try again' : undefined }));
      fail = false;
    } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Screenshot review/ }).click();
  const retry = page.getByRole('button', { name: 'Image unavailable. Retry' });
  await expect(retry).toBeVisible();
  await retry.click();
  const previews = page.locator('.message.user .thread-images img');
  await expect(previews).toHaveCount(2);
  await expect.poll(() => previews.evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  await expect(page.locator('.message.user')).not.toContainText('[image]');
  expect(requests).toBe(3); // The collapsed tool image has not been fetched.
  const urls = await previews.evaluateAll(images => images.map(img => img.src));
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state: { ...state, status: 'working' } }));
  await expect(page.locator('#abort')).toBeVisible();
  expect(await previews.evaluateAll(images => images.map(img => img.src))).toEqual(urls);
  expect(requests).toBe(3);
  const popup = page.waitForEvent('popup');
  await page.locator('.message.user .thread-images a').first().click();
  const opened = await popup;
  await expect(opened.locator('img')).toBeVisible();
  await opened.close();
  await page.screenshot({ path: 'test-results/thread-images-mobile.png' });
  await page.locator('.tool summary').click();
  const toolImage = page.locator('.tool .thread-images img');
  await expect(toolImage).toBeVisible();
  await expect.poll(() => toolImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/thread-images-desktop.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#transcript img')).toHaveCount(0);
  expect(await page.evaluate(async url => { try { await fetch(url); return true; } catch { return false; } }, urls[0])).toBe(false);
  expect(errors).toEqual([]);
});

test('image picker waits for keyboard dismissal before Safari captures its anchor', async ({ page }) => {
  // Native repro: in iOS Safari, focus Message, type a draft, then tap +.
  // The source menu must stay beside + after the keyboard closes, including on reopening.
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.keyboardHeight = height => {
      viewport.height = height; viewport.dispatchEvent(new Event('resize'));
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const prompt = page.locator('#prompt'), input = page.getByLabel('Attach images', { exact: true });
  const pickers = [];
  page.on('filechooser', picker => pickers.push(picker));
  await prompt.fill('Keep this draft');
  await page.evaluate(() => window.keyboardHeight(460));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await input.tap();
  await expect(prompt).not.toBeFocused();
  expect(pickers).toHaveLength(0);
  await page.clock.runFor(300);
  await page.evaluate(() => window.keyboardHeight(700));
  await input.tap(); // Repeated taps must not bypass the keyboard wait.
  await page.clock.runFor(50);
  expect(pickers).toHaveLength(0);
  await page.evaluate(() => window.keyboardHeight(844));
  await page.clock.runFor(100);
  await expect.poll(() => pickers.length).toBe(1);
  expect(pickers[0].isMultiple()).toBe(true);
  expect(await input.boundingBox()).toEqual(await page.locator('#attach').boundingBox());
  await input.dispatchEvent('cancel');
  await expect(prompt).toHaveValue('Keep this draft');
  await input.tap(); // No keyboard: reopen immediately, with no duplicate source sheet.
  await expect.poll(() => pickers.length).toBe(2);
  await input.dispatchEvent('cancel');
  await prompt.focus();
  await input.tap(); // A hardware keyboard emits no resize; the fallback still opens.
  await page.clock.runFor(350);
  await expect.poll(() => pickers.length).toBe(3);
  await input.dispatchEvent('cancel');
  await prompt.focus();
  await input.tap();
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await page.clock.runFor(1000);
  expect(pickers).toHaveLength(3); // Never open a delayed picker for a different session.
});

test('image picker previews, removes and preserves session drafts until acknowledgement', async ({ page }) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/project', status: 'idle', messages: [] }));
  const commands = [], errors = [];
  let finish, client;
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const p = JSON.parse(raw);
    const reply = (ok = true, error) => ws.send(JSON.stringify({ type: 'response', id: p.id, ok, error, value: [] }));
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
    } else if (p.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: p.sessionId, version: 1, state: states.find(s => s.id === p.sessionId) })); reply();
    } else if (p.op === 'command') { commands.push(p); finish = reply; }
    else reply();
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Alpha/ }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByLabel('Attach images', { exact: true }).click();
  await (await picker).setFiles(file);
  await expect(page.getByRole('img', { name: file.name })).toBeVisible();
  await expect.poll(() => page.locator('#attachments img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: `Remove ${file.name}` }).click();
  await expect(page.getByLabel('Attach images', { exact: true })).toBeFocused();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.locator('#image-files').setInputFiles(file);
  await page.locator('#prompt').fill('What is in this image?');
  client.send(JSON.stringify({ type: 'ready' }));
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('Restart Pi Remote');
  expect(commands).toHaveLength(0);
  client.send(JSON.stringify({ type: 'ready', supportsImages: true }));
  await page.screenshot({ path: 'test-results/images-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(page.locator('#attachments img')).toHaveCount(1);
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(1);
  await expect(page.getByLabel('Attach images', { exact: true })).toBeDisabled();
  finish(false, 'Upload rejected');
  await expect(page.locator('#notice')).toHaveText('Upload rejected');
  await expect(page.locator('#attachments img')).toHaveCount(1);
  await expect(page.locator('#prompt')).toHaveValue('What is in this image?');
  await page.locator('#prompt').fill('/new');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('not a slash command');
  expect(commands).toHaveLength(1);
  await page.locator('#prompt').fill('');
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(2);
  finish();
  await expect(page.locator('#attachments')).toBeHidden();
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual(
    ['What is in this image?', ''].map(text => ({ sessionId: 'Alpha', command: { type: 'prompt', text,
      images: [{ type: 'image', mimeType: file.mimeType, data: png.toString('base64') }] } })));
  for (const files of [Array(5).fill(file), { ...file, buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }, { ...file, mimeType: 'image/svg+xml' }]) {
    await page.locator('#image-files').setInputFiles(files);
    await expect(page.locator('#notice')).toContainText('Attach up to 4 images, 2 MB total');
    await expect(page.locator('#attachments')).toBeHidden();
  }
  await page.locator('#image-files').setInputFiles([file, { ...file, name: 'second.png' }]);
  await expect(page.locator('#attachments img')).toHaveCount(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/images-desktop.png' });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#attachments img')).toHaveCount(0);
  expect(errors).toEqual([]);
});
