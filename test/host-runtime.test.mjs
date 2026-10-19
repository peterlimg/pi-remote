// E2E: real background hosts, restart CLI and a Pi replay worker; no model input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { ensureHost, hostStatus, stopHost } from '../src/control.mjs';
import { sessionKey } from '../src/locks.mjs';
import { socket } from './helpers.mjs';

test('guarded restart preserves the host and worker runtime when the controller uses another Node', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-runtime-')), bin = join(dir, 'controller');
  mkdirSync(bin);
  const controller = join(bin, 'node'); copyFileSync(process.execPath, controller);
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const config = { ...loadConfig(dir), port, publicUrl: 'http://127.0.0.1:' + port, relayUrl: '' };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  const file = join(dir, 'session.jsonl'), runtime = join(dir, 'worker-runtime.json'), pi = join(dir, 'replay-pi');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'runtime', cwd: dir }) + '\n');
  writeFileSync(pi, '#!/usr/bin/env node\n' +
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(runtime)}, JSON.stringify({ execPath: process.execPath }));\n` +
    `await import(${JSON.stringify(new URL('./fixtures/fake-pi.mjs', import.meta.url).href)});\n`, { mode: 0o700 });
  const keys = ['PI_REMOTE_HOME', 'PI_REMOTE_PORT', 'PI_REMOTE_PUBLIC_URL', 'PI_REMOTE_RELAY_URL', 'PI_REMOTE_SESSION_DIRS', 'PI_REMOTE_PI_BIN'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PI_REMOTE_HOME: dir, PI_REMOTE_PORT: String(port), PI_REMOTE_PUBLIC_URL: config.publicUrl,
    PI_REMOTE_RELAY_URL: '', PI_REMOTE_SESSION_DIRS: dir, PI_REMOTE_PI_BIN: pi });
  let client;
  try {
    const before = await ensureHost(config, dir);
    execFileSync(controller, [fileURLToPath(new URL('../scripts/restart-and-resume.mjs', import.meta.url)), '--run'], {
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH }, timeout: 30000
    });
    const after = await hostStatus(config, 'GET', dir, { idleOnly: true });
    assert.notEqual(after.pid, before.pid);
    client = await socket(`ws://127.0.0.1:${port}/ws`, config.clientToken, config.publicUrl);
    assert.equal((await client.request('resume', { sessionId: sessionKey(file) })).value.ok, true);
    assert.equal(JSON.parse(readFileSync(runtime, 'utf8')).execPath, process.execPath, 'Workers must use the host runtime, not the controller PATH');
    assert.equal(after.execPath, process.execPath, 'The caller must not silently switch the host runtime');
  } finally {
    client?.ws.terminate(); await stopHost(config, { idleOnly: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
