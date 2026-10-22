import { test, expect } from '@playwright/test';

test('each Pi reply has a copy button that copies its markdown', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const state = { id: 'Alpha', title: 'Alpha', cwd: '/project', status: 'idle', messages: [
    { id: 'u', role: 'user', text: 'Explain' },
    { id: 'a1', role: 'assistant', text: 'First **reply** with `code`.' },
    { id: 'a2', role: 'assistant', text: 'Second reply.' }
  ] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const p = JSON.parse(raw);
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else {
      if (p.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
    }
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Alpha/ }).click();
  const copies = page.getByRole('button', { name: 'Copy message' });
  await expect(copies).toHaveCount(2); // Not on the user's own message.
  await copies.first().click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('First **reply** with `code`.');
  await expect(copies).toHaveCount(2);
});

test('code blocks copy only their source, remain safe and report clipboard failures', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const shell = 'npm run check && npm test\n';
  const source = '<script>window.injected=true</script>\n' + 'a'.repeat(180) + '\n';
  const text = 'Run this `command`:\n\n```sh\n' + shell + '```\n\n```\n' + source + '```';
  const state = { id: 'code', title: 'Copy commands', cwd: '/project', status: 'idle', messages: [
    { id: 'reply', role: 'assistant', text }
  ] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const p = JSON.parse(raw);
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else {
      if (p.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
    }
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Copy commands/ }).click();
  const blocks = page.locator('.code-block'), copy = blocks.first().getByRole('button');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first().locator('.code-header')).toContainText('sh');
  await expect(blocks.first().locator('pre')).toHaveAttribute('tabindex', '0');
  await copy.tap();
  await expect(copy).toHaveAccessibleName('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shell);
  await expect(page.locator('#copy-status')).toHaveText('Code copied.');
  await expect(copy).toHaveAccessibleName('Copy code');
  await blocks.last().getByRole('button', { name: 'Copy code' }).press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await page.getByRole('button', { name: 'Copy message' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await blocks.last().locator('pre').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('copy-code-mobile.png') });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw new Error('Clipboard denied'); }
  } }));
  await copy.press('Enter');
  await expect(page.locator('#notice')).toHaveText('Could not copy. Select the text and copy it manually.');
  await expect(copy).toHaveAccessibleName('Copy code');
});
