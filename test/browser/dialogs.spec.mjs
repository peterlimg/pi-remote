import { test, expect } from '@playwright/test';
import { diffState } from '../../web/protocol.js';

const url = '/#token=browser-test-token-only-123456789012345';
const usage = {
  id: 'usage-1', method: 'select',
  title: 'Provider usage\nOpenAI Codex Usage · Current\nSemantics: ChatGPT subscription limits\nWeekly limit: [██████████████░░░░░░] 68% left (resets 12:53 on 4 Oct)\nCredits: none\nUsage limit resets: 1 available\nPlan: prolite\nFast mode: Unavailable · gpt-6-astra does not advertise Codex Fast support.',
  options: ['Refresh current usage', 'Settings', 'Close']
};

async function setup(page, dialog = usage) {
  let state = { id: 'one', title: 'Usage test', cwd: '/project', status: 'waiting', messages: [{ id: 'prompt', role: 'user', text: '/usage' }], dialog };
  let client, version = 0, respond;
  const answers = [];
  const update = (dialog, messages = state.messages) => {
    const next = { ...state, dialog, messages, status: dialog ? 'waiting' : 'idle' };
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

test('usage is plain conversation text and closes its extension menu automatically', async ({ page }) => {
  const server = await setup(page), summary = page.getByRole('article', { name: 'Provider usage' });
  await expect(summary).toHaveText('Weekly limit: 32% used · resets 12:53 on 4 Oct');
  await expect(summary.locator('p')).toHaveCSS('font-size', '16px');
  await expect(summary.locator('p')).toHaveCSS('line-height', '26.4px');
  expect(await summary.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.locator('#dialog')).toBeHidden();
  await expect(summary.locator('button, meter, details')).toHaveCount(0);
  await expect.poll(() => server.answers.length).toBe(1);
  expect(server.answers[0]).toEqual({ dialogId: usage.id, value: 'Close' });
  await page.locator('#prompt').fill('Keep this draft');
  await page.locator('#prompt').focus();
  server.respond();
  await expect(page.locator('#status')).toHaveText('idle');
  await expect(page.locator('#prompt')).toBeFocused();
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await expect(summary).toBeVisible();
  const bounds = await summary.boundingBox(), composer = await page.locator('#composer').boundingBox();
  expect(bounds.y + bounds.height).toBeLessThan(composer.y);
  expect(await summary.evaluate(node => node.closest('#transcript') !== null)).toBe(true);
  // Later messages must not move the usage response to the end of the conversation.
  server.update(undefined, [{ id: 'prompt', role: 'user', text: '/usage' }, { id: 'later', role: 'assistant', text: 'Later reply' }]);
  await expect(page.locator('#transcript article')).toHaveText(['/usage', 'Weekly limit: 32% used · resets 12:53 on 4 Oct', 'Later reply']);
  expect(server.answers).toHaveLength(1);
});

test('usage handles multiple limits, unavailable data and unknown provider text safely', async ({ page }) => {
  const server = await setup(page, { ...usage, options: [] }), summary = page.getByRole('article', { name: 'Provider usage' });
  await expect.poll(() => server.answers.length).toBe(1);
  expect(server.answers[0]).toEqual({ dialogId: usage.id, cancelled: true });
  server.respond(undefined, { ...usage, id: 'limits', title: 'Provider usage\nSession: [░░░░] 0% left\nWeekly: [████] 100% left\nMonthly: [██░░] 68.7% left (resets tomorrow)\nNew limit: [????] unknown\n<img src=x onerror=alert(1)>' });
  await expect(summary.locator('p')).toHaveText(['Session: 100% used', 'Weekly: 0% used', 'Monthly: 31.3% used · resets tomorrow', 'New limit: [????] unknown', '<img src=x onerror=alert(1)>']);
  await expect(summary.locator('img, meter')).toHaveCount(0);
  await expect.poll(() => server.answers.length).toBe(2);
  server.respond();
  await page.setViewportSize({ width: 390, height: 350 });
  await expect(page.locator('#prompt')).toBeInViewport();
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toBeInViewport();
  server.update({ ...usage, id: 'unavailable', title: 'Provider usage' });
  await expect(summary).toHaveText('Usage information is unavailable.');
  await expect.poll(() => server.answers.length).toBe(3);
  server.respond();
});

test('failed automatic usage close offers a retry without losing the summary', async ({ page }) => {
  const server = await setup(page), summary = page.getByRole('article', { name: 'Provider usage' });
  await expect.poll(() => server.answers.length).toBe(1);
  server.respond('Could not send response. Try again.');
  await expect(summary).toContainText('Try again');
  await summary.getByRole('button', { name: 'Retry closing usage' }).click();
  await expect.poll(() => server.answers.length).toBe(2);
  expect(server.answers[1]).toEqual(server.answers[0]);
  // Old hosts acknowledge the answer but omit the dialog-removal patch.
  server.respond(undefined, undefined, false);
  await expect(summary.getByRole('button')).toHaveCount(0);
  await expect(summary).toHaveText('Weekly limit: 32% used · resets 12:53 on 4 Oct');
  await expect(page.locator('#dialog')).toBeHidden();
});

test('other extension dialogs retain options, errors, cancellation and input methods', async ({ page }) => {
  const server = await setup(page, { id: 'select', method: 'select', title: 'Choose a provider', options: ['OpenAI', 'Anthropic'] });
  const panel = page.locator('#dialog');
  await panel.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await expect.poll(() => server.answers.length).toBe(1);
  expect(server.answers[0]).toEqual({ dialogId: 'select', value: 'OpenAI' });
  server.respond('Could not send response. Try again.');
  await expect(panel.getByRole('status')).toContainText('Try again');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => server.answers.length).toBe(2);
  expect(server.answers.at(-1)).toEqual({ dialogId: 'select', cancelled: true });
  server.respond();
  await expect(panel).toBeHidden();
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
    server.respond(undefined, undefined, false);
    await expect(panel).toBeHidden();
  }
  server.update({ id: 'escape', method: 'confirm', title: 'Proceed?' });
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => server.answers.at(-1)).toEqual({ dialogId: 'escape', cancelled: true });
  server.respond();
  await expect(panel).toBeHidden();
});
