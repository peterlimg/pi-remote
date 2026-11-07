import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { socket, until, delay } from '../../test/helpers.mjs';
import { parseTaskInput } from '../../src/task-input.mjs';

const fixture = fileURLToPath(new URL('../../test/fixtures/coordinator-flow-pi.mjs', import.meta.url));
const requestId = () => createHash('sha256').update(randomUUID()).digest('hex');

export async function replay(sourceRoot, scenario, evidence) {
  const root = mkdtempSync(join(tmpdir(), 'pi-coordinator-formal-replay-'));
  const dir = join(root, 'host'), sessions = join(root, 'sessions'), project = join(root, 'project');
  for (const folder of [dir, sessions, project]) mkdirSync(folder, { recursive: true });
  const timestamp = new Date().toISOString(), file = join(sessions, 'source.jsonl');
  writeFileSync(file, [
    { type: 'session', version: 3, id: randomUUID(), timestamp, cwd: project },
    { type: 'session_info', id: 'name', parentId: null, timestamp, name: 'Formal flow owner' },
    { type: 'model_change', id: 'model', parentId: 'name', timestamp, provider: 'formal', modelId: 'fixture' }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 });
  const { startHost } = await import(pathToFileURL(join(sourceRoot, 'src/host.mjs')));
  const { loadConfig } = await import(pathToFileURL(join(sourceRoot, 'src/config.mjs')));
  const { sessionKey } = await import(pathToFileURL(join(sourceRoot, 'src/locks.mjs')));
  const config = { ...loadConfig(dir), port: 0, publicUrl: 'http://127.0.0.1', relayUrl: '' };
  let host, client, assigning, stopping;
  const trace = [];
  const ledger = () => JSON.parse(readFileSync(join(dir, 'coordinator-tasks.json'), 'utf8'));
  const task = () => ledger().tasks[0];
  try {
    host = await startHost({ dir, config, port: 0, publicUrl: config.publicUrl, relayUrl: '', roots: [sessions],
      workerOptions: { bin: process.execPath, prefix: [fixture], env: { PI_FORMAL_ROOT: root, PI_FORMAL_SCENARIO: scenario } } });
    const origin = 'http://127.0.0.1:' + host.http.address().port;
    const post = async (token, input) => {
      const response = await fetch(origin + '/_pi/coordinator', { method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, requestId: requestId() }), signal: AbortSignal.timeout(12000) });
      return response.json();
    };
    client = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin);
    const adopted = await client.request('newCoordinator', { sessionId: sessionKey(file) });
    assert.equal(adopted.value.ok, true);
    const owner = ledger().coordinators[0];
    assigning = post(owner.token, { action: 'assign', title: 'Formal task', instruction: 'Return the fixture finding.' });
    await until(() => !!task(), 10000);
    if (scenario.startsWith('recovery-')) {
      const bodies = () => readFileSync(task().file, 'utf8').trim().split('\n').map(JSON.parse).filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => parseTaskInput(entry.message.content[0].text)).filter(Boolean);
      await assigning;
      if (scenario === 'recovery-stop') {
        await until(() => task().state === 'recovering', 10000);
        assert.equal((await post(owner.token, { action: 'stop', taskId: task().id })).ok, true);
        await delay(2000);
        trace.push('Stop was requested during recovery; state=' + task().state + ', deliveries=' + bodies().length);
        return save('StopWinsRecovery', task().state === 'stopped' && bodies().length === 1, task().state);
      }
      if (scenario === 'recovery-budget') {
        await until(() => task().recovery?.phase === 'blocked' || task().recovery?.attempts > 2, 15000);
        trace.push('Repeated reportless turns stop at attempts=' + task().recovery.attempts);
        return save('RecoveryIsBounded', task().recovery.attempts <= 2 && task().recovery.phase === 'blocked', task().state);
      }
      await until(() => task().recovery?.phase === 'blocked' || task().state === 'reported', 12000);
      if (scenario === 'recovery-effects') {
        trace.push('An unfinished tool is present in persisted history; deliveries=' + bodies().length);
        return save('UncertainEffectsBlock', task().recovery?.phase === 'blocked' && bodies().length === 1, task().state);
      }
      if (scenario === 'recovery-inputs') {
        const delivered = bodies().flatMap(input => input.messages).map(message => message.id);
        trace.push('Recovery continues the same session; persisted input bodies=' + delivered.length);
        return save('NoDuplicateInputs', delivered.length === new Set(delivered).size, task().state);
      }
      const stale = JSON.parse(readFileSync(join(root, 'stale-result.json'), 'utf8'));
      trace.push('The older generation posted a result while a new attempt was working; accepted=' + stale.ok);
      return save('ReportsAreCurrent', stale.ok === false, task().state);
    }
    if (['accepted-prompt-failure', 'accepted-prompt-ack'].includes(scenario)) {
      await until(() => task().state === 'reported', 10000);
      trace.push('Coordinator sends instruction; its RPC reply is pending.', 'Worker report is persisted as reported.');
      const accepted = await post(owner.token, { action: 'accept', taskId: task().id });
      assert.equal(accepted.ok, true); assert.equal(task().state, 'completed');
      trace.push('Coordinator acceptance is persisted as completed.');
      writeFileSync(join(root, 'prompt.reply'), 'release');
      await assigning;
      trace.push('The earlier instruction RPC ' + (scenario === 'accepted-prompt-ack' ? 'acknowledges' : 'fails') + '; task state is ' + task().state + '.');
      return save('AcceptedResultStable', task().state === 'completed', task().state);
    }
    if (scenario === 'accepted-stop-ack') {
      assert.equal((await assigning).ok, true);
      trace.push('Initial instruction is acknowledged; worker is working.');
    } else await until(() => task().state === 'working', 10000);
    stopping = post(owner.token, { action: 'stop', taskId: task().id });
    await until(() => task().state === 'stopping', 10000);
    trace.push('Coordinator requests Stop; stopping is persisted and abort reply is pending.');
    if (scenario === 'accepted-stop-ack') {
      const message = await post(owner.token, { action: 'message', taskId: task().id, text: 'Return a fresh fixture finding.' });
      assert.equal(message.ok, false, 'A new instruction must not overtake an unfinished Stop');
      trace.push('A follow-up while Stop is pending is refused.');
      writeFileSync(join(root, 'abort.reply'), 'release'); await stopping;
      assert.equal((await post(owner.token, { action: 'message', taskId: task().id, text: 'Return a fresh fixture finding.' })).ok, true);
      await until(() => task().state === 'reported', 10000);
      trace.push('After Stop is acknowledged, an explicit instruction returns a fresh report.');
      assert.equal((await post(owner.token, { action: 'accept', taskId: task().id })).ok, true);
      assert.equal(task().state, 'completed'); trace.push('The fresh result is accepted as completed.');
      trace.push('The old Stop completed before continuation; task state remains ' + task().state + '.');
      return save('AcceptedResultStable', task().state === 'completed', task().state);
    }
    const report = await post(task().token, { kind: 'result', generation: task().generation, text: 'Late fixture report during Stop.' });
    const held = report.ok === false && task().state === 'stopping';
    trace.push('Worker posts a result while stopping; accepted=' + report.ok + ', state=' + task().state + '.');
    writeFileSync(join(root, 'abort.reply'), 'release'); writeFileSync(join(root, 'prompt.finish'), 'release');
    await Promise.all([stopping, assigning]);
    return save('ReportsRequireWorking', held, task().state);
  } finally {
    for (const name of ['abort.reply', 'prompt.finish', 'prompt.reply']) writeFileSync(join(root, name), 'release');
    client?.ws.terminate();
    await Promise.allSettled([assigning, stopping].filter(Boolean));
    await host?.close('formal verification fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
  function save(property, held, finalState) {
    const result = { scenario, property, held, finalState, trace,
      boundary: 'real host, HTTP authorization, task ledger, command journal, RPC subprocess; controlled Pi RPC replies' };
    writeFileSync(join(evidence, scenario + '.json'), JSON.stringify(result, null, 2));
    return result;
  }
}
