import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyEvent, initialState } from '../../src/state.mjs';
import { cleanMessage } from '../../src/catalog.mjs';

const call = (id, code) => ({ id, name: 'codemode', text: JSON.stringify({ code }) });
const result = (id, text, durationMs, timestamp, isError = false) => ({
  id: id + '-result', role: 'toolResult', toolCallId: id, toolName: 'codemode', text, durationMs, timestamp, isError
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

test('terminal blocks follow call snapshots and survive reopening from a saved result', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const code = Array.from({ length: 11 }, (_, i) => 'const v' + i + ' = "VERSION";').join('\n');
  const state = initialState({ id: 'terminal', title: 'Check release', cwd: '/project' }, [
    cleanMessage({ role: 'assistant', content: [{ type: 'toolCall', name: 'codemode', id: 'run', arguments: { code } }] }, 'call')
  ]);
  const base = { toolCallId: 'run', toolName: 'codemode' };
  const calls = [{ name: 'read', args: '{"path":"VERSION"}', status: 'ok', durationMs: 3 },
    { name: 'bash', args: '{"command":"node check.mjs"}', status: 'running' }];
  applyEvent(state, { type: 'agent_start' });
  const publish = await open(page, state), block = page.locator('.pi-terminal');
  await expect(block).toContainText('Waiting to run…');
  await expect(block.locator('pre')).toBeHidden();
  applyEvent(state, { type: 'tool_execution_start', ...base }); publish();
  await expect(block).toHaveAttribute('data-status', 'working');
  await expect(block.locator('li')).toHaveCount(0);
  applyEvent(state, { type: 'tool_execution_update', ...base, partialResult: { details: { calls } } });
  applyEvent(state, { type: 'tool_execution_update', toolName: 'bash', toolCallId: 'run/2', parentToolCallId: 'run' });
  publish();
  await expect(block.locator('pre')).toBeHidden();
  await expect(block.locator('li')).toHaveCount(2);
  await expect(block.locator('li').last()).toContainText(/Running:.*bash/);
  await expect(block.locator('[data-terminal-started]')).toContainText('Elapsed');
  await expect(page.locator('[data-tool-id="run/2"]')).toHaveCount(0);
  await block.getByText('View code', { exact: true }).click();
  await expect(block.locator('pre')).toHaveText(code);
  calls[1] = { ...calls[1], status: 'error', error: 'Version mismatch', durationMs: 3250 };
  const completed = { content: [{ type: 'text', text: 'Script failed\nWall time 3.3 seconds\nOutput:\n' },
    { type: 'text', text: 'Error: <img src=x> version mismatch' }], details: { calls } };
  applyEvent(state, { type: 'tool_execution_end', ...base, result: completed, isError: true, durationMs: 3313 });
  applyEvent(state, { type: 'message_end', message: { role: 'toolResult', ...base, ...completed, isError: true, durationMs: 3313 } });
  state.tools = []; publish();
  await expect(block.locator('details')).toHaveJSProperty('open', true);
  await expect(block.locator('li').last()).toContainText('Version mismatch');
  await expect(block.locator('.terminal-output')).toHaveText('Error: <img src=x> version mismatch');
  await expect(block).toContainText('Failed · Took 3.3s');
  await expect(block.locator('img')).toHaveCount(0);
  expect(await page.locator('#transcript').evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /Check release/ }).click();
  await expect(page.locator('.pi-terminal li')).toHaveCount(2);
});

test('borderless terminal retains visible syntax colors in arguments and returned code', async ({ page }) => {
  const output = "==> text 1/4 <==\nimport { createServer } from 'node:http';";
  const state = { id: 'syntax', title: 'Inspect the server', cwd: '/project', status: 'idle', tools: [], messages: [
    { id: 'calls', role: 'assistant', toolCalls: [call('run', 'text(await tools.read({path: "src/host.mjs", limit: 85}));')] },
    { ...result('run', output, 32, 12000), trace: { calls: [{ name: 'read', args: '{"path":"src/host.mjs","limit":85}', status: 'ok' }] } }
  ] };
  await open(page, state);
  const block = page.locator('.pi-terminal');
  await expect(block.locator('.terminal-output')).toHaveText(output);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const colors = await block.evaluate(node => {
      const { backgroundColor: surface, borderTopWidth: border } = getComputedStyle(node);
      const ink = selector => { const token = node.querySelector(selector); return token && getComputedStyle(token).color; };
      return { surface, border, base: getComputedStyle(node).color,
        args: ['.property', '.string', '.literal'].map(c => ink('li ' + c)), keyword: ink('.terminal-output .keyword'), string: ink('.terminal-output .string') };
    });
    expect(colors.surface).toBe('rgba(0, 0, 0, 0)');
    expect(colors.border).toBe('0px');
    expect(colors.args).not.toContain(null);
    expect(new Set([...colors.args, colors.base]).size).toBe(4);
    expect(colors.keyword).toBeTruthy(); expect(colors.string).toBeTruthy();
    expect(new Set([colors.keyword, colors.string, colors.base]).size).toBe(3);
    await capture(page, 'terminal-syntax-' + scheme);
  }
});

test('runs without traces show their recorded output without inferring calls or merging neighboring tools', async ({ page }) => {
  const state = { id: 'history', title: 'Saved work', cwd: '/project', status: 'idle', tools: [], messages: [
    result('orphan', 'Output without script'),
    { id: 'calls', role: 'assistant', toolCalls: [
      { id: 'read', name: 'read', text: '{"path":"web/app.js"}' },
      call('saved', 'await tools.read({path:"never-called"});'),
      { id: 'bash', name: 'bash', text: '{"command":"pwd"}' }
    ] }, result('saved', 'Earlier output\n2\n3\n4\n5\n6', 0, 12000)
  ] };
  await open(page, state);
  const block = page.locator('.pi-terminal[data-tool-id="saved"]');
  await expect(block.locator('li')).toHaveCount(0);
  await expect(block.getByText(/never-called/)).toBeHidden();
  await expect(block.locator('.terminal-output').first()).toBeVisible();
  await block.getByText('… 1 more line').click();
  await expect(block.locator('.terminal-output').last()).toHaveText('6');
  await expect(page.locator('[data-tool-id="orphan"]')).not.toContainText('View code');
  await expect(page.locator('.tool-activity')).toHaveCount(2);
});
