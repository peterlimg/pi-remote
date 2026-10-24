// E2E: extension notices are pending input, not incomplete SDK history.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-notices-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'NOTICE_' + randomUUID() });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const last = () => entries().findLast(row => row.message?.role === 'assistant')?.message;
const result = { fixture: 'real Pi RPC, sendMessage/sendUserMessage, SDK provider and MCP; external SDK replay, no real children or models',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
let worker, settled = 0;
async function until(check) {
  const end = Date.now() + 12000;
  while (!check()) { if (Date.now() > end) throw new Error('Turn did not settle'); await delay(20); }
}
async function start() {
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'medium'] });
  worker.on('event', event => {
    if (event.type === 'agent_settled') settled++;
    if (event.type === 'extension_ui_request' && event.method === 'confirm') worker.process.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: event.id, confirmed: true }) + '\n');
  });
  await worker.request('get_state');
}
async function send(message) {
  const before = settled;
  await worker.request('prompt', { message }); await until(() => settled > before);
  return last();
}
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['live', 'first', 'restart', 'foreign', 'recovery', 'old-guard', 'unknown-error']) {
    result.stage = mode;
    process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    writeFileSync(process.env.PI_RECOVERY_SESSION, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length, current = () => records().slice(offset);
    await start();
    if (mode !== 'first') assert.equal((await send('seed')).stopReason, 'stop');
    if (['old-guard', 'unknown-error'].includes(mode)) {
      const previous = last(); await worker.close(); worker = undefined;
      const rows = entries();
      const append = data => rows.push({ ...data, id: randomUUID(), parentId: rows.at(-1).id, timestamp: new Date().toISOString() });
      for (const marker of ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']) append({ type: 'custom_message', customType: 'synthetic-child-notify', content: marker, display: true });
      append({ type: 'message', message: { role: 'user', content: 'Acknowledge the completed notices.', timestamp: Date.now() } });
      const errorMessage = mode === 'old-guard' ? 'Cannot recover SDK history with an incomplete Pi turn.' : 'Unrecognized SDK failure';
      append({ type: 'message', message: { ...previous, stopReason: 'error', errorMessage, content: [{ type: 'text', text: errorMessage }],
        ...(mode === 'old-guard' ? { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}) } });
      writeFileSync(process.env.PI_RECOVERY_SESSION, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      await start();
    } else if (mode === 'restart') { await worker.close(); worker = undefined; await start(); }
    else if (mode === 'foreign') {
      await worker.request('set_model', { provider: 'recovery-control', modelId: 'plain' });
      assert.equal((await send('foreign')).stopReason, 'stop');
      await worker.request('set_model', { provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
    } else if (mode === 'recovery') {
      await worker.request('prompt', { message: '/sdk-record-notices' });
      await worker.request('prompt', { message: '/sdk-recover' });
    }
    const response = await send(['old-guard', 'unknown-error', 'recovery'].includes(mode) ? 'Acknowledge the recorded child results without restarting work.' : '/sdk-notify');
    assert.equal(response.stopReason, 'stop', response.errorMessage);
    assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), mode === 'first' ? [] : mode === 'foreign' ? ['seed', 'foreign'] : ['seed']);
    const queryCount = ['live', 'first'].includes(mode) ? 1 : 2;
    assert.equal(current().filter(row => row.type === 'query').length, queryCount);
    const prompt = current().filter(row => row.type === 'prompt').at(-1);
    assert.deepEqual(prompt.notices, ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']);
    assert(prompt.noticeOrder.every((value, index, all) => index === 0 || value > all[index - 1]));
    assert.equal(entries().filter(row => row.type === 'custom_message' && row.customType === 'synthetic-child-notify').length, 3);
    assert.equal((await send('Follow up without tools.')).stopReason, 'stop');
    assert.equal(current().filter(row => row.type === 'query').length, queryCount);
    result.cases.push({ mode, pass: true, noToolReplay: true, noticesInOrder: true, blocked: false });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
