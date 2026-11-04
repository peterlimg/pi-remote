#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { chromium, devices, expect } from '@playwright/test';
import { socket, until, delay } from './helpers.mjs';

const clientToken = 'browser-test-token-only-123456789012345';
const bridgeToken = 'coordinator-bridge-fixture-only-123456789012345';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const lines = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const check = expect.configure({ timeout: 30000 });

async function doctor(pid, url) {
  assert(Number.isSafeInteger(pid) && pid > 0); process.kill(pid, 0);
  const health = await fetch(url + '/health', { signal: AbortSignal.timeout(3000) }); assert.equal(health.status, 200);
  const status = await fetch(url + '/_pi/remote', { headers: { Authorization: 'Bearer ' + bridgeToken }, signal: AbortSignal.timeout(3000) });
  assert.equal(status.status, 200); assert.equal((await status.json()).pid, pid, 'The listener must be the fixture we launched');
  for (const file of ['app.js', 'style.css', 'index.html']) {
    const response = await fetch(url + (file === 'index.html' ? '/' : '/' + file));
    assert.equal(response.status, 200); assert.equal(await response.text(), readFileSync('web/' + file, 'utf8'), 'Fixture must serve this checkout: ' + file);
  }
  const client = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
  try {
    await until(() => client.messages.some(packet => packet.type === 'ready'));
    assert.equal(client.messages.find(packet => packet.type === 'ready').supportsCoordinator, true);
    const page = await client.request('list', { limit: 100 });
    const sessions = page.value.sessions || page.value.changes;
    assert(sessions.some(session => session.title === 'Coordinator verification project'));
  } finally { client.ws.terminate(); }
  return { pid, url, health: 200, build: 'matches checkout', auth: 'accepted', coordinator: true };
}

if (process.argv[2] === 'doctor') {
  console.log(JSON.stringify(await doctor(Number(process.argv[3]), process.argv[4] || 'http://127.0.0.1:8813'), null, 2));
} else {
  assert.equal(process.argv.length, 2, 'Usage: coordinator-e2e.mjs [doctor PID URL]');
  const port = Number(process.env.PI_REMOTE_COORDINATOR_TEST_PORT || 8813), url = 'http://127.0.0.1:' + port;
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
  const version = execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim();
  assert(/^(?:[2-9]\d*|1\.(?:[4-9]|[1-9]\d+))\./.test(version), 'Pi 1.4 or newer is required, found ' + version);
  const evidence = mkdtempSync(join(tmpdir(), 'pi-coordinator-proof-')), scratch = join(evidence, 'scratch'); mkdirSync(scratch);
  console.log('Evidence: ' + evidence);
  const save = (name, value) => writeFileSync(join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const record = (action, detail = {}) => appendFileSync(join(evidence, 'actions.jsonl'), JSON.stringify({ at: new Date().toISOString(), action, ...detail }) + '\n');
  const env = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, PI_OFFLINE: '1' };
  for (const name of Object.keys(env)) if (name.startsWith('PI_REMOTE_')) delete env[name];
  delete env.PI_COORDINATOR_FIXTURE_ROOT; delete env.PI_MODEL; delete env.PI_PROVIDER;
  env.PI_REMOTE_COORDINATOR_TEST_PORT = String(port);
  let running, root, starts = 0, browser, context, page;
  const start = async () => {
    const logFile = join(evidence, 'host-' + (++starts) + '.log'), log = openSync(logFile, 'w');
    const child = spawn(process.execPath, ['test/coordinator-server.mjs'], { env: { ...env, ...(root ? { PI_COORDINATOR_FIXTURE_ROOT: root } : {}) }, stdio: ['ignore', 'pipe', log] }); closeSync(log);
    const stopped = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const ready = Promise.withResolvers(); let buffer = '';
    child.stdout.on('data', chunk => {
      appendFileSync(logFile, chunk); buffer += chunk.toString(); let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try { const value = JSON.parse(line); if (value.fixture === 'coordinator') ready.resolve(value); } catch {}
      }
    });
    child.once('error', ready.reject); child.once('exit', () => ready.reject(new Error('Fixture exited; inspect ' + logFile)));
    running = { child, stopped };
    const timer = setTimeout(() => ready.reject(new Error('Fixture startup timed out; inspect ' + logFile)), 20000);
    try { const info = await ready.promise; root = info.root; return info; } finally { clearTimeout(timer); }
  };
  const stop = async () => {
    if (!running) return;
    const instance = running; running = undefined;
    if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGTERM');
    const timer = setTimeout(() => instance.child.kill('SIGKILL'), 10000);
    try { return await instance.stopped; } finally { clearTimeout(timer); }
  };
    const api = async (token, input, origin) => {
      const response = await fetch(url + '/_pi/coordinator', { method: input ? 'POST' : 'GET',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}) });
      return { status: response.status, body: await response.json() };
    };
  const ledger = () => json(join(root, 'host', 'coordinator-tasks.json'));
  const owner = () => ledger().coordinators.find(owner => owner.cwd === join(root, 'project'));
  const entries = file => lines(file).filter(entry => entry.type === 'message');
  const eventCount = file => entries(file).filter(entry => entry.message.role === 'user' && JSON.stringify(entry.message.content).includes('[Pi Remote task events]')).length;
  const taskRow = name => page.getByRole('listitem', { name, exact: true });
  const snapshot = async name => {
    await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true });
    save(name + '.aria.txt', await page.locator('body').ariaSnapshot());
    record('capture', { name });
  };
  const openTasks = async () => {
    await page.getByLabel('Session details', { exact: true }).click();
    await page.getByRole('button', { name: 'Background tasks', exact: true }).click(); await check(page.locator('#coordinator-sheet')).toBeVisible();
  };
  const closeTasks = () => page.getByRole('button', { name: 'Done', exact: true }).click();
  const assertHierarchy = async () => {
    const client = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
    try {
      const tasks = ledger().tasks, workers = new Set(tasks.map(task => task.sessionId));
      assert.equal((await client.request('pin', { sessionId: tasks[0].sessionId, pinned: true })).ok, true);
      const roots = [];
      for (const section of [undefined, 'overview', 'now', 'pinned']) {
        const response = await client.request('list', { limit: 100, section, availability: 'all' });
        const rows = response.value.sessions || response.value.changes;
        roots.push({ section: section || 'all', onlyRoots: !rows.some(row => workers.has(row.id)) });
        if (!section) assert(rows.some(row => row.id === owner().id), 'The coordinator must remain a top-level session');
      }
      const search = await client.request('list', { limit: 100, query: 'First inspection' });
      assert((search.value.sessions || search.value.changes).some(row => row.id === tasks[0].sessionId), 'Workers must remain searchable');
      await client.request('pin', { sessionId: tasks[0].sessionId, pinned: false });
      const region = page.getByRole('region', { name: 'Workers', exact: true });
      const hierarchy = {
        globalListHasOnlyRoots: roots.every(result => result.onlyRoots),
        workersVisibleInChat: await region.count() === 1 && (await region.innerText()).includes('First inspection') && (await region.innerText()).includes('Second inspection')
      };
      save('hierarchy.json', { ...hierarchy, sections: roots });
      assert.deepEqual(hierarchy, { globalListHasOnlyRoots: true, workersVisibleInChat: true });
      record('workers belong to their coordinator, not global list sections');
    } finally { client.ws.terminate(); }
  };
  const send = async text => { record('send', { text }); await page.locator('#prompt').fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); };
  const restoreCoordinator = async () => {
    await page.reload();
    await check(page.locator('#connection')).toHaveText('Computer connected');
    await page.getByRole('button', { name: /Coordinator · project/ }).click();
    await check(page.locator('#coordinator-context')).toBeVisible();
  };
  const interrupt = () => { process.exitCode = 130; void browser?.close(); running?.child.kill('SIGTERM'); };
  process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
  const errors = [], frames = [];
  const observe = view => {
    view.on('pageerror', error => errors.push(error.message));
    view.on('websocket', ws => {
      ws.on('framesent', ({ payload }) => { const packet = JSON.parse(payload.toString()); if (packet.type !== 'auth') frames.push({ direction: 'sent', packet }); });
      ws.on('framereceived', ({ payload }) => frames.push({ direction: 'received', packet: JSON.parse(payload.toString()) }));
    });
  };
  try {
    const initial = await start();
    save('run.json', { feature: 'coordinator', entry: 'phone conversation', version, pid: initial.pid, url,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirtyPaths: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), fixture: 'real host and Pi runtime; deterministic model provider' });
    save('doctor.json', await doctor(initial.pid, url));
    const original = ['alpha.txt', 'beta.txt'].map(file => hash(readFileSync(join(root, 'project', file))));
    browser = await chromium.launch();
    context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page = await context.newPage(); observe(page);
    await page.goto(url); await page.getByText('Paste a private link instead', { exact: true }).click();
    await page.getByLabel('Private login link').fill(clientToken); await page.getByRole('button', { name: 'Connect to computer' }).click();
    await check(page.locator('#connection')).toHaveText('Computer connected'); record('manual login');
    await page.getByRole('button', { name: /Coordinator verification project/ }).click();
    await page.getByLabel('Session details', { exact: true }).click();
    record('start coordinator'); await page.getByRole('button', { name: 'Start read-only coordinator', exact: true }).click();
    await check(page.locator('#title')).toHaveText('Coordinator · project');
    await check(page.getByRole('heading', { name: 'Read-only coordinator', exact: true })).toBeVisible();
    await send('Investigate both fixture files.'); await openTasks();
    await check(taskRow('First inspection')).toContainText('Needs answer');
    await check(taskRow('Second inspection')).toContainText('Working');
    await check(page.locator('#coordinator-task-list').getByRole('listitem')).toHaveCount(2);
    await snapshot('assignment-and-question'); record('two independent tasks', { states: ledger().tasks.map(({ title, state }) => ({ title, state })) });
    await closeTasks();
    await check(page.locator('#transcript')).toContainText('Should I keep the original identifier in alpha.txt?');
    await assertHierarchy();
    const deniedClient = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
    try {
      const first = ledger().tasks.find(task => task.title === 'First inspection');
      const prompts = entries(first.file).filter(entry => entry.message.role === 'user').length;
      for (const command of [
        ...['prompt', 'steer', 'followUp'].map(type => ({ type, text: 'Do not deliver this direct input.' })), { type: 'abort' },
        { type: 'setModel', provider: 'coordinator-fixture', modelId: 'fixture' }, { type: 'setThinkingLevel', level: 'max' }, { type: 'compact' }
      ]) {
        const response = await deniedClient.request('command', { sessionId: first.sessionId, command });
        assert.equal(response.value?.ok, false); assert.equal(response.value.error, 'Worker logs are read-only. Send instructions to the coordinator.');
      }
      const answer = await deniedClient.request('answer', { sessionId: first.sessionId, answer: { dialogId: 'no-dialog', value: 'Do not deliver this.' } });
      assert.equal(answer.value?.ok, false); assert.equal(answer.value.error, 'Worker logs are read-only. Send instructions to the coordinator.');
      assert.equal(entries(first.file).filter(entry => entry.message.role === 'user').length, prompts);
      assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'waiting');
      record('worker input, dialog responses, model changes, compaction and abort rejected at the serialized client boundary');
    } finally { deniedClient.ws.terminate(); }
    const layout = [];
    for (const [name, width, height, colorScheme] of [
      ['workers-phone-light', 390, 844, 'light'], ['workers-phone-dark', 390, 844, 'dark'],
      ['workers-narrow', 320, 740, 'light'], ['workers-short', 390, 510, 'light'], ['workers-desktop', 1440, 900, 'light']
    ]) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
      if (height < 600) await page.locator('#prompt').focus(); else await page.locator('#prompt').blur();
      const workers = page.getByRole('region', { name: 'Workers', exact: true });
      await check(workers.getByRole('button', { name: 'First inspection, Needs answer', exact: true })).toBeVisible();
      await check(workers.getByRole('button', { name: 'Second inspection, Working', exact: true })).toBeVisible();
      const measured = await page.evaluate(() => {
        const rect = id => { const box = document.getElementById(id).getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height }; };
        return { workers: rect('coordinator-context'), transcript: rect('transcript'), composer: rect('composer'),
          overflow: document.documentElement.scrollWidth > innerWidth,
          namesReadable: [...document.querySelectorAll('#coordinator-worker-links strong')].every(node => node.scrollWidth <= node.clientWidth + 1),
          unboxed: [...document.querySelectorAll('#coordinator-worker-links button')].every(node => {
            const style = getComputedStyle(node); return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderRadius === '0px' && style.boxShadow === 'none';
          }),
          targets: [...document.querySelectorAll('#coordinator-worker-links button')].every(node => { const box = node.getBoundingClientRect(); return box.width >= 44 && box.height >= 44; }) };
      });
      assert(!measured.overflow && measured.targets && measured.unboxed && measured.namesReadable && measured.transcript.height >= 80);
      assert(measured.workers.height <= Math.min(height * .36, 280) + 1, 'The session tree must stay bounded');
      assert.equal(await page.locator('#coordinator-worker-links').evaluate(node => getComputedStyle(node).borderLeftWidth), '1px');
      await check(page.locator('#coordinator-owner')).toHaveAttribute('aria-current', 'page');
      assert(measured.transcript.bottom <= measured.workers.top + 1 && measured.workers.bottom <= measured.composer.top + 1);
      assert(measured.composer.top - measured.workers.bottom <= 12 && measured.composer.bottom <= height + 1);
      layout.push({ name, width, height, colorScheme, ...measured }); await snapshot(name);
      const disclosure = page.locator('#coordinator-workers'), toggle = disclosure.locator('summary');
      await toggle.click(); await check(disclosure).toHaveJSProperty('open', false);
      await check(page.locator('#coordinator-worker-links button:visible')).toHaveCount(0);
      await check(page.locator('#coordinator-worker-summary')).toHaveText('1 working · 1 needs answer');
      assert((await workers.boundingBox()).height <= 48, 'Collapsed workers must fit one touch-height row');
      await snapshot(name + '-collapsed');
      await toggle.focus(); await page.keyboard.press('Space'); await check(disclosure).toHaveJSProperty('open', true);
      if (height < 600) {
        await page.locator('#transcript').evaluate(node => node.scrollTo(0, 0));
        await check(page.getByRole('button', { name: 'Go to thread bottom', exact: true })).toBeVisible();
        const jump = await page.locator('#scroll-bottom').boundingBox(), dock = await workers.boundingBox();
        assert(jump.y + jump.height <= dock.y, 'Go to thread bottom must not cover the worker controls');
        await snapshot('workers-short-scrolled');
        await page.getByRole('button', { name: 'Go to thread bottom', exact: true }).click();
        await check(page.locator('#scroll-bottom')).toBeHidden();
        record('floating scroll control clears the worker dock and still reaches latest messages');
      }
    }
    save('worker-layout.json', layout);
    await page.locator('#prompt').blur(); await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#back').click();
    await check(page.locator('#sessions .session').filter({ hasText: 'First inspection' })).toHaveCount(0);
    await check(page.locator('#sessions .session').filter({ hasText: 'Second inspection' })).toHaveCount(0);
    await snapshot('global-roots-only');
    await page.locator('#sessions').getByRole('button', { name: /Coordinator · project/ }).click();
    const overLimit = await api(owner().token, { action: 'assign', title: 'Unwanted third task', instruction: 'This must not be dispatched.', requestId: hash(randomUUID()) });
    assert.equal(overLimit.body.ok, false); assert.equal(ledger().tasks.length, 2); record('third active task refused without dispatch');
    await send('Which tasks are still open?');
    await check(page.locator('#transcript')).toContainText('Second inspection is working');
    assert.equal(ledger().tasks.find(task => task.title === 'Second inspection').state, 'working'); record('coordinator responds while worker remains active');
    await check(page.locator('#transcript .message.user').filter({ hasText: '[Pi Remote task events]' })).toHaveCount(0);
    await check(page.locator('#transcript .tool-activity-label').filter({ hasText: 'Prompted by an extension' }).first()).toBeVisible();
    record('internal wake-up instructions stay in collapsed activity rather than user bubbles');
    await page.locator('#coordinator-workers > summary').click();
    await send('Keep the original identifier.');
    await until(() => ledger().tasks.find(task => task.title === 'First inspection').state === 'reported', 30000);
    await check(page.locator('#transcript')).toContainText('I sent your answer to First inspection');
    await check(page.locator('#coordinator-workers')).toHaveJSProperty('open', false);
    record('coordinator relays the main-session answer while the tree stays collapsed');
    await openTasks(); await check(taskRow('First inspection')).toContainText('ALPHA_VALUE=stable');
    await check(page.getByRole('button', { name: /Reply in worker|Accept result|Stop task/ })).toHaveCount(0);
    await snapshot('returned-result'); await closeTasks();
    await send('Review and accept the first result.');
    await until(() => ledger().tasks.find(task => task.title === 'First inspection').state === 'completed', 30000);
    await check(page.locator('#transcript')).toContainText('I reviewed and accepted First inspection: ALPHA_VALUE=stable');
    await page.locator('#coordinator-workers > summary').click();
    await page.locator('#prompt').fill('Keep my coordinator draft.');
    await page.locator('#image-files').setInputFiles({ name: 'draft.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=', 'base64') });
    await check(page.locator('#attachments img')).toBeVisible();
    await page.getByRole('region', { name: 'Workers', exact: true }).getByRole('button', { name: 'First inspection, Accepted', exact: true }).click();
    record('inspect worker through the selected C tree');
    await check(page.locator('#title')).toHaveText('First inspection');
    await check(page.locator('#composer')).toBeHidden(); await check(page.locator('#status-line')).toBeHidden();
    await check(page.locator('#coordinator-inspection-note')).toContainText('Read-only worker log');
    await check(page.locator('textarea:visible, input:visible')).toHaveCount(0);
    await check(page.locator('#transcript .message.user')).toHaveCount(0);
    await check(page.locator('#transcript .tool-activity-label').filter({ hasText: 'write failed 1 time' })).toHaveCount(1);
    assert(!/wrote/i.test((await page.locator('#transcript .tool-activity-label').allTextContents()).join(' ')), 'Blocked writes must not look like successful file changes');
    await check(page.locator('#coordinator-owner')).not.toHaveAttribute('aria-current', 'page');
    await check(page.getByRole('button', { name: 'Second inspection, Working', exact: true })).toBeVisible();
    await snapshot('worker-read-only');
    const control = await context.newPage(); observe(control);
    try {
      await control.goto(url); await check(control.locator('#connection')).toHaveText('Computer connected');
      await control.getByRole('button', { name: /Coordinator · project/ }).click();
      await control.locator('#prompt').fill('Stop Second inspection.');
      await control.getByRole('button', { name: 'Send message', exact: true }).click();
      await check(control.locator('#transcript')).toContainText('I stopped Second inspection only');
      await check(page.getByRole('button', { name: 'Second inspection, Stopped', exact: true })).toBeVisible();
      record('main-session Stop from another tab updates the inspected worker sibling tree');
    } finally { await control.close(); }
    await page.getByRole('button', { name: 'Return to coordinator', exact: true }).click();
    await check(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
    await check(page.locator('#attachments img')).toBeVisible();
    await page.locator('#attachments button').click(); await page.locator('#prompt').fill('');
    await openTasks(); await check(taskRow('First inspection')).toContainText('Accepted'); await check(taskRow('Second inspection')).toContainText('Stopped');
    assert.equal(ledger().tasks.find(task => task.title === 'First inspection').state, 'completed');
    record('coordinator accepts the result and stops only the addressed sibling; draft and attachment survive log inspection');
    await page.emulateMedia({ colorScheme: 'dark' }); await snapshot('result-and-scoped-stop');
    await closeTasks(); await restoreCoordinator(); await assertHierarchy(); await openTasks();
    await check(taskRow('First inspection')).toContainText('Accepted'); await check(taskRow('Second inspection')).toContainText('Stopped');
    await taskRow('First inspection').getByText('Last result', { exact: true }).click(); await check(taskRow('First inspection')).toContainText('ALPHA_VALUE=stable');
    record('reload preserves task ownership and report'); await closeTasks();
    await send('Start an interrupted task.'); await openTasks(); await check(taskRow('Interrupted inspection')).toContainText('Working');
    await closeTasks(); await check(page.locator('#abort')).toBeHidden();
    const before = ledger(), main = owner(), first = before.tasks.find(task => task.title === 'First inspection');
    const promptsBefore = Object.fromEntries(before.tasks.map(task => [task.id, entries(task.file).filter(entry => entry.message.role === 'user').length]));
    const eventsBefore = eventCount(main.file), oldPid = running.child.pid;
    record('stop owned fixture host during active work', { pid: oldPid }); await stop();
    const requestsBefore = lines(join(root, 'provider.jsonl')).filter(event => event.kind === 'request').length;
    const restarted = await start(); assert.notEqual(restarted.pid, oldPid); save('restart-doctor.json', await doctor(restarted.pid, url));
    const deadline = Date.now() + 40000; let restored;
    do {
      const status = await fetch(url + '/_pi/remote', { headers: { Authorization: 'Bearer ' + bridgeToken }, signal: AbortSignal.timeout(3000) });
      restored = await status.json();
      if (restored.busyWorkers === 0 && restored.managedSessions.length >= 4) break;
      await delay(20);
    } while (Date.now() < deadline);
    assert(restored.busyWorkers === 0 && restored.managedSessions.length >= 4, 'All four native sessions must finish restoring before the no-replay check');
    await restoreCoordinator(); await assertHierarchy(); await openTasks();
    await check(taskRow('Interrupted inspection')).toContainText('Needs inspection');
    await check(taskRow('First inspection')).toContainText('Accepted'); await check(taskRow('Second inspection')).toContainText('Stopped');
    for (const task of ledger().tasks) assert.equal(entries(task.file).filter(entry => entry.message.role === 'user').length, promptsBefore[task.id], 'Restart must not replay a task instruction');
    assert.equal(eventCount(main.file), eventsBefore, 'Restart must not reannounce acknowledged notifications');
    assert.equal(lines(join(root, 'provider.jsonl')).filter(event => event.kind === 'request').length, requestsBefore, 'Restore must not invoke the model again');
    await snapshot('recovery-without-replay'); record('new host restores ownership and exposes interrupted work without replay', { previousPid: oldPid, pid: restarted.pid });
    assert.equal((await api()).status, 403);
    assert.equal((await api(main.token, undefined, 'https://untrusted.invalid')).status, 403);
    const second = ledger().tasks.find(task => task.title === 'Second inspection');
    assert.equal((await api(second.token, { requestId: hash(randomUUID()), action: 'list' })).status, 403);
    const late = await api(second.token, { requestId: hash(randomUUID()), kind: 'result', text: 'A stopped task must not accept this report.' });
    assert.equal(late.body.ok, false); assert.equal(ledger().tasks.find(task => task.id === second.id).state, 'stopped');
    const client = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
    try {
      const created = await client.request('newCoordinator', { sessionId: restarted.sources.find(source => source.title === 'Other verification project').id });
      assert.equal(created.ok, true); assert.notEqual(created.value?.ok, false);
      const other = ledger().coordinators.find(candidate => candidate.cwd === join(root, 'other-project'));
      const denied = await api(other.token, { action: 'inspect', taskId: first.id, requestId: hash(randomUUID()) });
      assert.equal(denied.body.ok, false); assert(denied.status >= 400);
    } finally { client.ws.terminate(); }
    for (const title of ['Capacity A', 'Capacity B']) assert.equal((await api(main.token, {
      action: 'assign', title, instruction: 'Inspect beta.txt and keep investigating until stopped.', requestId: hash(randomUUID())
    })).body.ok, true);
    const promptsAtCapacity = entries(first.file).filter(entry => entry.message.role === 'user').length;
    const overCapacity = await api(main.token, { action: 'message', taskId: first.id, text: 'Keep the original identifier.', requestId: hash(randomUUID()) });
    assert.equal(overCapacity.body.ok, false); assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'completed');
    const directClient = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
    try {
      const denied = await directClient.request('command', { sessionId: first.sessionId, command: { type: 'prompt', text: 'Keep the original identifier.' } });
      assert.equal(denied.value?.ok, false); assert.equal(denied.value.error, 'Worker logs are read-only. Send instructions to the coordinator.');
    } finally { directClient.ws.terminate(); }
    await taskRow('First inspection').getByRole('button', { name: 'View worker log', exact: true }).click();
    await check(page.locator('#composer')).toBeHidden();
    assert.equal(entries(first.file).filter(entry => entry.message.role === 'user').length, promptsAtCapacity);
    assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'completed');
    record('task capacity enforced for coordinator follow-ups; direct worker input remains refused');
    await page.getByRole('button', { name: 'Return to coordinator', exact: true }).click();
    const toolCalls = file => entries(file).flatMap(entry => Array.isArray(entry.message.content) ? entry.message.content : []).filter(block => block.type === 'toolCall');
    const assign = toolCalls(main.file).find(call => call.name === 'remote_tasks' && call.arguments?.action === 'assign' && call.arguments.title === 'First inspection');
    const taskCount = ledger().tasks.length, eventTotal = ledger().tasks.reduce((count, task) => count + task.events.length, 0);
    assert.equal((await api(main.token, { ...assign.arguments, requestId: hash(assign.id) })).body.ok, true);
    const report = toolCalls(first.file).find(call => call.name === 'task_report' && call.arguments.kind === 'result');
    assert.equal((await api(first.token, { ...report.arguments, requestId: hash(report.id) })).body.ok, true);
    assert.equal(ledger().tasks.length, taskCount); assert.equal(ledger().tasks.reduce((count, task) => count + task.events.length, 0), eventTotal);
    assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'completed'); record('scope checks and idempotent assignment/report retries');
    const audit = lines(join(root, 'provider.jsonl')), requests = audit.filter(event => event.kind === 'request');
    for (const request of requests) assert.deepEqual([...request.tools].sort(), request.role === 'coordinator' ? ['remote_tasks'] : ['find', 'grep', 'ls', 'read', 'task_report']);
    const results = requests.filter(event => event.role === 'worker').flatMap(event => event.results);
    assert(results.filter(result => result.name === 'read' && result.isError).length >= 2, 'Outside paths and escaping symlinks must be denied');
    for (const name of ['write', 'bash']) assert(results.some(result => result.name === name && result.isError), name + ' must be unavailable');
    assert(audit.some(event => event.kind === 'aborted'), 'The scoped Stop must abort the held native provider request');
    assert(!JSON.stringify(audit).includes('PRIVATE_OUTSIDE_SHOULD_NOT_APPEAR'));
    assert.deepEqual(['alpha.txt', 'beta.txt'].map(file => hash(readFileSync(join(root, 'project', file)))), original);
    assert.deepEqual(readdirSync(join(root, 'project')).sort(), ['alpha.txt', 'beta.txt', 'escape.txt']);
    assert.equal(statSync(join(root, 'host', 'coordinator-tasks.json')).mode & 0o777, 0o600);
    for (const record of [...ledger().coordinators, ...ledger().tasks]) assert(!JSON.stringify(frames).includes(record.token), 'Private capabilities must not enter browser state');
    const workerIds = new Set(ledger().tasks.map(task => task.sessionId));
    assert(!frames.some(({ direction, packet }) => direction === 'sent' && ['command', 'answer', 'taskAction'].includes(packet.op) && workerIds.has(packet.sessionId)), 'Browser input must never target a worker');
    assert.deepEqual(errors, []);
    save('provider-audit.json', audit); save('browser-frames.json', frames);
    save('task-results.json', ledger().tasks.map(({ id, title, state, sessionId, result, error }) => ({ id, title, state, sessionId, result, error })));
    save('result.json', { passed: true, feature: 'coordinator', entry: 'phone conversation',
      checks: ['manual login and doctor', 'two real Pi workers', 'nested worker navigation', 'root-only global sections', 'two-task limit', 'coordinator stays responsive', 'main-session question/reply', 'read-only worker logs and serialized input rejection', 'draft and attachment preservation', 'coordinator report acceptance', 'main-session scoped Stop', 'live sibling tree updates', 'collapsible C tree', 'reload persistence', 'host process restart', 'unknown work without replay', 'scope authorization', 'idempotent retries', 'readonly tools and paths', 'no private capabilities in browser'],
      excluded: ['paid-model judgment', 'code-writing workers', 'physical iPhone/Safari', 'Render relay'] });
  } catch (error) {
    save('failure.txt', error.stack || String(error));
    if (page && !page.isClosed()) { try { await snapshot('failure'); } catch {} }
    throw error;
  } finally {
    try { await browser?.close(); }
    finally {
      save('browser-frames.json', frames);
      if (root) {
        save('provider-audit.json', lines(join(root, 'provider.jsonl')));
        if (existsSync(join(root, 'host', 'coordinator-tasks.json'))) save('task-results.json', ledger().tasks.map(({ id, title, state, sessionId, result, error }) => ({ id, title, state, sessionId, result, error })));
      }
      const workerPids = root ? [...new Set(lines(join(root, 'provider.jsonl')).filter(event => event.kind === 'boot').map(event => event.pid))] : [];
      const stopped = await stop();
      await until(() => workerPids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }), 10000);
      rmSync(scratch, { recursive: true, force: true });
      save('cleanup.json', { stopped, scratchRemoved: !existsSync(scratch), workerPids, workersExited: true });
      process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
    }
  }
  for (const file of ['doctor.json', 'restart-doctor.json', 'result.json', 'cleanup.json', 'actions.jsonl', 'provider-audit.json', 'assignment-and-question.png', 'result-and-scoped-stop.png', 'recovery-without-replay.png']) assert(existsSync(join(evidence, file)), 'Missing proof: ' + file);
  console.log('PASS: C session tree, coordinator-only input, native Pi workers, scoped replies/Stop, readonly enforcement and durable recovery; fixture cleaned, evidence retained.');
}
