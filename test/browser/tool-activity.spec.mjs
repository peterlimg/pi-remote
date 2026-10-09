import { test, expect } from '@playwright/test';

test('activity groups follow message boundaries, count each call once and keep disclosure state during streaming', async ({ page }, testInfo) => {
  const call = (id, name) => ({ id, name, text: JSON.stringify({ command: 'echo private-command', path: 'src/app.js' }) });
  const result = (id, name, isError = false) => ({ id: id + '-result', role: 'toolResult', toolCallId: id, toolName: name, text: 'Private output', isError });
  const state = { id: 'activity', title: 'Tool activity', cwd: '/project', status: 'working', historyTruncated: true, messages: [
    result('orphan', 'read'),
    { id: 'user', role: 'user', text: 'Check the changes.' },
    { id: 'calls', role: 'assistant', toolCalls: [call('a', 'bash'), call('b', 'bash'), call('c', 'bash'), call('d', 'read')] },
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
  await expect(groups).toHaveCount(2);
  await expect(groups.first().locator('.tool-activity-label')).toHaveText('Read 1 file');
  await expect(group.locator('.tool')).toHaveCount(4);
  await expect(group.locator('.tool-activity-label')).toHaveText('Running 3 commands, read 1 file');
  await expect(group.locator('.tool-activity-error')).toHaveText('1 failed');
  await expect(group.locator('.tool-activity-working')).toHaveText('1 running');
  await expect(group.locator('.tool-context').first()).toBeHidden();
  await page.setViewportSize({ width: 320, height: 740 });
  expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('activity-narrow-running.png') });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('open', '');
  state.messages.push(result('c', 'bash')); state.tools[0].status = 'done'; snapshot();
  await expect(group.locator('.tool-activity-label')).toHaveText('Ran 3 commands, read 1 file');
  await expect(summary).toBeFocused();
  await expect(group.locator('.tool-activity-working')).toHaveCount(0);
  await expect(group.locator('.tool')).toHaveCount(4);
  await page.keyboard.press('Enter');
  state.messages.push({ id: 'more', role: 'assistant', toolCalls: [call('e', 'edit')] }, result('e', 'edit')); snapshot();
  await expect(group.locator('.tool-activity-label')).toHaveText('Ran 3 commands, read 1 file, edited 1 file');
  await expect(group).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  state.messages.push({ id: 'reply', role: 'assistant', text: 'I found the failure.' },
    { id: 'custom', role: 'assistant', toolCalls: [call('f', 'constructor'), call('g', 'write')] }, result('f', 'constructor'), result('g', 'write'),
    { id: 'next', role: 'user', text: 'Try again.' }, result('later', 'bash'));
  state.status = 'saved'; snapshot();
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(2).locator('.tool-activity-label')).toHaveText('Used constructor 1 time, wrote 1 file');
  await expect(groups.nth(3).locator('.tool-activity-label')).toHaveText('Ran 1 command');
  expect(await page.locator('#transcript').evaluate(node => [...node.children].map(child =>
    child.classList.contains('tool-activity') ? 'activity' : child.classList.contains('message') ? child.textContent.trim() : 'hint')))
    .toEqual(['hint', 'activity', 'Check the changes.', 'activity', 'I found the failure.', 'activity', 'Try again.', 'activity']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
