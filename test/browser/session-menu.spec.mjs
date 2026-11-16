import { test, expect } from '@playwright/test';

for (const [width, colorScheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark']]) {
  test(`session menu keeps shared glass without a blurred ancestor (${width}, ${colorScheme})`, async ({ page }, testInfo) => {
    const state = { id: 'menu', title: 'Dense conversation', cwd: '/projects/sample-workspace', status: 'idle',
      contextUsage: { tokens: 64000, contextWindow: 200000, percent: 32 },
      messages: [{ id: 'reply', role: 'assistant', text: 'Check the session menu over dense conversation text. Keep the workspace path and all actions readable.\n\n'.repeat(40) }] };
    await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsSessionClosing: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      }
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true }));
    }));
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.locator('.session').click();
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    await page.locator('#prompt').fill('Keep this draft');
    await page.locator('#transcript').evaluate(node => { node.scrollTop = 300; });
    const scroll = await page.locator('#transcript').evaluate(node => node.scrollTop);
    const trigger = page.locator('.session-info summary');
    await expect(trigger).toHaveAccessibleName('Session details');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.session-details');
    await expect(menu).toBeVisible();
    await expect(menu.locator('#project')).toHaveText(state.cwd);
    for (const id of ['session-pin', 'session-close', 'session-icon-open']) await expect(menu.locator('#' + id)).toBeVisible();
    const anchor = await trigger.boundingBox(), bounds = await menu.boundingBox();
    expect(Math.abs(bounds.x + bounds.width - anchor.x - anchor.width)).toBeLessThan(1);
    expect(bounds.y - anchor.y - anchor.height).toBeCloseTo(8, 0);
    const materials = await page.locator('.session-details, .command-menu').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return [style.backgroundColor, style.backgroundImage, style.borderColor, style.backdropFilter || style.webkitBackdropFilter];
    }));
    for (const material of materials) expect(material).toEqual(materials[0]);
    expect(materials[0][3]).toContain('blur(12px)');
    const pillBlur = await page.locator('.conversation-actions').evaluate(node => {
      const style = getComputedStyle(node, '::before');
      return style.backdropFilter || style.webkitBackdropFilter;
    });
    expect(pillBlur).toBe(materials[0][3]);
    await page.screenshot({ path: testInfo.outputPath('menu-dense-chat.png') });
    // A computed blur on the menu alone misses nested backdrop roots that block the thread.
    const ancestors = await menu.evaluate(node => {
      const roots = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), blur = style.backdropFilter || style.webkitBackdropFilter;
        if (blur && blur !== 'none') roots.push({ element: parent.className || parent.tagName, blur });
      }
      return roots;
    });
    expect(ancestors).toEqual([]);
    await menu.locator('#session-icon-open').click();
    await expect(page.locator('#session-icon-picker')).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(menu).toBeVisible();
    await menu.locator('#project').click();
    await expect(menu).toBeVisible();
    await trigger.click();
    await expect(menu).toBeHidden();
    await trigger.click();
    await page.locator('#usage-meter').click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole('region', { name: 'Usage', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close usage', exact: true }).click();
    await trigger.click();
    await page.locator('#prompt').click();
    await expect(menu).toBeHidden();
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    expect(await page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(scroll);
  });
}
