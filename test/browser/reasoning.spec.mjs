import { test, expect } from '@playwright/test';

test('reasoning changes preserve drafts, show applied levels and stay scoped to their session', async ({ page }) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/project', status: 'idle',
    model: 'anthropic/claude-sonnet-4-6', thinkingLevel: id === 'Alpha' ? 'high' : 'off', messages: [] }));
  const commands = [];
  let finish, client, version = 0;
  const snapshot = state => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      const reply = (value, ok = true) => ws.send(JSON.stringify({ type: 'response', id: p.id, ok, ...(ok ? { value } : { error: value }) }));
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (p.op === 'watch') { snapshot(states.find(s => s.id === p.sessionId)); reply({}); }
      else if (p.op === 'commands') reply([]);
      else if (p.op === 'command') {
        commands.push(p);
        finish = error => {
          if (error) { reply(error, false); return; }
          const state = states.find(s => s.id === p.sessionId);
          state.thinkingLevel = p.command.level === 'max' ? 'high' : p.command.level;
          snapshot(state); reply({ thinkingLevel: state.thinkingLevel });
        };
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Alpha/ }).click();
  const effort = page.getByRole('combobox', { name: 'Reasoning effort' });
  await page.locator('#prompt').fill('Keep this draft');
  await expect(page.locator('#model')).toHaveText('claude-sonnet-4-6');
  await expect(effort).toHaveValue('high');
  await page.screenshot({ path: 'test-results/reasoning-mobile.png' });
  await effort.selectOption('max');
  await expect(effort).toBeDisabled();
  await expect.poll(() => commands.length).toBe(1);
  finish();
  await expect(effort).toBeEnabled();
  await expect(effort).toHaveValue('high');
  await expect(page.locator('#notice')).toContainText('high reasoning instead of max');
  await effort.selectOption('minimal');
  await expect.poll(() => commands.length).toBe(2);
  finish('Unsupported command');
  await expect(effort).toBeEnabled();
  await expect(effort).toHaveValue('high');
  await expect(page.locator('#notice')).toContainText('/reload');
  await effort.selectOption('low');
  await expect.poll(() => commands.length).toBe(3);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(effort).toHaveValue('off');
  await expect(effort).toBeEnabled();
  finish();
  await expect(effort).toHaveValue('off');
  await expect(page.locator('#notice')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(effort).toHaveValue('low');
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/reasoning-desktop.png' });
  states[0].thinkingLevel = 'off'; snapshot(states[0]);
  await expect(effort).toHaveValue('off');
  states[0].status = 'saved'; snapshot(states[0]);
  await expect(effort).toBeDisabled();
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual(
    ['max', 'minimal', 'low'].map(level => ({ sessionId: 'Alpha', command: { type: 'setThinkingLevel', level } })));
});
