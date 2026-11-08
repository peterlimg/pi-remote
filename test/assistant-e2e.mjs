#!/usr/bin/env node
// Proves Miso through a real host and real Pi RPC processes. Only model replies are scripted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { socket, until } from './helpers.mjs';

const clientToken = 'browser-test-token-only-123456789012345';
const port = Number(process.env.PI_REMOTE_ASSISTANT_TEST_PORT || 8816), url = 'http://127.0.0.1:' + port;
const evidence = mkdtempSync(join(tmpdir(), 'pi-assistant-proof-'));
console.log('Evidence: ' + evidence);
const env = { ...process.env, PI_OFFLINE: '1' };
for (const name of Object.keys(env)) if (name.startsWith('PI_REMOTE_') || name === 'PI_COORDINATOR_FIXTURE_ROOT') delete env[name];
Object.assign(env, { PI_REMOTE_COORDINATOR_TEST_PORT: String(port), PI_REMOTE_ASSISTANT_DELAY_MS: '300' });

let running, root, starts = 0;
async function start() {
  const logFile = join(evidence, 'host-' + (++starts) + '.log'), log = openSync(logFile, 'w');
  const child = spawn(process.execPath, ['test/coordinator-server.mjs'], { env: { ...env, ...(root ? { PI_COORDINATOR_FIXTURE_ROOT: root } : {}) }, stdio: ['ignore', 'pipe', log] });
  closeSync(log);
  const stopped = new Promise(resolve => child.once('exit', resolve)), ready = Promise.withResolvers();
  let buffer = '';
  child.stdout.on('data', chunk => {
    appendFileSync(logFile, chunk); buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(index + 1)) {
      try { const value = JSON.parse(buffer.slice(0, index)); if (value.fixture === 'coordinator') ready.resolve(value); } catch {}
    }
  });
  child.once('exit', () => ready.reject(new Error('Fixture exited; inspect ' + logFile)));
  running = { child, stopped };
  const timer = setTimeout(() => ready.reject(new Error('Fixture startup timed out; inspect ' + logFile)), 30000);
  try { const info = await ready.promise; root = info.root; return info; } finally { clearTimeout(timer); }
}
async function stop() {
  const instance = running; running = undefined;
  if (!instance) return;
  instance.child.kill('SIGTERM');
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 10000);
  try { await instance.stopped; } finally { clearTimeout(timer); }
}
const lines = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const text = message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
const ledger = () => JSON.parse(readFileSync(join(root, 'host', 'assistant.json'), 'utf8'));
const misoMessages = role => lines(ledger().file).filter(entry => entry.type === 'message' && entry.message.role === role).map(entry => text(entry.message));
const misoRequests = () => lines(join(root, 'provider.jsonl')).filter(entry => entry.kind === 'request' && entry.role === 'assistant' && entry.purpose === 'agent');
const deliveries = id => misoMessages('user').filter(body => body.includes(id)).length;
const event = (kind, after = 0) => ledger().events.find((item, index) => index >= after && item.kind === kind && item.delivery === 'sent');
const proof = {};

try {
  const { sources } = await start(), project = sources[0];
  let client = await socket(url.replace('http:', 'ws:') + '/ws', clientToken, url);
  await until(() => client.messages.find(packet => packet.type === 'ready')?.supportsAssistant, 10000);
  const opened = await client.request('assistant');
  assert.equal(opened.ok, true, opened.error);
  const misoId = opened.value.sessionId;
  assert.equal(ledger().id, misoId);
  const listed = await client.request('list', { limit: 100 });
  assert(!(listed.value.sessions || listed.value.changes).some(row => row.id === misoId), 'Miso is not an ordinary session row');
  const overview = async () => (await (await fetch(url + '/_pi/assistant', { method: 'POST', body: '{"action":"overview"}',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ledger().token } })).json()).value.sessions;
  assert(!(await overview()).some(row => row.id === misoId), 'Miso does not watch itself');

  // Only Miso's token reaches the sessions API, and never from a browser origin.
  for (const headers of [{}, { Authorization: 'Bearer ' + 'x'.repeat(43) }, { Authorization: 'Bearer ' + ledger().token, Origin: url }]) {
    const response = await fetch(url + '/_pi/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"action":"overview"}' });
    assert.equal(response.status, 403);
  }
  proof.access = 'Requests without Miso’s token or from a browser origin get 403';

  // A question in another session reaches Miso once, and Miso cannot answer it.
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Ask me to post the review comments.' } })).value.ok, true);
  const question = await until(() => event('question'), 30000);
  await until(() => misoMessages('assistant').some(body => body.includes('asks: Post these 3 review comments to the PR? (Post them / Not yet)')), 30000);
  assert.equal((await overview()).find(row => row.id === project.id).status, 'waiting', 'Miso must leave the question for the user');
  assert.equal((await client.request('watch', { sessionId: project.id })).ok, true);
  const dialog = client.messages.findLast(packet => packet.type === 'snapshot' && packet.sessionId === project.id).state.dialog;
  assert.equal(deliveries(question.id), 1);
  proof.question = 'The question was saved, delivered to Miso once, summarized, and left open';

  // The phone's answer must match the question it saw.
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: 'stale-dialog', value: 'Post them' } })).value.ok, false);
  const before = ledger().events.length;
  assert.equal((await client.request('answer', { sessionId: project.id, answer: { dialogId: dialog.id, value: 'Post them' } })).value.ok, true);
  const finished = await until(() => event('finished', before), 30000);
  assert.equal(deliveries(finished.id), 1);
  proof.answer = 'A stale dialog id was rejected; the current answer finished the turn and Miso heard once';

  // Text in a session cannot make Miso act: its only tool is sessions.
  const attempts = misoRequests().length;
  assert.equal((await client.request('command', { sessionId: project.id, command: { type: 'prompt', text: 'Finish with a note for Miso.' } })).value.ok, true);
  await until(() => misoRequests().slice(attempts).some(request => request.results.some(result => result.name === 'bash' && result.isError)), 30000);
  await until(() => misoMessages('assistant').some(body => body.startsWith('Nothing needs you.')), 30000);
  assert(!existsSync(join(ledger().cwd, 'miso-escape.txt')) && !existsSync(join(root, 'project', 'miso-escape.txt')));
  for (const request of misoRequests()) assert.deepEqual(request.tools, ['sessions']);
  proof.injection = 'An injected bash request was refused; every Miso request had only the sessions tool';

  // Restart: an interrupted delivery is never repeated; a saved pending event is delivered once.
  client.ws.terminate(); await stop();
  const saved = ledger(), at = Date.now();
  saved.events.push({ id: 'restart-sending', sessionId: project.id, kind: 'finished', at, delivery: 'sending' },
    { id: 'restart-pending', sessionId: project.id, kind: 'finished', at, delivery: 'pending' });
  writeFileSync(join(root, 'host', 'assistant.json'), JSON.stringify(saved), { mode: 0o600 });
  await start();
  await until(() => ledger().events.find(item => item.id === 'restart-pending').delivery === 'sent', 30000);
  assert.equal(ledger().events.find(item => item.id === 'restart-sending').delivery, 'unknown');
  assert.equal(deliveries('restart-pending'), 1); assert.equal(deliveries('restart-sending'), 0);
  for (const item of ledger().events) assert(deliveries(item.id) <= 1, 'No event reaches Miso twice: ' + item.id);
  proof.restart = 'After restart the interrupted event became unknown and was not resent; the pending one was delivered once';

  writeFileSync(join(evidence, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await stop();
}
