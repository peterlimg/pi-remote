import { test, expect } from '@playwright/test';

test('reasoning uses the model picker interaction and preserves drafts and session scoping', async ({ page, browserName }, testInfo) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/project', status: 'idle',
    model: 'anthropic/claude-sonnet-4-6', thinkingLevel: id === 'Alpha' ? 'high' : 'off', messages: [] }));
  const commands = [];
  let finish, finishModels, client, version = 0;
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
      else if (p.op === 'models') finishModels = () => reply({ current: states[0].model, models: [{ provider: 'anthropic', id: 'claude-sonnet-4-6' }] });
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
  const effort = page.getByRole('button', { name: 'Reasoning effort', exact: true });
  const picker = page.getByRole('region', { name: 'Choose reasoning effort' });
  await page.locator('#prompt').fill('Keep this draft');
  await expect(effort).toHaveText('High');
  await expect(page.locator('#composer select')).toHaveCount(0);
  await expect(effort).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  await effort.tap();
  await expect(effort).toHaveAttribute('aria-expanded', 'true');
  await expect(effort).toHaveCSS('outline-style', 'none');
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('HighCurrent');
  await expect(picker.getByRole('button')).toHaveCount(8);
  await expect(page.getByRole('searchbox', { name: 'Search models' })).toBeHidden();
  const menuBounds = await picker.boundingBox(), composerBounds = await page.locator('#composer').boundingBox();
  expect(Math.abs(menuBounds.x - composerBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(menuBounds.width - composerBounds.width)).toBeLessThanOrEqual(2);
  expect(menuBounds.y + menuBounds.height).toBeLessThan(composerBounds.y);
  await page.screenshot({ path: testInfo.outputPath('reasoning-picker-mobile.png') });
  await picker.getByRole('button', { pressed: true }).click();
  await expect(picker).toBeHidden();
  expect(commands).toHaveLength(0);
  await effort.click();
  await page.getByRole('button', { name: 'Close reasoning picker' }).click();
  await expect(effort).toBeFocused();
  await expect(effort).toHaveAttribute('aria-expanded', 'false');
  await effort.click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(effort).toBeFocused();
  await page.locator('#model').focus();
  // WebKit follows macOS's Option-Tab navigation for buttons.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(effort).toBeFocused();
  await expect(effort).toHaveCSS('outline-style', 'solid');
  await effort.press('Enter');
  await page.locator('#title').click();
  await expect(picker).toBeHidden();
  await page.locator('#model').click();
  await expect(page.getByRole('region', { name: 'Choose a model' })).toBeVisible();
  await expect.poll(() => !!finishModels).toBe(true);
  await effort.click();
  finishModels();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('HighCurrent');
  await expect(page.locator('#model')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#model').click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole('searchbox', { name: 'Search models' })).toBeVisible();
  await effort.click();
  await picker.getByRole('button', { name: 'Max', exact: true }).click();
  await expect(effort).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Low', exact: true })).toBeDisabled();
  await expect.poll(() => commands.length).toBe(1);
  finish();
  await expect(picker).toBeHidden();
  await expect(effort).toBeFocused();
  await expect(effort).toHaveText('High');
  await expect(page.locator('#notice')).toContainText('high reasoning instead of max');
  await effort.click();
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('HighCurrent');
  await picker.getByRole('button', { name: 'Minimal', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  finish('Unsupported command');
  await expect(effort).toBeEnabled();
  await expect(effort).toHaveText('High');
  await expect(picker).toContainText('/reload');
  await picker.getByRole('button', { name: 'Low', exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(picker).toBeHidden();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(effort).toHaveText('Off');
  finish();
  await expect(effort).toHaveText('Off');
  await expect(page.locator('#notice')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(effort).toHaveText('Low');
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await effort.click();
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('LowCurrent');
  await page.setViewportSize({ width: 390, height: 350 });
  await expect.poll(async () => (await picker.boundingBox()).y).toBeGreaterThanOrEqual(0);
  expect(await page.locator('#picker-options').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await picker.getByRole('button', { name: 'Close reasoning picker' }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await effort.press('Enter');
  await expect(picker).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reasoning-picker-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(effort).toBeFocused();
  states[0].thinkingLevel = 'off'; snapshot(states[0]);
  await expect(effort).toHaveText('Off');
  await effort.click();
  states[0].status = 'saved'; snapshot(states[0]);
  await expect(effort).toBeDisabled();
  await expect(picker).toBeHidden();
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual(
    ['max', 'minimal', 'low'].map(level => ({ sessionId: 'Alpha', command: { type: 'setThinkingLevel', level } })));
});
