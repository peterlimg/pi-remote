#!/usr/bin/env node
// Real host, journal and RPC subprocess; only Pi's acknowledgement timing is fault-controlled.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { socket, until, delay } from './helpers.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-assistant-delivery-'));
console.log('Evidence: ' + evidence);
const port = Number(process.env.PI_REMOTE_ASSISTANT_TEST_PORT || 8816), origin = 'http://127.0.0.1:' + port;
const env = { ...process.env, PI_OFFLINE: '1' };
for (const name of Object.keys(env)) if (name.startsWith('PI_REMOTE_') || name === 'PI_COORDINATOR_FIXTURE_ROOT') delete env[name];
Object.assign(env, { PI_REMOTE_SMOKE_PI_ENTRY: resolve('test/fixtures/coordinator-flow-pi.mjs'), PI_FORMAL_ROOT: evidence,
  PI_FORMAL_SCENARIO: 'assistant-delivery', PI_REMOTE_COORDINATOR_TEST_PORT: String(port), PI_REMOTE_ASSISTANT_DELAY_MS: '60000' });
let root, child, stopped, client, sources, misoId;
const ledger = () => JSON.parse(readFileSync(join(root, 'host', 'assistant.json'), 'utf8'));
const inputs = () => existsSync(join(evidence, 'draft-inputs.jsonl')) ? readFileSync(join(evidence, 'draft-inputs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
const count = text => inputs().filter(input => input.text === text).length;
async function start() {
  child = spawn(process.execPath, ['test/coordinator-server.mjs'], { env: { ...env, ...(root ? { PI_COORDINATOR_FIXTURE_ROOT: root } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  stopped = new Promise(resolve => child.once('exit', resolve));
  let output = '', ready;
  child.stderr.on('data', data => appendFileSync(join(evidence, 'host.log'), data));
  child.stdout.on('data', data => {
    appendFileSync(join(evidence, 'host.log'), data); output += data;
    for (let index; (index = output.indexOf('\n')) >= 0; output = output.slice(index + 1)) {
      try { const value = JSON.parse(output.slice(0, index)); if (value.fixture === 'coordinator') ready = value; } catch {}
    }
  });
  const info = await until(() => { assert(child.exitCode === null, 'Fixture exited before ready'); return ready; }, 15000);
  root = info.root; sources = info.sources;
  client = await socket(origin.replace('http:', 'ws:') + '/ws', 'browser-test-token-only-123456789012345', origin);
  await until(() => client.messages.some(packet => packet.type === 'ready'));
  misoId = (await client.request('assistant')).value.sessionId;
  await client.request('watch', { sessionId: misoId });
}
async function stop(signal = 'SIGTERM') {
  client?.ws.terminate();
  if (!child) return;
  child.kill(signal);
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  try { await stopped; } finally { clearTimeout(timer); child = undefined; }
}
async function draft(text) {
  const response = await fetch(origin + '/_pi/assistant', { method: 'POST', headers: { Authorization: 'Bearer ' + ledger().token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'draft', sessionId: sources[0].id, text, requestId: randomUUID() }) });
  const result = await response.json(); assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
}
const action = (draft, action = 'send') => client.request('assistantDraft', { sessionId: misoId, action: { action, draftId: draft.id, revision: draft.revision } });
const sendWithoutWaiting = draft => client.ws.send(JSON.stringify({ id: randomUUID(), op: 'assistantDraft', sessionId: misoId,
  action: { action: 'send', draftId: draft.id, revision: draft.revision } }));
const state = draft => ledger().drafts.find(item => item.id === draft.id);
const proofs = [];
try {
  await start();
  const interrupted = await draft('Interrupted delivery');
  sendWithoutWaiting(interrupted);
  await until(() => count(interrupted.text) === 1);
  assert.equal(state(interrupted).state, 'delivering');
  assert.equal(state(interrupted).approvedRevision, interrupted.revision);
  assert.equal((await action(interrupted)).value.ok, true);
  assert.equal(count(interrupted.text), 1);
  const busy = await draft('Never interrupt');
  assert.equal((await action(busy)).value.ok, false);
  await action(busy, 'cancel'); await action(busy);
  assert.equal(count(busy.text), 0);
  // Kill the actual host after the RPC process records input but before it acknowledges.
  await stop('SIGKILL');
  assert.equal(state(interrupted).state, 'delivering');
  await start();
  assert.equal(state(interrupted).state, 'uncertain');
  await action(interrupted); await delay(300);
  assert.equal(count(interrupted.text), 1);
  proofs.push('SIGKILL after delivery but before acknowledgement becomes uncertain; duplicate and post-restart approvals never resend.');

  writeFileSync(join(evidence, 'draft.reply'), 'release');
  const accepted = await draft('Acknowledged delivery');
  assert.equal((await action(accepted)).value.ok, true);
  await until(() => state(accepted).feedback?.text);
  assert.equal(state(accepted).state, 'delivered');
  assert.equal(state(accepted).feedback.text, 'Reply to: ' + accepted.text);
  await action(accepted); assert.equal(count(accepted.text), 1);
  proofs.push('An acknowledged delivery captures its own final reply exactly once.');

  rmSync(join(evidence, 'draft.reply'));
  const mixed = await draft('Interleaved draft');
  sendWithoutWaiting(mixed); await until(() => count(mixed.text) === 1);
  const interleavedId = randomUUID();
  client.ws.send(JSON.stringify({ op: 'command', id: interleavedId, sessionId: sources[0].id, command: { type: 'prompt', text: 'Unrelated user input' } }));
  await until(() => count('Unrelated user input') === 1);
  writeFileSync(join(evidence, 'draft.reply'), 'release');
  await until(() => state(mixed).state === 'delivered');
  await until(() => client.messages.some(packet => packet.type === 'response' && packet.id === interleavedId));
  assert.match(state(mixed).feedback.note, /Other input/); assert.equal(state(mixed).feedback.text, undefined);
  proofs.push('Interleaved user input suppresses reply attribution rather than attaching an unrelated result.');

  // A failed RPC blocks the target; make this the final dispatch scenario.
  writeFileSync(join(evidence, 'draft.fail'), 'fail');
  const failed = await draft('Lost acknowledgement');
  await action(failed);
  assert.equal(state(failed).state, 'uncertain');
  await action(failed); assert.equal(count(failed.text), 1);
  const blocked = await draft('Do not continue a blocked turn');
  assert.equal((await action(blocked)).value.ok, false);
  assert.equal(count(blocked.text), 0);
  proofs.push('A failed acknowledgement after the effect remains uncertain and cannot be retried; blocked targets reject new drafts.');
  for (const input of inputs().filter(input => input.text !== 'Unrelated user input')) assert.equal(input.streamingBehavior, 'followUp');
  writeFileSync(join(evidence, 'proof.json'), JSON.stringify(proofs, null, 2)); console.log(proofs.join('\n'));
} finally {
  writeFileSync(join(evidence, 'draft.reply'), 'release');
  await stop();
}
