import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { initialState, applyEvent } from '../../src/state.mjs';

test('elapsed time stays on completed activity links and parallel tools are not added together', async ({ page }, testInfo) => {
  const state = initialState({ id: 'visible-time', title: 'Visible tool timing', cwd: '/project' });
  const calls = (timestamp, ids) => applyEvent(state, { type: 'message_end', message: {
    role: 'assistant', timestamp, content: ids.map(id => ({ type: 'toolCall', id, name: 'bash', arguments: { command: 'sleep 10' } }))
  } });
  const result = (id, timestamp, durationMs, isError = false) => applyEvent(state, { type: 'message_end', message: {
    role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: 'Finished' }], timestamp, durationMs, isError
  } });
  const reply = timestamp => {
    applyEvent(state, { type: 'message_end', message: { role: 'assistant', timestamp, content: 'Next checks.' } });
    applyEvent(state, { type: 'message_end', message: { role: 'user', timestamp: timestamp + 1, content: 'Continue checking.' } });
  };
  calls(1, ['countdown']);
  applyEvent(state, { type: 'agent_start' });
  applyEvent(state, { type: 'tool_execution_start', toolCallId: 'countdown', toolName: 'bash' });
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  // Browser contract check: simulate only the server WebSocket.
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
  const groups = page.locator('.tool-activity'), countdown = groups.first();
  const time = countdown.locator(':scope > summary .tool-activity-time');
  await expect(countdown).not.toHaveAttribute('open', '');
  await expect(time).toHaveCount(0);
  applyEvent(state, { type: 'tool_execution_end', toolCallId: 'countdown', toolName: 'bash',
    durationMs: 10147, result: { content: [{ type: 'text', text: 'Finished' }] }, isError: false });
  snapshot();
  await expect(time).toHaveText('10.1s');
  await expect(time).toBeHidden();
  await expect(countdown.locator('.tool-status')).toBeHidden();
  await page.getByRole('button', { name: 'View activity', exact: true }).click();
  await expect(time).toBeVisible();
  await expect(time).toHaveAccessibleName('Elapsed time: 10.1s');
  await countdown.locator(':scope > summary').click();
  result('countdown', 20000, 10147);
  reply(21000); calls(25000, ['long', 'short']); result('short', 31500, 1000); snapshot();
  const parallel = groups.nth(1);
  await expect(parallel.locator('.tool-activity-time')).toHaveCount(0);
  result('long', 32000, 2000); snapshot();
  await expect(parallel.locator(':scope > summary .tool-activity-time')).toHaveText('2.0s');
  await expect(parallel).not.toHaveAttribute('open', '');
  reply(33000); calls(34000, ['legacy']); result('legacy', 35000, undefined);
  reply(36000); calls(37000, ['failed']); result('failed', 38000, 0, true); snapshot();
  await expect(groups.nth(2).locator('.tool-activity-time')).toHaveCount(0);
  await expect(groups.nth(3).locator('.tool-activity-time')).toHaveText('0ms');
  for (const [width, colorScheme] of [[320, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    await countdown.scrollIntoViewIfNeeded();
    await expect(time).toBeVisible();
    const summary = await countdown.locator(':scope > summary').boundingBox(), timing = await time.boundingBox();
    expect(timing.x + timing.width).toBeLessThanOrEqual(summary.x + summary.width);
    expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`visible-time-${width}.png`) });
    writeFileSync(testInfo.outputPath(`visible-time-${width}.aria.txt`), await countdown.ariaSnapshot());
  }
  await page.reload();
  await page.locator('.session').click();
  await expect(countdown).not.toHaveAttribute('open', '');
  await expect(time).toHaveText('10.1s');
  await expect(time).toBeVisible();
});
