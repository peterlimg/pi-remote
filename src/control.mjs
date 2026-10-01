import { spawn } from 'node:child_process';
import { openSync, closeSync, fchmodSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dataDir, loadConfig } from './config.mjs';
import { processExists } from './locks.mjs';

export async function hostStatus(config = loadConfig(), method = 'GET') {
  let response;
  try {
    response = await fetch('http://127.0.0.1:' + config.port + '/_pi/remote', {
      method, headers: { Authorization: 'Bearer ' + config.bridgeToken },
      signal: AbortSignal.timeout(2000), redirect: 'error'
    });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw new Error('Cannot reach Pi Remote: ' + error.message, { cause: error });
  }
  if (!response.ok) throw new Error('Cannot control the service on port ' + config.port + '. Stop the old host manually once, then run /pi-remote again.');
  const status = await response.json();
  if (status.protocol !== 1) throw new Error('Unsupported Pi Remote service');
  return status;
}

export async function ensureHost(config = loadConfig(), dir = dataDir()) {
  dir = resolve(dir);
  const running = await hostStatus(config);
  if (running) {
    if (running.closing) throw new Error('Pi Remote is stopping. Try again shortly.');
    return running;
  }
  const logPath = join(dir, 'host.log');
  const log = openSync(logPath, 'a', 0o600);
  fchmodSync(log, 0o600);
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('../bin/pi-remote.mjs', import.meta.url)), 'serve'], {
      detached: true, cwd: dir, stdio: ['ignore', log, log, 'ipc'],
      env: { ...process.env, PI_REMOTE_HOME: dir, PI_REMOTE_PORT: String(config.port),
        PI_REMOTE_PUBLIC_URL: config.publicUrl, PI_REMOTE_RELAY_URL: config.relayUrl }
    });
  } finally { closeSync(log); }
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Pi Remote startup timed out. See ' + logPath)); }, 10000);
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
      child.once('error', error => finish(error));
      child.once('exit', () => finish(new Error('Pi Remote could not start. See ' + logPath + '; stale service lock recovery: pi-remote unlock service')));
      child.on('message', message => {
        if (message.type === 'ready') finish(null, message.status);
        else if (message.type === 'error') finish(Object.assign(new Error(message.error), { code: message.code }));
      });
    });
  } catch (error) {
    // A concurrent start may have won the existing exclusive service lock.
    for (let attempt = 0; attempt < 100; attempt++) {
      const running = await hostStatus(config);
      if (running && !running.closing) return running;
      if (error.code !== 'ELOCKED') break;
      let owner;
      try { owner = JSON.parse(readFileSync(join(dir, 'locks', 'service.json'), 'utf8')); } catch { break; }
      if (!processExists(owner.pid)) break;
      await delay(100);
    }
    if (error.code === 'ELOCKED') throw new Error('Pi Remote service is owned or has a stale lock. If its owner has exited, run pi-remote unlock service.');
    throw error;
  } finally {
    if (child.connected) child.disconnect();
    child.unref();
  }
}

function shutdownDisconnect(error) {
  for (let cause = error; cause; cause = cause.cause) {
    if (cause.code === 'ECONNRESET' || cause.code === 'ECONNREFUSED') return true;
  }
  return false;
}

export async function stopHost(config = loadConfig()) {
  const deadline = Date.now() + 30000;
  let stopping;
  try {
    stopping = await hostStatus(config, 'DELETE');
    if (!stopping) return false;
  } catch (error) {
    // DELETE may have been accepted before the connection was reset.
    if (!shutdownDisconnect(error)) throw error;
  }
  while (Date.now() < deadline) {
    if (stopping && !processExists(stopping.pid)) return true;
    await delay(100);
    try { if (!await hostStatus(config)) return true; }
    catch (error) {
      // An accepted DELETE can outlive individual status requests while workers close.
      if ((error.cause ?? error).name !== 'TimeoutError' && !shutdownDisconnect(error)) throw error;
    }
  }
  if (stopping && !processExists(stopping.pid)) return true;
  throw new Error('Pi Remote is still stopping after 30 seconds. Check /pi-remote status.');
}

export async function restartHost(config = loadConfig(), dir = dataDir()) {
  let stopError;
  try { await stopHost(config); } catch (error) { stopError = error; }
  // Even an unsuccessful stop wait may have delivered DELETE. Never skip startup.
  const deadline = Date.now() + 30000;
  for (;;) {
    try { return await ensureHost(config, dir); }
    catch (error) {
      if (Date.now() >= deadline) throw new AggregateError(stopError ? [stopError, error] : [error],
        'Pi Remote restart failed. Check ' + join(dir, 'host.log') + ': ' + error.message, { cause: error });
      await delay(250);
    }
  }
}
