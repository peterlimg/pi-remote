import { test, expect } from '@playwright/test';
import { filterRecentSessions } from './session-filter.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { applyEvent } from '../../src/state.mjs';
import { socket } from '../helpers.mjs';

test('saved histories and older bridges retain prompt order after output, scans and restarts', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-prompt-order-')), root = join(dir, 'sessions');
  mkdirSync(root);
  const now = Date.now(), files = ['older', 'newer'].map(name => join(root, name + '.jsonl'));
  const parents = [null, null], titles = ['Older busy task', 'Newer prompt task'];
  const append = (i, entry) => {
    const id = randomUUID();
    appendFileSync(files[i], JSON.stringify({ id, parentId: parents[i], ...entry }) + '\n');
    parents[i] = id;
  };
  for (const [i, file] of files.entries()) {
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: dir, timestamp: new Date(now - 86400000).toISOString() }) + '\n');
    append(i, { type: 'session_info', name: titles[i] });
    append(i, { type: 'message', message: { role: 'user', content: 'Start ' + titles[i], timestamp: now - (i ? 0 : 60000) } });
  }
  for (let i = 0; i < 110; i++) append(0, { type: 'message', message: { role: 'assistant', content: 'Older output ' + i, timestamp: now + i } });
  append(0, { type: 'custom', customType: 'pi-remote-extension-input', data: { text: 'Scheduled work' } });
  append(0, { type: 'message', message: { role: 'user', content: 'Scheduled work', timestamp: now + 200 } });
  const tip = parents[0];
  append(0, { type: 'message', message: { role: 'user', content: 'Abandoned branch', timestamp: now + 60000 } });
  parents[0] = tip;
  append(0, { type: 'message', message: { role: 'assistant', content: 'Current branch reply', timestamp: now + 300 } });
  utimesSync(files[1], now / 1000, (now - 3600000) / 1000);
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const options = { dir, config, roots: [root], relayUrl: '' };
  let host, agent, lock;
  try {
    host = await startHost({ ...options, port: 0 });
    const port = host.http.address().port, id = sessionKey(files[0]), instanceId = randomUUID();
    await page.goto(`http://127.0.0.1:${port}/#token=${config.clientToken}`);
    await filterRecentSessions(page, 'all');
    const rows = page.locator('#sessions .session strong');
    await expect(rows).toHaveText([titles[1], titles[0]]);
    const state = { ...readSession(files[0]), instanceId, status: 'working', tools: [], revision: 0 };
    delete state.lastPromptAt; // A terminal already running before the host upgrade.
    lock = acquireLock(join(dir, 'locks'), id, { file: files[0], instanceId });
    agent = await socket(`ws://127.0.0.1:${port}/bridge`, config.bridgeToken);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    await expect.poll(() => host.service.live.get(id)?.state.lastPromptAt).toBe(now - 60000);
    const publish = (message, save = false) => {
      if (save) append(0, { type: 'message', message });
      applyEvent(state, { type: 'message_end', message });
      delete state.lastPromptAt;
      agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    };
    publish({ role: 'assistant', content: 'Live background reply', timestamp: now + 1000 });
    await expect(page.getByRole('button', { name: /Older busy task/ })).toContainText('Live background reply');
    await expect(rows).toHaveText([titles[1], titles[0]]);
    const promptedAt = now + 2000;
    publish({ role: 'user', content: 'My next prompt', timestamp: promptedAt }, true);
    await expect(rows).toHaveText(titles);
    await expect.poll(() => host.service.live.get(id)?.state.lastPromptAt).toBe(promptedAt);
    for (let i = 0; i < 105; i++) {
      const message = { role: 'assistant', content: 'New background output ' + i, timestamp: now + 3000 + i };
      append(0, { type: 'message', message });
      applyEvent(state, { type: 'message_end', message });
    }
    delete state.lastPromptAt;
    agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    await expect(page.getByRole('button', { name: /Older busy task/ })).toContainText('New background output 104');
    expect(state.messages.some(message => message.role === 'user')).toBe(false);
    expect(host.service.live.get(id).state.lastPromptAt).toBe(promptedAt);
    host.service.scan();
    await expect(rows).toHaveText(titles);
    agent.ws.terminate(); lock.release();
    await host.close();
    host = await startHost({ ...options, port });
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await page.reload();
    await filterRecentSessions(page, 'all');
    await expect(rows).toHaveText(titles);
    expect(host.service.catalog.get(id).lastPromptAt).toBe(promptedAt);
    await testInfo.attach('prompt-order-host', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    agent?.ws.terminate(); lock?.release(); await host?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const fails of [false, true]) test(`startup events from ${fails ? 'failed' : 'successful'} restores do not promote old sessions`, async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-recency-')), root = join(dir, 'sessions');
  mkdirSync(root);
  const now = Date.now(), files = [], recent = Array.from({ length: 21 }, (_, i) => `Recent task ${i + 1}`);
  const titles = [...recent, 'Older restored task 1', 'Older restored task 2'];
  for (const [i, title] of titles.entries()) {
    const file = join(root, `${i}.jsonl`);
    writeFileSync(file, [
      { type: 'session', version: 3, id: `session-${i}`, cwd: dir, timestamp: new Date(now - i * 3600000).toISOString() },
      { type: 'session_info', id: 'name', parentId: null, name: title },
      { type: 'message', id: 'prompt', parentId: 'name', message: { role: 'user', content: 'Start ' + title, timestamp: now - i * 3600000 } }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    utimesSync(file, now / 1000, (now - i * 3600000) / 1000);
    files.push(file);
  }
  const saved = files.map(file => readFileSync(file, 'utf8'));
  writeFileSync(join(dir, 'resume-sessions.json'), JSON.stringify(files.slice(-2).map(sessionKey)));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const options = { dir, config, roots: [root], relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)),
      '--startup-events', ...(fails ? ['--fail-startup'] : [])] } };
  let host;
  try {
    host = await startHost({ ...options, port: 0 });
    const port = host.http.address().port, url = `http://127.0.0.1:${port}`;
    const restored = async (expectedLive = 2) => {
      await expect.poll(() => host.service.live.size).toBe(expectedLive);
      await expect.poll(() => host.service.busyWorkers).toBe(0);
      for (const [i, file] of files.entries()) {
        expect(host.service.read(sessionKey(file)).updatedAt).toBeCloseTo(now - i * 3600000, 0);
      }
    };
    await restored();
    await page.goto(url + '/#token=' + config.clientToken);
    await filterRecentSessions(page, 'all');
    const rows = page.locator('#sessions .session strong');
    await expect(rows).toHaveText(recent.slice(0, 20));
    await expect(page.locator('#sessions .session').first()).toHaveAccessibleName(/^Saved Recent task 1 /);
    await page.locator('#sessions .session').last().scrollIntoViewIfNeeded();
    await expect(rows).toHaveText(titles);
    await expect(page.locator('#sessions .session').last()).toHaveAccessibleName(new RegExp(`^${fails ? 'Saved' : 'Ready'} Older restored task 2 `));

    await host.close();
    expect(JSON.parse(readFileSync(join(dir, 'resume-sessions.json'), 'utf8'))).toEqual(fails ? [] : files.slice(-2).map(sessionKey));
    await expect(page.locator('#connection')).not.toHaveText('Computer connected');
    host = await startHost({ ...options, port });
    await restored(fails ? 0 : 2);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await expect(rows).toHaveText(titles);
    await page.reload();
    await filterRecentSessions(page, 'all');
    await expect(rows).toHaveText(recent.slice(0, 20));
    await page.screenshot({ path: testInfo.outputPath('recent-sessions-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(rows).toHaveText(recent.slice(0, 20));
    await page.screenshot({ path: testInfo.outputPath('recent-sessions-desktop.png') });
    await testInfo.attach('recent-sessions', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(saved);
    if (!fails) {
      await page.locator('#sessions .session').last().scrollIntoViewIfNeeded();
      await expect(rows).toHaveText(titles);
      await page.getByRole('button', { name: /Older restored task 1/ }).click();
      await page.locator('#prompt').fill('Actual conversation activity');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(page.locator('#transcript')).toContainText('reply: Actual conversation activity');
      await expect(rows.first()).toHaveText('Older restored task 1');
    }
  } finally {
    await host?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
