import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, realpathSync, renameSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ensureDir } from './config.mjs';

export function canonical(file) {
  const absolute = resolve(file);
  try { return realpathSync(absolute); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const parent = dirname(absolute);
    if (parent === absolute) throw e;
    return join(canonical(parent), basename(absolute));
  }
}
export function sessionKey(file) { return createHash('sha256').update(canonical(file)).digest('hex'); }
export function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true; // malformed owners fail closed
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
export function acquireLock(dir, key, details = {}) {
  ensureDir(dir);
  const file = join(dir, key + '.json');
  const owner = { ...details, pid: process.pid, nonce: randomUUID(), createdAt: Date.now() };
  let fd;
  try { fd = openSync(file, 'wx', 0o600); }
  catch (e) {
    if (e.code === 'EEXIST') throw Object.assign(new Error('Session is owned or has a stale lock. Close its owner or run pi-remote unlock locally.'), { code: 'ELOCKED' });
    throw e;
  }
  try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); }
  let released = false;
  return { owner, setWorkerPid(pid) {
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Worker did not start');
    owner.workerPid = pid;
    const temp = file + '.' + owner.nonce + '.tmp';
    writeFileSync(temp, JSON.stringify(owner), { mode: 0o600 });
    renameSync(temp, file);
  }, release() {
    if (released) return;
    released = true;
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).nonce === owner.nonce) unlinkSync(file);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }};
}
export function acquireSessionLock(dir, key, details = {}) {
  // Serialize recovery separately so two resumptions cannot unlink a new owner.
  const recovery = acquireLock(dir, key + '-recovery', { kind: 'recovery' });
  try {
    try { return acquireLock(dir, key, details); }
    catch (error) {
      if (error.code !== 'ELOCKED') throw error;
      try { unlockDead(dir, key); }
      catch { throw error; } // Live workers and malformed owners still fail closed.
      return acquireLock(dir, key, details);
    }
  } finally { recovery.release(); }
}
export function unlockDead(dir, key) {
  if (!/^[a-zA-Z0-9-]+$/.test(key)) throw new Error('Invalid lock ID');
  const file = join(dir, key + '.json');
  const owner = JSON.parse(readFileSync(file, 'utf8'));
  if (processExists(owner.pid)) throw new Error('Owner process still exists; refusing unlock');
  if (owner.kind === 'rpc' && (!owner.workerPid || processExists(owner.workerPid))) throw new Error('RPC worker may still exist; refusing unlock');
  // Callers serialize recovery with a separate lock or the host's listening port.
  unlinkSync(file);
}
