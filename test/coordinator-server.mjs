#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { sessionKey } from '../src/locks.mjs';

const root = process.env.PI_COORDINATOR_FIXTURE_ROOT || mkdtempSync(join(tmpdir(), 'pi-coordinator-fixture-'));
assert(basename(root).startsWith('pi-coordinator-fixture-'), 'Refuse using an unrelated directory');
const marker = join(root, '.coordinator-fixture.json');
if (!process.env.PI_COORDINATOR_FIXTURE_ROOT) writeFileSync(marker, JSON.stringify({ version: 1 }), { flag: 'wx' });
assert.equal(JSON.parse(readFileSync(marker, 'utf8')).version, 1);
const dir = join(root, 'host'), agent = join(root, 'agent'), sessions = join(root, 'sessions');
for (const folder of [dir, agent, sessions, join(root, 'project'), join(root, 'other-project')]) mkdirSync(folder, { recursive: true });
const seed = (path, content) => { if (!existsSync(path)) writeFileSync(path, content, { flag: 'wx', mode: 0o600 }); };
seed(join(root, 'project', 'alpha.txt'), 'ALPHA_VALUE=stable\n');
seed(join(root, 'project', 'beta.txt'), 'BETA_VALUE=hold\n');
seed(join(root, 'outside.txt'), 'PRIVATE_OUTSIDE_SHOULD_NOT_APPEAR\n');
if (!existsSync(join(root, 'project', 'escape.txt'))) symlinkSync(join(root, 'outside.txt'), join(root, 'project', 'escape.txt'));
seed(join(agent, 'settings.json'), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
const sources = [];
for (const [name, folder] of [['Coordinator verification project', 'project'], ['Other verification project', 'other-project']]) {
  const file = join(sessions, folder + '.jsonl'), id = randomUUID(), timestamp = new Date().toISOString();
  seed(file, [
    { type: 'session', version: 3, id, timestamp, cwd: join(root, folder) },
    { type: 'session_info', id: 'name', parentId: null, timestamp, name },
    { type: 'model_change', id: 'model', parentId: 'name', timestamp, provider: 'coordinator-fixture', modelId: 'fixture' }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  sources.push({ id: sessionKey(file), title: name });
}
seed(join(dir, 'pinned-sessions.json'), JSON.stringify(sources.map(source => source.id)));
const port = Number(process.env.PI_REMOTE_COORDINATOR_TEST_PORT || 8813);
assert(Number.isInteger(port) && port > 0 && port <= 65535);
const config = { ...loadConfig(dir), port, publicUrl: 'http://127.0.0.1:' + port, relayUrl: '',
  clientToken: 'browser-test-token-only-123456789012345', bridgeToken: 'coordinator-bridge-fixture-only-123456789012345' };
writeFileSync(join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
const entry = process.env.PI_REMOTE_SMOKE_PI_ENTRY || resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const local = existsSync(entry);
const host = await startHost({ dir, config, port, publicUrl: config.publicUrl, relayUrl: '', roots: [sessions],
  workerOptions: { bin: local ? process.execPath : 'pi', prefix: [...(local ? [entry] : []), '-e', resolve('test/fixtures/coordinator-provider.mjs')],
    env: { PI_CODING_AGENT_DIR: agent, PI_COORDINATOR_FIXTURE_ROOT: root, PI_OFFLINE: '1' } } });
console.log(JSON.stringify({ fixture: 'coordinator', root, pid: process.pid, url: config.publicUrl, sources }));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  try { await host.close(); process.exit(0); } catch (error) { console.error(error); process.exit(1); }
});
