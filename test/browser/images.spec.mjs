import { test, expect } from '@playwright/test';
import { cleanMessage } from '../../src/catalog.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const file = { name: 'screenshot.png', mimeType: 'image/png', buffer: png };
for (const withCall of [true, false]) test(`thread images from ${withCall ? 'called' : 'orphan'} tools stay visible, survive updates and retry failures`, async ({ page }, info) => {
  const image = { type: 'image', mimeType: 'image/png', data: png.toString('base64') };
  const state = { id: 'images', title: 'Screenshot review', cwd: '/project', status: 'idle', messages: [
    cleanMessage({ role: 'user', content: [{ type: 'text', text: 'Compare these screenshots.' }, image, image] }, 'user'),
    ...(withCall ? [cleanMessage({ role: 'assistant', content: [
      { type: 'toolCall', id: 'read', name: 'read', arguments: { path: '/project/screenshot.png' } }
    ] }, 'call')] : []),
    cleanMessage({ role: 'toolResult', toolName: 'read', toolCallId: 'read', content: [{ type: 'text', text: 'Screenshot tool output' }, image] }, 'tool'),
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
  const toolImage = page.locator('#transcript > .thread-images img');
  await expect(toolImage).toBeVisible();
  await expect.poll(() => toolImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.tool-activity')).not.toHaveAttribute('open', '');
  await expect(page.locator('.tool-output')).toBeHidden();
  expect(requests).toBe(4);
  const urls = await previews.evaluateAll(images => images.map(img => img.src));
  const toolURL = await toolImage.getAttribute('src');
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state: { ...state, status: 'working' } }));
  await expect(page.locator('#abort')).toBeVisible();
  expect(await previews.evaluateAll(images => images.map(img => img.src))).toEqual(urls);
  expect(await toolImage.getAttribute('src')).toBe(toolURL);
  expect(requests).toBe(4);
  await page.locator('.message.user .thread-images a').first().click();
  const viewer = page.locator('#image-viewer');
  await expect(viewer.locator('img')).toBeVisible();
  expect(await viewer.locator('img').getAttribute('src')).toBe(urls[0]);
  expect(page.context().pages()).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await page.locator('.message.user .thread-images a').first().click();
  const streamed = [...state.messages, cleanMessage({ role: 'assistant', content: 'Streaming a new reply.' }, 'streamed')];
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 2, state: { ...state, status: 'working', messages: streamed } }));
  await expect(page.locator('#transcript')).toContainText('Streaming a new reply.');
  await expect(viewer).toBeVisible(); // New AI output must not dismiss the image.
  await viewer.getByRole('button', { name: 'Close image' }).click();
  await expect(viewer).toBeHidden();
  await page.locator('.message.user .thread-images a').first().click();
  await viewer.locator('.image-stage').evaluate(stage => {
    const box = stage.getBoundingClientRect();
    const pointer = (type, dy) => stage.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch',
      button: 0, clientX: box.x + box.width / 2, clientY: box.y + 100 + dy, bubbles: true }));
    pointer('pointerdown', 0); pointer('pointermove', 160); pointer('pointerup', 160);
  });
  await expect(viewer).toBeHidden(); // Pulling down closes an image that fits the width.
  await page.locator('.tool-activity > summary').click();
  await page.locator('.tool summary').click();
  await expect(page.locator('.tool-output')).toHaveText('Screenshot tool output');
  await expect(page.locator('.tool .thread-images')).toHaveCount(0);
  await expect(toolImage).toHaveCount(1);
  expect(await toolImage.getAttribute('src')).toBe(toolURL);
  expect(requests).toBe(4);
  await page.locator('.tool summary').click();
  await page.locator('.tool-activity > summary').click();
  await toolImage.locator('..').click();
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img')).toHaveAttribute('src', toolURL);
  await viewer.getByRole('button', { name: 'Close image' }).click();
  await page.screenshot({ path: info.outputPath('tool-image-mobile.png'), fullPage: true });
  await info.attach('tool-image-conversation', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('tool-image-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#transcript img')).toHaveCount(0);
  expect(await page.evaluate(async url => { try { await fetch(url); return true; } catch { return false; } }, urls[0])).toBe(false);
  expect(errors).toEqual([]);
});

test('attachment menu opens above an unchanged composer and preserves upload sources', async ({ page }, info) => {
  // Opening + is app-controlled; native pickers start only after choosing a source.
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.keyboardHeight = (height, offsetTop = 0) => {
      Object.assign(viewport, { height, offsetTop }); viewport.dispatchEvent(new Event('resize'));
    };
  });
  const states = ['Alpha', 'Beta', 'fresh'].map(id => ({ id, title: id === 'fresh' ? 'Untitled session' : 'Project ' + id,
    cwd: '/projects/Alpha', status: 'idle', model: 'test/first', modelName: 'GPT-6.1 Sol', thinkingLevel: 'max', fastMode: true, messages: [] }));
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    const reply = value => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: states.slice(0, 2) }));
    } else if (packet.op === 'projects') reply([{ cwd: states[0].cwd, sessionId: 'Alpha' }]);
    else if (packet.op === 'new') reply({ sessionId: 'fresh', state: states[2] });
    else {
      if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0,
        state: states.find(state => state.id === packet.sessionId) }));
      reply([]);
    }
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.evaluate(() => window.keyboardHeight(844));
  await page.getByRole('button', { name: 'New session', exact: true }).tap();
  await page.locator('.project-option').click();
  await expect(page.locator('#title')).toHaveText('Untitled session');
  const prompt = page.locator('#prompt'), input = page.getByLabel('Attach images and videos', { exact: true });
  await expect(input).toBeEnabled();
  await expect(prompt).toBeFocused();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const attach = page.getByRole('button', { name: 'Add attachments', exact: true }), menu = page.locator('#attachment-menu');
  const layout = () => page.locator('#composer, #prompt, #attach, #model, #reasoning-control, #send, #commands, #attachments')
    .evaluateAll(nodes => nodes.map(node => ({ id: node.id, ...node.getBoundingClientRect().toJSON() })));
  const pickers = [];
  page.on('filechooser', picker => pickers.push(picker));
  await page.evaluate(() => window.keyboardHeight(460, 280));
  await page.locator('#app').evaluate(app => { app.style.top = '0px'; }); // Safari's client rectangles already use the panned viewport's origin.
  const before = await layout();
  await attach.tap();
  await expect(menu).toBeVisible();
  await expect(attach).toHaveAttribute('aria-expanded', 'true');
  await expect(prompt).toBeFocused();
  expect(await layout()).toEqual(before);
  const panel = await menu.boundingBox(), composer = await page.locator('#composer').boundingBox();
  expect(panel.y + panel.height).toBeLessThanOrEqual(composer.y - 4);
  expect(panel.x).toBeGreaterThanOrEqual(composer.x);
  expect(panel.x + panel.width).toBeLessThanOrEqual(composer.x + composer.width);
  expect(panel.width).toBeGreaterThanOrEqual(composer.width - 4);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(pickers).toHaveLength(0);
  for (const option of await menu.locator('.attachment-option').all()) {
    const box = await option.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(panel.y);
    expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
  }
  await expect(page.locator('#camera-files')).toHaveAttribute('capture', 'environment');
  await expect(page.locator('#device-files')).toHaveAttribute('accept', 'application/octet-stream');
  await page.screenshot({ path: info.outputPath('attachment-menu-mobile.png') });
  await info.attach('attachment-menu', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(prompt).toBeFocused();
  expect(await layout()).toEqual(before);

  await input.setInputFiles(file);
  const draft = 'Keep this draft\n'.repeat(8).trimEnd();
  await prompt.fill(draft);
  const expanded = await layout();
  await attach.tap();
  await expect(menu).toBeVisible();
  expect(await layout()).toEqual(expanded);
  await expect(page.locator('#attachments img')).toBeVisible();
  await expect(prompt).toHaveValue(draft);
  const compactPanel = await menu.boundingBox();
  expect(compactPanel.y + compactPanel.height).toBeLessThanOrEqual((await page.locator('#composer').boundingBox()).y - 4);

  const media = page.waitForEvent('filechooser');
  await input.click();
  const mediaPicker = await media;
  expect(mediaPicker.isMultiple()).toBe(true);
  await page.evaluate(() => window.keyboardHeight(844));
  expect(await menu.boundingBox()).toEqual(compactPanel); // The source row stays put while iOS dismisses the keyboard.
  await mediaPicker.setFiles(file);
  await expect(menu).toBeHidden();
  await expect(page.locator('#attachments img')).toHaveCount(2);
  await expect(prompt).toHaveValue(draft);

  await attach.tap();
  const camera = page.waitForEvent('filechooser');
  await page.getByLabel('Take photo or video', { exact: true }).click();
  const cameraPicker = await camera;
  expect(cameraPicker.isMultiple()).toBe(false);
  await cameraPicker.setFiles(file);
  await expect(menu).toBeHidden();
  await expect(page.locator('#attachments img')).toHaveCount(3);

  await attach.tap();
  const files = page.waitForEvent('filechooser');
  await page.getByLabel('Choose image or video files', { exact: true }).click();
  await (await files).setFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not an image') });
  await expect(menu).toBeHidden();
  await expect(page.locator('#notice')).toContainText('Attach up to 4 images, 2 MB total');
  await expect(page.locator('#attachments img')).toHaveCount(3);
  await expect(prompt).toHaveValue(draft);

  await attach.tap();
  const cancel = page.waitForEvent('filechooser');
  const deviceFiles = page.getByLabel('Choose image or video files', { exact: true });
  await deviceFiles.click(); await cancel;
  await deviceFiles.dispatchEvent('cancel');
  await expect(menu).toBeHidden();
  await expect(prompt).toHaveValue(draft);
  await attach.tap();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(menu).toBeHidden();
  await expect(attach).toHaveAttribute('aria-expanded', 'false');
  await expect(prompt).toHaveValue('');
  expect(pickers).toHaveLength(4);
});

test('desktop attachment button opens the device chooser directly', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  const page = await context.newPage();
  try {
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await page.locator('#prompt').fill('Keep the desktop draft');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(true);
    await expect(page.locator('#attachment-menu')).toBeHidden();
    await picker.setFiles(file);
    await expect(page.locator('#attachments img')).toBeVisible();
    await expect(page.locator('#prompt')).toHaveValue('Keep the desktop draft');
  } finally { await context.close(); }
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
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByLabel('Attach images and videos', { exact: true }).click();
  await (await picker).setFiles(file);
  await expect(page.getByRole('img', { name: file.name })).toBeVisible();
  await expect.poll(() => page.locator('#attachments img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const checkRemoveOverlay = async () => {
    const preview = await page.locator('#attachments img').first().boundingBox();
    const remove = page.getByRole('button', { name: `Remove ${file.name}` });
    await expect(remove.locator('svg')).toBeVisible();
    await expect(remove).toHaveText('');
    const target = await remove.boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.y).toBe(preview.y);
    expect(target.x + target.width).toBe(preview.x + preview.width);
    expect(target.y + target.height).toBeLessThanOrEqual(preview.y + preview.height);
  };
  await checkRemoveOverlay();
  await page.getByRole('link', { name: `Open ${file.name}` }).tap();
  await expect(page.locator('#image-viewer img')).toBeVisible();
  await page.getByRole('button', { name: 'Close image' }).tap();
  await expect(page.locator('#image-viewer')).toBeHidden();
  await page.getByRole('button', { name: `Remove ${file.name}` }).tap();
  await expect(page.getByRole('button', { name: 'Add attachments', exact: true })).toBeFocused();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.locator('#image-files').setInputFiles(file);
  await page.locator('#prompt').fill('What is in this image?');
  client.send(JSON.stringify({ type: 'ready' }));
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('Restart Pi Remote');
  expect(commands).toHaveLength(0);
  client.send(JSON.stringify({ type: 'ready', supportsImages: true }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(page.locator('#attachments img')).toHaveCount(1);
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(1);
  await expect(page.getByLabel('Attach images and videos', { exact: true })).toBeDisabled();
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
  await checkRemoveOverlay();
  await page.getByRole('button', { name: `Remove ${file.name}` }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#attachments img')).toHaveCount(1);
  await expect(page.getByRole('img', { name: 'second.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#attachments img')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('attached images upload before send and send by ID', async ({ page }) => {
  const state = { id: 'staged', title: 'Staged upload', cwd: '/project', status: 'idle', messages: [] };
  const commands = [];
  let uploaded;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true, supportsUploads: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state }));
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
    } else if (packet.op === 'upload') {
      expect(packet.image).toEqual({ type: 'image', mimeType: 'image/png', data: png.toString('base64') });
      uploaded = () => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: { uploadId: 'up-1' } }));
    } else if (packet.op === 'command') {
      commands.push(packet.command);
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: { ok: true } }));
    } else ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Staged upload/ }).click();
  await page.locator('#image-files').setInputFiles(file);
  await expect(page.getByLabel('Uploading')).toBeVisible();
  await expect.poll(() => !!uploaded).toBe(true);
  uploaded();
  await expect(page.getByLabel('Uploading')).toHaveCount(0);
  await page.locator('#prompt').fill('Look');
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].images).toEqual([{ type: 'image', uploadId: 'up-1' }]);
});
