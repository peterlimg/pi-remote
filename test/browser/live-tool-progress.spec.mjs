import { test, expect } from '@playwright/test';

test('inline activity shows fresh output before tools finish and keeps separate progress blocks', async ({ page }, testInfo) => {
  const state = { id: 'live-progress', title: 'Simplify history loading', cwd: '/project', status: 'working', messages: [
    { id: 'user', role: 'user', text: 'Simplify history loading.' },
    { id: 'intro', role: 'assistant', text: 'The loading control is simpler now. I’m checking the browser behavior.' },
    { id: 'calls', role: 'assistant', toolCalls: [
      { id: 'checks', name: 'bash', text: '{"command":"npx playwright test test/browser/history.spec.mjs"}' },
      { id: 'read', name: 'read', text: '{"path":"web/app.js"}' }
    ] }
  ], tools: [{ id: 'checks', name: 'bash', status: 'working', text: '' }, { id: 'read', name: 'read', status: 'working', text: '' }] };
  let client, version = 0;
  const publish = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') publish();
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.locator('.session').click();
  const groups = page.locator('.tool-activity'), group = groups.first(), summary = group.locator(':scope > summary');
  const preview = summary.locator('.tool-activity-progress');
  await expect(summary).toBeVisible();
  await expect(group).not.toHaveAttribute('open', '');
  await expect(group.locator('.tool').first()).toBeHidden();
  await expect(preview).toHaveCount(0);
  for (const count of [2, 4, 6]) {
    state.tools[0].text = `Running browser checks\n\n${count - 1}/18 checks passed\r${count}/18 checks passed\n`;
    publish();
    await expect(preview).toHaveText(`${count - 1}/18 checks passed\n${count}/18 checks passed`);
    await expect(preview).toBeVisible();
    await expect(summary.locator('.tool-activity-line')).toHaveText('$ npx playwright test test/browser/history.spec.mjs');
    await expect(group.locator('[data-tool-id="checks"]')).toHaveAttribute('data-status', 'working');
    await expect(group).not.toHaveAttribute('open', '');
  }
  for (const [width, scheme] of [[390, 'light'], [320, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: scheme });
    await summary.scrollIntoViewIfNeeded();
    expect((await preview.boundingBox()).height).toBeLessThanOrEqual(36);
    expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`inline-progress-${width}.png`) });
  }
  await summary.focus(); await page.keyboard.press('Enter');
  state.tools[0].text = '<img src=x onerror=window.injected=true>\n7/18 checks passed'; publish();
  await expect(preview).toContainText('<img src=x onerror=window.injected=true>');
  await expect(summary).toBeFocused();
  await expect(page.locator('#transcript img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  state.messages.push(
    { id: 'checks-result', role: 'toolResult', toolCallId: 'checks', toolName: 'bash', text: '18 checks passed.' },
    { id: 'read-result', role: 'toolResult', toolCallId: 'read', toolName: 'read', text: 'Source read.' },
    { id: 'milestone', role: 'assistant', text: 'The browser checks passed. I’m reviewing the final change.' },
    { id: 'final-call', role: 'assistant', toolCalls: [{ id: 'final-read', name: 'read', text: '{"path":"web/style.css"}' }] }
  );
  state.tools.forEach(tool => { tool.status = 'done'; });
  state.tools.push({ id: 'final-read', name: 'read', status: 'working', text: 'Reviewing the activity preview styles.' }); publish();
  await expect(groups).toHaveCount(2);
  await expect(group.locator('.tool-activity-progress')).toHaveCount(0);
  await expect(groups.nth(1).locator('.tool-activity-progress')).toHaveText('Reviewing the activity preview styles.');
  await expect(page.locator('#activity-toggle, #activity-log')).toHaveCount(0);
  await expect(page.locator('#transcript')).not.toContainText('View activity');
  state.messages.push({ id: 'final-result', role: 'toolResult', toolCallId: 'final-read', toolName: 'read', text: 'Source code that should not fill the preview.' });
  state.tools[2].status = 'done'; publish();
  const latest = groups.nth(1).locator(':scope > summary');
  await expect(latest.locator('.tool-activity-line')).toHaveText('Last: read web/style.css');
  await expect(latest.locator('.tool-activity-line')).toBeVisible();
  await expect(latest.locator('.tool-activity-progress')).toHaveCount(0);
  state.messages.push({ id: 'quick-call', role: 'assistant', toolCalls: [{ id: 'quick', name: 'read', text: '{"path":"web/app.js"}' }] },
    { id: 'quick-result', role: 'toolResult', toolCallId: 'quick', toolName: 'read', text: 'Source code.' }); publish();
  await expect(latest.locator('.tool-activity-line')).toHaveText('Last: read web/app.js');
  await expect(latest.locator('.tool-activity-label')).toHaveText('Read 2 files');
  state.messages.push({ id: 'command-call', role: 'assistant', toolCalls: [{ id: 'command', name: 'bash', text: '{"command":"npm run check"}' }] },
    { id: 'command-result', role: 'toolResult', toolCallId: 'command', toolName: 'bash', text: 'Starting checks\nTypeScript passed\nSyntax passed' }); publish();
  await expect(latest.locator('.tool-activity-line')).toHaveText('Last: $ npm run check');
  await expect(latest.locator('.tool-activity-progress')).toHaveText('TypeScript passed\nSyntax passed');
  await expect(groups).toHaveCount(2);
  state.status = 'idle'; publish();
  await expect(page.locator('.tool-activity-progress, .tool-activity-line')).toHaveCount(0);
  await expect(groups.nth(1).locator('.tool-activity-label')).toHaveText('Read 2 files, ran 1 command');
});
