import { test, expect } from '@playwright/test';

const url = '/#token=browser-test-token-only-123456789012345';

test('slash menu filters session commands, completes on touch and keeps arguments', async ({ page }) => {
  const sent = [];
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString());
    if (packet.op === 'command') sent.push(packet.command);
  }));
  await page.goto(url);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const prompt = page.locator('#prompt'), menu = page.getByRole('listbox', { name: 'Pi commands' });
  await prompt.fill('/');
  await expect(menu.getByRole('option')).toHaveCount(5);
  await expect(prompt).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: 'test-results/commands-mobile.png' });
  await prompt.fill('/rvw');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await menu.getByRole('option', { name: /\/review/ }).tap();
  await expect(prompt).toHaveValue('/review ');
  await expect(menu).toBeHidden();
  expect(sent).toHaveLength(0);
  await prompt.pressSequentially('src/app.js');
  await page.locator('#send').click();
  await expect(prompt).toHaveValue('');
  expect(sent).toEqual([{ type: 'prompt', text: '/review src/app.js' }]);
  await prompt.fill('/skill:');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await prompt.press('Escape');
  await expect(menu).toBeHidden();
  await expect(prompt).toHaveValue('/skill:');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await prompt.fill('/');
  await expect(menu.getByRole('option', { name: /\/deploy/ })).toBeVisible();
  await expect(menu.getByRole('option', { name: /\/review/ })).toHaveCount(0);
  await prompt.fill('/does-not-exist');
  await expect(page.locator('#command-help')).toContainText('No matching commands');
  await prompt.fill('Explain /review');
  await expect(menu).toBeHidden();
  await prompt.fill('/settings');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('only available in the Pi terminal');
  await expect(prompt).toHaveValue('/settings');
});

test('slash shortcut opens and reopens commands without sending or replacing a message draft', async ({ page }) => {
  const sent = [];
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString());
    if (packet.op === 'command') sent.push(packet.command);
  }));
  await page.goto(url);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const shortcut = page.getByRole('button', { name: 'Open slash commands' });
  const prompt = page.locator('#prompt'), menu = page.getByRole('listbox', { name: 'Pi commands' });
  await shortcut.tap();
  await expect(prompt).toHaveValue('/');
  await expect(prompt).toBeFocused();
  await expect(shortcut).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('option')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/commands-shortcut-mobile.png' });
  await prompt.press('Escape');
  await expect(shortcut).toHaveAttribute('aria-expanded', 'false');
  await shortcut.tap();
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: /\/review/ }).tap();
  await expect(prompt).toHaveValue('/review ');
  await expect(shortcut).toBeDisabled();
  await prompt.fill('Keep this message');
  await expect(shortcut).toBeDisabled();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await shortcut.tap();
  await expect(menu.getByRole('option', { name: /\/deploy/ })).toBeVisible();
  await expect(menu.getByRole('option', { name: /\/review/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(prompt).toHaveValue('Keep this message');
  expect(sent).toHaveLength(0);
});

test('arrows navigate, Tab completes, Enter runs the selected command, and IME does not submit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: false });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:8799' + url);
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    const prompt = page.locator('#prompt'), menu = page.getByRole('listbox');
    await prompt.fill('/');
    await expect(menu.getByRole('option')).toHaveCount(5);
    await prompt.press('ArrowDown');
    await expect(menu.getByRole('option', { selected: true })).toContainText('/summarize');
    await prompt.press('Tab');
    await expect(prompt).toHaveValue('/summarize ');
    await expect(prompt).toBeFocused();
    await expect(menu).toBeHidden();
    await prompt.fill('/');
    await expect(menu.getByRole('option')).toHaveCount(5);
    await prompt.press('ArrowUp');
    await prompt.press('ArrowUp');
    await prompt.press('ArrowUp');
    await expect(menu.getByRole('option', { selected: true })).toContainText('/skill:debug');
    await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(prompt).toHaveValue('/');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: 'test-results/commands-desktop.png' });
    await prompt.press('Enter');
    await expect(prompt).toHaveValue('');
    await expect(page.locator('#transcript')).toContainText('/skill:debug');
  } finally { await context.close(); }
});

test('/new creates and opens a fresh session from the same project', async ({ page }) => {
  const states = [{ id: 'old', title: 'Old task', cwd: '/project', status: 'idle', messages: [{ role: 'user', text: 'old context' }] }];
  const operations = [];
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(x => x.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: { watching: packet.sessionId } }));
      } else if (packet.op === 'commands') {
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [{ name: 'new', description: 'Start a new session in this project', source: 'remote' }] }));
      } else if (packet.op === 'new') {
        operations.push(packet);
        states.push({ id: 'fresh', title: 'Untitled session', cwd: '/project', status: 'idle', messages: [] });
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: { ok: true, value: { sessionId: 'fresh' } } }));
      }
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Old task/ }).click();
  await page.locator('#prompt').fill('/');
  await page.getByRole('option', { name: /\/new/ }).click();
  await page.locator('#send').click();
  await expect(page.locator('#title')).toHaveText('Untitled session');
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#project')).toHaveText('/project');
  expect(operations).toHaveLength(1);
  expect(operations[0].sessionId).toBe('old');
});

test('late discovery cannot replace another session menu; loading and failure stay explicit', async ({ page }) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/' + id, status: 'idle', messages: [] }));
  const requests = [];
  let client;
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(x => x.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
      } else if (packet.op === 'commands') requests.push(packet);
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Alpha/ }).click();
  await page.locator('#prompt').fill('/');
  await expect(page.locator('#command-help')).toHaveText('Loading commands…');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await page.locator('#prompt').fill('/');
  await expect.poll(() => requests.filter(x => x.sessionId === 'Beta').length).toBe(2);
  for (const packet of requests) client.send(JSON.stringify({ type: 'response', id: packet.id, ok: true,
    value: [{ name: packet.sessionId.toLowerCase(), description: '<img onerror=alert(1)>', source: 'extension' }] }));
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('/beta');
  await expect(page.locator('#command-menu img')).toHaveCount(0);
  const option = await page.getByRole('option').elementHandle();
  client.send(JSON.stringify({ type: 'snapshot', sessionId: 'Beta', version: 1, state: { ...states[1], status: 'working' } }));
  await expect(page.locator('#status')).toHaveText('working');
  expect(await option.evaluate(node => node.isConnected)).toBe(true);
  await page.locator('#prompt').fill('');
  await page.locator('#prompt').fill('/');
  await expect.poll(() => requests.length).toBe(5);
  client.send(JSON.stringify({ type: 'response', id: requests.at(-1).id, ok: false, error: 'Pi disconnected' }));
  await expect(page.locator('#command-help')).toHaveText('Pi disconnected');
  await expect(page.getByRole('option')).toHaveCount(0);
  client.send(JSON.stringify({ type: 'snapshot', sessionId: 'Beta', version: 2, state: { ...states[1], status: 'disconnected' } }));
  await expect(page.locator('#command-menu')).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue('/');
});
