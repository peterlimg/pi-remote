// Real Pi tree/RPC/projection/persistence/provider/MCP and effects; only the external SDK peer is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-tree-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(project, '.pi'), join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
  PI_RECOVERY_CLONE: 'tree', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'PI_CLONE_' + randomUUID() });
writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 0 }, retry: { enabled: false } }));
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const rows = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
const save = (path, entries) => writeFileSync(path, entries.map(row => JSON.stringify(row)).join('\n') + '\n');
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? rows(process.env.PI_RECOVERY_EVENTS) : [];
const text = message => typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('');
const result = { fixture: 'real Pi tree/RPC/projection/persistence, SDK provider, MCP and effects; external SDK replay only',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
const modes = ['selected-history', 'assistant-point', 'metadata-point', 'first-user', 'first-user-twice', 'queued-point', 'tool-boundary', 'tool-boundary-clone', 'custom-message', 'label',
  'summary', 'summary-error', 'summary-stop', 'compact-source', 'compact-target', 'compact-before-activation', 'tree-before-activation', 'clone-before-activation',
  'pending-unactivated', 'foreign-source', 'legacy-foreign-source', 'foreign-branch', 'new-tools-before', 'new-tools-branch', 'new-calls', 'reuse-omitted-id', 'permission', 'validation', 'notices', 'stop-first', 'inherited-tree',
  'checkpoint-gap', 'summary-checkpoint-gap', 'missing-result', 'unknown-source', 'no-checkpoint', 'pending-source', 'busy', 'invalid-point', 'split-batch',
  'target-tamper', 'target-missing-result', 'receipt-gap', 'receipt-gap-label', 'receipt-gap-first', 'receipt-gap-return', 'source-tamper', 'prefix-tamper',
  'invalid-receipt', 'null-config', 'intent-tamper', 'wrong-source', 'wrong-owner', 'wrong-target', 'system-tamper', 'system-missing', 'system-malformed', 'instructions', 'environment'];
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
  assert.equal(response.stopReason, expected, response.errorMessage || 'Unexpected assistant stop reason'); return text(response);
}
async function navigate(target, options = {}) {
  const offset = records().length;
  await worker.request('prompt', { message: '/sdk-tree ' + JSON.stringify({ target, ...options }) });
  return records().slice(offset).findLast(row => row.type === 'tree-result');
}
const compact = () => worker.request('compact', { customInstructions: 'Preserve exact markers. Never repeat tools.' });
const sdk = () => worker.request('set_model', { provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
async function foreign() { await worker.request('set_model', { provider: 'recovery-control', modelId: 'plain' }); await send('foreign'); }
const native = () => rows(file).findLast(row => row.customType === 'claude-sdk-checkpoint')?.data.sdkSessionId;
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : modes) {
    result.stage = mode;
    process.env.PI_RECOVERY_FORK = mode === 'queued-point' ? 'queued' : ''; process.env.PI_RECOVERY_FORK_LATE = 'PI_CLONE_' + randomUUID();
    process.env.PI_RECOVERY_COMPACTION = mode.startsWith('summary-') && ['summary-error', 'summary-stop'].includes(mode) ? mode : 'tree';
    process.env.PI_RECOVERY_DYNAMIC = mode.startsWith('new-tools') ? '1' : '0';
    process.env.PI_RECOVERY_TOOL_CASE = mode === 'environment' ? 'environment' : ''; process.env.PI_RECOVERY_REQUEST_SCOPE = 'base';
    process.env.PI_RECOVERY_EFFECTS = join(evidence, mode + '-effects.log'); writeFileSync(process.env.PI_RECOVERY_EFFECTS, '');
    writeFileSync(join(project, 'AGENTS.md'), 'TREE_POLICY: selecting history never undoes existing filesystem effects.');
    file = process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    save(file, [{ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }]);
    const offset = records().length, current = () => records().slice(offset), queries = () => current().filter(row => row.type === 'query').length;
    await start(file); await send('seed');
    if (mode === 'custom-message') await worker.request('prompt', { message: '/sdk-record-notices' });
    const late = process.env.PI_RECOVERY_FORK_LATE;
    if (mode !== 'queued-point') await send('Remember ' + late);
    if (mode === 'new-tools-before') await send('dynamic-tools');
    await send('after-restart');
    if (mode === 'inherited-tree') { assert.equal((await worker.request('clone')).cancelled, false); file = (await worker.request('get_state')).sessionFile; await send('recall in source clone'); }
    if (mode === 'compact-source') { await compact(); await send('recall after source compaction'); }
    if (mode === 'foreign-source') await foreign();
    if (mode === 'legacy-foreign-source') {
      await worker.close(); worker = undefined; const originalPath = file, saved = rows(file), foreignFile = join(evidence, 'foreign-root.jsonl');
      save(foreignFile, [{ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }]);
      await start(foreignFile); await foreign(); await worker.close(); worker = undefined;
      // Seed a legacy multi-root tree from two actual Pi runs, not fabricated messages/results.
      save(originalPath, [...saved, ...rows(foreignFile).filter(row => row.type !== 'session')]); await start(originalPath);
    }
    const originalFile = file, original = rows(file), oldLeaf = (await worker.request('get_tree')).leafId, sourceNative = native();
    let selected = original.find(row => row.message?.role === 'user' && text(row.message) === 'Remember ' + late);
    if (['assistant-point', 'summary', 'summary-error', 'summary-stop', 'summary-checkpoint-gap', 'receipt-gap', 'system-missing'].includes(mode)) selected = original.find(row => row.message?.role === 'assistant' && row.message.stopReason === 'stop');
    if (mode === 'metadata-point') selected = original.find(row => row.customType === 'claude-sdk-checkpoint');
    if (mode === 'tool-boundary' || mode === 'tool-boundary-clone') selected = original.find(row => row.message?.role === 'toolResult');
    if (mode === 'custom-message') selected = original.filter(row => row.type === 'custom_message').at(-1);
    if (['first-user', 'first-user-twice', 'receipt-gap-first'].includes(mode)) selected = original.find(row => row.message?.role === 'user');
    if (mode === 'split-batch') selected = original.find(row => row.message?.role === 'assistant' && row.message.stopReason === 'toolUse');
    assert(selected);
    if (['missing-result', 'unknown-source', 'no-checkpoint', 'pending-source'].includes(mode)) {
      await worker.close(); worker = undefined; let entries = rows(file);
      if (mode === 'missing-result') entries.splice(entries.findIndex(row => row.message?.role === 'toolResult'), 1);
      if (mode === 'no-checkpoint') entries = entries.filter(row => row.customType !== 'claude-sdk-checkpoint');
      if (['unknown-source', 'pending-source'].includes(mode)) entries.push({ type: 'message', id: randomUUID(), parentId: entries.at(-1).id, timestamp: new Date().toISOString(),
        message: mode === 'pending-source' ? { role: 'user', content: 'PENDING', timestamp: Date.now() } : {
          ...entries.findLast(row => row.message?.role === 'assistant').message, content: [], stopReason: 'error', errorMessage: 'Unknown SDK failure' } });
      save(file, entries); await start(file);
    }
    if (mode === 'busy') { await worker.request('prompt', { message: 'cancel-waiting' }); await until(() => current().some(row => row.type === 'cancel-ready'), 'busy source'); }
    if (['missing-result', 'unknown-source', 'no-checkpoint', 'pending-source', 'busy', 'invalid-point', 'split-batch'].includes(mode)) {
      const before = readFileSync(file, 'utf8'), count = queries();
      if (mode === 'busy' || mode === 'invalid-point') assert((await navigate(mode === 'invalid-point' ? 'no-such-entry' : selected.id)).error);
      else assert.equal((await navigate(selected.id)).cancelled, true);
      assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), before);
      if (mode === 'busy') assert.equal((await worker.request('get_state')).isStreaming, true);
      result.cases.push({ mode, pass: true, rejectedBeforeNavigationAndNetwork: true }); await worker.close(); worker = undefined; continue;
    }
    const effects = readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8');
    const summary = ['summary', 'summary-error', 'summary-stop', 'summary-checkpoint-gap', 'receipt-gap', 'receipt-gap-first'].includes(mode);
    const options = { summarize: summary, ...['label', 'receipt-gap-label', 'intent-tamper'].includes(mode) ? { label: 'tree-point' } : {} };
    if (mode === 'summary-error' || mode === 'summary-stop') {
      if (mode === 'summary-error') assert((await navigate(selected.id, options)).error);
      else {
        const pending = navigate(selected.id, options); await until(() => current().some(row => row.type === 'compaction-helper'), 'branch summary start');
        await worker.command({ type: 'abort' }); assert.equal((await pending).cancelled, true);
      }
      assert(!rows(file).some(row => row.customType === 'claude-sdk-tree'));
      await worker.close(); worker = undefined; await start(file); assert.equal(await send('recall after failed summary'), late); assert.equal(native(), sourceNative);
      assert.equal(readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8'), effects);
      result.cases.push({ mode, pass: true, originalStillUsable: true, nativeNotRewound: true }); await worker.close(); worker = undefined; continue;
    }
    assert.equal((await navigate(selected.id, options)).cancelled, false, 'Tree navigation must not be cancelled.');
    assert.equal((await worker.request('get_state')).sessionFile, file);
    if (summary) { const helpers = current().filter(row => row.type === 'compaction-helper'); assert.equal(helpers.length, 1); assert(helpers.every(row => row.tools === 0 && row.nativeCompactionDisabled)); }
    if (mode === 'receipt-gap-return') {
      await send('recall without tools'); const branch = 'PI_CLONE_' + randomUUID(); await send('Remember ' + branch);
      assert.equal((await navigate(oldLeaf, { label: 'returned-point' })).cancelled, false);
    }
    const tamper = ['receipt-gap', 'receipt-gap-label', 'receipt-gap-first', 'receipt-gap-return', 'source-tamper', 'prefix-tamper', 'invalid-receipt',
      'null-config', 'intent-tamper', 'wrong-source', 'wrong-owner', 'wrong-target', 'system-tamper', 'system-missing', 'system-malformed', 'instructions', 'environment'].includes(mode);
    if (tamper || mode.endsWith('checkpoint-gap')) {
      if (mode.endsWith('checkpoint-gap')) { worker.process.kill('SIGKILL'); await worker.exited; } else await worker.close(); worker = undefined;
      const entries = rows(file), receipt = entries.findLast(row => row.customType === 'claude-sdk-tree'); assert(receipt?.data.state);
      if (mode.startsWith('receipt-gap')) entries.splice(entries.indexOf(receipt));
      if (mode === 'source-tamper') entries.find(row => row.message?.role === 'toolResult').message.content[0].text = 'ALTERED_RESULT';
      if (mode === 'prefix-tamper') receipt.data.state.prefix[0] = '0'.repeat(64);
      if (mode === 'invalid-receipt') receipt.data.state = null;
      if (mode === 'null-config') { receipt.data.state.configuration = null; receipt.data.state.accepted = 0; }
      if (mode === 'intent-tamper') { entries.splice(entries.indexOf(receipt)); entries.findLast(row => row.customType === 'claude-sdk-tree-start').data.sdkSessionIds = null; }
      if (mode === 'wrong-source') receipt.data.sourceId = 'no-such-source';
      if (mode === 'wrong-target') receipt.data.state.targetSessionId = randomUUID();
      if (mode === 'wrong-owner') receipt.data.state.sourceSessionId = randomUUID();
      if (mode === 'system-tamper') { receipt.data.state.configurationContext.content = 'ALTERED_SYSTEM'; delete receipt.data.state.configurationContext.sections; }
      if (mode === 'system-missing') delete receipt.data.state.configurationContext;
      if (mode === 'system-malformed') receipt.data.state.configurationContext = { role: 'user', content: 'NOT_A_SYSTEM_CHECKPOINT' };
      if (mode === 'instructions') writeFileSync(join(project, 'AGENTS.md'), 'CHANGED_OPERATOR_POLICY');
      if (mode === 'environment') process.env.PI_RECOVERY_REQUEST_SCOPE = 'changed';
      save(file, entries); await start(file);
      if (tamper) { const count = queries(); await send('recall without tools', 'error'); assert.equal(queries(), count);
        result.cases.push({ mode, pass: true, rejectedWithoutSdkRequest: true }); await worker.close(); worker = undefined; continue; }
    }
    if (mode === 'pending-unactivated') {
      await worker.close(); worker = undefined; const entries = rows(file);
      entries.push({ type: 'message', id: randomUUID(), parentId: entries.at(-1).id, timestamp: new Date().toISOString(), message: { role: 'user', content: 'UNANSWERED_INPUT', timestamp: Date.now() } });
      save(file, entries); await start(file); const count = queries(), bytes = readFileSync(file, 'utf8');
      assert.equal((await navigate(oldLeaf)).cancelled, true); assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), bytes);
      result.cases.push({ mode, pass: true, pendingInputNotApproved: true }); await worker.close(); worker = undefined; continue;
    }
    if (mode === 'compact-before-activation') await compact();
    if (mode === 'tree-before-activation' || mode === 'first-user-twice') assert.equal((await navigate(oldLeaf)).cancelled, false);
    if (['clone-before-activation', 'tool-boundary-clone'].includes(mode)) { assert.equal((await worker.request('clone')).cancelled, false); file = (await worker.request('get_state')).sessionFile; }
    await sdk();
    const expected = mode === 'first-user' ? 'MISSING_MARKER' : summary || mode === 'tree-before-activation' || mode === 'first-user-twice' ? late : process.env.PI_RECOVERY_MARKER;
    if (mode === 'stop-first') { const before = settled; await worker.request('prompt', { message: 'cancel-after-tools' });
      await until(() => current().some(row => row.type === 'cancel-ready'), 'cancellable branch'); await worker.command({ type: 'abort' }); await until(() => settled > before, 'Stop'); }
    assert.equal(await send('recall without tools'), expected);
    if (mode === 'compact-target') { await compact(); assert.equal(await send('recall after compaction'), expected); }
    if (mode === 'foreign-branch') { await foreign(); await sdk(); }
    if (mode === 'new-tools-branch') await send('dynamic-tools');
    if (mode === 'new-calls') await send('allow-new');
    if (mode === 'reuse-omitted-id') {
      await send('reuse-later-id', 'error'); assert.match(rows(file).findLast(row => row.message?.role === 'assistant').message.errorMessage, /repeated a previously issued tool-call ID/);
      assert.equal(readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8'), effects);
      result.cases.push({ mode, pass: true, omittedCallIdRetiredWithoutReplay: true }); await worker.close(); worker = undefined; continue;
    }
    if (mode === 'permission' || mode === 'validation') { await send(mode === 'permission' ? 'deny-new' : 'invalid-new');
      assert(current().some(row => row.type === 'result' && row.label === (mode === 'permission' ? 'policy-denied' : 'invalid') && row.error)); }
    if (mode === 'notices') { const before = settled; await worker.request('prompt', { message: '/sdk-notify' }); await until(() => settled > before, 'notice settlement');
      assert.deepEqual(current().filter(row => row.type === 'prompt').at(-1).notices, ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']); }
    const branch = 'PI_CLONE_' + randomUUID(); await send('Remember ' + branch);
    const branchLeaf = (await worker.request('get_tree')).leafId, branchFile = file, branchNative = native(); assert.notEqual(branchNative, sourceNative);
    await worker.close(); worker = undefined; await start(file); assert.equal(await send('recall after restart'), branch); assert.equal(native(), branchNative);
    if (mode === 'target-tamper' || mode === 'target-missing-result') {
      await worker.close(); worker = undefined; const entries = rows(file), target = entries.find(row => row.message?.role === 'toolResult' && !text(row.message).includes(process.env.PI_RECOVERY_MARKER));
      assert(target); if (mode === 'target-tamper') target.message.content[0].text = 'ALTERED_OMITTED_BRANCH';
      else { for (const row of entries) if (row.parentId === target.id) row.parentId = target.parentId; entries.splice(entries.indexOf(target), 1); }
      save(file, entries); await start(file); const count = queries(), bytes = readFileSync(file, 'utf8');
      assert.equal((await navigate(oldLeaf)).cancelled, true); assert.equal(queries(), count); assert.equal(readFileSync(file, 'utf8'), bytes);
      assert.equal(await send('recall current branch'), branch); result.cases.push({ mode, pass: true, unsafeDestinationRejected: true }); await worker.close(); worker = undefined; continue;
    }
    if (['clone-before-activation', 'tool-boundary-clone'].includes(mode)) { await worker.close(); worker = undefined; await start(originalFile); }
    assert.equal((await navigate(oldLeaf)).cancelled, false); await sdk(); assert.equal(await send('recall without tools'), mode === 'legacy-foreign-source' ? 'MISSING_MARKER' : late);
    const returnedNative = native(); assert.notEqual(returnedNative, sourceNative); assert.notEqual(returnedNative, branchNative);
    await worker.close(); worker = undefined; await start(file); assert.equal(await send('recall after return and restart'), mode === 'legacy-foreign-source' ? 'MISSING_MARKER' : late); assert.equal(native(), returnedNative);
    if (file !== branchFile) { await worker.close(); worker = undefined; await start(branchFile); }
    else assert.equal((await navigate(branchLeaf)).cancelled, false);
    assert.equal(await send('recall branch after return'), branch);
    for (const entry of original) assert.deepEqual(rows(originalFile).find(row => row.id === entry.id), entry, 'Tree navigation must preserve every old audit entry.');
    const extra = mode === 'new-tools-branch' ? 'dynamic-tools\nnew-capability\n' : mode === 'new-calls' ? 'allowed\n' : mode === 'stop-first' ? 'cancel-completed\n' : mode === 'foreign-branch' ? 'foreign\n' : '';
    assert.equal(readFileSync(process.env.PI_RECOVERY_EFFECTS, 'utf8'), effects + extra, 'Tree navigation must neither replay nor rewind tools.');
    const entries = rows(file), messages = entries.flatMap(row => row.message ? [row.message] : []);
    const calls = messages.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(b => b.type === 'toolCall')), receipts = messages.filter(m => m.role === 'toolResult');
    assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
    for (const call of calls) assert.equal(receipts.filter(row => row.toolCallId === call.id && row.toolName === call.name).length, 1);
    const cost = messages.filter(m => m.role === 'assistant').reduce((sum, m) => sum + m.usage.cost.total, 0)
      + entries.filter(row => row.type === 'compaction' || row.type === 'branch_summary').reduce((sum, row) => sum + (row.usage?.cost.total || 0), 0);
    assert(Math.abs((await worker.request('get_session_stats')).cost - cost) < 1e-9);
    result.cases.push({ mode, pass: true, selectedMemory: true, independentReturnAndRestart: true, auditPreserved: true, noReplayOrRewind: true, usageReconciled: true });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; result.stack = error.stack; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
