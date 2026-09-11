import { test, expect } from '@playwright/test';

test('mobile navigation preserves drafts and sends to the selected session', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('#connection')).toContainText('Computer connected');
  await expect(page.locator('#sessions .session')).toHaveCount(2);
  await expect(page.locator('#diagnostics')).toBeVisible();
  await expect(page.locator('#warnings-summary')).toHaveText('20 scan warnings');
  await expect(page.locator('#warnings')).toBeHidden();
  await expect(page.locator('#notice')).toBeHidden();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Alpha');
  await expect(page.locator('#composer select')).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
  await page.locator('#prompt').fill('draft for alpha');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Beta');
  await expect(page.locator('#prompt')).toHaveValue('');
  await page.locator('#prompt').fill('instruction for beta');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('instruction for beta');
  await page.locator('#back').click();
  await expect(page.locator('#diagnostics')).toBeHidden();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#prompt')).toHaveValue('draft for alpha');
  await expect(page.locator('#transcript')).not.toContainText('instruction for beta');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(new URL(page.url()).hash).toBe('');
  await page.screenshot({ path: 'test-results/mobile-session.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('conversation renders safe Markdown and keeps tool output collapsed across updates', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('.message-text strong')).toHaveText('The relay is ready.');
  await expect(page.locator('.message-text pre code')).toHaveText('npm test\n');
  await expect(page.locator('.message-text li')).toHaveCount(2);
  await expect(page.locator('#transcript script, #transcript img, #transcript a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  const tool = page.locator('#transcript details.tool');
  await expect(tool).toHaveCount(1);
  await expect(tool.locator('summary')).toContainText('read');
  await expect(tool.locator('.tool-context')).toHaveText('render.yaml:10-29');
  await expect(tool.locator('.tool-status')).toBeHidden();
  await expect(tool.locator('.tool-output')).not.toBeVisible();
  await expect(page.locator('#tools, .message-label')).toHaveCount(0);
  await expect(page.locator('#composer-hint')).toBeHidden();
  expect((await page.locator('.conversation-header').boundingBox()).height).toBeLessThan(80);
  await tool.locator('summary').click();
  await expect(tool.locator('.tool-output')).toBeVisible();
  await page.locator('#prompt').fill('Keep the tool expanded');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Keep the tool expanded');
  await expect(tool.locator('.tool-output')).toBeVisible();
  await tool.locator('summary').click();
  await expect(page.locator('#abort')).toBeHidden();
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Beta');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/quiet-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#sidebar')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/quiet-desktop.png', fullPage: true });
});

test('tool summaries show context and a short shell tail without losing full details', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Beta/ }).click();
  const shell = page.locator('[data-tool-id="run-checks"]');
  await expect(shell.locator('.tool-context')).toHaveText('npm run check && npm test');
  await expect(shell.locator('.tool-preview')).toContainText('44 earlier lines');
  await expect(shell.locator('.tool-preview-text')).toHaveText('108 tests passed\n0 failed\nTypeScript passed\nLint passed\nWorking tree clean');
  await expect(shell.locator('.tool-input')).toBeHidden();
  await expect(shell.locator('.tool-output')).toBeHidden();
  const read = page.locator('[data-tool-id="read-source"]');
  await expect(read.locator('.tool-context')).toHaveText('src/server/api/routers/history/bets.ts:270-386');
  await expect(read.locator('.tool-output')).toBeHidden();
  await expect(read.locator('.tool-preview')).toHaveCount(0);
  await shell.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(shell.locator('.tool-preview')).toBeHidden();
  await expect(shell.locator('.tool-output')).toContainText('check 1: passed');
  await expect(shell.locator('.tool-input')).toContainText('"timeout": 120');
  await page.locator('#prompt').fill('Keep the shell expanded');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Keep the shell expanded');
  await expect(shell.locator('.tool-output')).toBeVisible();
  await shell.locator('summary').click();
  await shell.scrollIntoViewIfNeeded();
  expect((await read.boundingBox()).height).toBeLessThan(65);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/compact-tools-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await shell.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/compact-tools-desktop.png', fullPage: true });
});

test('streaming tool input, errors and shortened output stay readable and safe', async ({ page }) => {
  let client;
  const state = { id: 'stream', title: 'Streaming tools', cwd: '/project', status: 'working', messages: [
    { id: 'calls', role: 'assistant', toolCalls: [
      { id: 'partial', name: 'read', text: '{"path":' },
      { id: 'null', name: 'custom', text: 'null' },
      { id: 'safe', name: 'read', text: JSON.stringify({ path: '<img onerror=window.injected=true>', limit: 3 }) },
      { id: 'shell', name: 'bash', text: '{"command":"npm test"}' }
    ] }
  ], tools: [{ id: 'shell', name: 'bash', status: 'working', text: 'Checking…' }] };
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Streaming tools/ }).click();
  await expect(page.locator('.tool')).toHaveCount(4);
  await expect(page.locator('[data-tool-id="safe"] .tool-context')).toHaveText('<img onerror=window.injected=true>:1-3');
  await expect(page.locator('#transcript img')).toHaveCount(0);
  const shell = page.locator('[data-tool-id="shell"]');
  await expect(shell.locator('.tool-status')).toHaveText('working');
  await expect(shell.locator('.tool-preview')).toHaveText('Checking…');
  state.messages.push({ id: 'failed', role: 'toolResult', toolCallId: 'shell', text: 'Tests failed', isError: true, truncated: true });
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 2, state }));
  await expect(shell.locator('.tool-status')).toHaveText('error');
  await expect(shell.locator('.tool-preview')).toContainText('Output shortened for mobile.');
  await shell.locator('summary').click();
  await expect(shell.locator('.tool-output')).toHaveText('Tests failed');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('desktop Enter sends, Shift+Enter adds a line and Alt+Enter queues a follow-up', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  const page = await context.newPage(), commands = [];
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString());
    if (packet.op === 'command') commands.push(packet.command);
  }));
  try {
    await page.goto('http://127.0.0.1:8799/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    const prompt = page.locator('#prompt');
    await expect(page.locator('#send')).toBeEnabled();
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    await prompt.fill('first line');
    await prompt.press('Shift+Enter');
    await expect(prompt).toHaveValue('first line\n');
    expect(commands).toHaveLength(0);
    await prompt.press('Enter');
    await expect.poll(() => commands.length).toBe(1);
    await expect(prompt).toHaveValue('');
    await prompt.fill('next turn');
    await prompt.press('Alt+Enter');
    await expect(prompt).toHaveValue('');
    expect(commands).toEqual([{ type: 'prompt', text: 'first line\n' }, { type: 'followUp', text: 'next turn' }]);
    await expect(page.locator('#composer select')).toHaveCount(0);
    await prompt.fill('normal message');
    await page.locator('#send').click();
    await expect(prompt).toHaveValue('');
    expect(commands.at(-1)).toEqual({ type: 'prompt', text: 'normal message' });
  } finally { await context.close(); }
});
