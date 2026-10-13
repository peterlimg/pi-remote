import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { videoMessage } from '../../web/videos.js';

const original = readFileSync(new URL('../fixtures/video.webm', import.meta.url));
const file = { name: 'screen recording.webm', mimeType: 'video/webm', buffer: original };
const token = 'browser-test-token-only-123456789012345';

test('video picker previews, removes and sends original bytes through the real host', async ({ page }, info) => {
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
  await input.click(); await (await picker).setFiles(file);
  const video = page.locator('#attachments video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(node => node.videoWidth)).toBe(160);
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
  expect(readFileSync(removedPath)).toEqual(original);
  await page.getByRole('button', { name: 'Remove ' + file.name }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await expect.poll(() => { try { readFileSync(removedPath); return false; } catch { return true; } }).toBe(true);
  await input.setInputFiles(file);
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
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await expect.poll(() => packets.filter(packet => packet.op === 'command').length).toBe(1);
  const command = packets.find(packet => packet.op === 'command');
  expect(command.command.images).toBeUndefined();
  expect(command.command.videos).toHaveLength(1);
  await expect.poll(() => responses.find(packet => packet.id === command.id)?.value.ok).toBe(true);
  const path = finishedPath();
  await expect(page.locator('#transcript')).not.toContainText(path);
  await expect(page.locator('.message.user .thread-video video')).toHaveCount(1);
  await expect(page.locator('#transcript')).not.toContainText('Sent. Waiting for Pi');
  expect(readFileSync(path)).toEqual(original);
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#transcript')).not.toContainText(path);
  await expect(page.locator('#transcript')).not.toContainText('Attached video files');
  const play = page.getByRole('button', { name: 'Play screen_recording.webm', exact: true });
  await expect(play).toBeVisible();
  await expect(play.locator('img')).toBeVisible();
  await expect.poll(() => play.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await play.click();
  const player = page.locator('.thread-video video');
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(video => video.videoWidth)).toBe(160);
  const videoURL = await player.getAttribute('src');
  await page.locator('#prompt').fill('Keep the preview during conversation updates');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Keep the preview during conversation updates');
  await expect(player).toHaveAttribute('src', videoURL);
  expect(videoURL).toMatch(/^blob:/);
  const reads = packets.filter(packet => packet.op === 'videoRead' && packet.offset !== undefined);
  const downloaded = reads.map(request => Buffer.from(responses.find(response => response.id === request.id && response.ok).value.data, 'base64'));
  expect(Buffer.concat(downloaded)).toEqual(original);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  expect(await page.evaluate(url => new Promise(resolve => {
    const video = document.createElement('video');
    video.onloadedmetadata = () => resolve(true); video.onerror = () => resolve(false); video.src = url;
  }), videoURL)).toBe(false);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.getByRole('button', { name: 'Play screen_recording.webm', exact: true })).toBeVisible();
  expect(readFileSync(path)).toEqual(original); // Socket cleanup must not delete a sent file.
  await page.screenshot({ path: info.outputPath('video-sent.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(play).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('video-sent-desktop.png'), fullPage: true });
  await info.attach('conversation', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  expect(errors).toEqual([]);
});

test('unsupported previews still upload originals, and removal cancels an in-flight upload', async ({ page }) => {
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
  await expect(page.locator('.video-preview-unavailable')).toHaveText('Preview unavailable');
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
