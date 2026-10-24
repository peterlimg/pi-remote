// E2E: Stop and continue through real Pi RPC, provider and MCP; only the SDK is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-cancel-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'CANCEL_' + randomUUID() });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const settings = join(homedir(), '.pi/agent/settings.json');
const settingsHash = () => existsSync(settings) ? createHash('sha256').update(readFileSync(settings)).digest('hex') : undefined;
const beforeSettings = settingsHash();
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const last = () => entries().findLast(row => row.message?.role === 'assistant')?.message;
const result = { fixture: 'real Pi RPC, Stop, provider, MCP and tool effects; external SDK replay, no model calls',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
let worker, settled = 0;
async function until(check, label) {
  const end = Date.now() + 12000;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await delay(20); }
}
async function start() {
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'high'] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled++; });
  await worker.request('get_state');
}
async function send(message) {
  const before = settled;
  await worker.request('prompt', { message });
  await until(() => settled > before, 'turn settlement');
  return last();
}
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['first', 'checkpoint', 'restart', 'during-tool', 'text', 'old-guard', 'missing-result', 'unknown-error']) {
    result.stage = mode;
    const file = join(evidence, mode + '.jsonl'); process.env.PI_RECOVERY_SESSION = file;
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length;
    await start();
    if (mode === 'checkpoint') assert.equal((await send('seed')).stopReason, 'stop');
    const before = settled;
    const command = mode === 'during-tool' ? 'cancel-in-tool' : mode === 'text' ? 'cancel-text' : 'cancel-after-tools';
    await worker.request('prompt', { message: command });
    await until(() => records().slice(offset).some(row => mode === 'during-tool' ? row.type === 'execution' && row.label === 'cancel-running' : row.type === 'cancel-ready'), 'cancellation boundary');
    await worker.command({ type: 'abort' });
    await until(() => settled > before, 'Stop settlement');
    assert.equal(last().stopReason, 'aborted');
    const cancelledHistory = readFileSync(file, 'utf8');
    if (['restart', 'old-guard', 'missing-result', 'unknown-error'].includes(mode)) {
      await worker.close(); worker = undefined;
      const rows = entries();
      if (mode === 'old-guard') {
        const append = message => rows.push({ type: 'message', id: randomUUID(), parentId: rows.at(-1).id, timestamp: new Date().toISOString(), message });
        append({ role: 'user', content: 'Correction rejected before the update.', timestamp: Date.now() });
        const errorMessage = 'Cannot recover uncheckpointed SDK responses or interrupted SDK tools.';
        append({ ...last(), stopReason: 'error', errorMessage, content: [{ type: 'text', text: errorMessage }], usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
      }
      if (mode === 'missing-result') rows.splice(rows.findIndex(row => row.message?.role === 'toolResult'), 1);
      if (mode === 'unknown-error') {
        const message = rows.findLast(row => row.message?.role === 'assistant').message;
        message.stopReason = 'error'; message.errorMessage = 'Unknown SDK failure'; message.content = [{ type: 'text', text: message.errorMessage }];
      }
      if (mode !== 'restart') {
        let parentId = null;
        for (const row of rows) if (row.type !== 'session') { row.parentId = parentId; parentId = row.id; }
        writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      }
      await start();
    }
    const queriesBefore = records().filter(row => row.type === 'query').length;
    const effectsBefore = records().slice(offset).filter(row => row.type === 'execution').map(row => row.label);
    const response = await send('Continue with the corrected location. Do not repeat any earlier tool.');
    const blocked = mode === 'missing-result';
    assert.equal(response.stopReason, blocked ? 'error' : 'stop', response.errorMessage);
    assert.deepEqual(records().slice(offset).filter(row => row.type === 'execution').map(row => row.label), effectsBefore);
    if (blocked) assert.equal(records().filter(row => row.type === 'query').length, queriesBefore);
    else {
      const query = records().filter(row => row.type === 'query').at(-1), prompt = records().filter(row => row.type === 'prompt').at(-1);
      assert.equal(query.resumed, false); assert.equal(query.resumedAt, false);
      assert.equal(prompt.cancelled, mode !== 'unknown-error');
      assert.equal(prompt.failed, mode === 'unknown-error');
      if (mode !== 'text' && mode !== 'during-tool') assert.equal(prompt.marker, true);
      assert.equal(response.usage.input, 100, 'New native context must reset the SDK usage baseline.');
      if (['first', 'checkpoint', 'text', 'during-tool', 'restart'].includes(mode)) assert(readFileSync(file, 'utf8').startsWith(cancelledHistory));
      assert(entries().some(row => row.customType === 'claude-sdk-checkpoint'));
      const queries = records().filter(row => row.type === 'query').length;
      assert.equal((await send('followup')).stopReason, 'stop');
      assert.equal(records().filter(row => row.type === 'query').length, queries);
    }
    result.cases.push({ mode, pass: true, effects: effectsBefore, historicalToolsReplayed: false, blocked });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); result.personalSettingsUnchanged = settingsHash() === beforeSettings;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
