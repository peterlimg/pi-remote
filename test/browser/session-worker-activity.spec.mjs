import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { socket, until } from '../helpers.mjs';

// Real host, task HTTP/report API and browser; only the Pi bridge/RPC endpoints are replayed.
test('parent list activity follows owned workers without changing its own agent or composer', async ({ page }, info) => {
  test.setTimeout(60000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-session-worker-activity-')), root = join(dir, 'sessions'), cwd = join(dir, 'project');
  mkdirSync(root); mkdirSync(cwd);
  const now = Date.now(), agents = [], locks = [], commands = [], watches = [], errors = [];
  const seed = (title, index = 0) => {
    const file = join(root, randomUUID() + '.jsonl'), timestamp = now - index * 60000;
    writeFileSync(file, [
      { type: 'session', version: 3, id: randomUUID(), cwd, timestamp: new Date(timestamp).toISOString() },
      { type: 'session_info', id: 'name', parentId: null, name: title },
      { type: 'model_change', id: 'model', parentId: 'name', provider: 'formal', modelId: 'fixture' },
      { type: 'message', id: 'user', parentId: 'model', message: { role: 'user', content: title, timestamp } }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    return { file, id: sessionKey(file), title };
  };
  const parent = seed('Parent with background work'), other = seed('Independent parent in the same project', 1);
  const foreground = ['Needs input', 'Own response', 'Starting session'].map((title, index) => seed(title, index + 2));
  const owners = [parent, other].map(item => ({ ...item, cwd, mode: 'session', token: randomUUID() }));
  const task = (owner, state, extra = {}) => ({ ...seed(`${owner.title}: ${state} worker`), id: randomUUID(),
    coordinatorId: owner.id, sessionId: undefined, token: randomUUID(), cwd, state,
    instruction: 'Inspect this isolated fixture.', events: [], updatedAt: now, ...extra });
  const history = ['waiting', 'reported', 'completed', 'stopped'].map(state => task(parent, state));
  history.push(task(parent, 'completed', { kind: 'code', workspace: { integration: 'applied' } }));
  const recovery = task(other, 'unknown', { protocol: 2, inputs: [], generation: randomUUID() });
  const queued = task(other, 'reported', { protocol: 2, inputs: [], generation: randomUUID() });
  const tasks = [...history, recovery, queued];
  for (const item of tasks) item.sessionId = sessionKey(item.file);
  writeFileSync(join(dir, 'coordinator-tasks.json'), JSON.stringify({ version: 1, coordinators: owners, tasks }));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  let host, peer;
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload.toString());
    if (packet.op === 'watch') watches.push(packet.sessionId);
  }));
  try {
    host = await startHost({ dir, config, roots: [root], port: 0, relayUrl: '', workerOptions: {
      bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/coordinator-flow-pi.mjs', import.meta.url))],
      env: { PI_FORMAL_ROOT: dir, PI_FORMAL_SCENARIO: 'accepted-stop-ack' }
    } });
    const url = `http://127.0.0.1:${host.http.address().port}`;
    const connect = async (item, status, extra = {}) => {
      const state = { ...readSession(item.file), instanceId: randomUUID(), status, ...extra };
      const lock = acquireLock(join(dir, 'locks'), state.id, { file: state.file, instanceId: state.instanceId }); locks.push(lock);
      const agent = await socket(url.replace('http:', 'ws:') + '/bridge', config.bridgeToken); agents.push(agent);
      const publish = status => { state.status = status; state.revision++; agent.ws.send(JSON.stringify({ type: 'snapshot', state })); };
      agent.ws.on('message', raw => {
        const packet = JSON.parse(raw.toString());
        if (packet.type !== 'command') return;
        commands.push({ sessionId: state.id, ...packet.command });
        if (packet.command.type === 'prompt') {
          state.messages.push({ id: randomUUID(), role: 'user', text: packet.command.text, timestamp: Date.now() });
          publish('idle');
        }
        agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { commands: [], accepted: true } }));
      });
      agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
      await until(() => host.service.live.has(state.id));
      return { state, publish };
    };
    const main = await connect(parent, 'idle');
    await connect(other, 'idle');
    for (const [index, item] of foreground.entries()) await connect(item, ['waiting', 'working', 'starting'][index]);
    for (const item of [recovery, queued]) await connect({ file: item.file }, 'waiting', {
      dialog: { id: 'permission', method: 'confirm', title: 'Fixture permission remains unanswered.' }
    });
    const api = async (record, input) => {
      const response = await fetch(url + '/_pi/coordinator', { method: 'POST', headers: {
        Authorization: 'Bearer ' + record.token, 'Content-Type': 'application/json'
      }, body: JSON.stringify({ requestId: createHash('sha256').update(randomUUID()).digest('hex'), ...input }) });
      const result = await response.json();
      expect(result.ok, result.error || result.value?.error).toBe(true);
      return result.value;
    };
    const ledger = () => JSON.parse(readFileSync(join(dir, 'coordinator-tasks.json'), 'utf8'));
    const record = id => ledger().tasks.find(item => item.id === id);
    // Recovery waits for the old permission; a queued instruction is not a running worker either.
    expect((await api(owners[1], { action: 'recover', taskId: recovery.id })).state).toBe('recovering');
    expect((await api(owners[1], { action: 'message', taskId: queued.id, text: 'Continue after permission.' })).state).toBe('queued');
    peer = await socket(url.replace('http:', 'ws:') + '/ws', config.clientToken, url);
    expect((await peer.request('pin', { sessionId: queued.sessionId, pinned: true })).ok).toBe(true);
    const list = async options => {
      const response = await peer.request('list', { limit: 100, ...options }); expect(response.ok).toBe(true);
      return response.value.sessions || response.value.changes;
    };
    const nowGroup = page.locator('#sessions .session-group-now');
    const recent = page.locator('#sessions .session-group-recent');
    const pins = page.locator('#sessions .session-group-pinned');
    const row = scope => scope.locator(`.session[data-id="${parent.id}"]`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url + '/#token=' + config.clientToken);
    await expect(row(recent)).toBeVisible(); await expect(row(recent).locator('.session-state')).toHaveCount(0);
    await expect(recent.locator(`.session[data-id="${other.id}"] .session-state`)).toHaveCount(0);
    await expect(nowGroup.locator('.badge')).toHaveText('3');
    // Delegation uses the production task path and leaves the parent unwatched and genuinely idle.
    const running = await api(owners[0], { action: 'assign', title: 'Live background inspection', instruction: 'Inspect the fixture and wait.' });
    expect(running.state).toBe('working');
    expect(host.service.read(parent.id).status).toBe('idle');
    expect(watches).not.toContain(parent.id);
    await expect(row(nowGroup)).toBeVisible();
    await expect(row(nowGroup).locator('.session-state')).toHaveText('Working');
    await expect(row(nowGroup).locator('.session-icon')).toHaveAttribute('data-status', 'working');
    await expect(row(nowGroup).locator('.bot')).toHaveAttribute('data-mood', 'working');
    await expect(row(nowGroup)).toHaveClass(/session-busy/);
    await expect(nowGroup.locator('.badge')).toHaveText('4');
    await expect(recent.locator(`.session[data-id="${other.id}"]`)).toBeVisible();
    for (const section of [undefined, 'overview', 'now', 'pinned']) {
      const rows = await list({ section, availability: 'all' });
      expect(rows.some(item => ledger().tasks.some(task => task.sessionId === item.id))).toBe(false);
      if (section !== 'pinned') {
        const summary = rows.find(item => item.id === parent.id);
        expect(summary).toMatchObject({ status: 'idle', workersWorking: 1 });
        expect(summary).not.toHaveProperty('coordination');
      }
    }
    await page.getByRole('button', { name: 'View all active sessions', exact: true }).click();
    const active = page.getByRole('dialog', { name: 'Active sessions', exact: true });
    await expect(active.locator('.session')).toHaveCount(4);
    await expect(row(active).locator('.session-state')).toHaveText('Working');
    await expect(row(active).locator('.bot')).toHaveAttribute('data-mood', 'working');
    await expect(active.locator('.session').first()).toHaveAttribute('data-id', foreground[0].id);
    await page.getByRole('button', { name: 'Close sessions', exact: true }).click();
    await row(nowGroup).click();
    await expect(page.locator('#coordinator-worker-summary')).toContainText('1 working');
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#agent-activity')).toBeHidden();
    await expect(page.locator('#abort')).toBeHidden();
    await expect(page.locator('#send')).toBeVisible(); await expect(page.locator('#send')).toBeEnabled();
    await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Type / for commands');
    await expect(page.locator('#title-kind .bot')).toHaveAttribute('data-mood', 'working');
    const strip = await page.locator('#session-swipe').boundingBox();
    await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2); await page.mouse.down();
    await expect(page.locator('#nearby-sessions')).toBeVisible(); await page.mouse.up();
    const nearby = page.locator('#nearby-list button', { hasText: parent.title });
    await expect(nearby).toHaveAttribute('data-status', 'working');
    await expect(nearby.locator('.nearby-state')).toHaveText(/^Working/);
    await expect(nearby.locator('.bot')).toHaveAttribute('data-mood', 'working');
    await page.keyboard.press('Escape');
    await page.locator('#prompt').fill('Send normally while only the worker runs.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('Send normally while only the worker runs.');
    expect(commands.filter(item => item.text === 'Send normally while only the worker runs.').map(item => item.type)).toEqual(['prompt']);
    await page.getByLabel('Session details', { exact: true }).click();
    await page.getByRole('button', { name: 'Pin session', exact: true }).click();
    await page.getByLabel('Session details', { exact: true }).click();
    for (const [status, label] of [['waiting', 'Needs input'], ['working', 'Working'], ['starting', 'Starting'], ['idle', 'Working']]) {
      main.publish(status);
      await expect(row(nowGroup).locator('.session-state')).toHaveText(label);
      await expect(page.locator('#status')).toHaveText(status);
      if (status === 'waiting' || status === 'working') await expect(page.locator('#abort')).toBeVisible();
      else await expect(page.locator('#abort')).toBeHidden();
    }
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await page.screenshot({ path: info.outputPath('parent-working-in-now.png') });
    await row(nowGroup).click();
    await api(record(running.id), { kind: 'result', generation: record(running.id).generation, text: 'Inspection returned.' });
    await expect(page.locator('#coordinator-worker-summary')).not.toContainText('working');
    await expect(row(pins).locator('.session-state')).toHaveCount(0);
    await expect(page.locator('#abort')).toBeHidden();
    expect((await api(owners[0], { action: 'accept', taskId: running.id })).state).toBe('completed');
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await recent.locator(`.session[data-id="${other.id}"]`).click();
    await page.locator('#prompt').fill('Independent parent draft');
    // A new instruction queues behind the old turn. Stopping still counts as work until its ACK.
    expect((await api(owners[0], { action: 'message', taskId: running.id, text: 'Inspect once more.' })).state).toBe('queued');
    await expect(row(pins).locator('.session-state')).toHaveCount(0);
    const stopped = api(owners[0], { action: 'stop', taskId: running.id });
    await expect.poll(() => record(running.id).state).toBe('stopping');
    await expect(row(nowGroup).locator('.session-state')).toHaveText('Working');
    await expect(page.locator('#title')).toHaveText(other.title);
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#abort')).toBeHidden();
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await page.getByRole('button', { name: 'View all active sessions', exact: true }).click();
    await expect(row(active).locator('.session-state')).toHaveText('Working');
    writeFileSync(join(dir, 'abort.reply'), 'Release only the fixture abort acknowledgement.');
    expect((await stopped).state).toBe('stopped');
    await expect(row(active)).toHaveCount(0); await expect(active.locator('.session')).toHaveCount(3);
    await page.getByRole('button', { name: 'Close sessions', exact: true }).click();
    await expect(row(pins).locator('.session-state')).toHaveCount(0);
    await expect(row(pins).locator('.session-pinned')).toBeAttached();
    await expect(row(nowGroup)).toHaveCount(0);
    await expect(page.locator('#prompt')).toHaveValue('Independent parent draft');
    expect((await list({ section: 'now' })).some(item => item.id === parent.id || item.id === other.id)).toBe(false);
    await page.getByRole('button', { name: 'Search sessions', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search sessions', exact: true }).fill('Live background inspection');
    await expect(page.locator('#sessions .session')).toHaveCount(1);
    await page.locator('#sessions .session').click();
    await expect(page.locator('#coordinator-return')).toHaveText('Return to ' + parent.title);
    await expect(page.locator('#composer')).toBeHidden();
    await page.locator('#coordinator-return').click();
    await expect(page.locator('#title')).toHaveText(parent.title);
    await expect(page.locator('#composer')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#abort')).toBeHidden();
    await info.attach('worker-session-activity', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    expect(errors).toEqual([]);
  } finally {
    await page.close(); peer?.ws.terminate();
    agents.forEach(agent => agent.ws.terminate()); locks.forEach(lock => lock.release());
    await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
