import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadConfig } from '../src/config.mjs';
import { ensureHost, stopHost, hostStatus } from '../src/control.mjs';
import { startHost } from '../src/host.mjs';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function environment(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-recovery-'));
  const config = { ...loadConfig(dir), port: await freePort(), relayUrl: '' };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  mkdirSync(join(dir, 'locks'));
  const previous = process.env.PI_REMOTE_SESSION_DIRS;
  process.env.PI_REMOTE_SESSION_DIRS = dir;
  t.after(async () => {
    await stopHost(config);
    if (previous === undefined) delete process.env.PI_REMOTE_SESSION_DIRS;
    else process.env.PI_REMOTE_SESSION_DIRS = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  return { dir, config, deadPid: child.pid, file: join(dir, 'locks', 'service.json') };
}

for (const legacy of [true, false]) test(`start recovers a dead ${legacy ? 'legacy' : 'current'} service lock with concurrent callers`, async t => {
  const { dir, config, deadPid, file } = await environment(t);
  writeFileSync(file, JSON.stringify({ kind: 'service', pid: deadPid, nonce: 'dead-host',
    ...(!legacy && { port: config.port }) }));
  const sessionFile = join(dir, 'locks', 'saved-session.json');
  const sessionLock = JSON.stringify({ kind: 'rpc', pid: deadPid, workerPid: process.pid });
  writeFileSync(sessionFile, sessionLock);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => ensureHost(config, dir)));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
  const pids = new Set(results.map(result => result.value.pid));
  assert.equal(pids.size, 1);
  const owner = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(owner.pid, (await hostStatus(config)).pid);
  assert.equal(owner.port, config.port);
  assert.equal(readFileSync(sessionFile, 'utf8'), sessionLock, 'Never recover session locks automatically');
});

test('recovery leaves living, malformed, non-service and different-port owners untouched', async t => {
  const { dir, config, deadPid, file } = await environment(t);
  for (const owner of [
    { kind: 'service', pid: process.pid },
    { kind: 'service', pid: 'invalid' },
    { kind: 'rpc', pid: deadPid, workerPid: process.pid },
    { kind: 'service', pid: deadPid, port: await freePort() },
    null
  ]) {
    const contents = JSON.stringify(owner);
    writeFileSync(file, contents);
    await assert.rejects(startHost({ dir, config, roots: [] }), { code: 'ELOCKED' });
    assert.equal(readFileSync(file, 'utf8'), contents);
    assert.equal(await hostStatus(config), null);
  }
});

test('an occupied listening port prevents stale-lock recovery', async t => {
  const { dir, config, deadPid, file } = await environment(t);
  const contents = JSON.stringify({ kind: 'service', pid: deadPid, port: config.port });
  writeFileSync(file, contents);
  const server = createServer();
  await new Promise(resolve => server.listen(config.port, '127.0.0.1', resolve));
  try {
    await assert.rejects(startHost({ dir, config, roots: [] }), { code: 'EADDRINUSE' });
    assert.equal(readFileSync(file, 'utf8'), contents);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
