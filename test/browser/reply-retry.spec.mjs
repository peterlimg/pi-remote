import { test, expect } from '@playwright/test';
import { filterRecentSessions } from './session-filter.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

// UI contract for terminals opened before retry metadata was available.
test('older terminal snapshots clear a recovered attempt without hiding a later failed turn', async ({ page }) => {
  let client;
  let state = { id: 'legacy-retry', title: 'Older terminal retry', cwd: '/project', status: 'working', messages: [
    { id: 'user', role: 'user', text: 'A request' }, { id: 'failed', role: 'assistant', text: '', stopReason: 'error' }
  ] };
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); ws.send(JSON.stringify({ type: 'sessions', sessions: [state] })); }
      else {
        if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Older terminal retry/ }).click();
  await expect(page.locator('#activity-label')).toHaveText('Retrying reply…');
  await expect(page.locator('.message-error')).toHaveCount(0);
  state = { ...state, status: 'idle', messages: [...state.messages, { id: 'recovered', role: 'assistant', text: 'Recovered response', stopReason: 'stop' }] };
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
  await expect(page.locator('#transcript')).toContainText('Recovered response');
  await expect(page.locator('#agent-activity')).toBeHidden(); await expect(page.locator('.message-error')).toHaveCount(0);
  state = { ...state, messages: [...state.messages, { id: 'next', role: 'user', text: 'Another request' },
    { id: 'final-failure', role: 'assistant', text: '', stopReason: 'error' }] };
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 2, state }));
  await expect(page.locator('.message-error')).toHaveText('Reply failed. Try again.');
});

// Real host, RPC worker, history reader and mobile UI; only Pi/model events are replayed.
test('automatic retries stay quiet, clear on success and expose only final failures', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-reply-retry-')), file = join(dir, 'session.jsonl');
  const timestamp = Date.now() - 10000, config = loadConfig(dir), gate = join(dir, 'retry-result.json');
  writeFileSync(file, [
    { type: 'session', id: 'retry', cwd: dir },
    { type: 'message', id: 'user', parentId: null, message: { role: 'user', content: 'Earlier request', timestamp } },
    { type: 'message', id: 'failed', parentId: 'user', message: { role: 'assistant', timestamp: timestamp + 1,
      content: [], stopReason: 'error', errorMessage: 'Private earlier diagnostics' } },
    { type: 'session_info', id: 'name', parentId: 'failed', name: 'Retry feedback' }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const options = { dir, config, roots: [dir], relayUrl: '', workerOptions: { bin: process.execPath,
    prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } };
  let host = await startHost({ ...options, port: 0 });
  config.port = host.http.address().port;
  const id = sessionKey(file), commands = [];
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => { const packet = JSON.parse(payload); if (packet.op === 'command') commands.push(packet.command); }));
  const retry = async () => {
    rmSync(gate, { force: true });
    await page.locator('#prompt').fill('retry reply'); await page.locator('#send').click();
    await expect(page.locator('#activity-label')).toHaveText('Retrying reply…');
    await expect(page.locator('#agent-activity')).toBeVisible();
    await expect(page.locator('#agent-activity .sr-only')).toHaveText('Retrying reply…');
    await expect(page.locator('#transcript')).not.toContainText('Private');
  };
  try {
    await page.goto(`http://127.0.0.1:${config.port}/#token=${config.clientToken}`);
    await filterRecentSessions(page, 'offline');
    await page.getByRole('button', { name: /Retry feedback/ }).click(); await page.locator('#resume').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await retry();
    await expect(page.locator('.message-error')).toHaveCount(1); // Keep an unrelated, older failed turn visible.
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: testInfo.outputPath(`retrying-${width}.png`) });
    }
    writeFileSync(gate, JSON.stringify({ success: true }));
    await expect(page.locator('#transcript')).toContainText('Recovered reply.');
    await expect(page.locator('#agent-activity')).toBeHidden(); await expect(page.locator('.message-error')).toHaveCount(1);
    const history = await host.service.history(id, {});
    expect(history.messages.find(message => message.id !== 'failed' && message.stopReason === 'error')?.retryAttempt).toBe(true);
    await retry(); await expect(page.locator('.message-error')).toHaveCount(1);
    writeFileSync(gate, JSON.stringify({ success: false }));
    await expect(page.locator('#agent-activity')).toBeHidden();
    await expect(page.locator('.message-error')).toHaveText(['Reply failed. Try again.', 'Reply failed. Try again.']);
    await retry(); await expect(page.locator('.message-error')).toHaveCount(2);
    await page.locator('#abort').click(); await expect(page.locator('#agent-activity')).toBeHidden();
    await expect(page.locator('.message-error')).toHaveCount(2);
    await host.close(); host = await startHost(options);
    await page.reload(); await page.getByRole('button', { name: /Retry feedback/ }).click();
    await expect(page.locator('.message-error')).toHaveCount(2);
    await expect(page.locator('#transcript')).not.toContainText('Private');
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    expect(rows.filter(row => row.message?.errorMessage === 'Private retry diagnostics')).toHaveLength(3);
    expect(rows.filter(row => row.type === 'context_edit' && row.replacement === null)).toHaveLength(3);
    expect(commands.filter(command => command.text === 'retry reply')).toHaveLength(3);
  } finally { await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
