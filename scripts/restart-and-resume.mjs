import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, renameSync, openSync, closeSync, fchmodSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { loadConfig, dataDir, parseObject } from '../src/config.mjs';
import { hostStatus, restartHost, handoffSession } from '../src/control.mjs';

function ownedSessions(dir, pid) {
  return readdirSync(join(dir, 'locks')).flatMap(name => {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) return [];
    let owner;
    try { owner = JSON.parse(readFileSync(join(dir, 'locks', name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return owner.pid === pid && owner.kind === 'rpc' ? [{ id: name.slice(0, -5), file: owner.file, nonce: owner.nonce }] : [];
  });
}

// The CLI queues this guarded operation so its caller's own turn can finish first.
export async function restartAndResume(config = loadConfig(), dir = dataDir(), { idleOnly = true } = {}) {
  const before = await hostStatus(config, 'GET', dir, { idleOnly });
  if (before && !before.closing && !Number.isSafeInteger(before.busyWorkers)) {
    // Modern hosts own this snapshot; concurrent restart jobs must not overwrite it.
    const ids = ownedSessions(dir, before.pid).map(item => item.id), file = join(dir, 'resume-sessions.json');
    const current = await hostStatus(config, 'GET', dir, { idleOnly });
    if (current?.pid === before.pid && !current.closing) {
      const temp = file + '.' + randomUUID() + '.tmp';
      writeFileSync(temp, JSON.stringify(ids), { mode: 0o600 });
      renameSync(temp, file);
    }
  }
  return restartHost(config, dir, { idleOnly, execPath: before?.execPath });
}

async function withClient(config, action) {
  const origin = 'http://127.0.0.1:' + config.port;
  const socket = new WebSocket('ws://127.0.0.1:' + config.port + '/ws', { origin });
  const ready = Promise.withResolvers();
  let pending;
  const timer = setTimeout(() => ready.reject(new Error('Could not connect to the local Pi Remote host.')), 5000);
  socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: config.clientToken })));
  socket.on('error', error => { ready.reject(error); pending?.reject(error); });
  socket.on('close', () => { ready.reject(new Error('Local host disconnected.')); pending?.reject(new Error('Local host disconnected.')); });
  socket.on('message', raw => {
    try {
      const message = parseObject(raw);
      if (message.type === 'ready') ready.resolve();
      if (message.type === 'response' && message.id === pending?.id) {
        message.ok ? pending.resolve(message.value) : pending.reject(new Error('Local host refused the control request.'));
      }
    } catch { const error = new Error('Invalid local host control response.'); ready.reject(error); pending?.reject(error); }
  });
  const request = (packet, wait = 5000) => new Promise((resolve, reject) => {
    const id = randomUUID(), timeout = setTimeout(() => reject(new Error('Local control request timed out.')), wait);
    pending = { id, resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } };
    socket.send(JSON.stringify({ ...packet, id }));
  });
  try {
    await ready.promise; clearTimeout(timer);
    return await action(request);
  } finally { clearTimeout(timer); socket.close(); }
}

// One-time upgrade fallback for a running host that predates lifecycle status.
async function legacyIdle(config, dir, pid) {
  const owned = ownedSessions(dir, pid);
  if (!owned.length) return true;
  return withClient(config, async request => {
    const sessions = [];
    for (let offset = 0; ; offset += 20) {
      const page = await request({ op: 'list', offset });
      if (!Array.isArray(page.sessions) || !Number.isSafeInteger(page.matched) || page.matched < 0) throw new Error('Invalid restart preflight session page.');
      sessions.push(...page.sessions);
      if (offset + 20 >= page.matched) break;
    }
    return owned.every(item => {
      const state = sessions.find(row => row.id === item.id);
      if (!state || state.status !== 'idle') return false;
      if (Date.now() - statSync(item.file).mtimeMs < 1000) return false;
      if (!state.model?.startsWith('claude-sdk/')) return true;
      const entries = readFileSync(item.file, 'utf8').trim().split('\n').map(JSON.parse);
      const last = entries.findLastIndex(entry => entry.message?.role === 'assistant' && entry.message.provider === 'claude-sdk');
      if (last < 0 || !['stop', 'length'].includes(entries[last].message.stopReason)) return true;
      return entries.findLastIndex(entry => entry.type === 'custom' && entry.customType === 'claude-sdk-checkpoint') > last;
    });
  });
}

export async function updateWorkers(config = loadConfig(), dir = dataDir()) {
  const before = await hostStatus(config, 'GET', dir, { idleOnly: true });
  if (!before || before.closing || !Array.isArray(before.managedSessions)) throw new Error('A running lifecycle-aware host is required to update workers.');
  const pending = new Map(ownedSessions(dir, before.pid).filter(item => before.managedSessions.some(session => session.id === item.id) &&
    statSync(item.file, { throwIfNoEntry: false })?.isFile())
    .map(item => [item.id, item.nonce]));
  let updated = 0;
  if (!pending.size) return { updated };
  return withClient(config, async request => {
    if ((await request({ op: 'list' })).allowResume !== true) throw new Error('Enable saved-session resume before updating workers.');
    const deadline = Date.now() + 5 * 60 * 1000;
    while (pending.size && Date.now() < deadline) {
      try {
        const current = await hostStatus(config, 'GET', dir, { idleOnly: true });
        if (current && !current.closing) {
          if (current.pid !== before.pid) return { updated, hostRestarted: true };
          const owners = new Map(ownedSessions(dir, before.pid).map(item => [item.id, item.nonce]));
          for (const [id, nonce] of pending) {
            if (Date.now() >= deadline) break;
            // Another update, a terminal handoff or a closed worker must not be restarted again.
            if (owners.get(id) !== nonce) { pending.delete(id); continue; }
            if (!current.managedSessions.find(session => session.id === id)?.restartSafe) continue;
            try {
              await handoffSession(id, config);
              const result = await request({ op: 'resume', sessionId: id }, 30000);
              if (!result?.ok) throw new Error(result?.error || 'Worker update could not resume the session. Resume it from the phone.');
              pending.delete(id); updated++;
              console.log(`Worker updated: ${id}`);
            } catch (error) { if (error.code !== 'EHANDOFF') throw error; }
          }
        }
      } catch (error) { if (error.code !== 'EHOSTTIMEOUT') throw error; }
      if (pending.size) await delay(250);
    }
    if (pending.size) throw new Error(`Updated ${updated} worker(s); ${pending.size} remained busy or unreachable. Run --workers again after they settle.`);
    return { updated };
  });
}

async function runQueuedRestart(config, dir) {
  const deadline = Date.now() + 5 * 60 * 1000;
  let first;
  while (Date.now() < deadline) {
    try {
      const current = await hostStatus(config, 'GET', dir, { idleOnly: true });
      if (first === undefined) first = current;
      else if (current && (!first || current.pid !== first.pid) && !current.closing) return current;
      const idle = !current || !current.closing && (Number.isSafeInteger(current.busyWorkers)
        ? current.busyWorkers === 0 : await legacyIdle(config, dir, current.pid));
      if (idle) return await restartAndResume(config, dir, { idleOnly: true });
    } catch (error) {
      if (!['ERESTARTBUSY', 'EHOSTTIMEOUT'].includes(error.code)) throw error;
      if (error.code === 'EHOSTTIMEOUT') console.warn(`Restart job ${process.pid}: host status timed out; retrying safely.`);
    }
    await delay(250);
  }
  throw new Error('Restart was not performed: sessions are active, saving checkpoints, or the host did not respond in time. Run again after they settle.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--run-workers') {
      const result = await updateWorkers();
      console.log(`Pi Remote worker update finished (job ${process.pid}): ${result.updated} updated${result.hostRestarted ? '; host was also replaced' : ''}.`);
    } else if (process.argv[2] === '--run') {
      await runQueuedRestart(loadConfig(), dataDir());
      console.log(`Pi Remote restarted (job ${process.pid}); session restoration starts automatically.`);
    } else if (process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--workers') {
      const dir = dataDir(), logPath = join(dir, 'restart.log');
      loadConfig(dir);
      const log = openSync(logPath, 'a', 0o600); fchmodSync(log, 0o600);
      let child;
      const workers = process.argv[2] === '--workers';
      try { child = spawn(process.execPath, [fileURLToPath(import.meta.url), workers ? '--run-workers' : '--run'], { detached: true, stdio: ['ignore', log, log] }); }
      finally { closeSync(log); }
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      console.log(`${workers ? 'Worker update' : 'Restart'} queued (pid ${child.pid}); waiting for ${workers ? 'each session to settle' : 'settled sessions and saved checkpoints'}. Log: ${logPath}`);
    } else throw new Error('Usage: node scripts/restart-and-resume.mjs [--workers]');
  } catch (error) { console.error(`Restart job ${process.pid}: ${error.message}`); process.exitCode = 1; }
}
