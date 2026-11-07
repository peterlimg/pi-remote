#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, rmSync, existsSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { chromium, devices, expect } from '@playwright/test';
import { socket, until, delay } from './helpers.mjs';
import { sessionCapability } from '../src/locks.mjs';

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
    assert.equal(client.messages.find(packet => packet.type === 'ready').supportsWorkerInspection, true);
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
    const api = async (token, input, origin, headers = {}) => {
      const response = await fetch(url + '/_pi/coordinator', { method: input ? 'POST' : 'GET',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers },
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
  const closeTasks = () => page.getByRole('button', { name: 'Close workers', exact: true }).click();
  const openLog = async name => {
    await taskRow(name).getByRole('button').click();
    await check(page.locator('#coordinator-title')).toHaveText(name);
    await check(page.locator('#coordinator-log')).toBeVisible();
  };
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
      await check(page.locator('#coordinator-context')).toBeVisible();
      await page.locator('#coordinator-open').click();
      await check(taskRow('First inspection')).toBeVisible(); await check(taskRow('Second inspection')).toBeVisible();
      const hierarchy = {
        globalListHasOnlyRoots: roots.every(result => result.onlyRoots),
        workersVisibleInChat: await page.locator('#coordinator-sheet').isVisible()
      };
      await closeTasks();
      save('hierarchy.json', { ...hierarchy, sections: roots });
      assert.deepEqual(hierarchy, { globalListHasOnlyRoots: true, workersVisibleInChat: true });
      record('workers belong to their coordinator, not global list sections');
    } finally { client.ws.terminate(); }
  };
  const send = async text => { record('send', { text }); await page.locator('#prompt').fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); };
  const restoreCoordinator = async () => {
    await page.reload();
    await check(page.locator('#connection')).toHaveText('Computer connected');
    await page.getByRole('button', { name: /Coordinator verification project/ }).click();
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
    browser = await chromium.launch({ channel: process.env.PI_REMOTE_TEST_CHANNEL });
    context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page = await context.newPage(); observe(page);
    await page.goto(url); await page.getByText('Paste a private link instead', { exact: true }).click();
    await page.getByLabel('Private login link').fill(clientToken); await page.getByRole('button', { name: 'Connect to computer' }).click();
    await check(page.locator('#connection')).toHaveText('Computer connected'); record('manual login');
    await page.getByRole('button', { name: /Coordinator verification project/ }).click();
    const source = initial.sources.find(source => source.title === 'Coordinator verification project');
    const existingHistory = readFileSync(source.file, 'utf8');
    await check(page.locator('#title')).toHaveText(source.title);
    await check(page.locator('#transcript')).toContainText('Existing conversation note.');
    await check(page.getByRole('button', { name: 'Start read-only coordinator', exact: true })).toHaveCount(0);
    await check(page.locator('#coordinator-context')).toBeHidden();
    await send('Read alpha before delegating.');
    await check(page.locator('#transcript')).toContainText('No workers were started.');
    assert(!existsSync(join(root, 'host', 'coordinator-tasks.json')) || ledger().coordinators.length === 0 && ledger().tasks.length === 0, 'Ordinary conversation must not create coordinator membership');
    await send('Investigate both fixture files.'); await openTasks();
    await check(taskRow('First inspection')).toContainText('Needs answer');
    await check(taskRow('Second inspection')).toContainText('Working');
    await check(page.locator('#coordinator-task-list').getByRole('listitem')).toHaveCount(2);
    assert.equal(owner().id, source.id); assert.equal(owner().file, source.file); assert.equal(owner().mode, 'session');
    assert(readFileSync(source.file, 'utf8').startsWith(existingHistory), 'Delegation must append to the original conversation, not replace it');
    assert.equal(readdirSync(join(root, 'sessions')).filter(name => name.startsWith('pi-remote-coordinator-')).length, 0);
    record('ordinary session coordinates in place with its original history and full tool set');
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
      await check(page.locator('#coordinator-worker-summary')).toHaveText('1 working · 1 needs answer');
      const measured = await page.evaluate(() => {
        const rect = id => { const box = document.getElementById(id).getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height }; };
        return { workers: rect('coordinator-context'), transcript: rect('transcript'), composer: rect('composer'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert(!measured.overflow && measured.transcript.height >= 80 && measured.workers.height <= 48);
      assert(measured.transcript.bottom <= measured.workers.top + 1 && measured.workers.bottom <= measured.composer.top + 1);
      assert(measured.composer.top - measured.workers.bottom <= 12 && measured.composer.bottom <= height + 1);
      await snapshot(name + '-main');
      await page.locator('#coordinator-open').focus(); await page.keyboard.press('Space');
      await check(page.locator('#coordinator-sheet')).toBeVisible();
      await check(page.getByRole('button', { name: 'First inspection, Needs answer', exact: true })).toBeVisible();
      await check(page.getByRole('button', { name: 'Second inspection, Working', exact: true })).toBeVisible();
      const sheet = await page.locator('.coordinator-sheet').evaluate(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect(), rows = [...node.querySelectorAll('.coordinator-worker')];
        return { top: box.top, bottom: box.bottom, width: box.width, height: box.height, background: style.backgroundColor, blur: style.backdropFilter,
          foreground: getComputedStyle(node.querySelector('header')).opacity, modal: node.parentElement.matches(':modal'),
          namesReadable: rows.every(row => { const name = row.querySelector('strong'); return name.scrollWidth <= name.clientWidth + 1; }),
          unboxed: rows.every(row => { const css = getComputedStyle(row); return css.backgroundColor === 'rgba(0, 0, 0, 0)' && css.borderRadius === '0px' && css.boxShadow === 'none'; }),
          targets: rows.every(row => row.getBoundingClientRect().height >= 44) };
      });
      assert(sheet.modal && sheet.namesReadable && sheet.unboxed && sheet.targets);
      assert(sheet.height <= Math.min(height * .72, 640) + 1 && sheet.bottom <= height + 1 && sheet.top > 0 && sheet.width <= Math.min(width, 640));
      assert.match(sheet.background, /0\.74/); assert.equal(sheet.blur, 'blur(10px)'); assert.equal(sheet.foreground, '1');
      layout.push({ name, width, height, colorScheme, ...measured, sheet }); await snapshot(name);
      await page.keyboard.press('Escape'); await check(page.locator('#coordinator-sheet')).toBeHidden();
      await check(page.locator('#coordinator-open')).toHaveAttribute('aria-expanded', 'false');
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
    const touchClient = await context.newCDPSession(page);
    const touch = (type, x, y) => touchClient.send('Input.dispatchTouchEvent', { type, touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ x, y }] });
    const scrollTouch = async (x, y, distance) => {
      await touch('touchStart', x, y);
      for (let step = 1; step <= 12; step++) {
        await touch('touchMove', x, y + distance * (1 - (1 - step / 12) ** 3));
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await touch('touchEnd');
    };
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      await page.locator('#coordinator-open').click();
      await check(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
      const surface = page.locator('.coordinator-sheet'), header = await surface.locator('header').boundingBox();
      const x = header.x + header.width / 2, y = header.y + 32, resting = Math.round((await surface.boundingBox()).y);
      await touch('touchStart', x, y); await touch('touchMove', x, y + 24); await touch('touchMove', x, y + 64);
      assert((await surface.boundingBox()).y > resting + 40);
      await touch('touchCancel'); await check.poll(async () => Math.round((await surface.boundingBox()).y)).toBe(resting);
      await touch('touchStart', x, y); await touch('touchMove', x, y + 24); await touch('touchEnd');
      await check.poll(async () => Math.round((await surface.boundingBox()).y)).toBe(resting);
      await openLog('First inspection');
      await check(page.locator('#coordinator-log .coordinator-instruction-label').first()).toBeVisible();
      const taskDetails = page.locator('#coordinator-log details[data-disclosure-id="task"]');
      if (await taskDetails.getAttribute('open') === null) await taskDetails.locator('summary').click();
      const scroll = page.locator('#coordinator-scroll');
      await check.poll(() => scroll.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(100);
      const body = await scroll.boundingBox(), sy = body.y + body.height - 16;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      record('native log scroll geometry', { reducedMotion, ...await scroll.evaluate(node => ({ top: node.scrollTop, height: node.clientHeight, content: node.scrollHeight })) });
      await scrollTouch(230, sy, -100);
      await check.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      const before = await scroll.evaluate(node => node.scrollTop), top = body.y + 16;
      await scrollTouch(230, top, 60);
      await check.poll(() => scroll.evaluate(node => node.scrollTop)).toBeLessThan(before);
      assert.equal(Math.round((await surface.boundingBox()).y), resting);
      await touch('touchStart', x, y); await touch('touchMove', x, y + 30); await touch('touchMove', x, y + 90); await touch('touchMove', x, y + 150); await touch('touchEnd');
      await check(page.locator('#coordinator-sheet')).toBeHidden();
      await check(page.locator('#coordinator-open')).toBeFocused();
    }
    await touchClient.detach();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      window.workerMotion = { frames: [], done: false };
      const start = performance.now(), dialog = document.getElementById('coordinator-sheet');
      const sample = () => {
        if (dialog.open) {
          const box = dialog.firstElementChild.getBoundingClientRect();
          window.workerMotion.frames.push({ x: box.x, y: box.y, scroll: dialog.scrollTop });
        }
        if (performance.now() - start < 450) requestAnimationFrame(sample); else window.workerMotion.done = true;
      };
      requestAnimationFrame(sample);
    });
    await page.locator('#coordinator-open').click();
    await check.poll(() => page.evaluate(() => window.workerMotion.done)).toBe(true);
    const motion = await page.evaluate(() => window.workerMotion.frames);
    assert(motion.length > 5 && motion[0].y > motion.at(-1).y + 100);
    assert(motion.every((frame, i) => frame.scroll === 0 && Math.abs(frame.x - motion[0].x) < 1 && (!i || frame.y <= motion[i - 1].y + 1)));
    save('worker-motion.json', motion); await closeTasks(); await page.emulateMedia({ reducedMotion: 'reduce' });
    record('native pull follows the finger, short and cancelled pulls snap back, scrolled logs stay scrollable, and entry rises without overlay scroll');
    await page.locator('#back').click();
    await check(page.locator('#sessions .session').filter({ hasText: 'First inspection' })).toHaveCount(0);
    await check(page.locator('#sessions .session').filter({ hasText: 'Second inspection' })).toHaveCount(0);
    await snapshot('global-roots-only');
    await page.locator('#sessions').getByRole('button', { name: /Coordinator verification project/ }).click();
    const overLimit = await api(owner().token, { action: 'assign', title: 'Unwanted third task', instruction: 'This must not be dispatched.', requestId: hash(randomUUID()) });
    assert.equal(overLimit.body.ok, false); assert.equal(ledger().tasks.length, 2); record('third active task refused without dispatch');
    await send('Which tasks are still open?');
    await check(page.locator('#transcript')).toContainText('Second inspection is working');
    assert.equal(ledger().tasks.find(task => task.title === 'Second inspection').state, 'working'); record('coordinator responds while worker remains active');
    await check(page.locator('#transcript .message.user').filter({ hasText: '[Pi Remote task events]' })).toHaveCount(0);
    await check(page.locator('#transcript .tool-activity-label').filter({ hasText: 'Prompted by an extension' }).first()).toBeVisible();
    record('internal wake-up instructions stay in collapsed activity rather than user bubbles');
    await openTasks(); await openLog('First inspection');
    const reply = await context.newPage(); observe(reply);
    try {
      await reply.goto(url); await check(reply.locator('#connection')).toHaveText('Computer connected');
      await reply.getByRole('button', { name: /Coordinator verification project/ }).click();
      await reply.locator('#prompt').fill('Keep the original identifier.'); await reply.getByRole('button', { name: 'Send message', exact: true }).click();
      await until(() => ledger().tasks.find(task => task.title === 'First inspection').state === 'reported', 30000);
      await check(page.locator('#transcript')).toContainText('I sent your answer to First inspection');
      await check(page.locator('#coordinator-subtitle')).toHaveText('Result ready');
      await check(page.locator('#coordinator-log article').filter({ hasText: 'Keep the original identifier.' })).toHaveCount(1);
      assert(frames.some(({ direction, packet }) => direction === 'received' && packet.type === 'workerPatch' && packet.sessionId === ledger().tasks.find(task => task.title === 'First inspection').sessionId));
      record('main conversation and inspected worker stream independently on the same connection');
    } finally { await reply.close(); }
    await page.locator('#coordinator-log').getByText('Task details', { exact: true }).click();
    await check(page.locator('#coordinator-log')).toContainText('ALPHA_VALUE=stable');
    await check(page.getByRole('button', { name: /Reply in worker|Accept result|Stop task/ })).toHaveCount(0);
    await snapshot('returned-result'); await closeTasks();
    await send('Review and accept the first result.');
    await until(() => ledger().tasks.find(task => task.title === 'First inspection').state === 'completed', 30000);
    await check(page.locator('#transcript')).toContainText('I reviewed and accepted First inspection: ALPHA_VALUE=stable');
    await page.locator('#prompt').fill('Keep my coordinator draft.');
    await page.locator('#image-files').setInputFiles({ name: 'draft.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=', 'base64') });
    await check(page.locator('#attachments img')).toBeVisible();
    await page.locator('#transcript').evaluate(node => node.scrollTo(0, 0));
    const readingPosition = await page.locator('#transcript').evaluate(node => node.scrollTop);
    await page.locator('#coordinator-open').click(); await openLog('First inspection');
    record('inspect worker in the selected D bottom sheet without switching the main session');
    await check(page.locator('#title')).toHaveText(source.title);
    await check(page.locator('#composer')).toBeVisible();
    await check(page.locator('#coordinator-sheet textarea, #coordinator-sheet input')).toHaveCount(0);
    await check(page.locator('#coordinator-log .message.user')).toHaveCount(0);
    await check(page.locator('#coordinator-log .coordinator-instruction-label').first()).toHaveText('Instruction to worker');
    await check(page.locator('#coordinator-log summary').filter({ hasText: 'write failed' })).toHaveCount(1);
    assert(!/wrote/i.test((await page.locator('#coordinator-log summary').allTextContents()).join(' ')), 'Blocked writes must not look like successful file changes');
    await snapshot('worker-read-only');
    const control = await context.newPage(); observe(control);
    try {
      await control.goto(url); await check(control.locator('#connection')).toHaveText('Computer connected');
      await control.getByRole('button', { name: /Coordinator verification project/ }).click();
      await control.locator('#prompt').fill('Stop Second inspection.');
      await control.getByRole('button', { name: 'Send message', exact: true }).click();
      await check(control.locator('#transcript')).toContainText('I stopped Second inspection only');
      await check(page.locator('#transcript')).toContainText('I stopped Second inspection only');
      await page.locator('#coordinator-log-back').click();
      await check(page.getByRole('button', { name: 'Second inspection, Stopped', exact: true })).toBeVisible();
      record('main-session Stop from another tab updates the background conversation and worker roster');
    } finally { await control.close(); }
    await closeTasks();
    assert.equal(await page.locator('#transcript').evaluate(node => node.scrollTop), readingPosition);
    await check(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
    await check(page.locator('#attachments img')).toBeVisible();
    await page.locator('#attachments button').click(); await page.locator('#prompt').fill('');
    await openTasks(); await check(taskRow('First inspection')).toContainText('Accepted'); await check(taskRow('Second inspection')).toContainText('Stopped');
    assert.equal(ledger().tasks.find(task => task.title === 'First inspection').state, 'completed');
    record('coordinator accepts the result and stops only the addressed sibling; draft and attachment survive log inspection');
    await page.emulateMedia({ colorScheme: 'dark' }); await snapshot('result-and-scoped-stop');
    await closeTasks(); await restoreCoordinator(); await assertHierarchy(); await openTasks();
    await check(taskRow('First inspection')).toContainText('Accepted'); await check(taskRow('Second inspection')).toContainText('Stopped');
    await openLog('First inspection'); await page.locator('#coordinator-log').getByText('Task details', { exact: true }).click();
    await check(page.locator('#coordinator-log')).toContainText('ALPHA_VALUE=stable');
    record('reload preserves task ownership and report'); await closeTasks();
    await send('Start an interrupted task.'); await openTasks(); await check(taskRow('Interrupted inspection')).toContainText('Working');
    await closeTasks(); await check(page.locator('#abort')).toBeHidden();
    const before = ledger(), main = owner(), first = before.tasks.find(task => task.title === 'First inspection');
    const promptsBefore = Object.fromEntries(before.tasks.map(task => [task.id, entries(task.file).filter(entry => entry.message.role === 'user').length]));
    await openTasks(); await openLog('Interrupted inspection');
    const eventsBefore = eventCount(main.file), oldPid = running.child.pid;
    const oldScope = sessionCapability(bridgeToken, main.id, json(join(root, 'host', 'locks', main.id + '.json')).nonce);
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
    await check(page.locator('#coordinator-sheet')).toBeVisible();
    await check(page.locator('#coordinator-title')).toHaveText('Interrupted inspection');
    await check(page.locator('#coordinator-subtitle')).toHaveText('Needs inspection');
    await check(page.locator('#coordinator-log .coordinator-instruction-label').first()).toBeVisible();
    record('open worker sheet reconnects after host restart without replacing the main conversation');
    await closeTasks(); await restoreCoordinator(); await assertHierarchy(); await openTasks();
    await check(taskRow('Interrupted inspection')).toContainText('Needs inspection');
    await check(taskRow('First inspection')).toContainText('Accepted'); await check(taskRow('Second inspection')).toContainText('Stopped');
    for (const task of ledger().tasks) assert.equal(entries(task.file).filter(entry => entry.message.role === 'user').length, promptsBefore[task.id], 'Restart must not replay a task instruction');
    assert.equal(eventCount(main.file), eventsBefore, 'Restart must not reannounce acknowledged notifications');
    assert.equal(lines(join(root, 'provider.jsonl')).filter(event => event.kind === 'request').length, requestsBefore, 'Restore must not invoke the model again');
    await snapshot('recovery-without-replay'); record('new host restores ownership and exposes interrupted work without replay', { previousPid: oldPid, pid: restarted.pid });
    assert.equal((await api()).status, 403);
    assert.equal((await api(oldScope, undefined, undefined, { 'X-Pi-Remote-Session': main.id })).status, 403, 'A previous process ownership capability must expire');
    assert.equal((await api(main.token, undefined, 'https://untrusted.invalid')).status, 403);
    const second = ledger().tasks.find(task => task.title === 'Second inspection');
    assert.equal((await api(second.token, { requestId: hash(randomUUID()), action: 'list' })).status, 403);
    const late = await api(second.token, { requestId: hash(randomUUID()), kind: 'result', text: 'A stopped task must not accept this report.' });
    assert.equal(late.body.ok, false); assert.equal(ledger().tasks.find(task => task.id === second.id).state, 'stopped');
    for (const title of ['Capacity A', 'Capacity B']) assert.equal((await api(main.token, {
      action: 'assign', title, instruction: 'Inspect beta.txt and keep investigating until stopped.', requestId: hash(randomUUID())
    })).body.ok, true);
    const promptsAtCapacity = entries(first.file).filter(entry => entry.message.role === 'user').length;
    const overCapacity = await api(main.token, { action: 'message', taskId: first.id, text: 'Keep the original identifier.', requestId: hash(randomUUID()) });
    assert.equal(overCapacity.body.ok, false); assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'completed');
    const directClient = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
    try {
      assert.equal((await directClient.request('inspectWorker', { sessionId: first.sessionId })).ok, false);
      await directClient.request('watch', { sessionId: main.id });
      assert.equal((await directClient.request('inspectWorker', { sessionId: main.id })).ok, false);
      assert.equal((await directClient.request('inspectWorker', { sessionId: first.sessionId })).ok, true);
      const history = await directClient.request('history', { sessionId: first.sessionId });
      assert.equal(history.ok, true); assert(history.value.messages.length > 0);
      await directClient.request('watch', { sessionId: main.id });
      assert.equal((await directClient.request('history', { sessionId: first.sessionId })).ok, true, 'Resyncing the same parent must preserve its worker inspection');
      await directClient.request('watch', { sessionId: initial.sources.find(source => source.title === 'Other verification project').id });
      assert.equal((await directClient.request('history', { sessionId: first.sessionId })).ok, false);
      assert.equal((await directClient.request('inspectWorker', { sessionId: first.sessionId })).ok, false);
      record('worker inspection and history are scoped to the selected owner and cleared on navigation');
      const denied = await directClient.request('command', { sessionId: first.sessionId, command: { type: 'prompt', text: 'Keep the original identifier.' } });
      assert.equal(denied.value?.ok, false); assert.equal(denied.value.error, 'Worker logs are read-only. Send instructions to the coordinator.');
    } finally { directClient.ws.terminate(); }
    await openLog('First inspection');
    await check(page.locator('#coordinator-sheet textarea, #coordinator-sheet input')).toHaveCount(0);
    assert.equal(entries(first.file).filter(entry => entry.message.role === 'user').length, promptsAtCapacity);
    assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'completed');
    record('task capacity enforced for coordinator follow-ups; direct worker input remains refused');
    await closeTasks();
    const toolCalls = file => entries(file).flatMap(entry => Array.isArray(entry.message.content) ? entry.message.content : []).filter(block => block.type === 'toolCall');
    const assign = toolCalls(main.file).find(call => call.name === 'remote_tasks' && call.arguments?.action === 'assign' && call.arguments.title === 'First inspection');
    const taskCount = ledger().tasks.length, eventTotal = ledger().tasks.reduce((count, task) => count + task.events.length, 0);
    assert.equal((await api(main.token, { ...assign.arguments, requestId: hash(assign.id) })).body.ok, true);
    const report = toolCalls(first.file).find(call => call.name === 'task_report' && call.arguments.kind === 'result');
    assert.equal((await api(first.token, { ...report.arguments, requestId: hash(report.id) })).body.ok, true);
    assert.equal(ledger().tasks.length, taskCount); assert.equal(ledger().tasks.reduce((count, task) => count + task.events.length, 0), eventTotal);
    assert.equal(ledger().tasks.find(task => task.id === first.id).state, 'completed'); record('scope checks and idempotent assignment/report retries');
    const freshFrames = frames.length;
    await send('/new');
    const created = await until(() => {
      const creation = frames.slice(freshFrames).find(({ direction, packet }) => direction === 'sent' && packet.op === 'new')?.packet;
      return creation && frames.find(({ direction, packet }) => direction === 'received' && packet.type === 'response' && packet.id === creation.id)?.packet;
    }, 30000);
    await check(page.locator('#coordinator-context')).toBeHidden();
    await check(page.locator('#prompt')).toBeEnabled();
    assert.equal(created.ok, true); assert.equal(created.value.ok, true);
    const fresh = created.value.value;
    assert.notEqual(fresh.sessionId, main.id); assert.equal(fresh.state.cwd, join(root, 'project'));
    assert(!ledger().coordinators.some(owner => owner.id === fresh.sessionId));
    const scope = sessionCapability(bridgeToken, main.id, json(join(root, 'host', 'locks', main.id + '.json')).nonce);
    assert.equal((await api(scope, undefined, undefined, { 'X-Pi-Remote-Session': fresh.sessionId })).status, 403);
    await send('Start independent inspection.');
    await check(page.locator('#transcript')).toContainText('Should I keep the original identifier in alpha.txt?');
    const freshOwner = ledger().coordinators.find(owner => owner.id === fresh.sessionId);
    assert(freshOwner); assert.notEqual(freshOwner.id, main.id); assert.equal(freshOwner.file, fresh.state.file);
    const independent = ledger().tasks.find(task => task.coordinatorId === freshOwner.id);
    assert(independent); assert.equal(ledger().tasks.filter(task => task.coordinatorId === main.id).length, taskCount);
    const denied = await api(freshOwner.token, { action: 'inspect', taskId: first.id, requestId: hash(randomUUID()) });
    assert.equal(denied.body.ok, false); assert(denied.status >= 400);
    assert.equal(lines(freshOwner.file).findLast(entry => entry.type === 'model_change').modelId, 'fixture');
    record('a fresh session delegates independently in the same project; its model and identity stay unchanged');
    await snapshot('fresh-session-coordinates');
    const terminal = restarted.sources.find(source => source.title === 'Terminal verification project');
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await page.locator('#sessions').getByRole('button', { name: /Terminal verification project/ }).click();
    await check(page.locator('#prompt')).toBeEnabled();
    await check(page.locator('#transcript')).toContainText('Existing conversation note.');
    await send('Start independent inspection.');
    await check(page.locator('#transcript')).toContainText('Should I keep the original identifier in alpha.txt?');
    await check(page.getByRole('article', { name: 'You', exact: true }).filter({ hasText: 'Start independent inspection.' })).toHaveCount(1);
    await check(page.locator('#transcript .tool-activity-label').filter({ hasText: 'Prompted by an extension' })).toHaveCount(1);
    const terminalOwner = ledger().coordinators.find(owner => owner.id === terminal.id);
    assert(terminalOwner); assert.equal(terminalOwner.file, terminal.file); assert.equal(terminalOwner.mode, 'session');
    assert(ledger().tasks.some(task => task.coordinatorId === terminal.id && task.state === 'waiting'));
    assert.equal(ledger().tasks.filter(task => task.coordinatorId === main.id).length, taskCount);
    await check(page.locator('#coordinator-context')).toBeVisible();
    record('a terminal-owned session delegates in place and receives its worker question through the real bridge');
    await snapshot('terminal-session-coordinates');
    const audit = lines(join(root, 'provider.jsonl')), requests = audit.filter(event => event.kind === 'request');
    for (const request of requests) {
      if (request.purpose === 'session-title') assert.deepEqual(request.tools, [], 'Title generation intentionally has no agent tools');
      else if (request.role === 'worker') assert.deepEqual([...request.tools].sort(), ['find', 'grep', 'ls', 'read', 'task_report']);
      else if (request.role === 'coordinator') assert.deepEqual(request.tools, ['remote_tasks']);
      else for (const name of ['read', 'bash', 'edit', 'write', 'remote_tasks']) assert(request.tools.includes(name), 'Normal sessions must retain ' + name);
      assert.equal(new Set(request.tools).size, request.tools.length);
    }
    const results = requests.filter(event => event.role === 'worker').flatMap(event => event.results);
    assert(results.filter(result => result.name === 'read' && result.isError).length >= 2, 'Outside paths and escaping symlinks must be denied');
    for (const name of ['write', 'bash']) assert(results.some(result => result.name === name && result.isError), name + ' must be unavailable');
    assert(audit.some(event => event.kind === 'aborted'), 'The scoped Stop must abort the held native provider request');
    assert(!JSON.stringify(audit).includes('PRIVATE_OUTSIDE_SHOULD_NOT_APPEAR'));
    assert.deepEqual(['alpha.txt', 'beta.txt'].map(file => hash(readFileSync(join(root, 'project', file)))), original);
    assert.deepEqual(readdirSync(join(root, 'project')).sort(), ['alpha.txt', 'beta.txt', 'escape.txt']);
    // Coding runs through the same phone conversation and real native tool runtime.
    for (const title of ['Capacity A', 'Capacity B']) {
      const task = ledger().tasks.find(task => task.title === title);
      assert.equal((await api(main.token, { action: 'stop', taskId: task.id, requestId: hash(randomUUID()) })).body.ok, true);
    }
    const project = join(root, 'project'), calculation = 'export const add = (a, b) => a - b;\n';
    writeFileSync(join(project, 'calc.mjs'), calculation);
    symlinkSync(join(root, 'future-outside.txt'), join(project, 'dangling.txt'));
    const git = args => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture base']);
    writeFileSync(join(project, 'parent-draft.txt'), 'Unrelated local draft.\n');
    writeFileSync(join(project, 'staged.txt'), 'Unrelated staged change.\n'); git(['add', 'staged.txt']);
    const originalIndex = git(['ls-files', '--stage']);
    await restoreCoordinator();
    await send('Fix the fixture calculation with two workers.');
    await until(() => ledger().tasks.find(task => task.title === 'Calculation fix')?.state === 'reported', 30000);
    const coding = () => ledger().tasks.find(task => task.title === 'Calculation fix');
    const notes = () => ledger().tasks.find(task => task.title === 'Coding notes');
    await until(() => notes()?.state === 'working' && existsSync(join(notes().workspace.path, 'worker-notes.md')), 30000);
    assert.notEqual(coding().workspace.path, notes().workspace.path);
    assert.equal(coding().kind, 'code'); assert.equal(readFileSync(join(project, 'calc.mjs'), 'utf8'), calculation);
    assert.equal(readFileSync(join(coding().workspace.path, 'calc.mjs'), 'utf8'), calculation.replace('a - b', 'a + b'));
    assert(!existsSync(join(coding().workspace.path, 'parent-draft.txt')));
    assert(!existsSync(join(project, 'worker-notes.md')));
    const codeClient = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
    try {
      const denied = await codeClient.request('command', { sessionId: coding().sessionId, command: { type: 'prompt', text: 'Bypass the main conversation.' } });
      assert.equal(denied.value?.ok, false); assert.equal(denied.value.error, 'Worker logs are read-only. Send instructions to the coordinator.');
    } finally { codeClient.ws.terminate(); }
    const peek = await api(main.token, { action: 'inspect', taskId: coding().id, requestId: hash(randomUUID()) });
    assert.equal(peek.body.ok, true); assert(peek.body.value.review.diff.includes('a + b')); assert(peek.body.value.review.diff.includes('checks.txt'));
    const oldRevision = peek.body.value.review.revision;
    assert.equal((await api(main.token, { action: 'message', taskId: coding().id, text: 'Revise calculation fixture.', requestId: hash(randomUUID()) })).body.ok, true);
    await until(() => coding().state === 'reported' && existsSync(join(coding().workspace.path, 'review-marker.txt')), 30000);
    assert.equal((await api(main.token, { action: 'integrate', taskId: coding().id, revision: oldRevision, requestId: hash(randomUUID()) })).body.ok, false);
    assert.equal(coding().state, 'reported'); assert.equal(coding().workspace.integration, undefined);
    const review = (await api(main.token, { action: 'inspect', taskId: coding().id, requestId: hash(randomUUID()) })).body.value.review;
    const conflict = calculation.replace('a - b', 'a * b'); writeFileSync(join(project, 'calc.mjs'), conflict);
    assert.equal((await api(main.token, { action: 'integrate', taskId: coding().id, revision: review.revision, requestId: hash(randomUUID()) })).body.ok, false);
    assert.equal(readFileSync(join(project, 'calc.mjs'), 'utf8'), conflict); assert.equal(git(['ls-files', '--stage']), originalIndex);
    assert.equal(coding().state, 'reported'); writeFileSync(join(project, 'calc.mjs'), calculation);
    await send('Review and integrate the calculation fix.');
    await until(() => coding().state === 'completed', 30000);
    assert.equal(coding().workspace.integration, 'applied');
    assert.equal(readFileSync(join(project, 'calc.mjs'), 'utf8'), calculation.replace('a - b', 'a + b'));
    assert.equal(readFileSync(join(project, 'checks.txt'), 'utf8'), 'calculation checks passed\n');
    assert.equal(readFileSync(join(project, 'parent-draft.txt'), 'utf8'), 'Unrelated local draft.\n');
    assert.equal(git(['ls-files', '--stage']), originalIndex); assert(!existsSync(join(project, 'worker-notes.md')));
    assert.equal((await api(freshOwner.token, { action: 'inspect', taskId: coding().id, requestId: hash(randomUUID()) })).body.ok, false);
    assert.equal((await api(coding().token, { action: 'integrate', taskId: coding().id, revision: review.revision, requestId: hash(randomUUID()) })).status, 403);
    const integration = toolCalls(main.file).findLast(call => call.name === 'remote_tasks' && call.arguments?.action === 'integrate');
    assert.equal((await api(main.token, { ...integration.arguments, requestId: hash(integration.id) })).body.ok, true);
    await openTasks(); await openLog('Calculation fix');
    await page.locator('#coordinator-log').getByText('Task details', { exact: true }).click();
    await check(page.locator('#coordinator-log')).toContainText('Reviewed changes integrated');
    await check(page.locator('#coordinator-subtitle')).toHaveText('Integrated');
    await check(page.locator('#coordinator-sheet textarea, #coordinator-sheet input')).toHaveCount(0);
    await snapshot('coding-workspace-integrated'); await closeTasks();
    const codingRequests = lines(join(root, 'provider.jsonl')).filter(event => event.role === 'coder' && event.kind === 'request' && event.purpose === 'agent');
    for (const request of codingRequests) assert.deepEqual([...request.tools].sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'task_report', 'write']);
    const codingResults = codingRequests.flatMap(event => event.results);
    for (const name of ['edit', 'write', 'bash']) assert(codingResults.some(result => result.name === name && !result.isError));
    assert(codingResults.some(result => result.name === 'bash' && result.text.includes('calculation checks passed')));
    assert(codingResults.filter(result => result.name === 'write' && result.isError).length >= 2);
    assert(!existsSync(join(root, 'future-outside.txt'))); assert.equal(readFileSync(join(root, 'outside.txt'), 'utf8'), 'PRIVATE_OUTSIDE_SHOULD_NOT_APPEAR\n');
    const codePrompts = [coding(), notes()].map(task => entries(task.file).filter(entry => entry.message.role === 'user').length);
    const oldWorkspace = coding().workspace.path, notesWorkspace = notes().workspace.path;
    await stop(); await start(); await restoreCoordinator();
    assert.equal(coding().workspace.path, oldWorkspace); assert.equal(coding().state, 'completed');
    assert.equal(notes().workspace.path, notesWorkspace); assert.equal(notes().state, 'unknown');
    assert.equal(readFileSync(join(notesWorkspace, 'worker-notes.md'), 'utf8'), 'Independent coding work in its own worktree.\n');
    for (const [index, task] of [coding(), notes()].entries()) assert.equal(entries(task.file).filter(entry => entry.message.role === 'user').length, codePrompts[index]);
    await send('Stop the coding notes worker.'); await until(() => notes().state === 'stopped', 30000);
    assert.equal(coding().state, 'completed');
    const matching = await api(main.token, { action: 'assign', kind: 'code', title: 'Matching fix', instruction: 'Fix add in calc.mjs and run its focused Node check.', requestId: hash(randomUUID()) });
    assert.equal(matching.body.ok, true);
    const matched = () => ledger().tasks.find(task => task.title === 'Matching fix');
    await until(() => matched().state === 'reported', 30000);
    const matchedReview = (await api(main.token, { action: 'inspect', taskId: matched().id, requestId: hash(randomUUID()) })).body.value.review;
    const parentDiff = git(['diff']);
    assert.equal((await api(main.token, { action: 'integrate', taskId: matched().id, revision: matchedReview.revision, requestId: hash(randomUUID()) })).body.ok, true);
    assert.equal(git(['diff']), parentDiff); assert.equal(git(['ls-files', '--stage']), originalIndex);
    record('coding workers edit and test in separate worktrees, reject stale/conflicting integration, preserve parent changes/index, survive restart without replay, and stop by task ID');
    save('coding-audit.json', codingRequests);
    assert.equal(statSync(join(root, 'host', 'coordinator-tasks.json')).mode & 0o777, 0o600);
    for (const token of [oldScope, scope, bridgeToken, ...ledger().coordinators.map(record => record.token), ...ledger().tasks.map(record => record.token)]) assert(!JSON.stringify(frames).includes(token), 'Private capabilities must not enter browser state');
    const workerIds = new Set(ledger().tasks.map(task => task.sessionId));
    assert(!frames.some(({ direction, packet }) => direction === 'sent' && ['command', 'answer', 'taskAction'].includes(packet.op) && workerIds.has(packet.sessionId)), 'Browser input must never target a worker');
    assert.deepEqual(errors, []);
    save('provider-audit.json', audit); save('browser-frames.json', frames);
    save('task-results.json', ledger().tasks.map(({ id, title, state, sessionId, result, error }) => ({ id, title, state, sessionId, result, error })));
    save('result.json', { passed: true, feature: 'coordinator', entry: 'phone conversation',
      checks: ['manual login and doctor', 'implicit existing-session delegation with preserved history and tools', 'fresh-session and terminal-bridge delegation', 'same-project ownership isolation', 'ownership capability expiration', 'two real Pi workers', 'bottom-sheet worker inspection', 'root-only global sections', 'two-task limit', 'coordinator stays responsive', 'main-session question/reply', 'read-only worker logs and serialized input rejection', 'draft and attachment preservation', 'coordinator report acceptance', 'main-session scoped Stop', 'independent parent and worker streams', 'translucent D bottom sheet', 'reload persistence', 'host process restart', 'unknown work without replay', 'scope authorization', 'idempotent retries', 'readonly tools and paths', 'coding worktrees and native edits/checks', 'reviewed conflict-safe integration', 'coding restart recovery', 'no private capabilities in browser'],
      excluded: ['paid-model judgment', 'OS sandboxing', 'physical iPhone/Safari', 'Render relay'] });
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
  console.log('PASS: D worker bottom sheet, coordinator-only input, native Pi workers, scoped replies/Stop, readonly investigations, coding worktrees/integration and durable recovery; fixture cleaned, evidence retained.');
}
