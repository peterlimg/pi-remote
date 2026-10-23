import { test, expect } from '@playwright/test';

test('one model trigger opens a phone sheet for model and effort without losing drafts or session scoping', async ({ page }, testInfo) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/project', status: 'idle',
    model: 'anthropic/claude-sonnet-4-6', thinkingLevel: id === 'Alpha' ? 'high' : 'off', messages: [] }));
  const commands = [];
  let finish, finishModels, client, version = 0, deferModels = true;
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
      else if (p.op === 'models') {
        const respond = () => reply({ current: states.find(s => s.id === p.sessionId).model,
          models: [{ provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }] });
        if (deferModels) { finishModels = respond; deferModels = false; } else respond();
      } else if (p.op === 'command') {
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
  const model = page.locator('#model'), effort = page.getByRole('button', { name: 'Reasoning effort', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Model settings' });
  const picker = page.getByRole('region', { name: 'Choose reasoning effort' });
  const openEffort = async () => { await model.click(); await effort.click(); };
  await page.locator('#prompt').fill('Keep this draft');
  await expect(page.locator('#model-effort')).toHaveText('High');
  await expect(model).toHaveAccessibleName('Switch model: claude-sonnet-4-6, High reasoning');
  await expect(effort).toBeHidden();
  await model.tap();
  await expect(model).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog).toBeFocused(); // Opening by touch must not summon the keyboard.
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await expect(effort).toContainText('High');
  await effort.tap();
  await expect.poll(() => !!finishModels).toBe(true);
  finishModels(); // A late model response cannot replace the reasoning page.
  await expect(picker.getByRole('button', { pressed: true })).toHaveText('HighCurrent');
  await expect(page.getByRole('searchbox', { name: 'Search models' })).toBeHidden();
  const bounds = await picker.boundingBox();
  expect(bounds.x).toBe(0);
  expect(bounds.width).toBe(page.viewportSize().width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({ path: testInfo.outputPath('reasoning-sheet-mobile.png') });
  await page.getByRole('button', { name: 'Back to models' }).click();
  await expect(page.getByRole('region', { name: 'Choose a model' })).toBeVisible();
  await expect(effort).toBeVisible();
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await effort.click();
  await picker.getByRole('button', { pressed: true }).click();
  await expect(dialog).toBeHidden();
  expect(commands).toHaveLength(0);
  await openEffort();
  await page.getByRole('button', { name: 'Close reasoning picker' }).press('Enter');
  await expect(model).toBeFocused();
  await expect(model).toHaveAttribute('aria-expanded', 'false');
  await openEffort();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(model).toBeFocused();
  await openEffort();
  await picker.getByRole('button', { name: 'Max', exact: true }).press('Enter');
  await expect(model).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Low', exact: true })).toBeDisabled();
  await expect.poll(() => commands.length).toBe(1);
  finish();
  await expect(dialog).toBeHidden();
  await expect(model).toBeFocused();
  await expect(page.locator('#model-effort')).toHaveText('High');
  await expect(page.locator('#notice')).toContainText('high reasoning instead of max');
  await openEffort();
  await picker.getByRole('button', { name: 'Minimal', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  finish('Unsupported command');
  await expect(model).toBeEnabled();
  await expect(picker).toContainText('/reload');
  await picker.getByRole('button', { name: 'Low', exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(page.locator('#model-effort')).toHaveText('Off');
  finish();
  await expect(page.locator('#model-effort')).toHaveText('Off');
  await expect(page.locator('#notice')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(page.locator('#model-effort')).toHaveText('Low');
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await openEffort();
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
  await expect(model).toBeFocused();
  await openEffort();
  states[0].status = 'saved'; snapshot(states[0]);
  await expect(model).toBeDisabled();
  await expect(dialog).toBeHidden();
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual(
    ['max', 'minimal', 'low'].map(level => ({ sessionId: 'Alpha', command: { type: 'setThinkingLevel', level } })));
});
