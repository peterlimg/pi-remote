import { test, expect } from '@playwright/test';

for (const vibration of [true, false]) {
  test(`composer buttons give one haptic via ${vibration ? 'vibration' : 'the iOS switch fallback'}`, async ({ page }, info) => {
    await page.addInitScript(vibration => {
      window.haptics = [];
      Object.defineProperty(navigator, 'vibrate', { value: vibration ? duration => { window.haptics.push(duration); return true; } : undefined });
      document.addEventListener('change', event => {
        if (event.target.matches('input[type=checkbox][switch]')) window.haptics.push('switch');
      }, true);
    }, vibration);
    const state = { id: 'composer', title: 'Composer haptics', cwd: '/project', status: 'working',
      model: 'test/first', thinkingLevel: 'high', contextUsage: { tokens: 64000, contextWindow: 200000, percent: 32 }, messages: [] };
    const commands = [];
    let version = 0, finishSend;
    await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      const reply = value => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
      const snapshot = () => ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsUsage: true, supportsImages: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') { snapshot(); reply({}); }
      else if (packet.op === 'models') reply({ current: state.model, models: [{ provider: 'test', id: 'first', name: 'First' }] });
      else if (packet.op === 'usage') reply({ model: state.model, contextUsage: state.contextUsage });
      else if (packet.op === 'command') {
        commands.push(packet.command);
        if (packet.command.type === 'prompt') {
          finishSend = () => { state.messages.push({ id: 'sent', role: 'user', text: packet.command.text }); snapshot(); reply({}); };
        } else if (packet.command.type === 'abort') { state.status = 'idle'; snapshot(); reply({}); }
      } else reply([]);
    }));
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await page.getByRole('button', { name: /Composer haptics/ }).tap();
    await expect(page.locator('#abort')).toBeVisible();
    let count = await page.evaluate(() => window.haptics.length);
    const expectHaptic = async () => {
      expect(await page.evaluate(() => window.haptics)).toEqual(Array(++count).fill(vibration ? 10 : 'switch'));
      await expect(page.locator('body > label input[switch]')).toHaveCount(0);
    };

    const chooser = page.waitForEvent('filechooser');
    await page.locator('#attach svg').tap();
    await (await chooser).setFiles([]);
    await expectHaptic();

    for (const [id, name] of [['model', 'Choose a model'], ['reasoning-control', 'Choose reasoning effort'], ['usage-meter', 'Usage']]) {
      await page.locator('#' + id).tap();
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
      await expectHaptic();
      await page.locator('#picker-cancel').tap();
      expect(await page.evaluate(() => window.haptics.length)).toBe(count);
    }

    await page.locator('#commands svg path').tap();
    await expect(page.locator('#prompt')).toHaveValue('/');
    await expectHaptic();
    await page.locator('#prompt').fill('Check composer haptics');
    await page.locator('#send svg').tap();
    await expectHaptic();
    await expect(page.locator('#attach')).toBeDisabled();
    await page.locator('#attach').tap({ force: true });
    expect(await page.evaluate(() => window.haptics.length)).toBe(count);
    await expect.poll(() => !!finishSend).toBe(true);
    finishSend();
    await expect(page.locator('#transcript')).toContainText('Check composer haptics');
    await expect(page.locator('#attach')).toBeEnabled();
    await page.locator('#abort svg rect').tap();
    await expectHaptic();
    await expect(page.locator('#abort')).toBeHidden();
    expect(commands).toEqual([{ type: 'prompt', text: 'Check composer haptics' }, { type: 'abort' }]);
    await page.screenshot({ path: info.outputPath('composer-haptics.png') });
    await info.attach('composer', { body: await page.locator('#composer').ariaSnapshot(), contentType: 'text/plain' });
  });
}
