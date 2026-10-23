import { test, expect } from '@playwright/test';

test('focusing the message field has no tap overlay or border change', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const prompt = page.locator('#prompt'), composer = page.locator('#composer');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.locator('#transcript').focus();
    const background = await composer.evaluate(node => getComputedStyle(node).backgroundColor);
    const border = await composer.evaluate(node => getComputedStyle(node).borderColor);
    // Native tap feedback is transient and is not reliably captured by screenshots.
    await expect(prompt).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
    await prompt.tap();
    await expect(prompt).toBeFocused();
    await expect(composer).toHaveCSS('background-color', background);
    await expect(composer).toHaveCSS('border-color', border);
    await expect(prompt).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
});

test('compact composer keeps controls reachable across draft, working and offline states', async ({ page }, testInfo) => {
  const state = { id: 'composer', title: 'Review changes', cwd: '/project', status: 'idle',
    model: 'openai/gpt-6.1-sol', modelName: 'GPT-6.1 Sol', thinkingLevel: 'medium', messages: [
      { id: 'reply', role: 'assistant', text: 'The changes are ready to review.' }
    ] };
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else {
        if (p.op === 'watch') snapshot();
        ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Review changes/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await expect(page.locator('#model-name')).toHaveText('GPT-6.1 Sol');
  await expect(page.locator('#model-effort')).toHaveText('Medium');
  await expect(page.locator('#reasoning-control')).toBeHidden();
  await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Type / for commands');
  await expect(page.locator('#abort')).toBeHidden();
  await expect(page.locator('#commands')).toBeEnabled();
  const rowFits = async () => {
    await expect(page.locator('#model-effort')).toBeVisible();
    const controls = await page.locator('#attach, #model, #usage-meter, #commands, #abort:not([hidden]), #send:not([hidden])')
      .evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height };
      }).sort((a, b) => a.y - b.y || a.x - b.x));
    for (const [i, control] of controls.entries()) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(control.x).toBeGreaterThanOrEqual(8);
      expect(control.right).toBeLessThanOrEqual(page.viewportSize().width - 8);
      if (i) {
        const previous = controls[i - 1];
        if (Math.abs(control.y - previous.y) < 1) expect(control.x).toBeGreaterThanOrEqual(previous.right - 1);
        else expect(control.y).toBeGreaterThanOrEqual(previous.y + previous.height - 1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await expect(page.getByRole('img', { name: 'Fast mode enabled' })).toBeHidden();
  state.fastMode = true; snapshot();
  await expect(page.getByRole('img', { name: 'Fast mode enabled' })).toBeVisible();
  await rowFits();
  expect(await page.locator('#model-name').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('composer-mobile.png') });
  state.status = 'working'; snapshot();
  await expect(page.locator('#abort')).toBeVisible();
  await expect(page.locator('#send')).toBeHidden();
  await expect(page.locator('#commands')).toBeEnabled();
  await rowFits();
  await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Message Pi while it works…');
  await page.locator('#prompt').fill('Keep working on the tests');
  await expect(page.locator('#send')).toBeVisible();
  await rowFits();
  delete state.modelName;
  state.model = 'custom/provider/a-very-long-model-name-that-must-not-hide-the-send-button'; state.thinkingLevel = 'xhigh'; snapshot();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('#model-effort')).toHaveText('Extra high');
  await rowFits();
  await page.locator('#prompt').fill('');
  await page.locator('#image-files').setInputFiles({ name: 'image.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#send')).toBeVisible();
  await page.getByRole('button', { name: 'Remove image.png' }).click();
  await expect(page.locator('#send')).toBeHidden();
  state.status = 'idle'; state.model = 'anthropic/claude-sonnet-4-6'; snapshot();
  await expect(page.locator('#send')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await rowFits();
  await page.screenshot({ path: testInfo.outputPath('composer-desktop-dark.png') });
  state.status = 'saved'; snapshot();
  await expect(page.locator('#resume')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Fast mode enabled' })).toBeHidden();
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#commands')).toBeDisabled();
  await expect(page.locator('#model')).toBeDisabled();
  await expect(page.locator('#composer-hint')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  expect((await page.locator('#send').boundingBox()).x + 44).toBeLessThanOrEqual(312);
  await rowFits();
  const toolbar = await page.locator('.composer-toolbar').boundingBox();
  expect((await page.locator('#resume').boundingBox()).y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
});
