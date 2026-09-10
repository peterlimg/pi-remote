import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
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
    if (e.code === 'EEXIST') throw new Error('Session is owned or has a stale lock. Close its owner or run pi-remote unlock locally.');
    throw e;
  }
  try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); }
  let released = false;
  return { owner, release() {
    if (released) return;
    released = true;
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).nonce === owner.nonce) unlinkSync(file);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }};
}
export function unlockDead(dir, key) {
  if (!/^[a-zA-Z0-9-]+$/.test(key)) throw new Error('Invalid lock ID');
  const file = join(dir, key + '.json');
  const owner = JSON.parse(readFileSync(file, 'utf8'));
  if (processExists(owner.pid)) throw new Error('Owner process still exists; refusing unlock');
  // No code automatically replaces locks. This local recovery command is the only stale-lock remover.
  unlinkSync(file);
}
