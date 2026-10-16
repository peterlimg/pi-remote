import { test, expect } from '@playwright/test';

const url = '/#token=browser-test-token-only-123456789012345';
const projects = ['beta', 'alpha'].map(name => ({ cwd: '/Users/me/' + name, sessionId: name }));
const state = { id: 'beta', title: 'Old task', cwd: projects[0].cwd, status: 'idle', messages: [] };
const reply = ({ ws, packet }, value, error) => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: !error, value, error }));

// Delay only the host's project replies so browser caching cannot hide behind a fast fixture.
test('cached projects stay usable while the picker refreshes', async ({ page }, testInfo) => {
  const requests = [], starts = [];
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'projects') {
        requests.push({ ws, packet });
        if (requests.length === 1) reply(requests[0], projects);
      } else if (packet.op === 'new') starts.push({ ws, packet });
    });
  });
  await page.goto(url);
  const open = () => page.getByRole('button', { name: 'New session', exact: true }).tap();
  const picker = page.getByRole('dialog', { name: 'New session in…' });
  const names = picker.locator('.project-option-name'), status = picker.locator('#project-status');
  const close = () => picker.getByRole('button', { name: 'Close', exact: true }).tap();
  await open();
  await expect(names).toHaveText(['beta', 'alpha']);
  await close();
  await open();
  await expect(names).toHaveText(['beta', 'alpha'], { timeout: 1000 });
  await expect(status).toBeEmpty();
  // Closing and reopening during a pending refresh must not send duplicate requests.
  await close();
  await open();
  await expect(names).toHaveText(['beta', 'alpha']);
  expect(requests).toHaveLength(2);
  await picker.getByRole('searchbox', { name: 'Search projects' }).fill('gam');
  await expect(status).toHaveText('No matching projects');
  reply(requests.at(-1), [projects[0], { cwd: '/Users/me/gamma', sessionId: 'gamma' }]);
  await expect(names).toHaveText(['gamma']);
  await expect(status).toBeEmpty();
  await picker.getByRole('searchbox', { name: 'Search projects' }).fill('');
  await expect(names).toHaveText(['beta', 'gamma']);
  await close();
  await open();
  await expect.poll(() => requests.length).toBe(3);
  await picker.locator('.project-option').first().focus();
  reply(requests.at(-1), projects);
  await expect(picker.locator('.project-option').first()).toBeFocused();
  await close();
  await open();
  await expect.poll(() => requests.length).toBe(4);
  reply(requests.at(-1), undefined, 'Project refresh failed');
  await expect(names).toHaveText(['beta', 'alpha']);
  await expect(status).toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath('cached-projects-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('cached-projects-desktop.png') });
  await close();
  await open();
  await expect.poll(() => requests.length).toBe(5);
  await picker.locator('.project-option').first().click();
  await expect(status).toHaveText('Starting session…');
  // A refresh arriving during creation must not replace or re-enable the buttons.
  reply(requests.at(-1), projects);
  await expect(picker.locator('.project-option').first()).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Start without a project' })).toBeDisabled();
  await expect(status).toHaveText('Starting session…');
  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0].packet.sessionId).toBe('beta');
  reply(starts[0], undefined, 'Session start failed');
  await expect(status).toHaveText('Session start failed');
  await expect(picker.locator('.project-option').first()).toBeEnabled();
});

test('project prefetch survives dismissal and reconnect, but clears on sign out', async ({ page }) => {
  const requests = [];
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'projects') requests.push({ ws, packet });
    });
  });
  await page.goto(url);
  await expect.poll(() => requests.length).toBe(1); // Prefetch before the first tap.
  const open = () => page.getByRole('button', { name: 'New session', exact: true }).tap();
  const picker = page.getByRole('dialog', { name: 'New session in…' });
  const names = picker.locator('.project-option-name'), status = picker.locator('#project-status');
  const close = () => picker.getByRole('button', { name: 'Close', exact: true }).tap();
  await open();
  await expect(status).toHaveText('Loading projects…');
  await close();
  expect(requests).toHaveLength(1);
  reply(requests[0], projects);
  await open();
  await expect(names).toHaveText(['beta', 'alpha']);
  await close();
  await open();
  await expect.poll(() => requests.length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => requests.length).toBe(3);
  await expect(names).toHaveText(['beta', 'alpha']);
  await expect(status).toBeEmpty();
  await close();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Private login link').fill('browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect.poll(() => requests.length).toBe(4);
  await open();
  await expect(names).toHaveCount(0);
  await expect(status).toHaveText('Loading projects…');
  reply(requests[3], undefined, 'Projects unavailable');
  await expect(status).toHaveText('Projects unavailable');
  await close();
  await open();
  await expect.poll(() => requests.length).toBe(5);
  reply(requests[4], []);
  await expect(status).toHaveText('No projects yet.');
  await close();
  await open();
  await expect(status).toHaveText('No projects yet.');
  await expect(picker.getByRole('button', { name: 'Start without a project' })).toBeEnabled();
});
