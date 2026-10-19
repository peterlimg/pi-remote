// E2E: real Pi prompt hooks, session audit and SDK bridge; only the external SDK is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from '../../src/rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-prompt-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'PROMPT_' + randomUUID() });
writeFileSync(join(evidence, 'agent/AGENTS.md'), 'PORTABLE_GLOBAL_POLICY: retain operator instructions.');
writeFileSync(join(project, 'AGENTS.md'), 'PORTABLE_PROJECT_POLICY: retain project instructions.');
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const fixture = fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url));
const hash = path => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined;
const settings = join(homedir(), '.pi/agent/settings.json'), settingsBefore = hash(settings);
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const result = { fixture: 'Real Pi prompt replacement hooks, provider, MCP and tool execution; external SDK replay only',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
let worker;
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['append', 'same', 'rewrite', 'prepend', 'append-override', 'append-explicit-docs', 'override-explicit-docs', 'late-change', 'custom', 'opaque']) {
    result.stage = mode;
    process.env.PI_RECOVERY_PROMPT_CASE = mode;
    process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    writeFileSync(process.env.PI_RECOVERY_SESSION, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length;
    worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '--no-mcp', '--tools', 'probe',
      '-e', fixture, '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'off', '--append-system-prompt', 'PORTABLE_APPEND',
      ...(mode === 'custom' ? ['--system-prompt', 'PORTABLE_CUSTOM_PROMPT'] : [])] });
    let settled = false;
    worker.on('event', event => { if (event.type === 'agent_settled') settled = true; });
    await worker.request('get_state'); await worker.request('prompt', { message: 'seed' });
    const deadline = Date.now() + 12000;
    while (!settled) { if (Date.now() > deadline) throw new Error('Prompt fixture did not settle.'); await delay(20); }
    const rows = readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
    const reply = rows.findLast(row => row.message?.role === 'assistant').message;
    const blocked = ['rewrite', 'prepend', 'append-explicit-docs', 'override-explicit-docs', 'late-change'].includes(mode);
    assert.equal(reply.stopReason, blocked ? 'error' : 'stop', reply.errorMessage);
    const current = records().slice(offset), queries = current.filter(row => row.type === 'query');
    assert.equal(queries.length, blocked ? 0 : 1, 'Unknown rewrites and explicit documentation must reject before SDK startup.');
    if (blocked) assert.match(reply.errorMessage, /Cannot project an inherited Pi base prompt safely/);
    else {
      const query = queries[0]; assert.equal(query.portable, true); assert.equal(query.piDocs, false);
      assert.equal(query.forceBoundary, mode !== 'same');
      if (mode !== 'opaque') {
        for (const key of ['globalPolicy', 'projectPolicy', 'append', 'latePolicy']) assert.equal(query[key], true, key);
        for (const key of ['guideline', 'toolGuidance']) assert.equal(query[key], mode !== 'custom', key);
        if (mode === 'custom') assert.equal(query.customPrompt, true);
        if (mode === 'append-override') assert.equal(query.customDocs, true);
      }
      assert.deepEqual(current.filter(row => row.type === 'execution').map(row => row.label), ['seed']);
    }
    result.cases.push({ mode, pass: true, blocked, sdkQueries: queries.length });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); result.personalSettingsUnchanged = hash(settings) === settingsBefore;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
