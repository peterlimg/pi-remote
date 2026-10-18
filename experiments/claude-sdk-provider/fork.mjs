// Real Pi fork/RPC/persistence/provider/MCP; only the external SDK peer is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-fork-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(project, '.pi'), join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
  PI_RECOVERY_CLONE: 'fork', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'PI_CLONE_' + randomUUID() });
writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 0 }, retry: { enabled: false } }));
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const rows = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
const save = (path, entries) => writeFileSync(path, entries.map(row => JSON.stringify(row)).join('\n') + '\n');
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? rows(process.env.PI_RECOVERY_EVENTS) : [];
const checkpoint = path => rows(path).findLast(row => row.customType === 'claude-sdk-checkpoint')?.data;
const text = message => typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('');
const result = { fixture: 'real Pi fork/RPC/persistence, SDK provider, MCP and effects; external SDK replay only',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
const modes = ['selected-history', 'first-user', 'queued', 'boundary', 'compacted-point', 'older-than-compaction', 'compact-branch', 'compact-before-activation',
  'queued-compact-branch', 'inherited-older-than-compaction', 'legacy-inherited-compaction', 'source-away', 'foreign-before', 'foreign-after', 'branch-foreign', 'clone-source', 'unactivated-clone-source', 'new-tools-before',
  'new-tools-branch', 'new-calls', 'permission', 'validation', 'stop-first', 'notices', 'checkpoint-gap', 'queued-checkpoint-gap', 'parent-moved',
  'missing-result', 'unknown-source', 'no-checkpoint', 'pending-source', 'busy', 'invalid-id', 'invalid-role', 'split-batch', 'receipt-gap', 'source-tamper', 'prefix-tamper',
  'system-tamper', 'system-missing', 'system-malformed', 'wrong-target', 'instructions', 'environment'];
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
  assert.equal(response.stopReason, expected, response.errorMessage); return text(response);
}
const compact = () => worker.request('compact', { customInstructions: 'Preserve the exact marker. Never repeat completed tools.' });
const sdk = () => worker.request('set_model', { provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
async function foreign() { await worker.request('set_model', { provider: 'recovery-control', modelId: 'plain' }); await send('foreign'); }
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : modes) {
    result.stage = mode;
    const queued = ['queued', 'queued-compact-branch', 'queued-checkpoint-gap', 'system-tamper', 'system-missing', 'system-malformed'].includes(mode);
    process.env.PI_RECOVERY_FORK = queued ? 'queued' : mode; process.env.PI_RECOVERY_FORK_LATE = 'PI_CLONE_' + randomUUID();
    process.env.PI_RECOVERY_COMPACTION = mode.includes('compact') ? 'manual' : '';
    process.env.PI_RECOVERY_DYNAMIC = mode.startsWith('new-tools') ? '1' : '0';
    process.env.PI_RECOVERY_TOOL_CASE = mode === 'environment' ? 'environment' : ''; process.env.PI_RECOVERY_REQUEST_SCOPE = 'base';
    process.env.PI_RECOVERY_EFFECTS = join(evidence, mode + '-effects.log'); writeFileSync(process.env.PI_RECOVERY_EFFECTS, '');
    writeFileSync(join(project, 'AGENTS.md'), 'FORK_POLICY: preserve outcomes. Selecting older history never rewinds filesystem effects.');
    file = process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    save(file, [{ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }]);
    const offset = records().length, current = () => records().slice(offset), queries = () => current().filter(row => row.type === 'query').length;
    await start(file); await send('seed');
    if (['clone-source', 'unactivated-clone-source'].includes(mode)) {
      assert.equal((await worker.request('clone')).cancelled, false); file = (await worker.request('get_state')).sessionFile;
      if (mode === 'clone-source') await send('recall after clone');
    }
    if (mode === 'new-tools-before') await send('dynamic-tools');
    if (mode === 'foreign-before') { await foreign(); await sdk(); }
    if (mode === 'compacted-point') { await send('ack'); await compact(); await send('recall before selected point'); }
    const selectedText = 'Remember ' + process.env.PI_RECOVERY_FORK_LATE;
    if (!queued && mode !== 'boundary') await send(selectedText);
    let selected = rows(file).find(row => row.message?.role === 'user' && text(row.message) === selectedText)?.id;
    assert(selected, 'The selected message must really exist.');
    if (mode === 'first-user') selected = rows(file).find(row => row.message?.role === 'user').id;
    await send('after-restart');
    if (mode === 'legacy-inherited-compaction') {
      await worker.close(); worker = undefined; const entries = rows(file);
      for (const row of entries) if (row.customType === 'claude-sdk-checkpoint') delete row.data.piSessionId;
      save(file, entries); await start(file);
    }
    if (['inherited-older-than-compaction', 'legacy-inherited-compaction'].includes(mode)) {
      assert.equal((await worker.request('clone')).cancelled, false); file = (await worker.request('get_state')).sessionFile;
      await send('recall in source clone');
    }
    if (['older-than-compaction', 'inherited-older-than-compaction', 'legacy-inherited-compaction'].includes(mode)) { await compact(); await send('recall after source compaction'); }
    if (['source-away', 'foreign-after'].includes(mode)) { await foreign(); if (mode === 'foreign-after') await sdk(); }
    const original = file, originalNative = checkpoint(file).sdkSessionId;
    if (['missing-result', 'unknown-source', 'no-checkpoint', 'pending-source'].includes(mode)) {
      await worker.close(); worker = undefined; let entries = rows(file);
      if (mode === 'missing-result') entries.splice(entries.findIndex(row => row.message?.role === 'toolResult'), 1);
      if (mode === 'no-checkpoint') entries = entries.filter(row => row.customType !== 'claude-sdk-checkpoint');
      if (mode === 'unknown-source' || mode === 'pending-source') entries.push({ type: 'message', id: randomUUID(), parentId: entries.at(-1).id, timestamp: new Date().toISOString(),
        message: mode === 'pending-source' ? { role: 'user', content: 'PENDING', timestamp: Date.now() } : {
          ...entries.findLast(row => row.message?.role === 'assistant').message, content: [], stopReason: 'error', errorMessage: 'Unknown SDK failure' } });
      save(file, entries); await start(file);
    }
    if (mode === 'split-batch') {
      const entry = rows(file).find(row => row.message?.role === 'assistant' && row.message.content.some(block => block.type === 'toolCall'));
      const before = readFileSync(file, 'utf8'), count = queries();
      await worker.request('prompt', { message: '/sdk-fork-at ' + entry.id });
      assert.equal((await worker.request('get_state')).sessionFile, file); assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), before);
      result.cases.push({ mode, pass: true, truncatedToolBatchRejected: true }); await worker.close(); worker = undefined; continue;
    }
    if (mode === 'busy') {
      await worker.request('prompt', { message: 'cancel-waiting' }); await until(() => current().some(row => row.type === 'cancel-ready'), 'busy source');
    }
    if (['missing-result', 'unknown-source', 'no-checkpoint', 'pending-source', 'busy', 'invalid-id', 'invalid-role'].includes(mode)) {
      const before = readFileSync(file, 'utf8'), count = queries();
      const id = mode === 'invalid-id' ? 'no-such-entry' : mode === 'invalid-role' ? rows(file).find(row => row.message?.role === 'toolResult').id : selected;
      assert.equal((await worker.request('fork', { entryId: id })).cancelled, true);
      assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), before);
      if (mode === 'busy') assert.equal((await worker.request('get_state')).isStreaming, true);
      result.cases.push({ mode, pass: true, blockedBeforeForkOrNetwork: true }); await worker.close(); worker = undefined; continue;
    }
    const originalBytes = readFileSync(original, 'utf8'), effectsBefore = readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8');
    const forked = await worker.request('fork', { entryId: selected }); assert.equal(forked.cancelled, false, 'Earlier-message fork must not be cancelled.');
    assert.equal(forked.text, text(rows(original).find(row => row.id === selected).message));
    file = (await worker.request('get_state')).sessionFile; assert.notEqual(file, original);
    assert.equal(readFileSync(original, 'utf8'), originalBytes);
    if (existsSync(file)) assert(!readFileSync(file, 'utf8').includes(process.env.PI_RECOVERY_FORK_LATE), 'Later messages must not leak into the selected branch.');
    if (mode === 'source-away') await sdk();
    if (mode === 'parent-moved') renameSync(original, original + '.moved');
    if (['compact-before-activation', 'queued-compact-branch'].includes(mode)) await compact();
    if (['checkpoint-gap', 'queued-checkpoint-gap', 'receipt-gap', 'source-tamper', 'prefix-tamper', 'system-tamper', 'system-missing', 'system-malformed', 'wrong-target', 'instructions', 'environment'].includes(mode)) {
      if (mode.endsWith('checkpoint-gap')) { worker.process.kill('SIGKILL'); await worker.exited; }
      else await worker.close(); worker = undefined;
      const entries = rows(file), receipt = entries.findLast(row => row.customType === 'claude-sdk-clone'); assert(receipt?.data.state);
      if (mode === 'receipt-gap') entries.splice(entries.indexOf(receipt));
      if (mode === 'source-tamper') entries.find(row => row.message?.role === 'toolResult').message.content[0].text = 'ALTERED_RESULT';
      if (mode === 'prefix-tamper') receipt.data.state.prefix[0] = '0'.repeat(64);
      if (mode === 'system-tamper') { receipt.data.state.configurationContext.content = 'ALTERED_SYSTEM'; delete receipt.data.state.configurationContext.sections; }
      if (mode === 'system-missing') delete receipt.data.state.configurationContext;
      if (mode === 'system-malformed') receipt.data.state.configurationContext = { role: 'user', content: 'NOT_A_SYSTEM_CHECKPOINT' };
      if (mode === 'wrong-target') receipt.data.state.targetSessionId = randomUUID();
      if (mode === 'instructions') writeFileSync(join(project, 'AGENTS.md'), 'CHANGED_OPERATOR_POLICY');
      if (mode === 'environment') process.env.PI_RECOVERY_REQUEST_SCOPE = 'changed';
      save(file, entries); await start(file);
      if (!mode.endsWith('checkpoint-gap')) {
        const count = queries(); await send('recall without tools', 'error'); assert.equal(queries(), count);
        result.cases.push({ mode, pass: true, rejectedWithoutSdkRequest: true }); await worker.close(); worker = undefined; continue;
      }
    }
    if (mode === 'branch-foreign') { await foreign(); await sdk(); }
    if (mode === 'notices') {
      const before = settled; await worker.request('prompt', { message: '/sdk-notify' }); await until(() => settled > before, 'notice settlement');
      assert.deepEqual(current().filter(row => row.type === 'prompt').at(-1).notices, ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']);
    }
    if (mode === 'stop-first') {
      const before = settled; await worker.request('prompt', { message: 'cancel-after-tools' });
      await until(() => current().some(row => row.type === 'cancel-ready'), 'cancellable branch');
      await worker.command({ type: 'abort' }); await until(() => settled > before, 'branch Stop');
    }
    assert.equal(await send('recall without tools'), mode === 'first-user' ? 'MISSING_MARKER' : process.env.PI_RECOVERY_MARKER);
    if (mode === 'compact-branch') { await compact(); assert.equal(await send('recall after compaction'), process.env.PI_RECOVERY_MARKER); }
    if (mode === 'new-tools-branch') await send('dynamic-tools');
    if (mode === 'new-calls') await send('allow-new');
    if (mode === 'permission' || mode === 'validation') {
      await send(mode === 'permission' ? 'deny-new' : 'invalid-new');
      assert(current().some(row => row.type === 'result' && row.label === (mode === 'permission' ? 'policy-denied' : 'invalid') && row.error));
    }
    const effectsAfter = readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8');
    assert(effectsAfter.startsWith(effectsBefore), 'Forking must not rewind existing effects.');
    const extra = mode === 'new-tools-branch' ? 'dynamic-tools\nnew-capability\n' : mode === 'new-calls' ? 'allowed\n' : mode === 'stop-first' ? 'cancel-completed\n' : mode === 'branch-foreign' ? 'foreign\n' : '';
    assert.equal(effectsAfter, effectsBefore + extra);
    const own = 'PI_CLONE_' + randomUUID(); await send('Remember ' + own);
    const branch = file, native = checkpoint(file).sdkSessionId; assert.notEqual(native, originalNative);
    assert.equal(readFileSync(mode === 'parent-moved' ? original + '.moved' : original, 'utf8'), originalBytes);
    await worker.close(); worker = undefined;
    if (mode !== 'parent-moved') {
      await start(original); await sdk(); assert.equal(await send('recall without tools'), process.env.PI_RECOVERY_FORK_LATE);
      assert.equal(checkpoint(file).sdkSessionId, originalNative); await worker.close(); worker = undefined;
    }
    await start(branch); assert.equal(await send('recall after restart without tools'), own); assert.equal(checkpoint(file).sdkSessionId, native);
    assert.equal(readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8'), effectsAfter);
    const messages = rows(file).flatMap(row => row.message ? [row.message] : []);
    const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'toolCall'));
    const receipts = messages.filter(message => message.role === 'toolResult'); assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
    for (const call of calls) assert.equal(receipts.filter(row => row.toolCallId === call.id && row.toolName === call.name).length, 1);
    const cost = messages.filter(message => message.role === 'assistant').reduce((sum, message) => sum + message.usage.cost.total, 0)
      + rows(file).filter(row => row.type === 'compaction').reduce((sum, row) => sum + (row.usage?.cost.total || 0), 0);
    assert(Math.abs((await worker.request('get_session_stats')).cost - cost) < 1e-9);
    result.cases.push({ mode, pass: true, originalUnchanged: true, noFutureMessages: true, noReplayOrEffectRewind: true, independentRestarts: mode !== 'parent-moved', usageReconciled: true });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; result.stack = error.stack; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
