import { test, expect } from '@playwright/test';
import { cleanMessage } from '../../src/catalog.mjs';

test('one log per request keeps tool details out of chat and preserves disclosure and focus while streaming', async ({ page }, testInfo) => {
  const now = Date.now(), startedAt = now - 133000;
  await page.clock.setFixedTime(now);
  const call = (id, name) => ({ id, name, text: JSON.stringify({ command: 'echo private-command', path: 'src/app.js' }) });
  const result = (id, name, isError = false) => ({ id: id + '-result', role: 'toolResult', toolCallId: id, toolName: name, text: 'Private output', isError });
  const state = { id: 'activity', title: 'Tool activity', cwd: '/project', status: 'working', historyTruncated: true, messages: [
    result('orphan', 'read'),
    { id: 'user', role: 'user', text: 'Check the changes.', timestamp: startedAt },
    { id: 'calls', role: 'assistant', taskStartedAt: startedAt, toolCalls: [call('a', 'bash'), call('b', 'bash'), call('c', 'bash'), call('d', 'read')] },
    result('a', 'bash'), result('b', 'bash', true), result('d', 'read')
  ], tools: [{ id: 'c', name: 'bash', status: 'working', text: 'Still running' }] };
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
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
  const groups = page.locator('.tool-activity'), group = groups.nth(1), summary = group.locator(':scope > summary');
  const toggle = page.getByRole('button', { name: 'View activity', exact: true });
  await expect(groups).toHaveCount(2);
  await expect(groups.first().locator('.tool-activity-label')).toHaveText('View activity');
  await expect(group.locator('[data-tool-id]')).toHaveCount(4);
  await expect(summary).toBeHidden();
  await expect(group.locator('.tool-context').first()).toBeHidden();
  await expect(page.locator('#activity-label')).toHaveText('Running a command…');
  await expect(page.locator('#activity-time')).toHaveText('2m 13s');
  await expect(page.locator('#activity-error')).toHaveText('1 tool failed');
  await expect(page.locator('#activity-error')).toBeVisible();
  await expect(page.locator('#agent-activity')).not.toContainText(/private-command|src\/app.js|Read \d|Ran \d/);
  await page.clock.setFixedTime(now + 2000);
  await expect(page.locator('#activity-time')).toHaveText('2m 15s');
  await page.setViewportSize({ width: 320, height: 740 });
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('activity-narrow-running.png') });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  await expect(page.locator('#activity-toggle')).toHaveAttribute('aria-expanded', 'true');
  await group.locator('[data-tool-id="c"] > summary').click();
  await expect(group.locator('[data-tool-id="c"] .tool-output')).toHaveText('Still running');
  await summary.focus();
  state.messages.push(result('c', 'bash')); state.tools[0].status = 'done'; snapshot();
  await expect(page.locator('#activity-label')).toHaveText('Working…');
  await expect(summary).toBeFocused();
  await expect(group.locator('[data-tool-id="c"] .tool-output')).toHaveText('Private output');
  state.messages.push({ id: 'reply', role: 'assistant', text: 'I found the failure.', taskStartedAt: startedAt },
    { id: 'more', role: 'assistant', toolCalls: [call('e', 'edit')], taskStartedAt: startedAt });
  state.tools.push({ id: 'e', name: 'edit', status: 'working' }); snapshot();
  await expect(page.locator('#activity-label')).toHaveText('Making changes…');
  await expect(groups).toHaveCount(2);
  await expect(group.locator('[data-tool-id]')).toHaveCount(5);
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(group).not.toHaveAttribute('open', '');
  await expect(summary).toBeHidden();
  await expect(page.locator('#activity-toggle')).toBeFocused();
  state.messages.push(result('e', 'edit'),
    { id: 'wake', role: 'user', source: 'extension', text: 'Private extension wake-up' },
    { id: 'custom', role: 'assistant', toolCalls: [call('f', 'constructor'), call('g', 'write')] }, result('f', 'constructor'), result('g', 'write'),
    { id: 'final', role: 'assistant', text: 'The fix is ready.' });
  state.tools[1].status = 'done'; state.status = 'idle'; snapshot();
  await expect(groups).toHaveCount(2);
  await expect(page.locator('#agent-activity')).toBeHidden();
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(group.locator('.tool-activity-label')).toHaveText('View activity');
  await expect(group.locator('.tool-activity-error')).toHaveText('1 failed');
  await expect(group.locator('.extension-prompt')).toBeHidden();
  await expect(group.locator('[data-tool-id]')).toHaveCount(7);
  await summary.click();
  await group.getByText('Prompted by an extension', { exact: true }).click();
  await expect(group.locator('.extension-prompt')).toHaveText('Private extension wake-up');
  await summary.click();
  state.messages.push({ id: 'next', role: 'user', text: 'Try again.' }, result('later', 'bash'));
  state.status = 'saved'; snapshot();
  await expect(groups).toHaveCount(3);
  expect(await page.locator('#transcript').evaluate(node => [...node.children].map(child =>
    child.classList.contains('tool-activity') ? 'activity' : child.classList.contains('message') ? child.textContent.trim() : 'hint')))
    .toEqual(['activity', 'Check the changes.', 'I found the failure.', 'The fix is ready.', 'activity', 'Try again.', 'activity']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const error = 'SDK requested a tool outside Pi.';
  state.messages.push(cleanMessage({ role: 'assistant', stopReason: 'error', errorMessage: error,
    content: [{ type: 'text', text: error }] }, 'failed'));
  snapshot();
  await expect(page.locator('#transcript')).toContainText(error);
  await page.reload();
  await page.locator('.session').click();
  await expect(page.locator('#transcript')).toContainText(error);
  await expect(groups).toHaveCount(3);
});

test('live progress stays current while reading history and its log opens at the live tail', async ({ page }) => {
  const state = { id: 'history-activity', title: 'Activity with history', cwd: '/project', status: 'working', historyTruncated: true, messages: [
    { id: 'user', role: 'user', text: 'Fix the history controls.' },
    { id: 'reply', role: 'assistant', text: 'I found the cause.', toolCalls: [{ id: 'change', name: 'read', text: '{"path":"web/app.js"}' }] }
  ], tools: [{ id: 'change', name: 'read', status: 'working' }] };
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsHistory: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') snapshot();
      const value = packet.op === 'history' ? { messages: Array.from({ length: 100 }, (_, index) => ({
        id: 'older-' + index, role: 'assistant', text: `Older message ${index}\n\n${'Conversation history. '.repeat(20)}`
      })), older: false, newer: false, tip: 'reply' } : [];
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.locator('.session').click();
  await expect(page.locator('#activity-label')).toHaveText('Reading files…');
  const transcript = page.locator('#transcript');
  await transcript.hover(); await page.mouse.wheel(0, -100);
  const first = transcript.locator('.message').first();
  await expect(first).toContainText('Older message 0');
  await first.evaluate(node => { window.activityHistoryAnchor = node; });
  const scrollTop = await transcript.evaluate(node => node.scrollTop);
  state.tools[0].name = 'edit'; state.messages[1].toolCalls[0].name = 'edit'; snapshot();
  await expect(page.locator('#activity-label')).toHaveText('Making changes…');
  expect(await page.evaluate(() => window.activityHistoryAnchor.isConnected)).toBe(true);
  expect(await transcript.evaluate(node => node.scrollTop)).toBe(scrollTop);
  await page.getByRole('button', { name: 'View activity', exact: true }).click();
  await expect(first).toHaveText('Fix the history controls.');
  await expect(page.locator('.tool-activity[data-live]')).toHaveAttribute('open', '');
  await expect(page.locator('.tool-activity > summary')).toBeFocused();
  await expect(page.locator('[data-tool-id="change"] .tool-context')).toBeVisible();
});
