// Real Pi clone/RPC/persistence/provider/MCP; only the external SDK peer is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-clone-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(project, '.pi'), join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'PI_CLONE_' + randomUUID() });
writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 0 }, retry: { enabled: false } }));
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const rows = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? rows(process.env.PI_RECOVERY_EVENTS) : [];
const save = (path, entries) => writeFileSync(path, entries.map(row => JSON.stringify(row)).join('\n') + '\n');
const text = response => response.content.filter(block => block.type === 'text').map(block => block.text).join('');
const checkpoint = path => rows(path).findLast(row => row.customType === 'claude-sdk-checkpoint')?.data;
const result = { fixture: 'real Pi clone, RPC, persistence, SDK provider, MCP and effects; external SDK replay only',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
const modes = ['independent', 'checkpoint-gap', 'clone-again', 'compact-before', 'compact-before-activation', 'compact-after', 'compact-clone-gap',
  'foreign-before', 'clone-away', 'foreign-after', 'parent-moved', 'new-tools', 'permission', 'validation', 'cancel-first',
  'missing-result', 'unknown-error', 'no-checkpoint', 'pending-user', 'invalid-branch', 'busy', 'receipt-gap', 'source-tamper', 'prefix-tamper',
  'invalid-receipt', 'null-config', 'wrong-target', 'config-receipt', 'instructions', 'environment', 'reuse-id'];
let worker, file, settled = 0;
async function until(check, label) {
  const end = Date.now() + 12000;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await delay(20); }
}
async function start(path) {
  file = path;
  worker = new RpcWorker(file, project, { bin: process.execPath, prefix: [cli, '--approve', '-ne', '-ns', '-np', '--no-mcp', '--tools', process.env.PI_RECOVERY_DYNAMIC === '1' ? 'probe,extra' : 'probe',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'medium'] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled++; }); await worker.request('get_state');
}
async function send(message, expected = 'stop') {
  const before = settled; await worker.request('prompt', { message }); await until(() => settled > before, 'turn settlement');
  const response = rows(file).findLast(row => row.message?.role === 'assistant').message;
  assert.equal(response.stopReason, expected, response.errorMessage); return response;
}
const compact = () => worker.request('compact', { customInstructions: 'Preserve the exact marker. Never repeat recorded tools.' });
const sdk = () => worker.request('set_model', { provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
async function foreign() { await worker.request('set_model', { provider: 'recovery-control', modelId: 'plain' }); await send('foreign'); }
async function clone() {
  const source = file, bytes = readFileSync(source, 'utf8');
  assert.equal((await worker.request('clone')).cancelled, false, 'Cloning must not be cancelled.');
  file = (await worker.request('get_state')).sessionFile; assert.notEqual(file, source);
  assert.equal(readFileSync(source, 'utf8'), bytes, 'Clone must not alter its source.');
  const own = rows(file).filter(row => row.customType === 'claude-sdk-clone' && row.data?.sessionId === rows(file)[0].id);
  assert.equal(own.length, 1, 'Repeated session_start must not duplicate or overwrite the receipt.'); assert(own[0].data.state);
}
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : modes) {
    result.stage = mode; process.env.PI_RECOVERY_CLONE = mode; process.env.PI_RECOVERY_COMPACTION = mode.startsWith('compact') ? 'manual' : '';
    process.env.PI_RECOVERY_DYNAMIC = mode === 'new-tools' ? '1' : '0';
    process.env.PI_RECOVERY_TOOL_CASE = mode === 'environment' ? 'environment' : ''; process.env.PI_RECOVERY_REQUEST_SCOPE = 'base';
    writeFileSync(join(project, 'AGENTS.md'), 'CLONE_POLICY: preserve the original chat and recorded outcomes.');
    file = process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    save(file, [{ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }]);
    const offset = records().length, current = () => records().slice(offset), queries = () => current().filter(row => row.type === 'query').length;
    await start(file); await send('seed');
    const original = file;
    if (mode === 'busy') {
      const before = settled; await worker.request('prompt', { message: 'cancel-waiting' });
      await until(() => current().some(row => row.type === 'cancel-ready'), 'busy source');
      const count = queries(), bytes = readFileSync(file, 'utf8');
      assert.equal((await worker.request('clone')).cancelled, true);
      assert.equal((await worker.request('get_state')).isStreaming, true, 'Rejected clone must not abort its source.');
      assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), bytes);
      await worker.command({ type: 'abort' }); await until(() => settled > before, 'source cancellation');
      result.cases.push({ mode, pass: true, busySourceNotAborted: true }); await worker.close(); worker = undefined; continue;
    }
    if (['missing-result', 'unknown-error', 'no-checkpoint', 'pending-user'].includes(mode)) {
      await worker.close(); worker = undefined; let entries = rows(file);
      if (mode === 'missing-result') entries.splice(entries.findIndex(row => row.message?.role === 'toolResult'), 1);
      if (mode === 'no-checkpoint') entries = entries.filter(row => row.customType !== 'claude-sdk-checkpoint');
      if (mode === 'unknown-error' || mode === 'pending-user') {
        const message = mode === 'pending-user' ? { role: 'user', content: 'PENDING_INPUT', timestamp: Date.now() }
          : { ...entries.findLast(row => row.message?.role === 'assistant').message, content: [], stopReason: 'error', errorMessage: 'Unknown SDK failure' };
        entries.push({ type: 'message', id: randomUUID(), parentId: entries.at(-1).id, timestamp: new Date().toISOString(), message });
      }
      save(file, entries); await start(file);
    }
    if (['missing-result', 'unknown-error', 'no-checkpoint', 'pending-user', 'invalid-branch'].includes(mode)) {
      const count = queries(), before = readFileSync(file, 'utf8');
      const request = mode === 'invalid-branch' ? () => worker.request('fork', { entryId: 'no-such-entry' }) : () => worker.request('clone');
      assert.equal((await request()).cancelled, true); assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), before);
      result.cases.push({ mode, pass: true, blockedBeforeCloneOrNetwork: true }); await worker.close(); worker = undefined; continue;
    }
    if (['foreign-before', 'clone-away'].includes(mode)) { await foreign(); if (mode === 'foreign-before') await sdk(); }
    if (['compact-before', 'compact-before-activation'].includes(mode)) {
      await send('ack'); await compact(); if (mode === 'compact-before') await send('recall before cloning');
    }
    const originalBytes = readFileSync(original, 'utf8'), originalAtClone = checkpoint(original).sdkSessionId; await clone();
    if (mode === 'clone-again') await clone();
    if (mode === 'clone-away') await sdk();
    if (mode === 'foreign-after') { await foreign(); await sdk(); }
    if (['compact-after', 'compact-clone-gap'].includes(mode)) await compact();
    if (mode === 'parent-moved') renameSync(original, original + '.moved');
    if (['checkpoint-gap', 'receipt-gap', 'source-tamper', 'prefix-tamper', 'invalid-receipt', 'null-config', 'wrong-target', 'config-receipt', 'instructions', 'environment', 'compact-clone-gap'].includes(mode)) {
      if (mode === 'checkpoint-gap' || mode === 'compact-clone-gap') { worker.process.kill('SIGKILL'); await worker.exited; }
      else await worker.close(); worker = undefined;
      const entries = rows(file), receipt = entries.findLast(row => row.customType === 'claude-sdk-clone');
      if (mode === 'receipt-gap') entries.splice(entries.indexOf(receipt), 1);
      if (mode === 'source-tamper') entries.find(row => row.message?.role === 'toolResult').message.content[0].text = 'ALTERED_RESULT';
      if (mode === 'prefix-tamper') receipt.data.state.prefix[0] = '0'.repeat(64);
      if (mode === 'invalid-receipt') delete receipt.data.state.configuration;
      if (mode === 'null-config') receipt.data.state.configuration = null;
      if (mode === 'wrong-target') receipt.data.state.targetSessionId = randomUUID();
      if (mode === 'config-receipt') receipt.data.state.configuration = '0'.repeat(64);
      if (mode === 'instructions') writeFileSync(join(project, 'AGENTS.md'), 'CHANGED_OPERATOR_POLICY');
      if (mode === 'environment') process.env.PI_RECOVERY_REQUEST_SCOPE = 'changed';
      save(file, entries); await start(file);
      if (!['checkpoint-gap', 'compact-clone-gap'].includes(mode)) {
        const count = queries(); await send('recall without tools after altered clone', 'error'); assert.equal(queries(), count);
        assert.equal(readFileSync(original, 'utf8'), originalBytes);
        result.cases.push({ mode, pass: true, rejectedWithoutSdkRequest: true }); await worker.close(); worker = undefined; continue;
      }
    }
    if (mode === 'cancel-first') {
      const before = settled; await worker.request('prompt', { message: 'cancel-after-tools' });
      await until(() => current().some(row => row.type === 'cancel-ready'), 'cancel-ready');
      await worker.command({ type: 'abort' }); await until(() => settled > before, 'Stop settlement');
    }
    assert.equal(text(await send('recall without tools')), process.env.PI_RECOVERY_MARKER);
    if (mode === 'new-tools') await send('dynamic-tools');
    if (mode === 'permission' || mode === 'validation') {
      await send(mode === 'permission' ? 'deny-new' : 'invalid-new');
      assert(current().some(row => row.type === 'result' && row.label === (mode === 'permission' ? 'policy-denied' : 'invalid') && row.error));
    }
    if (mode === 'reuse-id') {
      await send('reuse-seed-id', 'error');
      assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), ['seed']);
      result.cases.push({ mode, pass: true, historicalCallIdCannotExecute: true }); await worker.close(); worker = undefined; continue;
    }
    const branch = 'PI_CLONE_' + randomUUID(); await send('Remember ' + branch);
    assert.equal(text(await send('recall without tools')), branch);
    const cloneFile = file, cloneId = checkpoint(file).sdkSessionId; assert.notEqual(cloneId, originalAtClone);
    assert.equal(readFileSync(mode === 'parent-moved' ? original + '.moved' : original, 'utf8'), originalBytes);
    await worker.close(); worker = undefined;
    if (mode !== 'parent-moved') {
      await start(original); await sdk(); assert.equal(text(await send('recall without tools')), process.env.PI_RECOVERY_MARKER);
      if (mode === 'compact-before-activation') assert.notEqual(checkpoint(original).sdkSessionId, originalAtClone);
      else assert.equal(checkpoint(original).sdkSessionId, originalAtClone);
      await worker.close(); worker = undefined;
    }
    await start(cloneFile); assert.equal(text(await send('recall after restart without tools')), branch);
    assert.equal(checkpoint(cloneFile).sdkSessionId, cloneId);
    const expected = ['foreign-before', 'clone-away', 'foreign-after'].includes(mode) ? ['seed', 'foreign'] : mode === 'new-tools' ? ['seed', 'dynamic-tools', 'new-capability']
      : mode === 'cancel-first' ? ['seed', 'cancel-completed'] : ['seed'];
    assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), expected);
    const messages = rows(file).flatMap(row => row.message ? [row.message] : []);
    const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'toolCall'));
    const receipts = messages.filter(message => message.role === 'toolResult');
    assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
    for (const call of calls) assert.equal(receipts.filter(row => row.toolCallId === call.id && row.toolName === call.name).length, 1);
    const total = messages.filter(message => message.role === 'assistant').reduce((sum, message) => sum + message.usage.cost.total, 0)
      + rows(file).filter(row => row.type === 'compaction').reduce((sum, row) => sum + (row.usage?.cost.total || 0), 0);
    assert(Math.abs((await worker.request('get_session_stats')).cost - total) < 1e-9);
    result.cases.push({ mode, pass: true, originalUnchanged: true, independentNativeContext: true, noToolReplay: true, cloneRestart: true, originalRestart: mode !== 'parent-moved', usageReconciled: true });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; result.stack = error.stack; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
