// E2E: activate a tool during real Pi execution, then use it through the SDK MCP boundary.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-tools-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_DYNAMIC: '1', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'TOOLS_' + randomUUID() });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const settings = join(homedir(), '.pi/agent/settings.json');
const hash = path => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined;
const beforeSettings = hash(settings);
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const last = () => entries().findLast(row => row.message?.role === 'assistant')?.message;
const result = { fixture: 'real Pi RPC, runtime tool selection, provider, MCP and tool execution; only external SDK replayed',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
let worker, settled = 0;
async function start() {
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe,extra',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'max'] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled++; });
  await worker.request('get_state');
}
async function send(message) {
  const before = settled;
  await worker.request('prompt', { message });
  const end = Date.now() + 12000;
  while (settled === before) { if (Date.now() > end) throw new Error('Turn did not settle.'); await delay(20); }
  return last();
}
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['first', 'checkpoint', 'restart', 'remove', 'stop', 'old-guard', 'queued-input', 'permission', 'validation', 'environment', 'instructions', 'missing-result', 'history']) {
    result.stage = mode;
    process.env.PI_RECOVERY_TOOL_CASE = mode;
    process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    writeFileSync(process.env.PI_RECOVERY_SESSION, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length, current = () => records().slice(offset), effects = () => current().filter(row => row.type === 'execution').map(row => row.label);
    await start();
    const seeded = ['checkpoint', 'old-guard'].includes(mode);
    if (seeded) assert.equal((await send('seed')).stopReason, 'stop');
    let response = await send('dynamic-tools');
    if (mode === 'old-guard') {
      assert.equal(response.errorMessage, 'SDK prompt, tools, environment, or output limit changed. Start a new Pi session.');
      await worker.close(); worker = undefined;
      await start();
      response = await send('dynamic-tools');
    }
    const blocked = ['environment', 'instructions', 'missing-result', 'history'].includes(mode);
    assert.equal(response.stopReason, blocked ? 'error' : 'stop', response.errorMessage);
    assert(current().find(row => row.type === 'selection').active.includes('extra'));
    const denied = ['permission', 'validation'].includes(mode);
    assert.deepEqual(effects(), [...(seeded ? ['seed'] : []), 'dynamic-tools', ...(!blocked && !denied ? ['new-capability'] : [])]);
    const queries = current().filter(row => row.type === 'query');
    if (blocked) {
      assert.equal(queries.length, 1, 'Unsafe change must not start another SDK query.');
      assert.match(response.errorMessage, mode === 'missing-result' ? /exactly one Pi result/ : mode === 'history' ? /history changed/ : /environment, or output limit changed/);
    } else {
      const capability = current().find(row => row.type === 'dynamic-tools');
      assert(capability.allowed && capability.listed.includes('extra'));
      assert.equal(queries.length, 2);
      assert.equal(queries[1].resumed, false); assert.equal(queries[1].resumedAt, false);
      assert.notEqual(queries[0].session, queries[1].session);
      assert(current().some(row => row.type === 'prompt' && row.toolUpdate));
      if (!['old-guard', 'queued-input'].includes(mode)) assert(current().some(row => row.type === 'prompt' && row.continuation), 'A live handoff must continue, not repeat the original user command.');
      if (mode === 'queued-input') assert.deepEqual(current().find(row => row.type === 'prompt' && row.toolUpdate).notices, ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']);
      assert(entries().some(row => row.customType === 'claude-sdk-checkpoint'));
      const toolResults = entries().flatMap(row => row.message?.role === 'toolResult' && row.message.toolName === 'extra' ? [row.message] : []);
      assert.equal(toolResults.length, 1); assert.equal(toolResults[0].isError, denied);
      if (mode === 'restart') { await worker.close(); worker = undefined; await start(); }
      if (mode === 'remove') await worker.request('prompt', { message: '/hide-extra' });
      if (mode === 'stop') {
        const before = settled;
        await worker.request('prompt', { message: 'cancel-text' });
        const end = Date.now() + 12000;
        while (!current().some(row => row.type === 'cancel-ready')) { if (Date.now() > end) throw new Error('No partial response after tool update.'); await delay(20); }
        await worker.command({ type: 'abort' });
        while (settled === before) { if (Date.now() > end) throw new Error('Stop did not settle.'); await delay(20); }
        assert.equal(last().stopReason, 'aborted');
      }
      const oldEffects = effects();
      assert.equal((await send(mode === 'remove' ? 'assert-extra-disabled' : 'followup')).stopReason, 'stop');
      assert.deepEqual(effects(), oldEffects);
      assert.equal(current().filter(row => row.type === 'query').length, ['restart', 'remove', 'stop'].includes(mode) ? 3 : 2);
      if (mode === 'restart') assert.equal(current().filter(row => row.type === 'query').at(-1).resumed, true);
      if (mode === 'remove') {
        const removed = current().find(row => row.type === 'unavailable');
        assert.equal(removed.allowed, false); assert(!removed.listed.includes('extra'));
      }
    }
    result.cases.push({ mode, pass: true, effects: effects(), oldToolReplayed: false, blocked });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); result.personalSettingsUnchanged = hash(settings) === beforeSettings;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
