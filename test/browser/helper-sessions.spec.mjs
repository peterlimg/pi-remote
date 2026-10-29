import { test, expect } from '@playwright/test';
import { filterRecentSessions } from './session-filter.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { initialState } from '../../src/state.mjs';
import { socket, until } from '../helpers.mjs';

test('helper sessions stay out of browsing but remain searchable without changing the project picker', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-helpers-')), root = join(dir, 'sessions');
  const now = Date.now(), files = [], helpers = [];
  const titles = ['Review subagent-worker naming', 'worker: investigate login', ...Array.from({ length: 21 }, (_, i) => `Task ${i + 1}`)];
  const seed = (file, title, cwd, updatedAt) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, [
      { type: 'session', version: 3, id: randomUUID(), cwd },
      { type: 'session_info', id: 'name', parentId: null, name: title }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    utimesSync(file, updatedAt / 1000, updatedAt / 1000); files.push(file);
    return file;
  };
  let host, agent, lock;
  try {
    for (const [i, title] of titles.entries()) seed(join(root, `${i}.jsonl`), title, '/projects/app', now - i * 60000);
    for (let i = 0; i < 25; i++) helpers.push(seed(join(root, 'parent', randomUUID(), `run-${i}`, 'session.jsonl'),
      `Helper analysis ${i}`, '/projects/helpers', now + (i + 1) * 60000));
    const legacyTitle = `subagent-worker-${randomUUID()}-1`;
    helpers.push(seed(join(root, 'legacy.jsonl'), legacyTitle, '/projects/helpers', now + 26 * 60000));
    const saved = files.map(file => readFileSync(file, 'utf8'));
    writeFileSync(join(dir, 'pinned-sessions.json'), JSON.stringify(helpers.map(sessionKey)));
    const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
    host = await startHost({ dir, config, port: 0, roots: [root], relayUrl: '' });
    const url = `http://127.0.0.1:${host.http.address().port}`, file = helpers[0], id = sessionKey(file), instanceId = randomUUID();
    const state = initialState({ ...readSession(file), instanceId });
    lock = acquireLock(join(dir, 'locks'), id, { file, instanceId });
    agent = await socket(url.replace('http:', 'ws:') + '/bridge', config.bridgeToken);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.type === 'command') agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { commands: [] } }));
    });
    await until(() => host.service.live.has(id));
    await page.goto(url + '/#token=' + config.clientToken);
    await filterRecentSessions(page, 'all');
    const rows = page.locator('#sessions .session'), names = rows.locator('strong');
    await expect(names).toHaveText(titles.slice(0, 20)); // Helpers must not consume the first page.
    expect(host.service.list()).toMatchObject({ total: titles.length, matched: titles.length });
    await rows.last().scrollIntoViewIfNeeded();
    await expect(names).toHaveText(titles);
    await page.screenshot({ path: testInfo.outputPath('helpers-hidden-mobile.png') });

    await page.getByRole('button', { name: 'Search sessions', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search sessions' });
    await search.fill('Helper analysis 0');
    await expect(names).toHaveText(['Helper analysis 0']);
    state.title = 'Helper analysis 0 renamed'; state.revision++;
    agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    await expect(names).toHaveText([state.title]);
    await rows.first().click();
    await expect(page.locator('#title')).toHaveText(state.title);
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await search.fill(legacyTitle);
    await expect(names).toHaveText([legacyTitle]);
    await page.getByRole('button', { name: 'Close search' }).click();
    await expect(names).toHaveText(titles.slice(0, 20));

    await page.getByRole('button', { name: 'New session', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'New session in…' });
    await expect(picker.locator('.project-option-name')).toHaveText(['helpers', 'app']);
    await picker.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(names).toHaveText(titles.slice(0, 20));
    await page.screenshot({ path: testInfo.outputPath('helpers-hidden-desktop.png') });
    await testInfo.attach('helpers-hidden', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
    await page.reload();
    await filterRecentSessions(page, 'all');
    await expect(names).toHaveText(titles.slice(0, 20));
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(saved);
  } finally {
    agent?.ws.terminate(); lock?.release();
    await host?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
