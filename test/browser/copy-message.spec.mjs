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
