// E2E: a real host and Pi processes share a session, without external model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { sessionKey } from '../src/locks.mjs';
import { JsonLines } from '../src/rpc.mjs';
import { socket, until } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pi-terminal-handoff-'));
const entry = process.env.PI_REMOTE_SMOKE_PI_ENTRY || resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const extension = resolve('extension/index.ts'), fixture = join(dir, 'fixture.ts');
const proof = join(dir, 'proof.json'), holding = join(dir, 'holding'), release = join(dir, 'release');
writeFileSync(fixture, `import { writeFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
export default function(pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  pi.on('input', event => {
    if (event.text !== 'handoff proof') return;
    writeFileSync(${JSON.stringify(proof)}, JSON.stringify({ pid: process.pid, source: event.source }));
    pi.appendEntry('handoff-proof', { pid: process.pid });
    return { action: 'handled' };
  });
  pi.registerCommand('hold-handoff', { handler: async () => {
    writeFileSync(${JSON.stringify(holding)}, 'holding');
    while (!existsSync(${JSON.stringify(release)})) await delay(20);
  } });
}
`);
for (const name of ['terminal-agent', 'worker-agent']) mkdirSync(join(dir, name));
const config = loadConfig(dir);
const host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '', publicUrl: 'http://127.0.0.1:1',
  workerOptions: { bin: '/usr/bin/env', prefix: ['PI_REMOTE_HOME=' + dir, 'PI_REMOTE_PORT=', 'PI_REMOTE_PUBLIC_URL=',
    'PI_CODING_AGENT_DIR=' + join(dir, 'worker-agent'), process.execPath, entry, '--no-extensions', '-e', extension, '-e', fixture] } });
config.port = host.http.address().port;
writeFileSync(join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
const file = join(dir, 'session.jsonl'), id = sessionKey(file);
writeFileSync(file, [
  { type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: dir },
  { type: 'message', id: 'saved-question', parentId: null, timestamp: new Date().toISOString(),
    message: { role: 'user', content: 'Saved handoff history', timestamp: 1 } }
].map(row => JSON.stringify(row)).join('\n') + '\n');
host.service.scan();
const original = readFileSync(file, 'utf8'), terminals = [];
const client = await socket('ws://127.0.0.1:' + config.port + '/ws', config.clientToken, 'http://127.0.0.1:' + config.port);
const owner = () => JSON.parse(readFileSync(join(dir, 'locks', id + '.json'), 'utf8'));
const startTerminal = async (sessionFile = file) => {
  const child = spawn(process.execPath, [entry, '--mode', 'rpc', '--session', sessionFile, '--no-extensions', '-e', extension, '-e', fixture],
    { cwd: dir, env: { ...process.env, PI_REMOTE_WORKER: '', PI_REMOTE_HOME: dir, PI_REMOTE_PORT: '', PI_REMOTE_PUBLIC_URL: '',
      PI_REMOTE_RELAY_URL: '', PI_CODING_AGENT_DIR: join(dir, 'terminal-agent') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const messages = [], parser = new JsonLines(message => messages.push(message));
  const terminal = { child, messages, exited: new Promise(resolve => child.once('close', resolve)) };
  terminals.push(terminal);
  child.stdout.on('data', data => parser.push(data));
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
  await until(() => messages.find(message => message.id === 'state' && message.type === 'response'), 25000);
  return terminal;
};
const stopTerminal = async terminal => {
  if (terminal.child.exitCode !== null) return;
  terminal.child.kill('SIGTERM');
  const timer = setTimeout(() => terminal.child.kill('SIGKILL'), 4000);
  await terminal.exited; clearTimeout(timer);
};
try {
  assert.equal((await client.request('resume', { sessionId: id })).value.ok, true);
  const worker = host.service.live.get(id).worker, before = owner();
  const handoffUrl = 'http://127.0.0.1:' + config.port + '/_pi/handoff';
  const headers = { Authorization: 'Bearer ' + config.bridgeToken, 'X-Pi-Remote-Session': id };
  for (const forbidden of [{}, { ...headers, Authorization: 'Bearer ' + config.clientToken }, { ...headers, Origin: 'https://example.com' }]) {
    assert.equal((await fetch(handoffUrl, { method: 'POST', headers: forbidden })).status, 403);
  }
  assert.equal((await fetch(handoffUrl, { headers })).status, 405);
  const invalid = await fetch(handoffUrl, { method: 'POST', headers: { ...headers, 'X-Pi-Remote-Session': '../invalid' } });
  assert.equal(invalid.status, 409);
  assert.deepEqual(await invalid.json(), { error: 'Invalid session ID.' });
  assert.equal(owner().nonce, before.nonce, 'Rejected control requests must not affect ownership');
  const terminal = await startTerminal();
  const errors = terminal.messages.filter(message => message.method === 'notify' && message.notifyType === 'error').map(message => message.message);
  assert.equal(owner().pid, terminal.child.pid, 'Resuming on the Mac must transfer the idle phone worker lock. Notifications: ' + JSON.stringify(errors));
  await until(() => host.service.live.get(id)?.socket);
  assert.equal(worker.closed, true, 'The old writer must exit before the Mac owns the session');
  assert.equal(host.service.managedSessions.length, 0);
  terminal.child.stdin.write(JSON.stringify({ id: 'local', type: 'prompt', message: 'handoff proof' }) + '\n');
  await until(() => existsSync(proof));
  assert.equal(JSON.parse(readFileSync(proof, 'utf8')).pid, terminal.child.pid, 'Local input must not be swallowed');
  rmSync(proof);
  assert.equal((await client.request('command', { sessionId: id, command: { type: 'prompt', text: 'handoff proof' } })).value.ok, true);
  await until(() => existsSync(proof));
  assert.equal(JSON.parse(readFileSync(proof, 'utf8')).pid, terminal.child.pid, 'Phone commands must reach the new terminal owner');
  const duplicate = await startTerminal();
  assert.equal(owner().pid, terminal.child.pid, 'Another terminal must not steal a live terminal lock');
  await stopTerminal(duplicate);
  await stopTerminal(terminal);
  await until(() => host.service.live.get(id)?.resumable);

  assert.equal((await host.service.resume(id, randomUUID())).ok, true);
  const busyWorker = host.service.live.get(id).worker;
  assert.equal((await host.service.command(id, randomUUID(), { type: 'prompt', text: '/hold-handoff' })).ok, true);
  await until(() => existsSync(holding));
  const blocked = await startTerminal();
  assert.equal(owner().workerPid, busyWorker.process.pid, 'A pending command must prevent handoff');
  assert.equal(busyWorker.closed, undefined);
  assert(blocked.messages.some(message => message.method === 'notify' && /still working|saving|busy/i.test(message.message)), 'Busy handoff must explain how to retry');
  await stopTerminal(blocked);
  writeFileSync(release, 'released');
  await until(() => busyWorker.pending.size === 0);
  const retried = await startTerminal();
  assert.equal(owner().pid, retried.child.pid, 'Retrying after the command settles must transfer ownership');
  await until(() => host.service.live.get(id)?.socket);
  await stopTerminal(retried);
  await until(() => host.service.live.get(id)?.resumable);
  assert.equal((await client.request('resume', { sessionId: id })).value.ok, true);
  const alternate = join(dir, 'alternate.jsonl');
  writeFileSync(alternate, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: dir }) + '\n');
  const switching = await startTerminal(alternate);
  switching.child.stdin.write(JSON.stringify({ id: 'resume', type: 'switch_session', sessionPath: file }) + '\n');
  const switched = await until(() => switching.messages.find(message => message.type === 'response' && message.id === 'resume'), 25000);
  assert.equal(switched.success, true, switched.error);
  assert.equal(switched.data.cancelled, false);
  assert.equal(owner().pid, switching.child.pid, 'Mac session switching must also transfer the phone worker lock');
  await until(() => host.service.live.get(id)?.socket && host.service.live.get(id).owner.pid === switching.child.pid);
  assert(readFileSync(file, 'utf8').startsWith(original), 'Handoff must preserve session history');
  console.log('PASS: real Pi startup and session-switch handoff, local input, phone commands, busy refusal/retry, exclusive ownership, authentication and history preservation. No model calls.');
} finally {
  client.ws.terminate();
  await Promise.all(terminals.map(stopTerminal));
  await host.close();
  rmSync(dir, { recursive: true, force: true });
}
