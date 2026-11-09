import { test, expect } from '@playwright/test';

test('long received text and codemode titles cannot scroll the whole conversation sideways', async ({ page }, testInfo) => {
  const title = 'Update the Codemode header icon and run its focused browser verification before publishing the change';
  const state = { id: 'layout-proof', title: 'Layout verification session', cwd: '/project', status: 'working', tools: [], messages: [
    { id: 'request', role: 'user', text: 'Please update only the work-log icon. Keep the existing labels, layout and behavior unchanged. '.repeat(3) },
    { id: 'reply', role: 'assistant', text: 'I will update the requested icon, then verify the phone layout.' },
    { id: 'call', role: 'assistant', toolCalls: [{ id: 'long-title', name: 'codemode', text: JSON.stringify({ code: '// ' + title + '\ntext(await tools.bash({command:"npm run check"}));' }) }] },
    { id: 'result', role: 'toolResult', toolCallId: 'long-title', toolName: 'codemode', text: 'Process exited with code 2', durationMs: 146, isError: true }
  ] };
  let client;
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 0, state }));
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: {} }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Layout verification session/ }).click();
  await expect(page.locator('.codemode-tool .codemode-title')).toHaveText(title);
  for (const width of [390, 320, 1200]) {
    await page.setViewportSize({ width, height: 844 });
    const transcript = page.locator('#transcript');
    await expect(async () => {
      const dimensions = await transcript.evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    }).toPass({ timeout: 2000 });
    const summary = page.locator('.codemode-tool > summary');
    const bounds = await summary.boundingBox();
    const heading = await summary.locator('.tool-heading').boundingBox(), label = await summary.locator('.codemode-title').boundingBox();
    expect(label.x).toBeGreaterThanOrEqual(bounds.x);
    expect(label.width).toBeLessThanOrEqual(heading.width);
    expect(label.x + label.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    await transcript.evaluate(node => { node.scrollLeft = 100; });
    expect(await transcript.evaluate(node => node.scrollLeft)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('layout-' + width + '.png') });
  }
  // A second live publication must not restore overflow after the initial render.
  client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
  await expect(page.locator('.codemode-tool .codemode-title')).toHaveText(title);
  expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});
