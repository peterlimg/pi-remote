#!/usr/bin/env node
// Proves Miso through a real host and real Pi RPC processes. Only model replies are scripted.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { chromium, devices, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { socket, until } from './helpers.mjs';

const clientToken = 'browser-test-token-only-123456789012345';
const port = Number(process.env.PI_REMOTE_ASSISTANT_TEST_PORT || 8816), url = 'http://127.0.0.1:' + port;
const evidence = mkdtempSync(join(tmpdir(), 'pi-assistant-proof-'));
console.log('Evidence: ' + evidence);
const env = { ...process.env, PI_OFFLINE: '1' };
for (const name of Object.keys(env)) if (name.startsWith('PI_REMOTE_') || name === 'PI_COORDINATOR_FIXTURE_ROOT') delete env[name];
Object.assign(env, { PI_REMOTE_COORDINATOR_TEST_PORT: String(port), PI_REMOTE_ASSISTANT_DELAY_MS: '300' });

let running, root, browser, context, starts = 0;
const check = expect.configure({ timeout: 30000 });
async function start() {
  const logFile = join(evidence, 'host-' + (++starts) + '.log'), log = openSync(logFile, 'w');
  const child = spawn(process.execPath, ['test/coordinator-server.mjs'], { env: { ...env, ...(root ? { PI_COORDINATOR_FIXTURE_ROOT: root } : {}) }, stdio: ['ignore', 'pipe', log] });
  closeSync(log);
  const stopped = new Promise(resolve => child.once('exit', resolve)), ready = Promise.withResolvers();
  let buffer = '';
  child.stdout.on('data', chunk => {
    appendFileSync(logFile, chunk); buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(index + 1)) {
      try { const value = JSON.parse(buffer.slice(0, index)); if (value.fixture === 'coordinator') ready.resolve(value); } catch {}
    }
  });
  child.once('exit', () => ready.reject(new Error('Fixture exited; inspect ' + logFile)));
  running = { child, stopped };
  const timer = setTimeout(() => ready.reject(new Error('Fixture startup timed out; inspect ' + logFile)), 30000);
  try { const info = await ready.promise; root = info.root; return info; } finally { clearTimeout(timer); }
}
async function stop() {
  const instance = running; running = undefined;
  if (!instance) return;
  instance.child.kill('SIGTERM');
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 10000);
  try { await instance.stopped; } finally { clearTimeout(timer); }
}
const lines = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const text = message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
const ledger = () => JSON.parse(readFileSync(join(root, 'host', 'assistant.json'), 'utf8'));
const misoMessages = role => lines(ledger().file).filter(entry => entry.type === 'message' && entry.message.role === role).map(entry => text(entry.message));
const misoRequests = () => lines(join(root, 'provider.jsonl')).filter(entry => entry.kind === 'request' && entry.role === 'assistant' && entry.purpose === 'agent');
const deliveries = id => misoMessages('user').filter(body => body.includes(id)).length;
const event = (kind, after = 0) => ledger().events.find((item, index) => index >= after && item.kind === kind && item.delivery === 'sent');
const proof = {};

try {
  const { sources, pid } = await start(), project = sources[0];
  writeFileSync(join(evidence, 'doctor.json'), execFileSync(process.execPath, ['test/coordinator-e2e.mjs', 'doctor', String(pid), url]));
  browser = await chromium.launch({ channel: process.env.PI_REMOTE_TEST_CHANNEL });
  context = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage(), errors = [], frames = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString()); if (packet.op === 'answer') frames.push(packet);
  }));
  await page.goto(url); await page.getByText('Paste a private link instead', { exact: true }).click();
  await page.getByLabel('Private login link').fill(clientToken); await page.getByRole('button', { name: 'Connect to computer' }).click();
  await check(page.locator('#connection')).toHaveText('Computer connected');
  await page.locator('#assistant-open').click();
  await check(page.locator('#title')).toHaveText('Miso');
  await check(page.locator('.assistant-checkin')).toContainText("Hi, I'm Miso.");
  await check(page.locator('.assistant-checkin')).toContainText('Nothing needs your input right now.');
  await page.screenshot({ path: join(evidence, 'first-open.png') });
  proof.welcome = 'First open shows a greeting and a host-derived live-session check-in without a model call';
  let client = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
  await until(() => client.messages.find(packet => packet.type === 'ready')?.supportsAssistant, 10000);
  const opened = await client.request('assistant');
  assert.equal(opened.ok, true, opened.error);
  const misoId = opened.value.sessionId;
  assert.equal(ledger().id, misoId);
  const listed = await client.request('list', { limit: 100 });
  assert(!(listed.value.sessions || listed.value.changes).some(row => row.id === misoId), 'Miso is not an ordinary session row');
  const overview = async () => (await (await fetch(url + '/_pi/assistant', { method: 'POST', body: '{"action":"overview"}',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ledger().token } })).json()).value.sessions;
  assert(!(await overview()).some(row => row.id === misoId), 'Miso does not watch itself');

  // Only Miso's token reaches the sessions API, and never from a browser origin.
  for (const headers of [{}, { Authorization: 'Bearer ' + 'x'.repeat(43) }, { Authorization: 'Bearer ' + ledger().token, Origin: url }]) {
    const response = await fetch(url + '/_pi/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"action":"overview"}' });
    assert.equal(response.status, 403);
  }
  const forbiddenAnswer = await fetch(url + '/_pi/assistant', { method: 'POST',
    headers: { Authorization: 'Bearer ' + ledger().token }, body: JSON.stringify({ action: 'answer', sessionId: project.id, answer: { value: 'Post them' } }) });
  assert.equal(forbiddenAnswer.status, 400, 'Miso’s read-only API cannot answer questions');
  proof.access = 'Requests without Miso’s token or from a browser origin get 403; Miso cannot answer through its API';

  // A question in another session reaches Miso once, and Miso cannot answer it.
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  const card = page.locator('.assistant-question');
  await check(card).toContainText('Post these 3 review comments to the PR?');
  await check(card.getByRole('button', { name: 'Post them', exact: true })).toBeVisible();
  const question = await until(() => event('question'), 30000);
  await until(() => misoMessages('assistant').some(body => body.includes('asks: Post these 3 review comments to the PR? (Post them / Not yet)')), 30000);
  assert.equal((await overview()).find(row => row.id === project.id).status, 'waiting', 'Miso must leave the question for the user');
  assert.equal((await client.request('watch', { sessionId: project.id })).ok, true);
  const dialog = client.messages.findLast(packet => packet.type === 'snapshot' && packet.sessionId === project.id).state.dialog;
  assert.equal(deliveries(question.id), 1);
  await check(page.locator('.tool-activity-label').filter({ hasText: /^Checked \d+ sessions?$/ })).toHaveCount(1);
  await check(page.locator('.tool-activity-label').filter({ hasText: '1 session changed' })).toHaveCount(1);
  await check(page.locator('.tool-activity-progress')).toHaveCount(0);
  await page.reload(); await page.locator('#assistant-open').click();
  await check(card).toHaveAttribute('data-question-id', dialog.id);
  for (const [name, theme, width] of [['phone-light', 'light', 390], ['phone-dark', 'dark', 390], ['desktop-light', 'light', 1200]]) {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width, height: 844 });
    await card.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    await page.screenshot({ path: join(evidence, name + '.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  proof.question = 'A real host question appears without leaving Miso, survives reload, and has readable activity labels in phone and desktop layouts';

  // The phone's answer must match the question it saw.
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: 'stale-dialog', value: 'Post them' } })).value.ok, false);
  const before = ledger().events.length;
  await card.getByRole('button', { name: 'Post them', exact: true }).click();
  await check(card).toHaveCount(0);
  assert.deepEqual(frames.at(-1).answer, { dialogId: dialog.id, value: 'Post them' });
  assert.equal(frames.at(-1).sessionId, project.id);
  await check(page.locator('#title')).toHaveText('Miso');
  const finished = await until(() => event('finished', before), 30000);
  assert.equal(deliveries(finished.id), 1);
  // Read the target again: disappearing UI alone is not evidence of delivery.
  await client.request('watch', { sessionId: project.id });
  assert(client.messages.findLast(packet => packet.type === 'snapshot').state.messages.some(message => message.text?.includes('User chose: Post them')));
  proof.answer = 'The phone answered the exact host dialog from Miso; the target recorded it and Miso heard once';

  // A replacement question rejects an old card; another client’s answer removes the current card.
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  await check(card).toHaveCount(1);
  const replacementId = await card.getAttribute('data-question-id'); assert.notEqual(replacementId, dialog.id);
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: dialog.id, value: 'Post them' } })).value.ok, false);
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: replacementId, value: 'Invented option' } })).value.ok, false);
  await check(card).toHaveAttribute('data-question-id', replacementId);
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: replacementId, cancelled: true } })).value.ok, true);
  await check(card).toHaveCount(0);
  proof.stale = 'An old dialog id and an invented option are rejected; an answer from another client removes the card';

  for (const method of ['confirm', 'input', 'editor']) {
    await check.poll(async () => (await overview()).find(row => row.id === project.id).status).toBe('idle');
    assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask with ' + method + '.' } })).value.ok, true);
    await check(card).toHaveCount(1);
    if (method === 'confirm') {
      await check(card).toContainText('This will post comments to the PR.');
      await card.getByRole('button', { name: 'Deny', exact: true }).click();
      assert.equal(frames.at(-1).answer.confirmed, false);
    } else {
      const input = card.locator(method === 'editor' ? 'textarea' : 'input');
      if (method === 'editor') await check(input).toHaveValue('Keep the original identifier.');
      await input.fill('Keep my answer while Miso updates.');
      // Let the actual Miso wake and streaming patches arrive with the draft focused.
      await check(page.locator('.assistant-checkin')).toContainText('1 needs your input.');
      await page.waitForTimeout(800);
      await check(input).toHaveValue('Keep my answer while Miso updates.');
      await check(input).toBeFocused();
      await card.getByRole('button', { name: 'Send answer', exact: true }).click();
      assert.equal(frames.at(-1).answer.value, 'Keep my answer while Miso updates.');
    }
    await check(card).toHaveCount(0);
    await check.poll(async () => (await overview()).find(row => row.id === project.id).status).toBe('idle');
    await client.request('watch', { sessionId: project.id });
    const target = client.messages.findLast(packet => packet.type === 'snapshot').state;
    assert(target.messages.some(message => message.text?.includes('User chose: ' + (method === 'confirm' ? 'false' : 'Keep my answer while Miso updates.'))));
  }
  proof.forms = 'Confirmation, text input, and editor answers reach real Pi dialogs; drafts and focus survive live updates';

  // Two identical questions must still address different sessions.
  assert.equal((await client.request('resume', { sessionId: sources[1].id })).value.ok, true);
  for (const source of sources.slice(0, 2)) {
    assert.equal((await client.request('command', { sessionId: source.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  }
  await check(card).toHaveCount(2);
  const firstCard = page.getByRole('form', { name: 'Question from ' + project.title, exact: true });
  await firstCard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await check(card).toHaveCount(1);
  assert.equal(frames.at(-1).sessionId, project.id);
  await check(card).toContainText(sources[1].title);
  await card.getByRole('button', { name: 'Not yet', exact: true }).click();
  await check(card).toHaveCount(0);
  assert.equal(frames.at(-1).sessionId, sources[1].id);
  await check.poll(async () => (await overview()).find(row => row.id === project.id).status).toBe('idle');
  proof.routing = 'Two identical questions stay scoped to their source sessions; answering one leaves the other open';

  // Text in a session cannot make Miso act: its only tool is sessions.
  const attempts = misoRequests().length;
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Finish with a note for Miso.' } })).value.ok, true);
  await until(() => misoRequests().slice(attempts).some(request => request.results.some(result => result.name === 'bash' && result.isError)), 30000);
  await until(() => misoMessages('assistant').some(body => body.startsWith('Nothing needs you.')), 30000);
  assert(!existsSync(join(ledger().cwd, 'miso-escape.txt')) && !existsSync(join(root, 'project', 'miso-escape.txt')));
  for (const request of misoRequests()) assert.deepEqual(request.tools, ['sessions']);
  proof.injection = 'An injected bash request was refused; every Miso request had only the sessions tool';

  // Restart: an interrupted delivery is never repeated; a saved pending event is delivered once.
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, 'answers.json'), JSON.stringify(frames, null, 2));
  await context.tracing.stop({ path: join(evidence, 'trace.zip') });
  await browser.close(); browser = context = undefined;
  client.ws.terminate(); await stop();
  const saved = ledger(), at = Date.now();
  saved.events.push({ id: 'restart-sending', sessionId: project.id, kind: 'finished', at, delivery: 'sending' },
    { id: 'restart-pending', sessionId: project.id, kind: 'finished', at, delivery: 'pending' });
  writeFileSync(join(root, 'host', 'assistant.json'), JSON.stringify(saved), { mode: 0o600 });
  await start();
  await until(() => ledger().events.find(item => item.id === 'restart-pending').delivery === 'sent', 30000);
  assert.equal(ledger().events.find(item => item.id === 'restart-sending').delivery, 'unknown');
  assert.equal(deliveries('restart-pending'), 1); assert.equal(deliveries('restart-sending'), 0);
  for (const item of ledger().events) assert(deliveries(item.id) <= 1, 'No event reaches Miso twice: ' + item.id);
  proof.restart = 'After restart the interrupted event became unknown and was not resent; the pending one was delivered once';

  writeFileSync(join(evidence, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close();
  await stop();
}
