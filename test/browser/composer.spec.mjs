import { test, expect } from '@playwright/test';

test('focusing the message field has no tap overlay and keeps the composer focus border', async ({ page }) => {
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
    await expect(composer).not.toHaveCSS('border-color', border);
    await expect(prompt).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
});

test('compact composer keeps controls on one row across draft, working and offline states', async ({ page }) => {
  const state = { id: 'composer', title: 'Review changes', cwd: '/project', status: 'idle',
    model: 'anthropic/claude-sonnet-4-6', thinkingLevel: 'medium', messages: [
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
  await expect(page.locator('#reasoning-value')).toHaveText('Medium');
  await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Type / for commands');
  await expect(page.locator('#abort')).toBeHidden();
  await expect(page.locator('#commands')).toBeEnabled();
  const rowFits = async () => {
    const controls = await page.locator('#attach, #model, #reasoning-control, #commands, #abort:not([hidden]), #send:not([hidden])')
      .evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height };
      }));
    for (const [i, control] of controls.entries()) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(Math.abs(control.y - controls[0].y)).toBeLessThan(1);
      if (i) expect(control.x).toBeGreaterThanOrEqual(controls[i - 1].right);
    }
    expect(controls.at(-1).right).toBeLessThanOrEqual(page.viewportSize().width - 8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await rowFits();
  state.status = 'working'; snapshot();
  await expect(page.locator('#abort')).toBeVisible();
  await expect(page.locator('#send')).toBeHidden();
  await expect(page.locator('#commands')).toBeEnabled();
  await rowFits();
  await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Message Pi while it works…');
  await page.locator('#prompt').fill('Keep working on the tests');
  await expect(page.locator('#send')).toBeVisible();
  await rowFits();
  state.model = 'custom/provider/a-very-long-model-name-that-must-not-hide-the-send-button'; snapshot();
  await page.setViewportSize({ width: 320, height: 568 });
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
  state.status = 'saved'; snapshot();
  await expect(page.locator('#resume')).toBeVisible();
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#commands')).toBeDisabled();
  await expect(page.locator('#reasoning')).toBeDisabled();
  await expect(page.locator('#composer-hint')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  expect((await page.locator('#send').boundingBox()).x + 44).toBeLessThanOrEqual(312);
  await rowFits();
  const toolbar = await page.locator('.composer-toolbar').boundingBox();
  expect((await page.locator('#resume').boundingBox()).y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
});
