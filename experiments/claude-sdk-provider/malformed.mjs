// E2E: real Pi RPC, provider, MCP and tool effects; only the external SDK peer is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-malformed-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'MALFORMED_FIXTURE' });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const settings = join(homedir(), '.pi/agent/settings.json');
const settingsHash = () => existsSync(settings) ? createHash('sha256').update(readFileSync(settings)).digest('hex') : undefined;
const beforeSettings = settingsHash();
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const result = { fixture: 'real Pi RPC, extension, MCP and filesystem effects; SDK protocol replay, no model calls',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
let worker, settled = 0;
const previews = new Set();
async function send(message) {
  const before = settled;
  await worker.request('prompt', { message });
  const deadline = Date.now() + 12000;
  while (settled === before && entries().findLast(entry => entry.message?.role === 'assistant')?.message.stopReason !== 'error') {
    if (Date.now() > deadline) throw new Error('Malformed-input turn did not settle.'); await delay(20);
  }
  return entries().findLast(entry => entry.message?.role === 'assistant').message;
}
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['local', 'early', 'late', 'early-receipt', 'mixed', 'success', 'missing', 'repeat', 'duplicate']) {
    result.stage = mode;
    const file = join(evidence, mode + '.jsonl');
    process.env.PI_RECOVERY_SESSION = file;
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length;
    worker = new RpcWorker(file, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
      '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'medium'] });
    worker.on('event', event => {
      if (event.type === 'agent_settled') settled++;
      if (event.type === 'message_update') for (const block of event.assistantMessageEvent.partial?.content ?? []) if (block.type === 'toolCall') previews.add(block.id);
    });
    await worker.request('get_state');
    const message = await send('malformed-' + mode), accepted = ['local', 'early', 'late', 'early-receipt', 'mixed'].includes(mode);
    assert.equal(message.stopReason, accepted ? 'stop' : 'error', message.errorMessage);
    const rows = records().slice(offset), bad = rows.filter(row => row.type === 'malformed');
    assert(bad.length > 0);
    const effects = rows.filter(row => row.type === 'execution').map(row => row.label);
    assert.deepEqual(effects, accepted ? ['before-malformed', 'after-malformed'] : ['before-malformed']);
    const calls = entries().flatMap(entry => entry.message?.role === 'assistant' ? entry.message.content.filter(block => block.type === 'toolCall') : []);
    for (const { id } of bad) { assert(!calls.some(call => call.id === id)); assert(!previews.has(id), 'Malformed tool calls must not be published as Pi calls.'); }
    for (const row of rows.filter(row => row.type === 'malformed-mcp-result')) assert.equal(row.isError, true);
    if (accepted) {
      assert.equal((await send('followup')).stopReason, 'stop');
      assert.deepEqual(records().slice(offset).filter(row => row.type === 'execution').map(row => row.label), effects);
      assert(entries().some(entry => entry.customType === 'claude-sdk-checkpoint'));
      assert.equal(records().slice(offset).filter(row => row.type === 'query').length, 1);
    } else assert.doesNotMatch(message.errorMessage, /login/i);
    result.cases.push({ mode, pass: true, malformedAttempts: bad.length, effects, oneNativeQuery: rows.filter(row => row.type === 'query').length === 1 });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close();
  result.personalSettingsUnchanged = settingsHash() === beforeSettings;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
