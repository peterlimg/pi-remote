import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';
import { filterRecentSessions } from './session-filter.mjs';

// Real host and phone UI; only the Pi RPC process is simulated.
test('unused sessions stay out of Recent until a message is sent, without deleting history or drafts', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-empty-sessions-')), sessions = join(dir, 'sessions'), project = join(dir, 'project');
  mkdirSync(sessions); mkdirSync(project);
  const saved = new Map();
  const seed = (name, title, messages = []) => {
    const file = join(sessions, name + '.jsonl');
    const rows = [{ type: 'session', version: 3, id: name, cwd: project }];
    if (title) rows.push({ type: 'session_info', id: 'name', parentId: null, name: title });
    for (const [index, message] of messages.entries()) rows.push({ type: 'message', id: 'message-' + index,
      parentId: index ? 'message-' + (index - 1) : title ? 'name' : null, message });
    const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(file, content); saved.set(file, content);
    return sessionKey(file);
  };
  // More than a page of empty saved sessions must not crowd out actual conversations.
  const empty = Array.from({ length: 25 }, (_, i) => seed('unused-' + i));
  const meaningful = [
    seed('source', 'Existing conversation', [{ role: 'user', content: 'Keep this conversation' }]),
    seed('named', 'Planned task'),
    seed('assistant', undefined, [{ role: 'assistant', content: 'Assistant-only history' }]),
    seed('tool', undefined, [{ role: 'toolResult', toolName: 'read', toolCallId: 'read-1', content: 'Saved tool output' }]),
    seed('image', undefined, [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] }])
  ];
  const pinned = seed('pinned');
  writeFileSync(join(dir, 'pinned-sessions.json'), JSON.stringify([pinned]));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const host = await startHost({ dir, config, roots: [sessions], port: 0, relayUrl: '', workerOptions: {
    bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)), '--persist-at-startup']
  } });
  host.service.tempDirs = [];
  const rows = page.locator('#sessions .session');
  const recent = page.getByRole('region', { name: 'Recent', exact: true });
  const openNew = async () => {
    await page.getByRole('button', { name: 'New session', exact: true }).tap();
    await page.getByRole('dialog', { name: 'New session in…' }).locator('.project-option').click();
    await expect(page.locator('#title')).toHaveText('Untitled session');
    await expect(page.locator('#send')).toBeEnabled();
    return [...host.service.live.keys()].at(-1);
  };
  try {
    await page.goto('http://127.0.0.1:' + host.http.address().port + '/#token=' + config.clientToken);
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await filterRecentSessions(page, 'all');
    await expect(recent.locator('.badge')).toHaveText('5');
    await expect(rows).toHaveCount(6);
    for (const id of [...meaningful, pinned]) await expect(page.locator(`#sessions .session[data-id="${id}"]`)).toHaveCount(1);
    for (const id of empty) await expect(page.locator(`#sessions .session[data-id="${id}"]`)).toHaveCount(0);

    const abandoned = await openNew();
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await expect(page.locator(`#sessions .session[data-id="${abandoned}"]`)).toHaveCount(0);
    host.service.scan();
    await page.reload();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await filterRecentSessions(page, 'all');
    await expect(recent.locator('.badge')).toHaveText('5');
    await expect(rows).toHaveCount(6);

    const fresh = await openNew();
    await page.locator('#prompt').fill('My first request');
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await expect(page.locator(`#sessions .session[data-id="${fresh}"]`)).toHaveCount(0);
    // Search keeps an unsent session addressable and its in-memory draft intact.
    await page.getByRole('button', { name: 'Search sessions', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search sessions', exact: true }).fill('Untitled session');
    await page.locator(`#sessions .session[data-id="${fresh}"]`).click();
    await expect(page.locator('#prompt')).toHaveValue('My first request');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('reply: My first request');
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await expect(page.locator(`#sessions .session[data-id="${fresh}"]`)).toBeVisible();
    await expect(recent.locator('.badge')).toHaveText('6');
    await page.screenshot({ path: testInfo.outputPath('recent-without-unused-sessions.png') });
    await testInfo.attach('session-list', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
    await page.locator(`#sessions .session[data-id="${fresh}"]`).click();
    await expect(page.locator('#transcript')).toContainText('reply: My first request');
    for (const [file, content] of saved) expect(readFileSync(file, 'utf8')).toBe(content);
  } finally {
    await page.goto('about:blank').catch(() => {});
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
