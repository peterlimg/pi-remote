import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanMessage } from '../../src/catalog.mjs';

const call = (id, code) => ({ id, name: 'codemode', text: JSON.stringify({ code }) });
const result = (id, text, durationMs, timestamp, isError = false) => ({
  id: id + '-result', role: 'toolResult', toolCallId: id, toolName: 'codemode', text, durationMs, timestamp, isError
});
const sample = () => ({
  id: 'codemode', title: 'Check session defaults', cwd: '/project', status: 'working', messages: [
    { id: 'user', role: 'user', text: 'Keep the same character after a rename.' },
    { id: 'intro', role: 'assistant', text: "I'll tie default characters to session IDs and check the rename behavior." },
    cleanMessage({ role: 'assistant', content: [
      { type: 'toolCall', id: 'read', name: 'codemode', arguments: { code: '// Read the icon components\ntext(await tools.read({ path: "/Users/private/project/web/app.js" }));' } },
      { type: 'toolCall', id: 'edit', name: 'codemode', arguments: { code: '// Update session defaults\nconsole.log("<img src=x onerror=window.injected=1>");' } },
      { type: 'toolCall', id: 'checks', name: 'codemode', arguments: { code: '// Run focused browser checks\ntext(await tools.bash({ command: "npm run test:browser" }));' } }
    ] }, 'calls'),
    result('read', 'Read two files.', 3000, 8000),
    result('edit', 'Applied the session ID change.', 4000, 9000)
  ], tools: [{ id: 'checks', name: 'codemode', status: 'working', text: 'Starting browser checks\n1 passed' }]
});
async function open(page, state) {
  page.on('pageerror', error => { throw error; });
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
  return publish;
}
async function capture(page, name) {
  if (!process.env.PI_CODEMODE_LIVE_EVIDENCE) return;
  mkdirSync(process.env.PI_CODEMODE_LIVE_EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(process.env.PI_CODEMODE_LIVE_EVIDENCE, name + '.png'), animations: 'disabled' });
}

test('codemode work log exposes real output before scripts and preserves focus through streaming', async ({ page }) => {
  const state = sample(), publish = await open(page, state);
  const group = page.locator('.codemode-activity'), summary = group.locator(':scope > summary');
  const read = page.locator('[data-tool-id="read"]'), checks = page.locator('[data-tool-id="checks"]');
  await expect(group).toHaveAttribute('open', '');
  await expect(group.locator('.tool-activity-label')).toHaveText('2 complete · 1 running');
  await expect(group.locator('.tool')).toHaveCount(3);
  await expect(read.locator('.codemode-title')).toHaveText('Read the icon components');
  await expect(read.locator('.tool-output')).toBeHidden();
  await expect(checks).toHaveAttribute('open', '');
  await expect(checks.locator('.codemode-state')).toHaveText(' · Running');
  await expect(checks.locator('.tool-status')).toHaveCount(0);
  await capture(page, 'phone-working');
  await read.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(read.locator('.tool-output')).toHaveText('Read two files.');
  await expect(read.locator('.tool-input')).toBeHidden();
  const script = read.locator('.codemode-script');
  await script.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(script.locator('pre')).toContainText('path: "~/project/web/app.js"');
  await expect(script.locator('pre')).not.toContainText('"code":');
  state.tools[0].text = 'Checking rename\n\x1b[32m2 passed\x1b[39m';
  publish();
  await expect(script).toHaveAttribute('open', '');
  await expect(script.locator('summary')).toBeFocused();
  await expect(checks.locator('.tool-output')).toHaveText('Checking rename\n2 passed');
  await summary.click();
  state.tools[0].text = '<img src=x onerror=window.injected=1>\n3 passed'; publish();
  await expect(group).not.toHaveAttribute('open', '');
  await expect(summary.locator('.tool-activity-progress')).toHaveText('<img src=x onerror=window.injected=1>\n3 passed');
  await expect(page.locator('#transcript img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  state.messages.push(result('checks', 'All browser checks passed.', 3000, 10000));
  state.tools = []; state.status = 'idle'; publish();
  await expect(group.locator('.tool-activity-label')).toHaveText('3 complete');
  await expect(group.locator('.tool-activity-time')).toHaveText('5.0s elapsed');
  await expect(group.locator('.tool-activity-progress')).toHaveCount(0);
  await expect(group).not.toHaveAttribute('open', '');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(script).toHaveAttribute('open', '');
  await expect(checks.locator('.tool-status')).toHaveText('3.0s');
  await expect(group.locator('.tool')).toHaveCount(3);
  state.messages.push({ id: 'retry', role: 'assistant', toolCalls: [call('failed', '// Check rename assertion\nthrow new Error("rename");')] },
    result('failed', 'Expected the same character after rename. 1 failed, 4 passed.', 0, 11000, true));
  publish();
  const failed = page.locator('[data-tool-id="failed"]');
  await expect(group.locator('.tool-activity-label')).toHaveText('3 complete · 1 failed');
  await expect(failed.locator('.tool-output')).toBeVisible();
  await expect(failed.locator('.codemode-state')).toHaveText(' · Failed');
  await expect(failed.locator('.tool-status')).toHaveText('0ms');
  await failed.scrollIntoViewIfNeeded(); await capture(page, 'phone-error');
  await failed.locator(':scope > summary').click();
  publish();
  await expect(failed).not.toHaveAttribute('open', '');
  state.messages.push({ id: 'queued', role: 'assistant', toolCalls: [call('pending', '// Review the final diff\nconsole.log("diff");')] });
  publish();
  const pending = page.locator('[data-tool-id="pending"]');
  await expect(group.locator('.tool-activity-label')).toHaveText('3 complete · 1 pending · 1 failed');
  await expect(pending.locator('.tool-status')).toHaveCount(0);
  await pending.locator(':scope > summary').click();
  await expect(pending.locator('.tool-output')).toHaveText('Waiting to run…');
});

test('missing, string and partial inputs remain inspectable without inventing inner-tool results', async ({ page }) => {
  const state = { id: 'codemode', title: 'Older codemode history', cwd: '/project', status: 'idle', tools: [], messages: [
    result('orphan', 'Older output, input unavailable.'),
    { id: 'user', role: 'user', text: 'Continue.' },
    { id: 'calls', role: 'assistant', toolCalls: [
      call('unnamed', 'console.log("tools.read is only a string, not an executed read");'),
      { id: 'normal', name: 'read', text: '{"path":"web/app.js"}' },
      { id: 'partial', name: 'codemode', text: '{"code":"const text = "' },
      { id: 'string', name: 'codemode', text: JSON.stringify('// Read a string input\nconsole.log("saved");') },
      call('options', '// @options: {"timeout_ms": 1000}\n\n// Review the results\nconsole.log("done");'),
      call('empty', '')
    ] },
    result('unnamed', ''), { id: 'normal-result', role: 'toolResult', toolCallId: 'normal', toolName: 'read', text: 'Normal source.' },
    { ...result('partial', 'Shortened output.'), truncated: true }, result('string', 'Saved output.'),
    result('options', 'Reviewed.'), result('empty', '')
  ] };
  await open(page, state);
  await expect(page.locator('.tool-activity')).toHaveCount(4);
  await expect(page.locator('.codemode-activity')).toHaveCount(3);
  const orphan = page.locator('[data-tool-id="orphan"]');
  await expect(orphan.locator('.codemode-title')).toHaveText('JavaScript run 1');
  await orphan.locator(':scope > summary').click();
  await expect(orphan.locator('.tool-output')).toHaveText('Older output, input unavailable.');
  await expect(orphan.locator('.codemode-script')).toHaveCount(0);
  const unnamed = page.locator('[data-tool-id="unnamed"]');
  await expect(unnamed.locator('.codemode-title')).toHaveText('JavaScript run 1');
  await unnamed.locator(':scope > summary').click();
  await expect(unnamed.locator('.tool-output')).toHaveText('No output.');
  await expect(page.locator('[data-tool-id="normal"]')).not.toHaveClass(/codemode-tool/);
  const partial = page.locator('[data-tool-id="partial"]');
  await partial.locator(':scope > summary').click();
  await expect(partial.locator('.hint')).toHaveText('Output shortened for mobile.');
  await partial.locator('.codemode-script summary').click();
  await expect(partial.locator('.tool-input')).toHaveText('{"code":"const text = "');
  await expect(partial.locator('.codemode-script summary')).toHaveText('Input');
  const string = page.locator('[data-tool-id="string"]');
  await expect(string.locator('.codemode-title')).toHaveText('Read a string input');
  await string.locator(':scope > summary').click();
  await string.locator('.codemode-script summary').click();
  await expect(string.locator('.tool-input')).toHaveText('// Read a string input\nconsole.log("saved");');
  await expect(page.locator('[data-tool-id="options"] .codemode-title')).toHaveText('Review the results');
  await expect(page.locator('[data-tool-id="empty"] .codemode-title')).toHaveText('JavaScript run 4');
  await expect(page.locator('#transcript')).not.toContainText('Read 1 file,');
});

test('compact work log fits phone, narrow and desktop views without shrinking touch targets', async ({ page }) => {
  const state = sample();
  state.messages.push(result('checks', '5 passed.', 3000, 10000)); state.tools = []; state.status = 'idle';
  await open(page, state);
  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [320, 'light'], [1440, 'light']]) {
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: scheme });
    const group = page.locator('.codemode-activity');
    await group.locator(':scope > summary').scrollIntoViewIfNeeded();
    for (const selector of ['.codemode-activity > summary', '.codemode-tool > summary']) {
      for (const box of await page.locator(selector).all()) {
        const { height } = await box.boundingBox();
        expect(height).toBeGreaterThanOrEqual(44);
        expect(height).toBeLessThanOrEqual(52);
      }
    }
    expect((await group.boundingBox()).height).toBeLessThanOrEqual(220);
    const iconBounds = await group.locator('.codemode-mark path').evaluate(path => {
      const { y, height } = path.getBBox(); return { y, height };
    });
    expect(iconBounds).toEqual({ y: 6, height: 12 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await capture(page, `work-log-${width}-${scheme}`);
  }
});
