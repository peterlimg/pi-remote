#!/usr/bin/env node
// Proves Miso through a real host and real Pi RPC processes. Only model replies are scripted.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { chromium, devices, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes, createECDH, createDecipheriv, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { socket, until } from './helpers.mjs';
import { Push } from '../src/push.mjs';

const clientToken = 'browser-test-token-only-123456789012345';
const port = Number(process.env.PI_REMOTE_ASSISTANT_TEST_PORT || 8816), url = 'http://127.0.0.1:' + port;
const evidence = mkdtempSync(join(tmpdir(), 'pi-assistant-proof-'));
console.log('Evidence: ' + evidence);
const env = { ...process.env, PI_OFFLINE: '1' };
for (const name of Object.keys(env)) if (name.startsWith('PI_REMOTE_') || name === 'PI_COORDINATOR_FIXTURE_ROOT') delete env[name];
Object.assign(env, { PI_REMOTE_COORDINATOR_TEST_PORT: String(port), PI_REMOTE_ASSISTANT_DELAY_MS: '300', PI_REMOTE_PUSH_TEST: '1' });

// A fake push service. Decryption here is written from RFC 8291 independently of src/push.mjs.
const pushes = [], receiver = createECDH('prime256v1'), authSecret = randomBytes(16);
receiver.generateKeys();
const pushServer = createServer((req, res) => {
  const chunks = []; req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => { pushes.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(req.url === '/gone' ? 410 : 201); res.end(); });
});
await new Promise(resolve => pushServer.listen(0, '127.0.0.1', resolve));
const pushOrigin = 'http://127.0.0.1:' + pushServer.address().port;
const openPush = push => {
  const salt = push.body.subarray(0, 16), sender = push.body.subarray(21, 21 + push.body[20]), sealed = push.body.subarray(21 + push.body[20]);
  const ikm = hkdfSync('sha256', receiver.computeSecret(sender), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), sender]), 32);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)),
    Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
  decipher.setAuthTag(sealed.subarray(-16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'Single final record delimiter');
  const [, jwt, k] = push.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/), [head, claims, signature] = jwt.split('.');
  const key = Buffer.from(k, 'base64url');
  const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: key.subarray(1, 33).toString('base64url'), y: key.subarray(33).toString('base64url') } });
  assert(verify('sha256', Buffer.from(head + '.' + claims), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), 'VAPID signature verifies');
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).aud, pushOrigin);
  assert.equal(push.headers['content-encoding'], 'aes128gcm');
  return JSON.parse(plain.subarray(0, -1));
};
const subscription = path => ({ endpoint: pushOrigin + path, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } });
// Production accepts only the browsers' HTTPS push services.
const production = new Push(mkdtempSync(join(tmpdir(), 'pi-push-')));
assert.throws(() => production.subscribe({ ...subscription('/x'), endpoint: 'https://attacker.example/x' }), /Invalid push subscription/);
assert.throws(() => production.subscribe({ ...subscription('/x'), endpoint: 'http://web.push.apple.com/x' }), /Invalid push subscription/);
assert.deepEqual(production.subscribe({ ...subscription('/x'), endpoint: 'https://web.push.apple.com/x' }), { subscribed: true });

const recording = process.env.PI_REMOTE_ASSISTANT_RECORD === '1', clips = [];
let recordAt, video;
const beginClip = name => { if (recording) clips.push({ name, start: (Date.now() - recordAt) / 1000 }); };
const endClip = async page => {
  if (!recording) return;
  await page.waitForTimeout(3000);
  clips.at(-1).end = (Date.now() - recordAt) / 1000;
  writeFileSync(join(evidence, 'clips.json'), JSON.stringify(clips, null, 2));
};
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
  let client = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
  await until(() => client.messages.some(packet => packet.type === 'ready'));
  assert.equal((await client.request('pin', { sessionId: project.id, pinned: true })).ok, true, 'List updates before Miso exists must not refresh an undefined session');
  browser = await chromium.launch({ channel: process.env.PI_REMOTE_TEST_CHANNEL });
  context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
    ...(recording ? { recordVideo: { dir: join(evidence, 'video'), size: { width: 390, height: 844 } } } : {}) });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.grantPermissions(['notifications'], { origin: url });
  const page = await context.newPage(), errors = [], frames = [];
  recordAt = Date.now(); video = page.video();
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString()); if (['answer', 'assistantDraft'].includes(packet.op)) frames.push(packet);
  }));
  await page.goto(url); await page.getByText('Paste a private link instead', { exact: true }).click();
  await page.getByLabel('Private login link').fill(clientToken); await page.getByRole('button', { name: 'Connect to computer' }).click();
  await check(page.locator('#connection')).toHaveText('Computer connected');
  beginClip('Open Miso');
  await page.locator('#assistant-open').click();
  await check(page.locator('#title')).toHaveText('Miso');
  await check(page.locator('.assistant-checkin')).toContainText("Hi, I'm Miso.");
  await check(page.locator('#project-name')).toHaveText(/^Watching \d+$/);
  await page.screenshot({ path: join(evidence, 'first-open.png') });
  proof.welcome = 'First open shows a greeting and a host-derived live-session check-in without a model call';
  await endClip(page);

  // The real service worker renders a delivered push; ?open= routes a notification tap to its session.
  await page.locator('.session-info > summary').click();
  await check(page.getByRole('button', { name: 'Turn on question notifications', exact: true })).toBeVisible();
  await check(page.getByRole('button', { name: 'Pin session', exact: true })).toBeHidden();
  await page.locator('.session-info > summary').click();
  const cdp = await context.newCDPSession(page);
  const registrationId = new Promise(resolve => cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const found = registrations.find(item => item.scopeURL === url + '/' && !item.isDeleted); if (found) resolve(found.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: url, registrationId: await registrationId,
    data: JSON.stringify({ sessionId: project.id, tag: 'question:proof', title: project.title, body: 'Post these 3 review comments to the PR?' }) });
  await check.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(item => [item.title, item.body, item.tag, item.data.sessionId])))
    .toEqual([[project.title, 'Post these 3 review comments to the PR?', 'question:proof', project.id]]);
  await page.goto(url + '/?open=' + project.id);
  await check(page.locator('#title')).toHaveText(project.title);
  assert.equal(new URL(page.url()).search, '');
  await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
  await page.locator('#assistant-open').click();
  await check(page.locator('#title')).toHaveText('Miso');
  proof.serviceWorker = 'The service worker shows a pushed question with its session, and the notification link opens that session';
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
  for (const path of ['/live', '/gone']) assert.equal((await client.request('pushSubscribe', { subscription: subscription(path) })).value.subscribed, true);
  assert.equal((await client.request('pushSubscribe', { subscription: { ...subscription('/x'), endpoint: 'https://attacker.example/x' } })).ok, false);
  const pushRecord = () => JSON.parse(readFileSync(join(root, 'host', 'push.json'), 'utf8'));
  assert.equal(pushRecord().subscriptions.length, 2);

  // A completion in the conversation on screen must not spend model tokens.
  const quietCalls = misoRequests().length, viewedFrom = ledger().events.length;
  await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(project.title) }).click();
  await check(page.locator('#title')).toHaveText(project.title);
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Finish with a note for Miso.' } })).value.ok, true);
  const viewedEvent = await until(() => ledger().events.slice(viewedFrom).find(item => item.kind === 'finished' && item.delivery !== 'pending'), 10000);
  assert.equal(viewedEvent.delivery, 'skipped', 'A viewed completion must not wake Miso');
  assert.equal(misoRequests().length, quietCalls, 'Watching this conversation must cost zero Miso model calls');
  // A question in the conversation on screen is already visible: no push.
  const viewedFrom2 = ledger().events.length;
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  const viewedQuestion = await until(() => ledger().events.slice(viewedFrom2).find(item => item.kind === 'question'), 15000);
  assert.equal(viewedQuestion.reason, 'viewed');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(pushes.length, 0, 'A viewed question must not notify');
  await client.request('watch', { sessionId: project.id });
  const viewedDialog = client.messages.findLast(packet => packet.type === 'snapshot' && packet.sessionId === project.id).state.dialog;
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: viewedDialog.id, value: 'Not yet' } })).value.ok, true);
  await check.poll(async () => (await overview()).find(row => row.id === project.id).status).toBe('idle');
  await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
  await page.locator('#assistant-open').click();
  await check(page.locator('#title')).toHaveText('Miso');
  proof.viewed = 'A completed turn in the foreground conversation is skipped without a Miso model call';

  // A question in another session reaches Miso once, and Miso cannot answer it.
  beginClip('A session needs your input');
  const questionCalls = misoRequests().length;
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  const card = page.locator('.assistant-question');
  await check(card).toContainText('Post these 3 review comments to the PR?');
  await check(card.getByRole('button', { name: 'Post them', exact: true })).toBeVisible();
  const question = await until(() => event('question'), 30000);
  await until(() => pushes.some(push => push.path === '/live'), 10000);
  assert.deepEqual(openPush(pushes.find(push => push.path === '/live')),
    { sessionId: project.id, tag: question.key, title: project.title, body: 'Post these 3 review comments to the PR?' });
  await until(() => pushRecord().subscriptions.length === 1, 5000);
  assert.equal(pushRecord().subscriptions[0].endpoint, pushOrigin + '/live', 'A gone (410) subscription is removed');
  proof.push = 'A question in a session not on screen pushes one VAPID-signed, RFC 8291-encrypted notification; viewed questions do not, and gone subscriptions are dropped';
  await until(() => misoMessages('assistant').some(body => body.includes('asks: Post these 3 review comments to the PR? (Post them / Not yet)')), 30000);
  assert.equal((await overview()).find(row => row.id === project.id).status, 'waiting', 'Miso must leave the question for the user');
  assert.equal((await client.request('watch', { sessionId: project.id })).ok, true);
  const dialog = client.messages.findLast(packet => packet.type === 'snapshot' && packet.sessionId === project.id).state.dialog;
  assert.equal(deliveries(question.id), 1);
  assert.equal(misoRequests().length - questionCalls, 1, 'A normal check-in summarizes the host snapshot in one model response');
  await check(page.locator('.tool-activity-label').filter({ hasText: /^Checked \d+ sessions?$/ })).toHaveCount(0);
  // Miso reads as a chat: no event rows, lookups, copy buttons or timings around its check-ins.
  await check(page.locator('#transcript .tool-activity')).toHaveCount(0);
  // The question sits in its session's thread row, answerable there.
  const projectRow = page.locator(`.thread-row[data-session-id="${project.id}"]`);
  await check(projectRow).toHaveCount(1);
  await check(projectRow.locator('.thread-state')).toHaveText('Needs you');
  await check(projectRow.locator('.assistant-question')).toContainText('Post these 3 review comments to the PR?');
  await check(page.locator('#transcript :is(.copy-message, .task-duration)')).toHaveCount(0);
  await check(page.locator('#project-name')).toHaveText('1 needs you');
  await check(page.locator('.tool-activity-progress')).toHaveCount(0);
  // A session opened from Miso goes back to Miso, by the back button or browser Back; Miso's back goes to the list.
  const swipe = (...steps) => page.evaluate(steps => {
    const main = document.querySelector('main'), touch = x => [new Touch({ identifier: 1, target: main, clientX: x, clientY: 300 })];
    for (const [type, x] of steps) main.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touch(x), changedTouches: touch(x) }));
    const backdrop = document.querySelector('.miso-backdrop');
    return { list: getComputedStyle(document.querySelector('aside')).visibility, backdrop: backdrop && getComputedStyle(backdrop).display };
  }, steps);
  const edgeSwipe = async () => {
    const during = await swipe(['touchstart', 5], ['touchmove', 20], ['touchmove', 200]);
    assert.deepEqual(during, { list: 'hidden', backdrop: 'block' }, 'Swiping back to Miso shows its copy, not the session list');
    await page.screenshot({ path: join(evidence, 'swipe-to-miso.png') });
    await swipe(['touchend', 200]);
  };
  for (const goBack of [() => page.getByRole('button', { name: 'Show sessions', exact: true }).click(), () => page.goBack(), edgeSwipe]) {
    await projectRow.locator('.thread-head').click();
    await check(page.locator('#title')).toHaveText(project.title);
    await goBack();
    await check(page.locator('#title')).toHaveText('Miso');
    await check(page.locator('#app')).toHaveClass(/viewing/);
  }
  await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
  await check(page.locator('#app')).not.toHaveClass(/viewing/);
  await page.locator('#assistant-open').click();
  await check(page.locator('#title')).toHaveText('Miso');
  proof.backToMiso = 'A session opened from Miso returns to Miso by back button, browser Back or edge swipe; Back from Miso returns to the list';
  await endClip(page);
  await page.reload(); await page.locator('#assistant-open').click();
  await check(card).toHaveAttribute('data-question-id', dialog.id);
  const layouts = [['phone-light', 'light', 390], ['phone-dark', 'dark', 390], ...(!recording ? [['desktop-light', 'light', 1200]] : [])];
  for (const [name, theme, width] of layouts) {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width, height: 844 });
    await card.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    await page.screenshot({ path: join(evidence, name + '.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  proof.question = 'A real host question appears without leaving Miso, survives reload, and has readable activity labels in ' + (recording ? 'phone light/dark layouts' : 'phone and desktop layouts');

  // The phone's answer must match the question it saw.
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: 'stale-dialog', value: 'Post them' } })).value.ok, false);
  const before = ledger().events.length;
  beginClip('Answer from Miso');
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
  await endClip(page);
  // A finished row wears the unread badge only until its session has been read.
  const badge = projectRow.locator('.thread-icon .bot-badge');
  await check(badge).toHaveCount(1, { timeout: 30000 });
  await projectRow.locator('.thread-head').click();
  await check(page.locator('#title')).toHaveText(project.title);
  await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
  await check(page.locator('#title')).toHaveText('Miso');
  await check(badge).toHaveCount(0);
  proof.unread = 'A finished session shows unread in Miso until it is opened';

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
      await check(page.locator('#project-name')).toHaveText('1 needs you');
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
  beginClip('Two questions stay separate');
  if (recording) await page.waitForTimeout(3000);
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
  await endClip(page);

  // A real Pi sessions tool prepares the draft; only the phone can approve its current revision.
  await client.request('watch', { sessionId: misoId });
  const post = async input => (await fetch(url + '/_pi/assistant', { method: 'POST',
    headers: { Authorization: 'Bearer ' + ledger().token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json();
  const draftAction = action => client.request('assistantDraft', { sessionId: misoId, action });
  const targetInputs = () => lines(project.file).filter(entry => entry.message?.role === 'user' && text(entry.message).startsWith('Miso approved instruction:'));
  beginClip('Prepare a draft, not a send');
  await page.locator('#prompt').fill('Prepare an approved instruction.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const draftCard = page.locator('.assistant-draft').filter({ hasText: 'Review before sending' });
  await check(draftCard).toHaveCount(1);
  const draftId = await draftCard.getAttribute('data-draft-id');
  assert.equal(targetInputs().length, 0);
  await endClip(page);
  for (const action of ['send', 'approve', 'cancel']) assert.equal((await post({ action, draftId, revision: 1 })).ok, false);
  assert.equal((await post({ action: 'draft', sessionId: project.id, text: '/reload', requestId: randomUUID() })).ok, false);
  await draftCard.getByLabel('Draft message').fill('Keep this unsaved edit.');
  assert.equal((await post({ action: 'draft', draftId, revision: 1, text: 'Miso approved instruction: newer draft.' })).ok, true);
  await check(draftCard.getByLabel('Draft message')).toHaveValue('Miso approved instruction: newer draft.');
  await check(draftCard).toContainText('Keep this unsaved edit.');
  beginClip('Review and save your edit');
  await draftCard.getByLabel('Draft message').fill('Miso approved instruction: report the revised result.');
  await check(draftCard.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await draftCard.getByRole('button', { name: 'Save changes', exact: true }).click();
  await until(() => ledger().drafts.find(draft => draft.id === draftId)?.revision === 3);
  assert.equal((await draftAction({ action: 'send', draftId, revision: 1 })).value.ok, false);
  assert.equal(targetInputs().length, 0);
  await check(draftCard.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.screenshot({ path: join(evidence, 'draft-review.png') });
  await endClip(page);
  beginClip('Send once and collect the reply');
  await draftCard.getByRole('button', { name: 'Send', exact: true }).click();
  const receipt = page.locator(`[data-draft-id="${draftId}"]`);
  await until(() => ledger().drafts.find(draft => draft.id === draftId).feedback?.text === 'Instruction received: Miso approved instruction: report the revised result.');
  await check(receipt).toHaveCount(0);
  assert.equal(targetInputs().length, 1);
  assert.equal(text(targetInputs()[0].message), 'Miso approved instruction: report the revised result.');
  assert.equal((await draftAction({ action: 'send', draftId, revision: 3 })).value.ok, true);
  assert.equal(targetInputs().length, 1, 'A fresh request ID must not send a delivered draft again');
  assert.equal((await post({ action: 'draft', draftId, revision: 3, text: 'Changed after approval.' })).ok, false);
  await page.screenshot({ path: join(evidence, 'draft-reply.png') });
  proof.drafts = 'A real tool prepares a draft; editing invalidates the old revision, only phone Send delivers once, and its completed reply returns to Miso';
  await endClip(page);

  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  await check(page.locator('.assistant-question:not(.assistant-draft)')).toHaveCount(1);
  const pendingDraft = (await post({ action: 'draft', sessionId: project.id, text: 'Miso approved instruction: do not interrupt.', requestId: randomUUID() })).value;
  assert.equal((await draftAction({ action: 'send', draftId: pendingDraft.id, revision: 1 })).value.ok, false);
  assert.equal(ledger().drafts.find(draft => draft.id === pendingDraft.id).state, 'drafted');
  if (recording) {
    beginClip('Busy targets are left alone');
    const busyCard = page.locator(`[data-draft-id="${pendingDraft.id}"]`);
    await busyCard.getByRole('button', { name: 'Send', exact: true }).click();
    await check(busyCard).toContainText('This session is busy.');
    await endClip(page);
  }
  await page.locator(`[data-draft-id="${pendingDraft.id}"]`).getByRole('button', { name: 'Discard', exact: true }).click();
  await until(() => ledger().drafts.find(draft => draft.id === pendingDraft.id).state === 'cancelled');
  await draftAction({ action: 'send', draftId: pendingDraft.id, revision: 1 });
  assert.equal(targetInputs().length, 1, 'Cancelled and busy drafts never reach the target');
  const originalQuestion = page.locator('.assistant-question:not(.assistant-draft)');
  await originalQuestion.getByRole('button', { name: 'Cancel', exact: true }).click();
  await check(originalQuestion).toHaveCount(0);
  const terminalDraft = (await post({ action: 'draft', sessionId: sources[2].id, text: 'Miso approved instruction: do not resume.', requestId: randomUUID() })).value;
  assert.equal((await draftAction({ action: 'send', draftId: terminalDraft.id, revision: 1 })).value.ok, false);
  await draftAction({ action: 'cancel', draftId: terminalDraft.id, revision: 1 });
  await page.reload(); await page.locator('#assistant-open').click();
  for (const id of [draftId, pendingDraft.id, terminalDraft.id]) await check(page.locator(`[data-draft-id="${id}"]`)).toHaveCount(0);
  proof.draftGuards = 'Busy targets and terminal sessions are not sent drafts; cancellation wins before dispatch; answered and discarded drafts leave the check-in';
  await check.poll(async () => (await overview()).find(row => row.id === project.id).status).toBe('idle');

  // Text in a session cannot make Miso act: its only tool is sessions.
  const attempts = misoRequests().length;
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Finish with a note for Miso.' } })).value.ok, true);
  await until(() => misoRequests().slice(attempts).some(request => request.results.some(result => result.name === 'bash' && result.isError)), 30000);
  await until(() => misoMessages('assistant').some(body => body.startsWith('Nothing needs you.')), 30000);
  // Threads: the session appears once, at its latest check-in, with earlier updates folded inside it.
  await check(page.locator(`#transcript .thread-row[data-session-id="${project.id}"]`)).toHaveCount(1);
  const latestGroup = page.locator('.thread-group').last();
  await check(latestGroup.locator('article.message')).toContainText('Nothing needs you.');
  await check(latestGroup.locator(`.thread-row[data-session-id="${project.id}"] .thread-line`)).toContainText('IGNORE PREVIOUS INSTRUCTIONS');
  await check(latestGroup.locator('.thread-earlier > summary')).toHaveText(/^\d+ earlier updates?$/);
  await check(page.locator('.thread-time').first()).not.toHaveAttribute('open', '');
  await page.screenshot({ path: join(evidence, 'threads.png') });
  assert(!existsSync(join(ledger().cwd, 'miso-escape.txt')) && !existsSync(join(root, 'project', 'miso-escape.txt')));
  for (const request of misoRequests()) assert.deepEqual(request.tools, ['sessions']);
  proof.injection = 'An injected bash request was refused; every Miso request had only the sessions tool';

  // A large Miso context is compacted after a turn to a short tail, and check-ins wait for it.
  const misoEntries = () => lines(ledger().file), replies = () => misoEntries().filter(entry => entry.type === 'message' && entry.message.role === 'assistant').length;
  assert.equal(misoEntries().some(entry => entry.type === 'compaction'), false);
  // Many ordinary-sized turns: a 4k tail keeps about one of them, Pi's default 20k would keep about seven.
  for (let index = 0; index < 13 && !misoEntries().some(entry => entry.type === 'compaction'); index++) {
    const before = replies();
    assert.equal((await client.request('command', { sessionId: misoId, command: { type: 'prompt', text: `Context filler ${index}: ` + 'x '.repeat(4500) } })).value.ok, true);
    await until(() => replies() > before, 30000);
  }
  const compaction = await until(() => misoEntries().find(entry => entry.type === 'compaction'), 60000);
  assert(compaction.tokensBefore > 30000, 'Compaction starts only above the threshold');
  const kept = misoEntries().slice(misoEntries().findIndex(entry => entry.id === compaction.firstKeptEntryId)).filter(entry => entry.type === 'message');
  assert(JSON.stringify(kept.map(entry => entry.message.content)).length < 20000, 'Miso keeps a short tail, not Pi\'s default 20k tokens');
  assert.equal(misoEntries().filter(entry => entry.type === 'compaction').length, 1, 'A compacted context does not compact again');
  const compactedCalls = misoRequests().length;
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  await until(() => misoMessages('assistant').filter(body => body.includes('asks: Post these 3 review comments')).length >= 2 && misoRequests().length > compactedCalls, 30000);
  await client.request('watch', { sessionId: project.id });
  const compactedDialog = client.messages.findLast(packet => packet.type === 'snapshot' && packet.sessionId === project.id).state.dialog;
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: compactedDialog.id, cancelled: true } })).value.ok, true);
  await check.poll(async () => (await overview()).find(row => row.id === project.id).status).toBe('idle');
  proof.compaction = 'Above 30k tokens Miso compacts once after its turn, keeps only a short tail, and the next check-in still arrives';

  const tags = pushes.filter(push => push.path === '/live').map(push => openPush(push).tag);
  assert.equal(new Set(tags).size, tags.length, 'At most one push per question');
  assert(!tags.includes(viewedQuestion.key));
  // Restart: an interrupted delivery is never repeated; a saved pending event is delivered once.
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, 'answers.json'), JSON.stringify(frames, null, 2));
  await context.tracing.stop({ path: join(evidence, 'trace.zip') });
  await context.close();
  if (recording) await video.saveAs(join(evidence, 'miso-proof.webm'));
  await browser.close(); browser = context = undefined;
  client.ws.terminate(); await stop();
  const saved = ledger(), at = Date.now();
  const lastChange = saved.events.findLast(item => item.sessionId === project.id && item.kind === 'finished');
  saved.events.push({ id: 'restart-sending', sessionId: project.id, key: lastChange.key, kind: 'finished', at, delivery: 'sending' },
    { id: 'restart-pending', sessionId: project.id, key: lastChange.key, kind: 'finished', at, delivery: 'pending' });
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
  pushServer.close();
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close();
  await stop();
}
