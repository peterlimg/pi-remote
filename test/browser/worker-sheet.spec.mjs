import { test, expect } from '@playwright/test';
import { diffState } from '../../web/protocol.js';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';

test('worker sheet scopes history and images without disturbing the live parent', async ({ page }) => {
  const parentImage = { id: 'a'.repeat(64), mimeType: 'image/png' }, workerImage = { id: 'b'.repeat(64), mimeType: 'image/png' };
  const task = { id: 'task', sessionId: 'worker', title: 'Image inspection', state: 'working', instruction: 'Inspect screenshot.png.', readOnly: true };
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
  await page.locator('#coordinator-open').click();
  await page.getByRole('button', { name: 'Image inspection, Working', exact: true }).click();
  const log = page.locator('#coordinator-log'), read = log.locator('details').filter({ has: page.locator('summary', { hasText: 'read · screenshot.png' }) });
  await read.locator('summary').click();
  const image = read.locator('img');
  await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(1);
  const workerURL = await image.getAttribute('src');
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
  await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
  await expect(page.locator('#prompt')).toHaveValue('Keep this main draft.'); await expect(page.locator('#title')).toHaveText(parent.title);
  await expect(mainImage).toHaveAttribute('src', mainURL); await expect.poll(() => mainImage.evaluate(node => node.naturalWidth)).toBe(1);
  expect(requests.filter(packet => packet.op === 'history').map(packet => packet.sessionId)).toEqual(['worker', 'worker']);
  expect(requests.filter(packet => packet.op === 'image').some(packet => packet.sessionId === 'worker' && packet.imageId === workerImage.id)).toBe(true);
  expect(requests.filter(packet => packet.op === 'watch').every(packet => packet.sessionId === 'parent')).toBe(true);
  expect(requests.some(packet => ['command', 'answer', 'taskAction'].includes(packet.op) && packet.sessionId === 'worker')).toBe(false);
  await expect.poll(() => requests.some(packet => packet.op === 'inspectWorker' && packet.sessionId === null)).toBe(true);
  expect(errors).toEqual([]);
});
