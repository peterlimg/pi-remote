import { test, expect } from '@playwright/test';
import { diffState } from '../../web/protocol.js';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';

test('worker sheet scopes history and images without disturbing the live parent', async ({ page }, info) => {
  const parentImage = { id: 'a'.repeat(64), mimeType: 'image/png' }, workerImage = { id: 'b'.repeat(64), mimeType: 'image/png' };
  const task = { id: 'task', sessionId: 'worker', title: 'Messaging and recovery inspection with a long worker name', state: 'working', instruction: 'Inspect screenshot.png.', readOnly: true };
  const parent = { id: 'parent', title: 'Main conversation', cwd: '/project', status: 'idle', messages: [
    { id: 'parent-note', role: 'user', text: 'Keep the main image.', images: [parentImage] }
  ], coordination: { role: 'coordinator', readOnly: false, tasks: [task] } };
  let worker = { id: 'worker', title: task.title, cwd: '/project', status: 'working', historyTruncated: true, messages: [
    { id: 'worker-call', role: 'assistant', toolCalls: [{ id: 'read-image', name: 'read', text: '{"path":"screenshot.png"}' }] },
    { id: 'worker-result', role: 'toolResult', toolCallId: 'read-image', toolName: 'read', text: 'Image output.', images: [workerImage] }
  ] };
  const older = { messages: [{ id: 'older-worker', role: 'assistant', text: 'Earlier worker finding.' }], older: false, newer: true, tip: 'worker-tip' };
  let client, parentVersion = 0, workerVersion = 0;
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw); requests.push(packet);
      let value = [];
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsCoordinator: true, supportsWorkerInspection: true, supportsHistory: true, supportsImages: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [parent] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: parentVersion, state: parent }));
      } else if (packet.op === 'inspectWorker' && packet.sessionId) {
        workerVersion = 0;
        ws.send(JSON.stringify({ type: 'workerSnapshot', sessionId: worker.id, version: workerVersion, state: worker }));
      } else if (packet.op === 'image') {
        value = { type: 'image', mimeType: 'image/png', data: pixel };
      } else if (packet.op === 'history') {
        value = packet.before ? older : { messages: worker.messages, older: true, newer: false, tip: older.tip };
      }
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.locator('#sessions .session').click();
  const mainImage = page.locator('#transcript .thread-image img');
  await expect(mainImage).toBeVisible(); await expect.poll(() => mainImage.evaluate(node => node.naturalWidth)).toBe(1);
  const mainURL = await mainImage.getAttribute('src');
  await page.locator('#prompt').fill('Keep this main draft.');
  expect((await page.locator('#coordinator-context').boundingBox()).height).toBeLessThanOrEqual(48);
  await expect(page.locator('#coordinator-context button')).toHaveCount(1);
  await expect(page.locator('#coordinator-workers, #coordinator-owner')).toHaveCount(0);
  await page.locator('#coordinator-open').click();
  await page.getByRole('button', { name: task.title + ', Working', exact: true }).click();
  const log = page.locator('#coordinator-log'), read = log.locator('details').filter({ has: page.locator('summary', { hasText: 'read · screenshot.png' }) });
  await read.locator('summary').click();
  const image = read.locator('img');
  await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(1);
  const workerURL = await image.getAttribute('src');
  const layout = [];
  for (const [name, width, height, colorScheme] of [['phone', 390, 844, 'light'], ['dark', 390, 844, 'dark'], ['narrow', 320, 740, 'light'], ['short', 390, 510, 'light'], ['desktop', 1440, 900, 'light']]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
    const space = await page.locator('.coordinator-sheet').evaluate(node => ({
      sheet: node.getBoundingClientRect().height, header: node.querySelector('header').getBoundingClientRect().height,
      body: node.querySelector('#coordinator-scroll').getBoundingClientRect().height, safeBottom: parseFloat(getComputedStyle(node).paddingBottom),
      overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...node.querySelectorAll('header button')].every(button => { const box = button.getBoundingClientRect(); return box.width >= 44 && box.height >= 44; })
    }));
    expect(space.header).toBeLessThanOrEqual(74); expect(space.targets).toBe(true); expect(space.overflow).toBe(false);
    expect(space.body).toBeGreaterThan(space.sheet - space.header - space.safeBottom - 3);
    await expect(page.locator('.coordinator-sheet > footer')).toHaveCount(0);
    await expect(page.locator('#coordinator-sheet')).toHaveAccessibleDescription('Read-only inspection. Give instructions in the main conversation.');
    await expect(page.locator('#coordinator-title')).toHaveText(task.title);
    await page.screenshot({ path: info.outputPath(`worker-sheet-${name}.png`) }); layout.push({ name, width, height, ...space });
  }
  await info.attach('compact-worker-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
  await page.setViewportSize({ width: 390, height: 844 });
  parent.messages.push({ id: 'parent-live', role: 'assistant', text: 'The parent is still live.' });
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  const next = { ...worker, messages: [...worker.messages, { id: 'worker-live', role: 'assistant', text: 'Latest worker finding.' }] };
  client.send(JSON.stringify({ type: 'workerPatch', sessionId: worker.id, version: ++workerVersion, patch: diffState(worker, next) })); worker = next;
  await expect(log).toContainText('Latest worker finding.');
  await expect(page.locator('#transcript')).toContainText('The parent is still live.');
  await expect(read).toHaveJSProperty('open', true);
  await expect(image).toHaveAttribute('src', workerURL); await expect(mainImage).toHaveAttribute('src', mainURL);
  await read.getByRole('link', { name: 'Open image' }).click();
  await expect(page.locator('#image-viewer')).toBeVisible();
  await page.locator('#image-close').click(); await expect(page.locator('#coordinator-sheet')).toBeVisible();
  await log.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(log).toContainText('Earlier worker finding.'); await expect(log).not.toContainText('Latest worker finding.');
  const newer = { ...worker, messages: [...worker.messages, { id: 'worker-newer', role: 'assistant', text: 'A newer live finding.' }] };
  client.send(JSON.stringify({ type: 'workerPatch', sessionId: worker.id, version: ++workerVersion, patch: diffState(worker, newer) })); worker = newer;
  await expect(log).toContainText('Earlier worker finding.'); await expect(log).not.toContainText('A newer live finding.');
  await log.getByRole('button', { name: 'Newer messages', exact: true }).click();
  await expect(log).toContainText('A newer live finding.');
  await log.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(log.getByRole('button', { name: 'Latest messages', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to workers', exact: true }).click();
  await expect(page.locator('#coordinator-title')).toHaveText('Workers');
  await page.getByRole('button', { name: 'Close workers', exact: true }).click();
  await expect(page.locator('#prompt')).toHaveValue('Keep this main draft.'); await expect(page.locator('#title')).toHaveText(parent.title);
  await expect(mainImage).toHaveAttribute('src', mainURL); await expect.poll(() => mainImage.evaluate(node => node.naturalWidth)).toBe(1);
  expect(requests.filter(packet => packet.op === 'history').map(packet => packet.sessionId)).toEqual(['worker', 'worker']);
  expect(requests.filter(packet => packet.op === 'image').some(packet => packet.sessionId === 'worker' && packet.imageId === workerImage.id)).toBe(true);
  expect(requests.filter(packet => packet.op === 'watch').every(packet => packet.sessionId === 'parent')).toBe(true);
  expect(requests.some(packet => ['command', 'answer', 'taskAction'].includes(packet.op) && packet.sessionId === 'worker')).toBe(false);
  await expect.poll(() => requests.some(packet => packet.op === 'inspectWorker' && packet.sessionId === null)).toBe(true);
  await page.locator('#coordinator-open').click();
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  const touchClient = await page.context().newCDPSession(page), header = await page.locator('.coordinator-sheet > header').boundingBox();
  const x = header.x + header.width / 2, y = header.y + 32;
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const dy of [30, 90, 150]) await touchClient.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy }] });
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#coordinator-sheet')).toBeHidden(); await touchClient.detach();
  await expect(page.locator('#prompt')).toHaveValue('Keep this main draft.');
  expect(errors).toEqual([]);
});
