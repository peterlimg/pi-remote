import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { initialState, applyEvent } from '../../src/state.mjs';
import { socket, until } from '../helpers.mjs';
import { e2eKey } from '../../src/e2e.mjs';
import { videoMessage } from '../../web/videos.js';

test('all saved messages remain reachable with bounded scrollback while Pi keeps working', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-history-'));
  const config = loadConfig(dir), file = join(dir, 'history.jsonl');
  let host, agent, lock, releaseHistory, parentId = null;
  const append = (id, fields) => {
    appendFileSync(file, JSON.stringify({ id, parentId, timestamp: new Date().toISOString(), ...fields }) + '\n');
    parentId = id;
  };
  try {
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: dir }) + '\n');
    append('name', { type: 'session_info', name: 'Full history' });
    for (let i = 0; i < 650; i++) {
      // Equal and out-of-order timestamps must not be used as pagination boundaries.
      append('m' + i, { type: 'message', message: { role: i % 2 ? 'assistant' : 'user',
        content: `Message ${i}\n\n${'A line in the conversation. '.repeat(8)}`, timestamp: 1000 + Math.floor(i / 4) % 13 } });
      if (i === 200) {
        append('compact', { type: 'compaction', firstKeptEntryId: 'm190', summary: 'Earlier work' });
        const current = parentId;
        append('abandoned', { type: 'message', message: { role: 'assistant', content: 'Abandoned branch', timestamp: 1 } });
        parentId = current;
      }
    }
    host = await startHost({ dir, config, port: 0, roots: [dir], publicUrl: 'http://127.0.0.1:8787', relayUrl: '' });
    const port = host.http.address().port, id = sessionKey(file), instanceId = randomUUID();
    const state = initialState({ ...readSession(file), instanceId }, readSession(file).messages);
    state.status = 'working';
    lock = acquireLock(join(dir, 'locks'), id, { file, instanceId });
    agent = await socket(`ws://127.0.0.1:${port}/bridge`, config.bridgeToken);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.type === 'command') agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true,
        value: packet.command.type === 'getCommands' ? { commands: [] } : { accepted: true } }));
    });
    await until(() => host.service.live.has(id));
    const frames = [];
    page.on('websocket', ws => ws.on('framereceived', event => {
      const packet = JSON.parse(event.payload.toString());
      if (packet.type === 'snapshot' || packet.type === 'patch' || packet.type === 'response' && packet.value?.messages) frames.push(packet);
    }));
    await page.goto(`http://127.0.0.1:${port}/#token=${config.clientToken}`);
    await page.getByRole('button', { name: /Full history/ }).click();
    const transcript = page.locator('#transcript'), messages = transcript.locator('article.message');
    await expect(messages.first()).toContainText('Message 550');
    await expect(transcript.getByRole('button', { name: /Load (older|newer) messages|Return to latest messages/ })).toHaveCount(0);
    await expect(transcript.getByRole('status')).toMatchAriaSnapshot('- status: Working…');
    const firstNumber = () => messages.first().innerText().then(text => Number(text.match(/Message (\d+)/)[1]));
    const history = host.service.history.bind(host.service);
    host.service.history = async (...args) => {
      host.service.history = history;
      await new Promise(resolve => { releaseHistory = resolve; });
      return history(...args);
    };
    await transcript.evaluate(node => {
      node.scrollTop = 0;
      window.pageAnchorTop = node.querySelector('[data-message-id="m550"]').getBoundingClientRect().top;
    });
    await expect.poll(() => typeof releaseHistory).toBe('function');
    await expect(transcript.getByText(/^Loading(?: messages)?…$/)).toHaveCount(1);
    const loading = transcript.getByRole('status').filter({ hasText: /^Loading…$/ });
    await expect(loading).toHaveText('Loading…');
    await expect(loading).toBeVisible();
    await expect(transcript).toHaveAttribute('aria-busy', 'true');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: testInfo.outputPath(`history-loading-${width}.png`) });
      writeFileSync(testInfo.outputPath(`history-loading-${width}.aria.txt`), await transcript.ariaSnapshot());
    }
    await page.setViewportSize({ width: 390, height: 844 });
    releaseHistory();
    await expect.poll(firstNumber).toBeLessThan(550);
    await expect(transcript.getByRole('status')).toHaveCount(0);
    expect(await page.locator('[data-message-id="m550"]').evaluate(node => Math.abs(node.getBoundingClientRect().top - window.pageAnchorTop))).toBeLessThan(2);
    expect(await messages.count()).toBeLessThanOrEqual(200);
    await transcript.evaluate(node => { node.scrollTop = 0; });
    await expect.poll(firstNumber).toBeLessThan(450);
    expect(await messages.count()).toBeLessThanOrEqual(200);
    // A live patch must neither rebuild nor move the historical transcript.
    await messages.first().evaluate(node => { window.historyAnchor = node; });
    const beforeScroll = await transcript.evaluate(node => node.scrollTop);
    const message = { role: 'assistant', content: 'A new live reply', timestamp: Date.now() };
    append('live-reply', { type: 'message', message });
    applyEvent(state, { type: 'message_end', message }); state.status = 'working'; state.revision++;
    agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    await expect.poll(() => frames.filter(frame => frame.type === 'patch').length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.historyAnchor.isConnected)).toBe(true);
    expect(await transcript.evaluate(node => node.scrollTop)).toBe(beforeScroll);
    expect(state.messages).toHaveLength(100);
    while (await firstNumber() > 0) {
      const first = await firstNumber();
      await transcript.evaluate(node => { node.scrollTop = 0; });
      await expect.poll(firstNumber).toBeLessThan(first);
      expect(await messages.count()).toBeLessThanOrEqual(200);
    }
    await expect(messages.first()).toContainText('Message 0');
    await transcript.evaluate(node => { node.scrollTop = 0; });
    await expect(messages.first()).toBeInViewport();
    await expect(transcript).not.toContainText('Abandoned branch');
    await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toHaveCount(0);
    const ids = await messages.evaluateAll(nodes => nodes.map(node => node.dataset.messageId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => 'm' + i));
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await transcript.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`history-${width}.png`) });
    }
    // Scroll forwards through evicted pages, then jump back to the live tail.
    await transcript.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(firstNumber).toBeGreaterThan(0);
    expect(await messages.count()).toBeLessThanOrEqual(200);
    await page.getByRole('button', { name: 'Go to thread bottom' }).click();
    await expect(messages.last()).toContainText('A new live reply');
    await expect(transcript.locator(':scope > #agent-activity:last-child')).toBeInViewport();
    expect(await messages.count()).toBeLessThanOrEqual(100);
    const patches = frames.filter(frame => frame.type === 'patch');
    expect(patches.every(frame => frame.patch.order.length <= 100)).toBe(true);
    expect(frames.filter(frame => frame.value?.messages).every(frame => frame.value.messages.length <= 100)).toBe(true);
    writeFileSync(testInfo.outputPath('history-bounds.json'), JSON.stringify({
      totalMessages: 651, maxPageMessages: Math.max(...frames.filter(frame => frame.value?.messages).map(frame => frame.value.messages.length)),
      maxLiveMessages: Math.max(...frames.filter(frame => frame.type === 'snapshot').map(frame => frame.state.messages.length)),
      maxPatchBytes: Math.max(...patches.map(frame => Buffer.byteLength(JSON.stringify(frame))))
    }, null, 2));
  } finally {
    releaseHistory?.();
    agent?.ws.terminate(); lock?.release(); await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('wheel, keyboard and touch can page collapsed history without idle controls', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-collapsed-history-'));
  const config = loadConfig(dir), file = join(dir, 'tools.jsonl');
  let host;
  try {
    const entries = [{ type: 'session', version: 3, id: randomUUID(), cwd: dir },
      { id: 'name', type: 'session_info', parentId: null, name: 'Collapsed history' }];
    for (let i = 0; i < 310; i++) entries.push({ id: 'm' + i, parentId: i ? 'm' + (i - 1) : 'name', type: 'message',
      message: { role: 'toolResult', toolCallId: 't' + i, toolName: 'read', content: 'Output ' + i, timestamp: 1000 + i } });
    writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    host = await startHost({ dir, config, port: 0, roots: [dir], publicUrl: 'http://127.0.0.1:8787', relayUrl: '' });
    const history = host.service.history.bind(host.service);
    let attempts = 0;
    host.service.history = (...args) => {
      if (++attempts === 1) throw new Error('Temporary history read failure');
      return history(...args);
    };
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.getByRole('button', { name: /Collapsed history/ }).click();
    const transcript = page.locator('#transcript'), tools = transcript.locator('details.tool');
    await expect(tools.first()).toHaveAttribute('data-tool-id', 't210');
    expect(await transcript.evaluate(node => node.scrollHeight === node.clientHeight)).toBe(true);
    await transcript.hover(); await page.mouse.wheel(0, -100);
    await expect(transcript.getByRole('alert')).toContainText('Temporary history read failure');
    expect(attempts).toBe(1);
    await page.mouse.wheel(0, -100);
    await expect(tools.first()).toHaveAttribute('data-tool-id', 't110');
    await expect(transcript.getByRole('alert')).toHaveCount(0);
    await transcript.focus(); await page.keyboard.press('PageUp');
    await expect(tools.first()).toHaveAttribute('data-tool-id', 't10');
    const cdp = await page.context().newCDPSession(page), box = await transcript.boundingBox();
    const x = box.x + box.width / 2, y = box.y + 100;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 50 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(tools.first()).toHaveAttribute('data-tool-id', 't0');
    await transcript.hover(); await page.mouse.wheel(0, 100);
    await expect(tools.first()).toHaveAttribute('data-tool-id', 't100');
    expect(await tools.count()).toBeLessThanOrEqual(200);
    await expect(transcript.getByRole('button', { name: /Load (older|newer) messages|Return to latest messages/ })).toHaveCount(0);
    await expect(transcript.getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Go to thread bottom' }).click();
    await expect(tools.first()).toHaveAttribute('data-tool-id', 't210');
    expect(await tools.count()).toBe(100);
  } finally {
    await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('older attachments keep session boundaries over encryption and pages are byte-bounded', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-history-media-'));
  const config = loadConfig(dir), file = join(dir, 'media.jsonl');
  let host, client;
  try {
    const videoDir = join(dir, 'videos', randomUUID()); mkdirSync(videoDir, { recursive: true });
    const videoPath = join(videoDir, 'old.webm'); copyFileSync(new URL('../fixtures/video.webm', import.meta.url), videoPath);
    const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=' };
    const entries = [{ type: 'session', version: 3, id: randomUUID(), cwd: dir },
      { id: 'name', parentId: null, type: 'session_info', name: 'Older attachments' }];
    for (let i = 0; i < 160; i++) entries.push({ id: 'm' + i, parentId: i ? 'm' + (i - 1) : 'name', type: 'message',
      message: { role: i === 1 ? 'assistant' : 'user', timestamp: i,
        content: i === 0 ? [{ type: 'text', text: 'Historic image' }, image] : i === 1 ? videoMessage('Historic video', [videoPath], 'assistant')
          : `Message ${i}\n${i < 35 ? 'x'.repeat(23000) : ''}` } });
    writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    host = await startHost({ dir, config, port: 0, roots: [dir], publicUrl: 'http://127.0.0.1:8787', relayUrl: '' });
    const origin = `http://127.0.0.1:${host.http.address().port}`, id = sessionKey(file), key = e2eKey(config);
    client = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin, key);
    expect((await client.request('watch', { sessionId: id })).ok).toBe(true);
    const pageResult = await client.request('history', { sessionId: id, before: 'm60' });
    expect(pageResult.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(pageResult.value.messages))).toBeLessThanOrEqual(512 * 1024);
    expect(pageResult.value.messages.length).toBeLessThan(60);
    expect((await client.request('history', { sessionId: id, before: 'abandoned' })).ok).toBe(false);
    expect((await client.request('history', { sessionId: id, before: 5 })).ok).toBe(false);
    expect((await client.request('history', { sessionId: 'unknown', before: 'm60' })).ok).toBe(false);
    expect((await client.request('videoRead', { sessionId: id, path: videoPath, messageId: 'm2', offset: 0 })).ok).toBe(false);
    expect((await client.request('videoRead', { sessionId: id, path: videoPath, messageId: 'm1', offset: 0 })).ok).toBe(true);
    await page.goto(origin + '/#token=' + config.clientToken + '&key=' + key);
    await page.getByRole('button', { name: /Older attachments/ }).click();
    const transcript = page.locator('#transcript');
    await expect(page.locator('article.message').first()).toContainText('Message 60');
    for (let i = 0; i < 4 && !await page.getByText('Historic image', { exact: true }).count(); i++) {
      const previous = await page.locator('article.message').first().getAttribute('data-message-id');
      await transcript.evaluate(node => { node.scrollTop = 0; });
      await expect(page.locator('article.message').first()).not.toHaveAttribute('data-message-id', previous);
    }
    await transcript.evaluate(node => { node.scrollTop = 0; });
    await expect(page.getByText('Historic image', { exact: true })).toBeInViewport();
    const preview = page.locator('.thread-image img');
    await expect(preview).toBeVisible();
    expect(await preview.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    const play = page.getByRole('button', { name: 'Play old.webm', exact: true });
    await expect(play).toBeVisible(); await play.click();
    await expect(page.locator('.thread-video video')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByRole('link', { name: 'Download old.webm' })).toBeAttached();
    // A branch change invalidates old cursors instead of mixing its history into the new branch.
    appendFileSync(file, JSON.stringify({ id: 'other-branch', parentId: 'name', type: 'message',
      message: { role: 'user', timestamp: Date.now(), content: 'Another branch' } }) + '\n');
    expect((await client.request('history', { sessionId: id, before: 'm35', expectedTip: pageResult.value.tip })).ok).toBe(false);
    expect((await client.request('videoRead', { sessionId: id, path: videoPath, messageId: 'm1', offset: 0 })).ok).toBe(false);
  } finally {
    client?.ws.terminate(); await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('sessions larger than 32 MiB are browsable without blocking live traffic', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-large-history-'));
  const config = loadConfig(dir), file = join(dir, 'large.jsonl');
  let host, client;
  try {
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: dir }) + '\n');
    appendFileSync(file, JSON.stringify({ id: 'name', parentId: null, type: 'session_info', name: 'Large history' }) + '\n');
    let parentId = 'name';
    for (let i = 0; i < 2200; i++) {
      const id = 'padding' + i;
      appendFileSync(file, JSON.stringify({ id, parentId, type: 'custom', data: 'x'.repeat(16384) }) + '\n'); parentId = id;
    }
    for (let i = 0; i < 130; i++) {
      const id = 'm' + i;
      appendFileSync(file, JSON.stringify({ id, parentId, type: 'message', message: { role: 'user', content: 'Large message ' + i, timestamp: i } }) + '\n'); parentId = id;
    }
    host = await startHost({ dir, config, port: 0, roots: [dir], publicUrl: 'http://127.0.0.1:8787', relayUrl: '' });
    const port = host.http.address().port, origin = `http://127.0.0.1:${port}`;
    client = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin);
    await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Large history/ }).click();
    const started = Date.now();
    const ping = await client.request('ping');
    expect(ping.ok).toBe(true); expect(Date.now() - started).toBeLessThan(500);
    await expect(page.locator('article.message').last()).toContainText('Large message 129');
    await page.locator('#transcript').evaluate(node => { node.scrollTop = 0; });
    await expect(page.locator('article.message').first()).toContainText('Large message 0');
  } finally {
    client?.ws.terminate(); await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
