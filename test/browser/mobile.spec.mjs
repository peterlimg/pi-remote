import { test, expect } from '@playwright/test';

test('mobile navigation preserves drafts and sends to the selected session', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('#connection')).toContainText('Computer connected');
  await expect(page.locator('#sessions .session')).toHaveCount(2);
  await expect(page.locator('#diagnostics')).toBeVisible();
  await expect(page.locator('#warnings-summary')).toHaveText('20 scan warnings');
  await expect(page.locator('#warnings')).toBeHidden();
  await expect(page.locator('#notice')).toBeHidden();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Alpha');
  await expect(page.locator('#transcript')).toContainText('Working on Project Alpha');
  await page.locator('#prompt').fill('draft for alpha');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Beta');
  await expect(page.locator('#prompt')).toHaveValue('');
  await page.locator('#prompt').fill('instruction for beta');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('instruction for beta');
  await page.locator('#back').click();
  await expect(page.locator('#diagnostics')).toBeHidden();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#prompt')).toHaveValue('draft for alpha');
  await expect(page.locator('#transcript')).not.toContainText('instruction for beta');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(new URL(page.url()).hash).toBe('');
  await page.screenshot({ path: 'test-results/mobile-session.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('conversation renders safe Markdown and keeps tool output collapsed across updates', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('.message-text strong')).toHaveText('The relay is ready.');
  await expect(page.locator('.message-text pre code')).toHaveText('npm test\n');
  await expect(page.locator('.message-text li')).toHaveCount(2);
  await expect(page.locator('#transcript script, #transcript img, #transcript a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  const tool = page.locator('#transcript details.tool');
  await expect(tool).toHaveCount(1);
  await expect(tool.locator('summary')).toContainText('read');
  await expect(tool.locator('.tool-output')).not.toBeVisible();
  await expect(page.locator('#tools, .message-label')).toHaveCount(0);
  await expect(page.locator('#composer-hint')).toBeHidden();
  expect((await page.locator('.conversation-header').boundingBox()).height).toBeLessThan(80);
  await tool.locator('summary').click();
  await expect(tool.locator('.tool-output')).toBeVisible();
  await page.locator('#prompt').fill('Keep the tool expanded');
  await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Keep the tool expanded');
  await expect(tool.locator('.tool-output')).toBeVisible();
  await tool.locator('summary').click();
  await expect(page.locator('#abort')).toBeHidden();
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Beta');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/quiet-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#sidebar')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/quiet-desktop.png', fullPage: true });
});

test('desktop Enter sends, Shift+Enter adds a line and Alt+Enter queues a follow-up', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  const page = await context.newPage(), commands = [];
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString());
    if (packet.op === 'command') commands.push(packet.command);
  }));
  try {
    await page.goto('http://127.0.0.1:8799/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    const prompt = page.locator('#prompt');
    await expect(page.locator('#send')).toBeEnabled();
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    await prompt.fill('first line');
    await prompt.press('Shift+Enter');
    await expect(prompt).toHaveValue('first line\n');
    expect(commands).toHaveLength(0);
    await prompt.press('Enter');
    await expect.poll(() => commands.length).toBe(1);
    await expect(prompt).toHaveValue('');
    await prompt.fill('next turn');
    await prompt.press('Alt+Enter');
    await expect(prompt).toHaveValue('');
    expect(commands).toEqual([{ type: 'prompt', text: 'first line\n' }, { type: 'followUp', text: 'next turn' }]);
    await expect(page.locator('#mode')).toHaveValue('prompt');
  } finally { await context.close(); }
});
