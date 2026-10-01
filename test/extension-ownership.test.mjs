import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import remoteExtension from '../extension/index.ts';
import { loadConfig } from '../src/config.mjs';
import { sessionKey } from '../src/locks.mjs';
import { startHost } from '../src/host.mjs';
import { until } from './helpers.mjs';

for (const kind of ['terminal', 'rpc']) test(`Mac and Remote reconnect through a dead ${kind} owner`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-ownership-'));
  const previous = process.env.PI_REMOTE_HOME;
  process.env.PI_REMOTE_HOME = dir;
  const events = new Map(), notifications = [], inputs = [];
  let host;
  t.after(async () => {
    await events.get('session_shutdown')?.();
    await host?.close();
    if (previous === undefined) delete process.env.PI_REMOTE_HOME;
    else process.env.PI_REMOTE_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(dead, 'exit');
  const file = join(dir, 'session.jsonl'), id = sessionKey(file);
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'test', cwd: dir }) + '\n');
  mkdirSync(join(dir, 'locks'));
  writeFileSync(join(dir, 'locks', id + '.json'), JSON.stringify({ pid: dead.pid, kind,
    ...(kind === 'rpc' && { workerPid: dead.pid }), nonce: 'dead-owner' }));
  const config = loadConfig(dir);
  host = await startHost({ dir, config, port: 0, roots: [dir] });
  config.port = host.http.address().port;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  remoteExtension({
    on: (name, handler) => events.set(name, handler), registerCommand() {},
    getSessionName: () => 'Shared session', getThinkingLevel: () => 'medium',
    sendUserMessage: text => inputs.push(text)
  });
  const context = { cwd: dir, sessionManager: {
    getSessionFile: () => file, getSessionId: () => 'test', getBranch: () => []
  }, ui: { notify: message => notifications.push(message), setStatus() {} } };
  await events.get('session_start')({}, context);
  assert.equal(events.get('input')?.({ text: 'local prompt', source: 'interactive' }, context)?.action,
    undefined, 'The remote extension must not swallow local input after a dead owner exits');
  assert.deepEqual(notifications, []);
  await until(() => host.service.live.get(id)?.socket);
  const result = await host.service.command(id, 'remote-prompt', { type: 'prompt', text: 'remote prompt' });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(inputs, ['remote prompt']);
  events.get('message_end')({ type: 'message_end', message: { role: 'user', timestamp: 1, content: 'local prompt' } });
  await until(() => host.service.read(id).messages.some(message => message.text === 'local prompt'));
});
