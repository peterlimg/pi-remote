import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSessionLock, acquireLock, sessionKey } from '../src/locks.mjs';
import { loadConfig } from '../src/config.mjs';
import { SessionService } from '../src/service.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-locks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  return { dir, deadPid: child.pid, file: join(dir, 'session.json') };
}

test('session recovery preserves living, orphaned, unknown and malformed owners', async t => {
  const { dir, deadPid, file } = await fixture(t);
  for (const owner of [
    { pid: process.pid },
    { pid: deadPid, kind: 'rpc', workerPid: process.pid },
    { pid: deadPid, kind: 'rpc' },
    { pid: 'invalid' },
    null,
    'not JSON'
  ]) {
    const contents = typeof owner === 'string' ? owner : JSON.stringify(owner);
    writeFileSync(file, contents);
    assert.throws(() => acquireSessionLock(dir, 'session'), { code: 'ELOCKED' });
    assert.equal(readFileSync(file, 'utf8'), contents);
  }
  const gate = acquireLock(dir, 'session-recovery');
  try {
    writeFileSync(file, JSON.stringify({ pid: deadPid }));
    assert.throws(() => acquireSessionLock(dir, 'session'), { code: 'ELOCKED' });
  } finally { gate.release(); }
  acquireSessionLock(dir, 'session').release();
});

test('Remote can resume a session whose host and worker both exited', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-worker-recovery-'));
  let service;
  t.after(async () => { await service?.close(); rmSync(dir, { recursive: true, force: true }); });
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  const file = join(dir, 'saved.jsonl'), id = sessionKey(file);
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'saved', cwd: dir }) + '\n');
  loadConfig(dir);
  const old = acquireLock(join(dir, 'locks'), id);
  const lockFile = join(dir, 'locks', id + '.json');
  writeFileSync(lockFile, JSON.stringify({ ...old.owner, kind: 'rpc', pid: child.pid, workerPid: child.pid }));
  service = new SessionService({ dir, roots: [dir], allowResume: true, workerOptions: {
    bin: process.execPath, prefix: [new URL('./fixtures/fake-pi.mjs', import.meta.url).pathname]
  } });
  const result = await service.resume(id, 'resume-after-crash');
  assert.equal(result.ok, true, result.error);
  assert.equal(service.read(id).status, 'idle');
  assert.equal(JSON.parse(readFileSync(lockFile, 'utf8')).workerPid, service.live.get(id).worker.process.pid);
});

test('simultaneous recovery leaves exactly one session owner', async t => {
  const { dir, deadPid, file } = await fixture(t);
  writeFileSync(file, JSON.stringify({ pid: deadPid, kind: 'rpc', workerPid: deadPid }));
  const children = Array.from({ length: 6 }, () => spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireSessionLock } from ${JSON.stringify(new URL('../src/locks.mjs', import.meta.url).href)};
    setInterval(() => {}, 30000); // Keep the winning owner alive until the parent finishes.
    process.send('ready');
    process.once('message', () => {
      try { const lock = acquireSessionLock(${JSON.stringify(dir)}, 'session'); process.send({ owner: lock.owner }); }
      catch (error) { process.send({ error: error.code }); }
    });
  `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }));
  t.after(() => { for (const child of children) child.kill(); });
  await Promise.all(children.map(child => once(child, 'message')));
  const results = children.map(child => once(child, 'message'));
  for (const child of children) child.send('go');
  const responses = (await Promise.all(results)).map(([message]) => message);
  const winners = responses.filter(response => response.owner);
  assert.equal(winners.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), winners[0].owner);
  assert.ok(responses.every(response => response.owner || response.error === 'ELOCKED'));
});
