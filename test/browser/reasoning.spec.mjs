import { test, expect } from '@playwright/test';

test('separate model and effort controls preserve one-tap selection, drafts and session scoping', async ({ page }, testInfo) => {
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
      else if (p.op === 'models') finishModels = () => reply({ current: states[0].model,
        models: [{ provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }] });
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
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const model = page.locator('#model'), effort = page.getByRole('button', { name: 'Reasoning effort', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Model settings' });
  const picker = page.getByRole('region', { name: 'Choose reasoning effort' });
  await page.locator('#prompt').fill('Keep this draft');
  await expect(model).toHaveAccessibleName('Switch model: claude-sonnet-4-6');
  await expect(effort).toBeVisible();
  await expect(effort).toHaveText('High');
  const modelBounds = await model.boundingBox(), effortBounds = await effort.boundingBox();
  expect(modelBounds.y).toBe(effortBounds.y);
  expect(modelBounds.x + modelBounds.width).toBeLessThanOrEqual(effortBounds.x);
  await effort.tap(); // Effort must open directly, without visiting the model list.
  await expect(effort).toHaveAttribute('aria-expanded', 'true');
  await expect(model).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog).toBeFocused();
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('HighCurrent');
  await expect(page.getByRole('searchbox', { name: 'Search models' })).toBeHidden();
  const bounds = await picker.boundingBox();
  expect(bounds.x).toBe(0);
  expect(bounds.width).toBe(page.viewportSize().width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({ path: testInfo.outputPath('reasoning-sheet-mobile.png') });
  await picker.getByRole('button', { pressed: true }).click();
  await expect(dialog).toBeHidden();
  expect(commands).toHaveLength(0);
  await model.tap();
  await expect.poll(() => !!finishModels).toBe(true);
  await page.keyboard.press('Escape');
  await expect(model).toBeFocused();
  await effort.tap();
  finishModels(); // A late model response cannot replace the reasoning picker.
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('HighCurrent');
  await page.getByRole('button', { name: 'Close reasoning picker' }).press('Enter');
  await expect(effort).toBeFocused();
  await expect(effort).toHaveAttribute('aria-expanded', 'false');
  await effort.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(effort).toBeFocused();
  await effort.click();
  await picker.getByRole('button', { name: 'Max', exact: true }).press('Enter');
  await expect(effort).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Low', exact: true })).toBeDisabled();
  await expect.poll(() => commands.length).toBe(1);
  finish();
  await expect(dialog).toBeHidden();
  await expect(effort).toBeFocused();
  await expect(effort).toHaveText('High');
  await expect(page.locator('#notice')).toContainText('high reasoning instead of max');
  await effort.click();
  await picker.getByRole('button', { name: 'Minimal', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  finish('Unsupported command');
  await expect(effort).toBeEnabled();
  await expect(picker).toContainText('/reload');
  await picker.getByRole('button', { name: 'Low', exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show sessions' }).click();
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
  await page.setViewportSize({ width: 320, height: 350 });
  await expect.poll(async () => (await picker.boundingBox()).y).toBeGreaterThanOrEqual(0);
  await expect.poll(() => page.locator('#picker-options').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.matches(':modal'))).toBe(false);
  const menuBounds = await picker.boundingBox(), composerBounds = await page.locator('#composer').boundingBox();
  expect(Math.abs(menuBounds.x - composerBounds.x)).toBeLessThanOrEqual(1);
  expect(menuBounds.width).toBeLessThanOrEqual(320);
  expect(menuBounds.y + menuBounds.height).toBeLessThan(composerBounds.y);
  await page.screenshot({ path: testInfo.outputPath('reasoning-menu-desktop-dark.png') });
  await page.keyboard.press('Escape');
  await expect(effort).toBeFocused();
  await effort.click();
  states[0].status = 'saved'; snapshot(states[0]);
  await expect(effort).toBeDisabled();
  await expect(dialog).toBeHidden();
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual(
    ['max', 'minimal', 'low'].map(level => ({ sessionId: 'Alpha', command: { type: 'setThinkingLevel', level } })));
});
