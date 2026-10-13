import { test, expect } from '@playwright/test';
import { cleanMessage } from '../../src/catalog.mjs';
import { summary } from '../../src/state.mjs';

for (const oldHost of [false, true]) test(`skills keep labels, titles and requests readable with ${oldHost ? 'old' : 'current'} hosts`, async ({ page }, testInfo) => {
  const skill = (name, body = 'Private skill instructions') => `<skill name="${name}" location="/private/skills/${name}/SKILL.md">\n${body}\n</skill>`;
  const ordinary = 'Explain this tag: ' + skill('example');
  const malformed = '<skill name="unfinished" location="/private/SKILL.md">\nKeep this incomplete message';
  const state = { id: 'skills', title: skill('code-review').replace(/\s+/g, ' ').slice(0, 79) + '…', cwd: '/project', status: 'idle', messages: [
    cleanMessage({ role: 'user', content: skill('code-review') + '\n\nReview PR #26' }, 'review'),
    cleanMessage({ role: 'user', content: skill('debug') + '\n\nFind the failing test.' }, 'with-request'),
    cleanMessage({ role: 'user', content: skill('long-skill', 'Private skill instructions\n'.repeat(1500)) }, 'truncated'),
    cleanMessage({ role: 'user', content: ordinary }, 'ordinary'),
    cleanMessage({ role: 'user', content: malformed }, 'malformed'),
    cleanMessage({ role: 'assistant', content: skill('assistant-example') }, 'assistant')
  ], tools: [] };
  expect(state.messages[2].truncated).toBe(true);
  await page.routeWebSocket('**/ws', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        const listed = summary(state);
        if (oldHost) Object.assign(listed, { title: state.title,
          preview: skill('code-review').replace(/\s+/g, ' ').slice(0, 159), previewRole: 'user' });
        ws.send(JSON.stringify({ type: 'sessions', sessions: [listed] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      }
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('.session strong')).toHaveText(oldHost ? 'Skill: code-review' : 'Review PR #26');
  if (oldHost) await expect(page.locator('.session-preview')).toHaveText('You: Skill: code-review');
  await page.locator('.session').click();
  const labels = page.locator('.skill-loaded');
  const verify = async () => {
    await expect(labels).toHaveText(['Loaded skill: code-review', 'Loaded skill: debug', 'Loaded skill: long-skill']);
    await expect(page.locator('#title')).toHaveText('Review PR #26');
    await expect(page.locator('.message.user .message-text')).toHaveText(['Review PR #26', 'Find the failing test.', ordinary, malformed]);
    await expect(page.locator('.message.assistant')).toContainText('assistant-example');
    await expect(page.locator('#transcript')).not.toContainText('(empty message)');
    await expect(page.locator('#transcript')).not.toContainText('Message shortened for mobile.');
    await expect(page.locator('#transcript > :first-child')).toHaveText('Loaded skill: code-review');
  };
  await verify();
  await page.reload();
  await page.locator('.session').click();
  await verify();
  for (const [width, colorScheme] of [[390, 'light'], [320, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    const style = await labels.first().evaluate(node => ({ color: getComputedStyle(node).color,
      normal: getComputedStyle(document.querySelector('.message-text')).color,
      height: node.getBoundingClientRect().height }));
    expect(style.color).not.toBe(style.normal);
    expect(style.height).toBeLessThan(30);
    expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await labels.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`skills-${width}.png`) });
  }
});
