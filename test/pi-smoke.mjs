import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { JsonLines } from '../src/rpc.mjs';
import { until } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pi-remote-real-'));
const config = loadConfig(dir), host = await startHost({ dir, config, port: 0, roots: [dir] });
config.port = host.http.address().port; writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
const file = join(dir, 'real.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: dir }) + '\n');
const trust = join(dir, 'trust-test.ts');
writeFileSync(trust, 'export default function(pi) { pi.on("project_trust", () => ({ trusted: "yes" })); }\n');
const entry = resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const child = spawn(process.execPath, [entry, '--mode', 'rpc', '--session', file, '-e', resolve('extension/index.ts'), '-e', trust],
  { cwd: dir, env: { ...process.env, PI_REMOTE_WORKER: '', PI_REMOTE_HOME: dir,
    PI_CODING_AGENT_DIR: join(dir, 'agent'), ANTHROPIC_API_KEY: 'test-key-no-model-calls' }, stdio: ['pipe', 'pipe', 'pipe'] });
const messages = []; let stderr = '';
const parser = new JsonLines(message => messages.push(message));
child.stdout.on('data', data => parser.push(data));
child.stderr.on('data', data => { stderr += data.toString(); });
child.stdin.on('error', () => {});
const exited = new Promise(resolve => child.on('close', resolve));
try {
  await until(() => host.service.live.size === 1, 25000);
  child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
  const state = await until(() => messages.find(x => x.id === 'state' && x.type === 'response'));
  assert.equal(state.success, true);
  child.stdin.write(JSON.stringify({ id: 'off', type: 'prompt', message: '/remote off' }) + '\n');
  await until(() => [...host.service.live.values()][0]?.state.status === 'disconnected');
  child.stdin.write(JSON.stringify({ id: 'on', type: 'prompt', message: '/remote on' }) + '\n');
  await until(() => [...host.service.live.values()][0]?.socket);
  console.log('Real Pi smoke passed: extension load, registration, state query, remote off/on. No model calls.');
} catch (e) {
  console.error(stderr.slice(-6000)); console.error(JSON.stringify(messages.slice(-10)));
  throw e;
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited; clearTimeout(timer); await host.close(); rmSync(dir, { recursive: true, force: true });
}
