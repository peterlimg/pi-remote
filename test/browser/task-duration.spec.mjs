import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, applyEvent } from '../../src/state.mjs';
import { readSession } from '../../src/catalog.mjs';

test('final replies show total thinking and tool time, survive steering, long tasks and saved history', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-task-time-')), file = join(dir, 'session.jsonl');
  const state = initialState({ id: 'task-time', title: 'Total task time', cwd: dir });
  let parentId = null, sequence = 0, client, version = 0;
  writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: 'task-time', cwd: dir }) + '\n');
  const message = (role, timestamp, content, extra = {}) => {
    const message = { role, timestamp, content, ...extra };
    const id = 'entry-' + ++sequence;
    appendFileSync(file, JSON.stringify({ type: 'message', id, parentId, timestamp: new Date(timestamp).toISOString(), message }) + '\n');
    parentId = id; applyEvent(state, { type: 'message_end', message });
  };
  const call = id => [{ type: 'text', text: 'Checking the files.' }, { type: 'toolCall', id, name: 'read', arguments: { path: 'app.js' } }];
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  try {
    message('user', 500, 'Think about this.');
    message('assistant', 1000, 'A reply with no tools.', { durationMs: 9000, stopReason: 'stop' });
    message('user', 11000, 'Check the files.');
    message('assistant', 12000, call('first'), { durationMs: 4000, stopReason: 'toolUse' });
    message('toolResult', 19000, 'Read output', { toolCallId: 'first', toolName: 'read', durationMs: 3000 });
    message('user', 20000, 'Keep going.');
    message('assistant', 21000, call('second'), { durationMs: 5000, stopReason: 'toolUse' });
    message('toolResult', 28000, 'Read output', { toolCallId: 'second', toolName: 'read', durationMs: 1000 });
    applyEvent(state, { type: 'agent_start' });
    applyEvent(state, { type: 'message_start', message: { role: 'assistant', timestamp: 29000, content: 'Finishing the answer.', stopReason: 'pending' } });
    // Browser contract check: the server WebSocket is simulated; timing uses the real state/catalog code.
    await page.routeWebSocket('**/ws', ws => {
      client = ws;
      ws.onMessage(raw => {
        const packet = JSON.parse(raw);
        if (packet.type === 'auth') {
          ws.send(JSON.stringify({ type: 'ready' }));
          ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
        } else if (packet.op === 'watch') snapshot();
        if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      });
    });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.locator('.session').click();
    await expect(page.locator('.task-duration')).toHaveText(['Worked for 9.5s']);
    await expect(page.locator('.message.assistant').filter({ hasText: 'Finishing the answer.' }).locator('.task-duration')).toHaveCount(0);
    message('assistant', 29000, 'Finished the whole task.', { durationMs: 2000, stopReason: 'stop' });
    applyEvent(state, { type: 'agent_end' }); snapshot();
    const final = page.locator('.message.assistant').filter({ hasText: 'Finished the whole task.' });
    await expect(final.locator('.copy-message + .task-duration')).toHaveText('Worked for 20.0s');
    await expect(page.locator('.task-duration')).toHaveCount(2);
    for (const [width, colorScheme] of [[390, 'light'], [1280, 'dark']]) {
      await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme });
      await final.scrollIntoViewIfNeeded();
      await expect(final.locator('.task-duration')).toBeVisible();
      const copy = await final.locator('.copy-message').boundingBox(), footer = await final.locator('.task-duration').boundingBox();
      expect(footer.y).toBeGreaterThanOrEqual(copy.y + copy.height);
      await page.screenshot({ path: testInfo.outputPath(`task-duration-${width}.png`) });
    }
    message('user', 31500, 'A long task.');
    for (let i = 0; i < 60; i++) {
      message('assistant', 32000 + i * 300, call('long-' + i), { durationMs: 100, stopReason: 'toolUse' });
      message('toolResult', 32200 + i * 300, 'Output', { toolCallId: 'long-' + i, toolName: 'read', durationMs: 100 });
    }
    message('assistant', 61000, 'The long task is done.', { durationMs: 1000, stopReason: 'stop' }); snapshot();
    await expect(page.locator('.task-duration')).toHaveText(['Worked for 30.5s']);
    state.messages = readSession(file).messages; state.status = 'saved';
    await page.reload(); await page.locator('.session').click();
    await expect(page.locator('.task-duration')).toHaveText(['Worked for 30.5s']);
    await expect(page.locator('.task-duration')).toBeVisible();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
