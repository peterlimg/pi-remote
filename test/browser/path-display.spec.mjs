import { test, expect } from '@playwright/test';

test('home paths hide usernames in tool labels, details and project locations', async ({ page }) => {
  const state = { id: 'paths', title: 'Private paths', cwd: '/Users/local-user/workspace/project', status: 'working', updatedAt: Date.now() - 5 * 60000,
    preview: 'Read /Users/local-user/workspace/project/notes.md', messages: [
    { id: 'calls', role: 'assistant', toolCalls: [
      { id: 'external', name: 'read', text: JSON.stringify({ path: '/Users/local-user/.pi/agent/skills/SKILL.md', offset: 1 }) },
      { id: 'relative', name: 'read', text: JSON.stringify({ path: '/Users/local-user/workspace/project/src/app.js', offset: 3, limit: 2 }) },
      { id: 'linux', name: 'read', text: JSON.stringify({ path: '/home/linux-user/.agents/SKILL.md' }) },
      { id: 'home', name: 'read', text: JSON.stringify({ path: '/Users/local-user', offset: 1 }) },
      { id: 'system', name: 'read', text: JSON.stringify({ path: '/etc/hosts' }) },
      { id: 'shell', name: 'bash', text: JSON.stringify({ command: 'ls /Users/local-user/.pi && ls "/home/linux-user/.agents"' }) }
    ] },
    { id: 'result', role: 'toolResult', toolCallId: 'external', text: 'Loaded /Users/local-user/.pi/agent/skills/SKILL.md' }
  ], tools: [{ id: 'shell', name: 'bash', status: 'working', text: '/Users/local-user\n/home/linux-user/.agents\n/var/log/system.log' }] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else if (packet.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
    }
    if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('.session-project')).toHaveAttribute('title', '~/workspace/project');
  await expect(page.locator('.session-preview')).toHaveText('Pi: Read ~/workspace/project/notes.md');
  await expect(page.locator('.session-time')).toHaveText('5m');
  await page.locator('.session').click();
  await page.locator('.session-info summary').click();
  await expect(page.locator('#project')).toHaveText('~/workspace/project');
  await page.locator('.session-info summary').click();
  for (const [id, text] of [
    ['external', '~/.pi/agent/skills/SKILL.md:1'], ['relative', 'src/app.js:3-4'],
    ['linux', '~/.agents/SKILL.md'], ['home', '~:1'], ['system', '/etc/hosts'],
    ['shell', 'ls ~/.pi && ls "~/.agents"']
  ]) {
    const label = page.locator(`[data-tool-id="${id}"] .tool-context`);
    await expect(label).toHaveText(text);
    await expect(label).toHaveAttribute('title', text);
  }
  await page.locator('.tool-activity > summary').click();
  const external = page.locator('[data-tool-id="external"]');
  await external.locator('summary').click();
  await expect(external.locator('.tool-input')).toContainText('"path":"~/.pi/agent/skills/SKILL.md"');
  await expect(external.locator('.tool-output')).toHaveText('Loaded ~/.pi/agent/skills/SKILL.md');
  const shell = page.locator('[data-tool-id="shell"]');
  await shell.locator('summary').click();
  await expect(shell.locator('.tool-output')).toHaveText('~\n~/.agents\n/var/log/system.log');
  await expect(page.locator('#transcript')).not.toContainText(/local-user|linux-user/);
});
