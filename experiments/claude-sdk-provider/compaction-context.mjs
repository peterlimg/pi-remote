// E2E: real Pi compaction, saved projection, provider and MCP; only the external SDK is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-compaction-context-')), project = join(evidence, 'project');
for (const path of [project, join(project, '.pi'), join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'PI_COMPACTION_' + randomUUID() });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const last = () => entries().findLast(row => row.message?.role === 'assistant')?.message;
const text = response => response.content.filter(block => block.type === 'text').map(block => block.text).join('');
const result = { fixture: 'real Pi RPC/default compactor, projection, SDK provider, MCP and effects; external SDK replay only',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
const modes = ['manual', 'checkpoint-gap', 'repeated', 'repeat-before-response', 'auto', 'auto-tools', 'summary-error', 'summary-stop', 'receipt-gap', 'source-tamper',
  'projection-tamper', 'invalid-receipt', 'config-receipt', 'instructions', 'missing-result', 'unknown-error', 'away-no-checkpoint',
  'foreign-before', 'compact-away', 'foreign-after', 'notices', 'tools-after', 'cancel-after'];
let worker, settled = 0;
async function until(check, label) {
  const end = Date.now() + 12000;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await delay(20); }
}
async function start() {
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '--approve', '-ne', '-ns', '-np', '--no-mcp', '--tools', process.env.PI_RECOVERY_DYNAMIC === '1' ? 'probe,extra' : 'probe',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'medium'] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled++; });
  await worker.request('get_state');
}
async function send(message, expected = 'stop') {
  const before = settled; await worker.request('prompt', { message }); await until(() => settled > before, 'turn settlement');
  const response = last(); assert.equal(response.stopReason, expected, response.errorMessage || `Unexpected SDK response: ${response.stopReason}`); return response;
}
const compact = () => worker.request('compact', { customInstructions: 'Preserve the actual tool marker and its completed execution. Never repeat recorded tools.' });
async function foreign() {
  await worker.request('set_model', { provider: 'recovery-control', modelId: 'plain' }); await send('foreign');
}
const sdk = () => worker.request('set_model', { provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
const save = rows => writeFileSync(process.env.PI_RECOVERY_SESSION, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : modes) {
    result.stage = mode; process.env.PI_RECOVERY_COMPACTION = mode;
    process.env.PI_RECOVERY_DYNAMIC = ['tools-after', 'auto-tools'].includes(mode) ? '1' : '0';
    process.env.PI_RECOVERY_GATE = join(evidence, 'gate-' + mode);
    process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    writeFileSync(join(project, 'AGENTS.md'), 'COMPACTION_PROJECT_POLICY: keep instructions and recorded outcomes intact.');
    writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: mode.startsWith('auto'), keepRecentTokens: 0,
      ...(mode.startsWith('auto') ? { reserveTokens: 997500 } : {}) }, retry: { enabled: false } }));
    writeFileSync(process.env.PI_RECOVERY_SESSION, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length, current = () => records().slice(offset), queries = () => current().filter(row => row.type === 'query').length;
    await start(); await send('seed'); if (mode !== 'auto') await send('ack');
    if (mode === 'auto-tools') await send('dynamic-tools');
    if (['foreign-before', 'compact-away'].includes(mode)) { await foreign(); if (mode === 'foreign-before') await sdk(); }
    if (['missing-result', 'unknown-error', 'away-no-checkpoint'].includes(mode)) {
      await worker.close(); worker = undefined;
      const rows = entries();
      if (mode === 'missing-result') {
        const index = rows.findIndex(row => row.message?.role === 'toolResult'); rows.splice(index, 1);
      } else {
        const previous = last(), errorMessage = 'Unrecognized SDK failure';
        rows.push({ type: 'message', id: randomUUID(), parentId: rows.at(-1).id, timestamp: new Date().toISOString(), message: {
          ...previous, content: [{ type: 'text', text: errorMessage }], stopReason: 'error', errorMessage } });
      }
      save(mode === 'away-no-checkpoint' ? rows.filter(row => row.customType !== 'claude-sdk-checkpoint') : rows);
      await start(); if (mode === 'away-no-checkpoint') await foreign();
      const count = queries(); await assert.rejects(compact(), /cancelled/i);
      assert.equal(queries(), count); assert(!entries().some(row => row.type === 'compaction'));
      result.cases.push({ mode, pass: true, blockedBeforeSummary: true }); await worker.close(); worker = undefined; continue;
    }
    const before = readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8');
    if (['summary-stop', 'notices'].includes(mode)) {
      const pending = compact().then(() => undefined, error => error);
      await until(() => current().some(row => row.type === 'compaction-helper'), 'summary helper');
      if (mode === 'summary-stop') { await worker.request('abort'); assert(await pending instanceof Error); }
      else {
        await worker.request('prompt', { message: '/sdk-record-notices' }); writeFileSync(process.env.PI_RECOVERY_GATE, 'release');
        assert.equal(await pending, undefined);
      }
    } else if (mode === 'summary-error') await assert.rejects(compact(), /summarization failed/i);
    else if (!mode.startsWith('auto')) await compact();
    if (['summary-error', 'summary-stop'].includes(mode)) {
      assert(!entries().some(row => row.type === 'compaction'));
      assert.equal(text(await send('recall without tools after the failed compaction')), process.env.PI_RECOVERY_MARKER);
      assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), ['seed']);
      result.cases.push({ mode, pass: true, failedSummaryLeavesHistoryUsable: true }); await worker.close(); worker = undefined; continue;
    }
    assert(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').startsWith(before), 'Original audit entries must remain unchanged.');
    assert.equal(entries().filter(row => row.type === 'compaction').length, 1);
    const receiptIndex = entries().findLastIndex(row => row.type === 'custom' && row.customType === 'claude-sdk-compaction'); assert(receiptIndex >= 0);
    if (['receipt-gap', 'source-tamper', 'projection-tamper', 'invalid-receipt', 'config-receipt', 'instructions', 'checkpoint-gap'].includes(mode)) {
      if (mode === 'checkpoint-gap') { worker.process.kill('SIGKILL'); await worker.exited; }
      else await worker.close();
      worker = undefined; const rows = entries();
      if (mode === 'receipt-gap') rows.splice(receiptIndex);
      if (mode === 'source-tamper') rows.find(row => row.message?.role === 'user').message.content = 'TAMPERED_SOURCE';
      if (mode === 'projection-tamper') rows.find(row => row.type === 'compaction').summary += '\nTAMPERED_SUMMARY';
      if (mode === 'invalid-receipt') delete rows[receiptIndex].data.state;
      if (mode === 'config-receipt') delete rows[receiptIndex].data.state.configuration;
      if (mode === 'instructions') writeFileSync(join(project, 'AGENTS.md'), 'CHANGED_OPERATOR_POLICY');
      save(rows); await start();
      if (mode !== 'checkpoint-gap') {
        const count = queries(); await send('recall without tools after altered compaction state', 'error'); assert.equal(queries(), count);
        result.cases.push({ mode, pass: true, rejectedWithoutNewSdkRequest: true }); await worker.close(); worker = undefined; continue;
      }
    }
    if (mode === 'repeat-before-response') await assert.rejects(compact(), /too small|already compacted/i);
    if (mode === 'compact-away') await sdk();
    if (mode === 'foreign-after') { await foreign(); await sdk(); }
    assert.equal(text(await send('recall the original marker without tools')), process.env.PI_RECOVERY_MARKER);
    if (mode === 'notices') assert.deepEqual(current().filter(row => row.type === 'prompt').at(-1).notices, ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']);
    if (mode === 'repeated') { await compact(); assert.equal(text(await send('recall after repeated compaction without tools')), process.env.PI_RECOVERY_MARKER); }
    if (mode === 'tools-after') await send('dynamic-tools');
    if (mode === 'cancel-after') {
      const before = settled;
      await worker.request('prompt', { message: 'cancel-after-tools' });
      await until(() => current().some(row => row.type === 'cancel-ready'), 'cancellable SDK request');
      await worker.command({ type: 'abort' }); await until(() => settled > before, 'cancel settlement');
      assert.equal(last().stopReason, 'aborted');
      assert.equal(text(await send('recall after Stop without tools')), process.env.PI_RECOVERY_MARKER);
    }
    await worker.close(); worker = undefined; await start();
    assert.equal(text(await send('recall the original marker after restart without tools')), process.env.PI_RECOVERY_MARKER);
    const expected = ['foreign-before', 'compact-away', 'foreign-after'].includes(mode) ? ['seed', 'foreign']
      : ['tools-after', 'auto-tools'].includes(mode) ? ['seed', 'dynamic-tools', 'new-capability'] : mode === 'cancel-after' ? ['seed', 'cancel-completed'] : ['seed'];
    assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), expected);
    const helpers = current().filter(row => row.type === 'compaction-helper');
    if (mode !== 'compact-away') {
      assert(helpers.length); if (mode !== 'auto') assert(helpers.some(row => row.marker));
      assert(helpers.every(row => row.tools === 0 && row.nativeCompactionDisabled));
    } else assert(current().some(row => row.type === 'control-compaction' && row.marker));
    const checkpoints = entries().filter(row => row.type === 'custom' && row.customType === 'claude-sdk-checkpoint');
    assert.equal(checkpoints.at(-1).data.sdkSessionId, checkpoints.at(-2).data.sdkSessionId);
    if (mode !== 'auto') assert.notEqual(checkpoints.at(-1).data.sdkSessionId, checkpoints[0].data.sdkSessionId);
    const messages = entries().flatMap(row => row.message ? [row.message] : []);
    const calls = messages.filter(m => m.role === 'assistant').flatMap(m => m.content.filter(block => block.type === 'toolCall'));
    const results = messages.filter(m => m.role === 'toolResult');
    assert.deepEqual(calls.map(call => call.id), results.map(response => response.toolCallId));
    const stats = await worker.request('get_session_stats');
    const cost = messages.filter(m => m.role === 'assistant').reduce((sum, m) => sum + m.usage.cost.total, 0)
      + entries().filter(row => row.type === 'compaction').reduce((sum, row) => sum + (row.usage?.cost.total || 0), 0);
    assert(Math.abs(stats.cost - cost) < 1e-9, 'Summary usage must remain in Pi totals.');
    result.cases.push({ mode, pass: true, auditPreserved: true, noToolReplay: true, markerAfterCompactionAndRestart: true, usageReconciled: true });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; result.stack = error.stack; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
