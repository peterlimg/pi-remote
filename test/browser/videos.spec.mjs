import { test, expect } from '@playwright/test';
import { readFileSync, statSync, utimesSync, rmSync } from 'node:fs';
import { videoMessage } from '../../web/videos.js';

const original = readFileSync(new URL('../fixtures/video.webm', import.meta.url));
const file = { name: 'screen recording.webm', mimeType: 'video/webm', buffer: original };
const token = 'browser-test-token-only-123456789012345';

for (const [orientation, buffer, width] of [
  ['landscape', original, 160],
  ['portrait', readFileSync(new URL('../fixtures/video-portrait.webm', import.meta.url)), 90]
]) test(`video picker ${orientation} previews, removes and sends original bytes through the real host`, async ({ page }, info) => {
  const upload = { ...file, name: `${orientation} recording.webm`, buffer };
  const packets = [], responses = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => {
    ws.on('framesent', ({ payload }) => packets.push(JSON.parse(String(payload))));
    ws.on('framereceived', ({ payload }) => responses.push(JSON.parse(String(payload))));
  });
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const input = page.getByLabel('Attach images and videos', { exact: true });
  await expect(input).toHaveAttribute('accept', /video\/\*/);
  await expect(page.locator('#attach')).toHaveAttribute('title', /200 MB each/);
  const picker = page.waitForEvent('filechooser');
  await input.click(); await (await picker).setFiles(upload);
  const video = page.locator('#attachments video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveCSS('width', '80px');
  await expect(video).toHaveCSS('height', '80px');
  await expect(video).toHaveAttribute('poster', /^blob:/);
  await expect(page.locator('.video-attachment')).not.toHaveClass(/uploading/);
  await expect(page.locator('.video-attachment')).toHaveText('');
  const finishedPath = () => {
    const finish = packets.findLast(packet => packet.op === 'videoFinish');
    return responses.find(packet => packet.id === finish?.id && packet.ok)?.value.path;
  };
  await expect.poll(finishedPath).toBeTruthy();
  const removedPath = finishedPath();
  expect(readFileSync(removedPath)).toEqual(buffer);
  await page.getByRole('button', { name: 'Remove ' + upload.name }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await expect.poll(() => { try { readFileSync(removedPath); return false; } catch { return true; } }).toBe(true);
  await input.setInputFiles(upload);
  await expect(page.locator('.video-attachment')).not.toHaveClass(/uploading/);
  await expect(page.locator('.video-attachment')).toHaveText('');
  await page.locator('#prompt').fill('Inspect the original recording');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(video).toBeVisible();
  await expect(page.locator('#prompt')).toHaveValue('Inspect the original recording');
  await page.screenshot({ path: info.outputPath('video-draft.png'), fullPage: true });
  const draftPoster = await video.getAttribute('poster');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await expect.poll(() => packets.filter(packet => packet.op === 'command').length).toBe(1);
  const command = packets.find(packet => packet.op === 'command');
  expect(command.command.images).toBeUndefined();
  expect(command.command.videos).toHaveLength(1);
  await expect.poll(() => responses.find(packet => packet.id === command.id)?.value.ok).toBe(true);
  const path = finishedPath();
  await expect(page.locator('#transcript')).not.toContainText(path);
  const sentVideo = page.locator('.message.user .thread-video video');
  await expect(sentVideo).toHaveCount(1);
  await expect(sentVideo).toHaveAttribute('poster', /^blob:/);
  await expect(sentVideo).not.toHaveAttribute('poster', draftPoster);
  const sentSize = await sentVideo.boundingBox();
  expect(sentSize.width).toBeLessThanOrEqual(160);
  expect(sentSize.height).toBeLessThanOrEqual(160);
  await expect(page.locator('#transcript')).not.toContainText('Sent. Waiting for Pi');
  expect(readFileSync(path)).toEqual(buffer);
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#transcript')).not.toContainText(path);
  await expect(page.locator('#transcript')).not.toContainText('Attached video files');
  const play = page.getByRole('button', { name: `Play ${orientation}_recording.webm`, exact: true });
  await expect(play).toBeVisible();
  await expect(play.locator('img')).toBeVisible();
  await expect.poll(() => play.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  const previewSize = await play.boundingBox();
  expect(previewSize.width).toBeLessThanOrEqual(160);
  expect(previewSize.height).toBeLessThanOrEqual(160);
  await play.click();
  const player = page.locator('.thread-video video');
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(width);
  const playerSize = await player.boundingBox();
  expect(playerSize.width).toBeLessThanOrEqual(160);
  expect(playerSize.height).toBeLessThanOrEqual(160);
  await page.screenshot({ path: info.outputPath('video-playing-mobile.png'), fullPage: true });
  const videoURL = await player.getAttribute('src');
  await page.locator('#prompt').fill('Keep the preview during conversation updates');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Keep the preview during conversation updates');
  await expect(player).toHaveAttribute('src', videoURL);
  expect(videoURL).toMatch(/^blob:/);
  const reads = packets.filter(packet => packet.op === 'videoRead' && packet.offset !== undefined);
  const downloaded = reads.map(request => Buffer.from(responses.find(response => response.id === request.id && response.ok).value.data, 'base64'));
  expect(Buffer.concat(downloaded)).toEqual(buffer);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  expect(await page.evaluate(url => new Promise(resolve => {
    const video = document.createElement('video');
    video.onloadedmetadata = () => resolve(true); video.onerror = () => resolve(false); video.src = url;
  }), videoURL)).toBe(false);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(play).toBeVisible();
  expect(readFileSync(path)).toEqual(buffer); // Socket cleanup must not delete a sent file.
  await page.screenshot({ path: info.outputPath('video-sent.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(play).toBeVisible();
  const desktopSize = await play.boundingBox();
  expect(desktopSize.width).toBeLessThanOrEqual(160);
  expect(desktopSize.height).toBeLessThanOrEqual(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('video-sent-desktop.png'), fullPage: true });
  await info.attach('conversation', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  expect(errors).toEqual([]);
});

test('agent-generated videos play, cache and download through the real host', async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }));
  const errors = [], packets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => packets.push(JSON.parse(String(payload)))));
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Send the edited video');
  await page.getByRole('button', { name: 'Send message' }).click();
  const message = page.locator('.message.assistant').filter({ hasText: 'Here is your edited video.' }).last();
  await expect(message).not.toContainText('Generated video files');
  await expect(message).not.toContainText('/videos/');
  const play = message.getByRole('button', { name: 'Play edited.webm', exact: true });
  await play.scrollIntoViewIfNeeded();
  await expect(play.locator('img')).toBeVisible();
  const previewSize = await play.boundingBox();
  expect(previewSize.width).toBeLessThanOrEqual(160);
  expect(previewSize.height).toBeLessThanOrEqual(160);
  await play.click();
  const player = message.locator('video');
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(160);
  const playerSize = await player.boundingBox();
  expect(playerSize.width).toBeLessThanOrEqual(160);
  expect(playerSize.height).toBeLessThanOrEqual(160);
  const link = message.getByRole('link', { name: 'Download edited.webm', exact: true });
  await expect(link).toHaveAttribute('href', /^blob:/);
  await expect(link).toHaveAttribute('download', 'edited.webm');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const downloadEvent = page.waitForEvent('download');
  await link.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('edited.webm');
  expect(readFileSync(await download.path())).toEqual(original);
  expect(await link.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('generated-video-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('generated-video-desktop.png'), fullPage: true });
  await player.dispatchEvent('error');
  await expect(message).toContainText('This browser cannot play this video.');
  await expect(link).toBeVisible();
  const byteReads = () => packets.filter(packet => packet.op === 'videoRead' && packet.offset !== undefined).length;
  const downloadedReads = byteReads();
  expect(downloadedReads).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(play).toBeVisible();
  await play.click();
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(160);
  expect(byteReads()).toBe(downloadedReads);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await play.click();
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(160);
  expect(byteReads()).toBe(downloadedReads);
  const cachedDownload = page.waitForEvent('download');
  await link.click();
  expect(readFileSync(await (await cachedDownload).path())).toEqual(original);
  const path = packets.find(packet => packet.op === 'videoRead' && packet.offset !== undefined).path, before = statSync(path);
  utimesSync(path, before.atime, new Date(before.mtimeMs + 1000));
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await play.click();
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(160);
  expect(byteReads()).toBe(downloadedReads * 2); // Same-sized files still need revision validation.
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('pi-remote-videos-')))).toEqual([]);
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await play.click();
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(160);
  expect(byteReads()).toBe(downloadedReads * 3);
  rmSync(path);
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(message.getByRole('button', { name: 'Video unavailable. Retry', exact: true })).toBeVisible();
  await expect(player).toHaveCount(0);
  expect(byteReads()).toBe(downloadedReads * 3);
  expect(errors).toEqual([]);
});

for (const failure of ['unavailable', 'full']) test(`video playback survives ${failure} browser storage`, async ({ page }) => {
  await page.addInitScript(failure => {
    if (failure === 'unavailable') Object.defineProperty(window, 'caches', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    else Cache.prototype.put = async () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  }, failure);
  const errors = [], packets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => packets.push(JSON.parse(String(payload)))));
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Send the edited video');
  await page.getByRole('button', { name: 'Send message' }).click();
  const message = page.locator('.message.assistant').filter({ hasText: 'Here is your edited video.' }).last();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      await page.reload();
      await page.getByRole('button', { name: /Project Alpha/ }).click();
    }
    await message.getByRole('button', { name: 'Play edited.webm', exact: true }).click();
    await expect.poll(() => message.locator('video').evaluate(video => video.videoWidth)).toBe(160);
    await expect(page.locator('#notice')).toBeHidden();
  }
  expect(packets.filter(packet => packet.op === 'videoRead' && packet.offset !== undefined)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('native video saving keeps the conversation and restores its viewport', async ({ page }) => {
  await page.addInitScript(({ width, height }) => {
    const viewport = new EventTarget();
    const normal = { width, height, offsetLeft: 0, offsetTop: 0, scale: 1 };
    Object.assign(viewport, normal);
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.savedFiles = []; window.saveOutcome = 'saved';
    Object.defineProperty(navigator, 'canShare', { value: data => data.files?.[0] instanceof File });
    Object.defineProperty(navigator, 'share', { value: async ({ files: [file] }) => {
      window.savedFiles.push({ name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
      // A native sheet can restore the visible viewport without another resize event.
      Object.assign(viewport, { width: width / 2, height: height / 2, offsetLeft: 25, offsetTop: 90, scale: 2 });
      viewport.dispatchEvent(new Event('resize'));
      Object.assign(viewport, normal);
      if (window.saveOutcome !== 'saved') throw new DOMException('Save failed', window.saveOutcome);
    } });
  }, page.viewportSize());
  const path = '/host/videos/12345678-1234-1234-1234-123456789abc/edited.webm';
  const state = { id: 'save-video', title: 'Save video', cwd: '/project', status: 'idle', messages: [
    { id: 'edit', role: 'assistant', text: videoMessage('Here is your edited video.', [path], 'assistant') }
  ] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    const reply = value => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state })); reply({});
    } else if (packet.op === 'videoRead') reply(packet.offset === undefined
      ? { size: original.length, mimeType: 'video/webm' }
      : { size: original.length, data: original.subarray(packet.offset, packet.offset + 256 * 1024).toString('base64') });
    else reply([]);
  }));
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Save video/ }).click();
  const message = page.locator('.message.assistant');
  await message.getByRole('button', { name: 'Play edited.webm', exact: true }).click();
  const link = message.getByRole('link', { name: 'Download edited.webm', exact: true });
  const url = page.url();
  let downloads = 0; page.on('download', () => downloads++);
  for (const [index, outcome] of ['saved', 'AbortError', 'NotAllowedError'].entries()) {
    await page.evaluate(value => { window.saveOutcome = value; }, outcome);
    await link.click();
    await expect.poll(() => page.evaluate(() => window.savedFiles.length)).toBe(index + 1);
    await expect.poll(() => page.locator('#app').boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() });
    expect(page.url()).toBe(url);
    expect(downloads).toBe(0);
    if (outcome === 'NotAllowedError') await expect(page.locator('#notice')).toContainText('Could not save video');
    else await expect(page.locator('#notice')).toBeHidden();
  }
  const saved = await page.evaluate(() => window.savedFiles[0]);
  expect(saved.name).toBe('edited.webm'); expect(saved.type).toBe('video/webm');
  expect(Buffer.from(saved.bytes)).toEqual(original);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(page.locator('#sidebar')).toBeVisible();
});

test('video uploads stay cancellable before the thumbnail is ready', async ({ page }) => {
  const state = { id: 'cancel', title: 'Video cancellation', cwd: '/project', status: 'idle', messages: [] };
  const packets = [];
  let client, chunkReply;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const packet = JSON.parse(raw); packets.push(packet);
    const reply = (value = []) => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state })); reply();
    } else if (packet.op === 'videoStart') reply({ uploadId: 'cancel-video' });
    else if (packet.op === 'videoChunk') chunkReply = reply;
    else reply();
  }));
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Video cancellation/ }).click();
  const unsupported = { name: 'recording.mov', mimeType: 'video/quicktime', buffer: Buffer.from('unsupported codec') };
  await page.locator('#image-files').setInputFiles(unsupported);
  await expect(page.locator('#notice')).toContainText('Restart Pi Remote');
  await expect(page.locator('#attachments')).toBeHidden();
  client.send(JSON.stringify({ type: 'ready', supportsVideos: true }));
  await page.locator('#image-files').setInputFiles(unsupported);
  // Unsupported bytes may replace the video with a fallback before the upload completes.
  await expect(page.locator('#attachments .video-attachment')).toBeVisible();
  await expect.poll(() => !!chunkReply).toBe(true);
  const progress = page.getByRole('progressbar', { name: 'Uploading recording.mov' });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS('width', '56px');
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(progress.locator('.video-upload-arc')).toHaveAttribute('stroke-dashoffset', '100');
  await expect(progress).toHaveText('');
  await expect(page.locator('.video-attachment [role=status]')).toBeHidden();
  await page.getByRole('button', { name: 'Remove recording.mov' }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await expect.poll(() => packets.some(packet => packet.op === 'videoDiscard')).toBe(true);
  chunkReply();
  await expect.poll(() => packets.filter(packet => packet.op === 'videoDiscard').length).toBe(2);
  expect(packets.some(packet => ['command', 'videoFinish'].includes(packet.op))).toBe(false);
});

test('video upload retries after disconnect, preserves rejected drafts and mixes with images', async ({ page }) => {
  const state = { id: 'videos', title: 'Video retry', cwd: '/project', status: 'idle', messages: [] };
  const commands = [], chunks = [];
  let starts = 0, interrupted = false;
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    const reply = (value = [], ok = true) => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok, value, error: ok ? undefined : 'Try again' }));
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsVideos: true, supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state })); reply();
    } else if (packet.op === 'videoStart') {
      starts++; reply({ uploadId: 'video-' + starts });
    } else if (packet.op === 'videoChunk') {
      if (!interrupted) { interrupted = true; ws.close({ code: 1012, reason: 'Interrupted upload' }); }
      else { chunks.push(Buffer.from(packet.data, 'base64')); reply(); }
    } else if (packet.op === 'videoFinish') reply({ path: '/host/screen_recording.mp4' });
    else if (packet.op === 'command') {
      commands.push(packet.command);
      if (commands.length === 1) reply(undefined, false);
      else {
        state.messages.push({ id: 'sent', role: 'user', text: videoMessage(packet.command.text, ['/host/screen_recording.mp4']),
          images: [{ id: 'a'.repeat(64), mimeType: 'image/png' }] });
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state })); reply();
      }
    } else reply();
  }));
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Video retry/ }).click();
  await page.locator('#image-files').setInputFiles(file);
  await expect(page.locator('#attachments [role=status]')).toContainText('Upload failed');
  await expect(page.locator('#send')).toBeEnabled();
  await page.locator('#image-files').setInputFiles({ name: 'image.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
  await page.locator('#prompt').fill('/review');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('not a slash command');
  expect(commands).toHaveLength(0);
  await page.locator('#prompt').fill('Compare');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toHaveText('Try again');
  await expect(page.locator('#prompt')).toHaveValue('Compare');
  await expect(page.locator('#attachments video')).toBeVisible();
  await expect(page.locator('#attachments img')).toHaveCount(1);
  expect(Buffer.concat(chunks)).toEqual(original);
  expect(starts).toBe(2);
  expect(commands[0].videos).toEqual(['video-2']);
  expect(commands[0].images).toHaveLength(1);
  await page.locator('#send').click();
  await expect(page.locator('#attachments')).toBeHidden();
  await expect(page.locator('.message.user').filter({ hasText: '/host/screen_recording.mp4' })).toHaveCount(1);
  await expect(page.locator('#transcript')).not.toContainText('Sent. Waiting for Pi');
  expect(starts).toBe(2); // A rejected command can reuse its complete upload.
});
