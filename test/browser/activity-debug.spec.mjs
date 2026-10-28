import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { e2eKey } from '../../src/e2e.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { socket, until } from '../helpers.mjs';

const readLog = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

test('working animation diagnostics reach the computer through encryption and survive reconnects', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-activity-debug-')), config = loadConfig(dir);
  const file = join(dir, 'session.jsonl'), log = join(dir, 'activity-debug.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: randomUUID(), cwd: dir }) + '\n');
  const id = sessionKey(file), instanceId = randomUUID();
  const state = { id, file, instanceId, cwd: dir, title: 'Animation diagnostics', status: 'working', revision: 0,
    updatedAt: Date.now(), messages: [{ id: 'reply', role: 'assistant', text: 'PRIVATE_CONVERSATION_TEXT' }], tools: [] };
  const options = { dir, config, port: 0, roots: [dir], relayUrl: '', publicUrl: 'http://127.0.0.1:8787' };
  let host = await startHost(options), agent, lock;
  const frames = [];
  page.on('websocket', ws => ws.on('framesent', frame => frames.push(String(frame.payload))));
  try {
    const port = host.http.address().port, origin = `http://127.0.0.1:${port}`, key = e2eKey(config);
    lock = acquireLock(join(dir, 'locks'), id, { file, instanceId });
    agent = await socket(origin.replace('http:', 'ws:') + '/bridge', config.bridgeToken);
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.type === 'command') agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: {} }));
    });
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    await until(() => host.service.live.has(id));
    await page.goto(origin + '/#token=' + config.clientToken + '&key=' + key);
    await page.getByRole('button', { name: /Animation diagnostics/ }).click();
    const dots = page.locator('#agent-activity svg');
    await expect(dots).toBeVisible();
    await expect.poll(() => readLog(log).some(row => row.playState === 'running')).toBe(true);
    const first = readLog(log).find(row => row.playState === 'running');
    expect(first).toMatchObject({ tag: 'activity-debug-v1', session: id, connected: true, visible: true, reducedMotion: false,
      animationName: 'connection-spin', animationCount: 1, durationMs: 1400 });
    expect(first.userAgent).toContain('AppleWebKit');
    const startTime = await dots.evaluate(async svg => {
      const animation = svg.getAnimations()[0]; await animation.ready; return Math.round(animation.startTime);
    });
    const count = readLog(log).length;
    for (let i = 0; i < 3; i++) {
      state.messages[0].text += ' stream'; state.revision++;
      agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
      await expect(page.locator('#transcript')).toContainText(state.messages[0].text);
    }
    expect(readLog(log).length).toBeLessThanOrEqual(count + 1);
    await expect.poll(() => readLog(log).some(row => row.currentTime > first.currentTime && row.startTime === startTime && row.frameDelayMs !== null),
      { timeout: 8000 }).toBe(true);
    // Deliberately pause the real CSS animation to prove the logs capture that failure mode.
    await dots.evaluate(svg => svg.getAnimations()[0].pause());
    await expect.poll(() => readLog(log).some(row => row.playState === 'paused' && row.rendered && row.renders > first.renders),
      { timeout: 8000 }).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('paused-working-dots.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => readLog(log).some(row => row.reducedMotion && row.animationName === 'none' && row.transform === 'none')).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: /Animation diagnostics/ }).click();
    await expect.poll(() => new Set(readLog(log).map(row => row.page)).size).toBe(2);
    await host.close();
    host = await startHost({ ...options, port });
    await expect.poll(() => readLog(log).some(row => row.reason === 'disconnect' && !row.connected), { timeout: 10000 }).toBe(true);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    const rows = readLog(log), disconnected = rows.findIndex(row => row.reason === 'disconnect' && !row.connected);
    expect(rows.slice(disconnected + 1).some(row => row.connected)).toBe(true);
    const text = readFileSync(log, 'utf8');
    for (const privateValue of ['PRIVATE_CONVERSATION_TEXT', config.clientToken, config.bridgeToken, key, dir]) expect(text).not.toContain(privateValue);
    expect(frames.some(frame => frame.includes('activityDebug'))).toBe(false);
  } finally {
    await page.close();
    if (existsSync(log)) writeFileSync(testInfo.outputPath('activity-debug.jsonl'), readFileSync(log));
    agent?.ws.terminate(); lock?.release(); await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostic ingestion is authenticated, allowlisted, rate limited, rotated and safe on write failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-debug-ingestion-')), config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [], relayUrl: '' });
  const origin = `http://127.0.0.1:${host.http.address().port}`, url = origin.replace('http:', 'ws:') + '/ws';
  const path = join(dir, 'activity-debug.jsonl');
  let client;
  try {
    const unauthenticated = new WebSocket(url, { origin });
    await once(unauthenticated, 'open');
    unauthenticated.send(JSON.stringify({ op: 'activityDebug', records: [] }));
    const [code] = await once(unauthenticated, 'close');
    expect(code).toBe(1008); expect(existsSync(path)).toBe(false);
    client = await socket(url, config.clientToken, origin, e2eKey(config));
    const record = { page: randomUUID(), session: null, reason: 'sample', status: 'working', at: Date.now(),
      text: 'PRIVATE_CONVERSATION_TEXT', token: config.clientToken, error: dir, url: '#key=PRIVATE_KEY' };
    expect(await client.request('activityDebug', { records: [record] })).toMatchObject({ ok: true, value: { recorded: 1 } });
    expect(readLog(path)[0]).toEqual({ tag: 'activity-debug-v1', receivedAt: expect.any(String), page: record.page,
      session: null, reason: 'sample', status: 'working', at: record.at });
    const size = statSync(path).size;
    for (const records of [Array(21).fill(record), [{ ...record, currentTime: -1 }], [{ ...record, transform: 'PRIVATE_TEXT' }],
      [{ ...record, status: 'PRIVATE_TEXT' }], [{ ...record, page: 'invalid' }]]) {
      expect(await client.request('activityDebug', { records })).toMatchObject({ ok: false, error: 'Invalid activity diagnostics' });
    }
    expect(statSync(path).size).toBe(size);
    expect(await client.request('activityDebug', { records: Array(20).fill(record) })).toMatchObject({ ok: true });
    expect(await client.request('activityDebug', { records: Array(20).fill(record) })).toMatchObject({ ok: false, error: 'Activity diagnostics are rate limited' });
    writeFileSync(path, 'x'.repeat(1024 * 1024));
    expect(await client.request('activityDebug', { records: [record] })).toMatchObject({ ok: true });
    expect(statSync(path + '.1').size).toBe(1024 * 1024);
    expect(statSync(path).size).toBeLessThan(1024 * 1024);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    rmSync(path); mkdirSync(path);
    expect(await client.request('activityDebug', { records: [record] })).toMatchObject({ ok: false, error: 'Could not save activity diagnostics' });
    expect(await client.request('ping')).toMatchObject({ ok: true, value: { pong: true } });
  } finally {
    client?.ws.terminate(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
