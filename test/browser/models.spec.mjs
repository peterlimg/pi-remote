import { test, expect } from '@playwright/test';

const url = '/#token=browser-test-token-only-123456789012345';

test('/model switches only the selected session without sending a prompt', async ({ page }) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/project', status: 'idle', model: 'test/first', messages: [] }));
  const commands = [];
  let fail = false;
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      const reply = (value, ok = true) => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok, ...(ok ? { value } : { error: value }) }));
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(s => s.id === packet.sessionId) }));
        reply({});
      } else if (packet.op === 'commands') reply([{ name: 'model', description: 'Switch model for this session', source: 'remote' }]);
      else if (packet.op === 'models') reply({ current: 'test/first', models: [
        { provider: 'test', id: 'first', name: 'First model' }, { provider: 'test', id: 'org/second', name: 'Second model' }
      ] });
      else if (packet.op === 'command') {
        commands.push(packet);
        if (fail) { reply('Model authentication is not configured', false); return; }
        const state = states.find(s => s.id === packet.sessionId);
        state.model = `${packet.command.provider}/${packet.command.modelId}`;
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: commands.length, state }));
        reply({ model: state.model });
      }
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Alpha/ }).click();
  const prompt = page.locator('#prompt'), picker = page.getByRole('form', { name: 'Switch model' });
  await prompt.fill('/model');
  await page.getByRole('option', { name: /\/model/ }).tap();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByLabel('Model for this session')).toHaveValue('test/first');
  await page.getByLabel('Model for this session').selectOption('test/org/second');
  await page.screenshot({ path: 'test-results/model-picker-mobile.png' });
  await page.getByRole('button', { name: 'Switch model', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('#model')).toHaveText('test/org/second');
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual([
    { sessionId: 'Alpha', command: { type: 'setModel', provider: 'test', modelId: 'org/second' } }
  ]);
  await prompt.fill('/model test/first');
  await page.locator('#send').click();
  await expect(page.locator('#model')).toHaveText('test/first');
  await expect(prompt).toHaveValue('');
  fail = true;
  await prompt.fill('/model');
  await page.locator('#send').click();
  await page.getByLabel('Model for this session').selectOption('test/org/second');
  await page.getByRole('button', { name: 'Switch model', exact: true }).click();
  await expect(page.locator('#model-help')).toContainText('authentication');
  await expect(picker).toBeVisible();
  await expect(page.locator('#model')).toHaveText('test/first');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/model-picker-desktop.png' });
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('#model')).toHaveText('test/first');
  expect(commands.every(p => p.command.type === 'setModel' && p.sessionId === 'Alpha')).toBe(true);
});

test('model discovery handles loading, cancellation, stale results, empty lists and errors', async ({ page }) => {
  const state = { id: 'one', title: 'One', cwd: '/project', status: 'idle', messages: [] };
  let client;
  const requests = [];
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (p.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: 'one', version: 0, state }));
        ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true }));
      } else if (p.op === 'commands') ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
      else if (p.op === 'models') requests.push(p);
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /One/ }).click();
  const open = async count => {
    await page.locator('#prompt').fill('/model');
    await page.locator('#send').click();
    await expect.poll(() => requests.length).toBe(count);
  };
  await open(1);
  await expect(page.locator('#model-help')).toHaveText('Loading available models…');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  client.send(JSON.stringify({ type: 'response', id: requests[0].id, ok: true, value: { models: [{ provider: 'stale', id: 'ignored' }] } }));
  await expect(page.locator('#model-picker')).toBeHidden();
  await open(2);
  client.send(JSON.stringify({ type: 'response', id: requests[1].id, ok: true, value: { models: [] } }));
  await expect(page.locator('#model-help')).toContainText('No models available');
  await expect(page.locator('#model-apply')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open(3);
  client.send(JSON.stringify({ type: 'response', id: requests[2].id, ok: false, error: 'Pi disconnected' }));
  await expect(page.locator('#model-help')).toHaveText('Pi disconnected');
});
