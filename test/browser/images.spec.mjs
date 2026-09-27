import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const file = { name: 'screenshot.png', mimeType: 'image/png', buffer: png };
test('image picker previews, removes and preserves session drafts until acknowledgement', async ({ page }) => {
  const states = ['Alpha', 'Beta'].map(id => ({ id, title: id, cwd: '/project', status: 'idle', messages: [] }));
  const commands = [], errors = [];
  let finish, client;
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    client = ws;
    const p = JSON.parse(raw);
    const reply = (ok = true, error) => ws.send(JSON.stringify({ type: 'response', id: p.id, ok, error, value: [] }));
    if (p.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
    } else if (p.op === 'watch') {
      ws.send(JSON.stringify({ type: 'snapshot', sessionId: p.sessionId, version: 1, state: states.find(s => s.id === p.sessionId) })); reply();
    } else if (p.op === 'command') { commands.push(p); finish = reply; }
    else reply();
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Alpha/ }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach images' }).click();
  await (await picker).setFiles(file);
  await expect(page.getByRole('img', { name: file.name })).toBeVisible();
  await expect.poll(() => page.locator('#attachments img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: `Remove ${file.name}` }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.locator('#image-files').setInputFiles(file);
  await page.locator('#prompt').fill('What is in this image?');
  client.send(JSON.stringify({ type: 'ready' }));
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('Restart Pi Remote');
  expect(commands).toHaveLength(0);
  client.send(JSON.stringify({ type: 'ready', supportsImages: true }));
  await page.screenshot({ path: 'test-results/images-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(page.locator('#attachments')).toBeHidden();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(page.locator('#attachments img')).toHaveCount(1);
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Attach images' })).toBeDisabled();
  finish(false, 'Upload rejected');
  await expect(page.locator('#notice')).toHaveText('Upload rejected');
  await expect(page.locator('#attachments img')).toHaveCount(1);
  await expect(page.locator('#prompt')).toHaveValue('What is in this image?');
  await page.locator('#prompt').fill('/new');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('not a slash command');
  expect(commands).toHaveLength(1);
  await page.locator('#prompt').fill('');
  await page.locator('#send').click();
  await expect.poll(() => commands.length).toBe(2);
  finish();
  await expect(page.locator('#attachments')).toBeHidden();
  expect(commands.map(p => ({ sessionId: p.sessionId, command: p.command }))).toEqual(
    ['What is in this image?', ''].map(text => ({ sessionId: 'Alpha', command: { type: 'prompt', text,
      images: [{ type: 'image', mimeType: file.mimeType, data: png.toString('base64') }] } })));
  for (const files of [Array(5).fill(file), { ...file, buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }, { ...file, mimeType: 'image/svg+xml' }]) {
    await page.locator('#image-files').setInputFiles(files);
    await expect(page.locator('#notice')).toContainText('Attach up to 4 images, 2 MB total');
    await expect(page.locator('#attachments')).toBeHidden();
  }
  await page.locator('#image-files').setInputFiles([file, { ...file, name: 'second.png' }]);
  await expect(page.locator('#attachments img')).toHaveCount(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/images-desktop.png' });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#attachments img')).toHaveCount(0);
  expect(errors).toEqual([]);
});
