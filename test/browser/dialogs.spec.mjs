import { test, expect } from '@playwright/test';
import { diffState } from '../../web/protocol.js';

const url = '/#token=browser-test-token-only-123456789012345';
const usage = {
  id: 'usage-1', method: 'select',
  title: 'Provider usage\nOpenAI Codex Usage · Current\nSemantics: ChatGPT subscription limits\nWeekly limit: [██████████████░░░░░░] 68% left (resets 12:53 on 4 Oct)\nCredits: none\nUsage limit resets: 1 available\nPlan: prolite\nFast mode: Unavailable · gpt-6-astra does not advertise Codex Fast support.',
  options: ['Refresh current usage', 'Close']
};

async function setup(page) {
  let state = { id: 'one', title: 'Usage test', cwd: '/project', status: 'waiting', messages: [], dialog: usage };
  let client, version = 0, respond;
  const answers = [];
  const update = dialog => {
    const next = { ...state, dialog, status: dialog ? 'waiting' : 'working' };
    client.send(JSON.stringify({ type: 'patch', sessionId: state.id, version: ++version, patch: diffState(state, next) }));
    state = next;
  };
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      const reply = (value, ok = true) => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok, ...(ok ? { value } : { error: value }) }));
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version, state }));
        reply({});
      } else if (packet.op === 'commands') reply([]);
      else if (packet.op === 'answer') {
        answers.push(packet.answer);
        respond = (error, replacement, sendPatch = true) => {
          if (error) reply(error, false);
          else { if (sendPatch) update(replacement); reply({ accepted: true }); }
        };
      }
    });
  });
  await page.goto(url);
  await page.getByRole('button', { name: /Usage test/ }).click();
  return { answers, update, respond: (...args) => respond(...args) };
}

test('usage cancellation clears the panel through a serialized state patch', async ({ page }) => {
  const server = await setup(page), panel = page.getByRole('region', { name: 'Provider usage' });
  await expect(panel.getByRole('heading')).toHaveText('Provider usage');
  await expect(panel.locator('.dialog-description')).toContainText('68% left');
  expect(await panel.locator('.dialog-description').evaluate(node => getComputedStyle(node).whiteSpace)).toBe('pre-wrap');
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  for (const [index, dismissal] of ['Cancel', 'Close dialog', 'Escape'].entries()) {
    if (index) server.update({ ...usage, id: `usage-${index + 1}` });
    await expect(panel).toBeVisible();
    if (index === 1) { await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: 'dark' }); }
    const bounds = await panel.boundingBox(), composer = await page.locator('#composer').boundingBox();
    expect(Math.abs(bounds.x - composer.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.width - composer.width)).toBeLessThanOrEqual(2);
    expect(bounds.y + bounds.height).toBeLessThan(composer.y);
    if (index < 2) await page.screenshot({ path: `test-results/usage-${index ? 'desktop-dark' : 'mobile'}.png` });
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await panel.getByRole('button', { name: dismissal, exact: true }).click();
    await expect.poll(() => server.answers.length).toBe(index + 1);
    expect(server.answers.at(-1)).toEqual({ dialogId: `usage-${index + 1}`, cancelled: true });
    // Prove the wire patch clears the panel independently of the acknowledgement.
    server.update(undefined);
    await expect(panel).toBeHidden({ timeout: 1500 });
    await expect(page.locator('#transcript')).toBeFocused();
    server.respond(undefined, undefined, false);
  }
});

test('dialog actions handle refresh, errors, small screens and other input methods', async ({ page }) => {
  const server = await setup(page), panel = page.locator('#dialog');
  await page.locator('#prompt').fill('Keep this draft');
  await panel.getByRole('button', { name: 'Refresh current usage' }).click();
  await expect.poll(() => server.answers.length).toBe(1);
  expect(server.answers[0]).toEqual({ dialogId: usage.id, value: 'Refresh current usage' });
  await page.keyboard.press('Escape');
  expect(server.answers).toHaveLength(1);
  server.respond('Could not send response. Try again.');
  await expect(panel.getByRole('status')).toContainText('Try again');
  await expect(panel.getByRole('button', { name: 'Close dialog' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Refresh current usage' }).click();
  await expect.poll(() => server.answers.length).toBe(2);
  server.respond(undefined, { ...usage, id: 'refreshed', title: usage.title.replace('68%', '67%') });
  await expect(panel.locator('.dialog-description')).toContainText('67% left');
  await expect(panel.getByRole('button', { name: 'Refresh current usage' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 350 });
  await expect.poll(async () => {
    const bounds = await panel.boundingBox();
    return bounds.y + bounds.height;
  }).toBeLessThan(350);
  expect((await panel.boundingBox()).y).toBeGreaterThanOrEqual(0);
  expect(await panel.locator('.dialog-body').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await expect(panel.getByRole('button', { name: 'Close dialog' })).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/usage-short-viewport.png' });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => server.answers.length).toBe(3);
  expect(server.answers.at(-1)).toEqual({ dialogId: 'refreshed', value: 'Close' });
  server.respond();
  await expect(panel).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const method of ['confirm', 'input', 'editor']) {
    server.update({ id: method, method, title: 'Pi needs your input', message: '<img src=x onerror=alert(1)>', prefill: 'Draft response' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('img')).toHaveCount(0);
    if (method !== 'confirm') {
      await expect(panel.getByRole('textbox')).toHaveValue('Draft response');
      await panel.getByRole('textbox').fill('My response');
    }
    const count = server.answers.length;
    await panel.getByRole('button', { name: method === 'confirm' ? 'Allow' : 'Submit' }).click();
    await expect.poll(() => server.answers.length).toBe(count + 1);
    expect(server.answers.at(-1)).toEqual({ dialogId: method, ...(method === 'confirm' ? { confirmed: true } : { value: 'My response' }) });
    // Old hosts send the acknowledgement but lose the undefined removal in JSON.
    server.respond(undefined, undefined, false);
    await expect(panel).toBeHidden();
  }
});
