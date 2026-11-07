#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { replay } from './replay.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const coverage = JSON.parse(readFileSync(join(here, 'coverage.json'), 'utf8'));
const version = '1.7.4', checksum = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const sha = value => createHash('sha256').update(value).digest('hex');
const normal = {
  WorkerFlow: { EnforceReportGuard: true, EnforceCompletionGuard: true },
  RecoveryFlow: { GuardInputs: true, GuardGeneration: true, GuardStop: true, GuardEffects: true, GuardBudget: true }
};
const selfTest = process.argv[2] === '--self-test';
assert(process.argv.length === 2 || selfTest && process.argv.length === 3, 'Usage: check.mjs [--self-test]');
const evidence = mkdtempSync(join(tmpdir(), 'pi-coordinator-formal-'));
console.log('Evidence: ' + evidence);

let changed;
try { changed = execFileSync('git', ['diff', coverage.syncCommit, '--name-only', '--', ...coverage.files], { cwd: root, encoding: 'utf8' }).trim(); }
catch { console.error('Cannot read the source sync commit. Fetch ' + coverage.syncCommit + ' before running verification.'); process.exit(2); }
if (changed) {
  console.error('SOURCE REVIEW REQUIRED: covered code differs from the confirmed sync commit. Read the verification skill and reconcile its model before advancing coverage.json.\n' + changed);
  process.exitCode = 2;
} else {
  const before = Object.fromEntries(coverage.files.map(file => [file, sha(readFileSync(join(root, file)))]));
  try {
    const jar = await toolsJar(), java = javaBinary();
    for (const module of Object.keys(normal)) for (const suffix of ['tla', 'cfg', 'view.mjs']) cpSync(join(here, module + '.' + suffix), join(evidence, module + '.' + suffix));
    const models = ['AcceptedResultStable', 'ReportsRequireWorking'].map(property => modelCheck('WorkerFlow', property, normal.WorkerFlow, evidence, jar, java));
    for (const property of ['NoDuplicateInputs', 'ReportsAreCurrent', 'StopWinsRecovery', 'UncertainEffectsBlock', 'RecoveryIsBounded']) models.push(modelCheck('RecoveryFlow', property, normal.RecoveryFlow, evidence, jar, java));
    const runtime = [];
    const current = join(evidence, 'runtime-current'); mkdirSync(current);
    for (const scenario of ['accepted-prompt-ack', 'accepted-prompt-failure', 'accepted-stop-ack', 'late-report', 'recovery-inputs', 'recovery-generation', 'recovery-stop', 'recovery-effects', 'recovery-budget']) runtime.push(await replay(root, scenario, current));
    for (const model of models) assert.equal(model.held, runtime.filter(result => result.property === model.property).every(result => result.held),
      model.property + ': model and real-host replay disagree; review the abstraction before reporting a finding');
    const mutation = [];
    if (selfTest) for (const variant of [
      { module: 'WorkerFlow', property: 'ReportsRequireWorking', scenario: 'late-report', disabled: 'EnforceReportGuard',
        guard: "      if (task.state !== 'working') throw publicError('This task is not working. Wait for an explicit instruction before reporting again.');", replacement: '' },
      { module: 'WorkerFlow', property: 'AcceptedResultStable', scenario: 'accepted-prompt-failure', disabled: 'EnforceCompletionGuard',
        guard: "    if (!transition || transition.commandId !== transition.task.commandId || !['working', 'stopping'].includes(transition.task.state)) return;", replacement: '    if (!transition) return;' },
      { module: 'RecoveryFlow', property: 'NoDuplicateInputs', scenario: 'recovery-inputs', disabled: 'GuardInputs', file: 'src/task-input.mjs',
        guard: 'inputs.filter(input => !recorded.has(input.id)).map', replacement: 'inputs.map' },
      { module: 'RecoveryFlow', property: 'ReportsAreCurrent', scenario: 'recovery-generation', disabled: 'GuardGeneration',
        guard: "task.protocol === 2 && (input.generation !== task.generation || !task.run?.read)", replacement: 'task.protocol === 2 && !task.run?.read' },
      { module: 'RecoveryFlow', property: 'UncertainEffectsBlock', scenario: 'recovery-effects', disabled: 'GuardEffects',
        guard: "history.pendingTools.length || recovery && history.failedTools.some(tool => tool.generation === task.run?.generation)", replacement: 'false' },
      { module: 'RecoveryFlow', property: 'RecoveryIsBounded', scenario: 'recovery-budget', disabled: 'GuardBudget',
        guard: "if (recovery && task.recovery.attempts >= 2)", replacement: 'if (false)' },
      { module: 'RecoveryFlow', property: 'StopWinsRecovery', scenario: 'recovery-stop', disabled: 'GuardStop',
        guard: `      if (command.action === 'stop') {
        task.stopped = true; task.generation = randomUUID();
        for (const input of task.inputs || []) if (!input.settled) input.cancelled = true;
        for (const event of task.events) if (event.recovery && event.delivery === 'pending') event.delivery = 'cancelled';
        task.recovery = undefined; task.commandId = randomUUID(); this.changed(ownerId);
        const live = this.service.live.get(task.sessionId);
        if (!live || live.resumable || live.managed?.restartSafe) { task.state = 'stopped'; this.changed(ownerId); return this.publicTask(task); }
        return this.send(task, { type: 'abort' }, requestId);
      }`, replacement: "      if (command.action === 'stop') return this.publicTask(task);" }
    ]) {
      const scratch = mkdtempSync(join(tmpdir(), 'pi-coordinator-formal-mutant-'));
      try {
        for (const folder of ['src', 'web', 'extension']) cpSync(join(root, folder), join(scratch, folder), { recursive: true });
        cpSync(join(root, 'package.json'), join(scratch, 'package.json'));
        symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
        const sourceFile = variant.file || 'src/coordinator.mjs';
        const file = join(scratch, sourceFile), original = readFileSync(file, 'utf8');
        assert.equal(original.split(variant.guard).length, 2, 'The mutation must remove exactly the production guard');
        writeFileSync(file, original.replace(variant.guard, variant.replacement));
        const mutantOut = join(evidence, 'mutant-' + variant.property); mkdirSync(mutantOut);
        const model = modelCheck(variant.module, variant.property, { ...normal[variant.module], [variant.disabled]: false }, mutantOut, jar, java);
        const code = await replay(scratch, variant.scenario, mutantOut);
        assert.equal(model.held, false, 'The model must detect the removed gate');
        assert.equal(code.held, false, 'The real HTTP/RPC replay must detect the removed gate');
        writeFileSync(file, original); assert.equal(sha(readFileSync(file)), before[sourceFile]);
        const restoredOut = join(evidence, 'restored-' + variant.property); mkdirSync(restoredOut);
        const restored = await replay(root, variant.scenario, restoredOut);
        const restoredModel = modelCheck(variant.module, variant.property, normal[variant.module], restoredOut, jar, java);
        assert.equal(restored.held, true); assert.equal(restoredModel.held, true);
        mutation.push({ property: variant.property, caughtInModel: true, caughtInCode: true, restoredModel: true, restoredCode: true });
      } finally { rmSync(scratch, { recursive: true, force: true }); }
    }
    const drift = coverage.files.filter(file => sha(readFileSync(join(root, file))) !== before[file]);
    assert.deepEqual(drift, [], 'Verification must not change covered product files');
    const result = { tool: 'TLC ' + version, syncCommit: coverage.syncCommit,
      bounds: 'WorkerFlow: one pending prompt/abort and one restart; RecoveryFlow: two inputs, three failures, at most eight generations, one Stop; fresh request IDs',
      models, runtime, ...(selfTest ? { mutation } : {}), productFilesUnchanged: true,
      excluded: ['multiple workers and capacity', 'request-ID replay', 'tool and filesystem permissions', 'native Pi/model ordering guarantees', 'power-loss durability', 'liveness'] };
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ models, runtime: runtime.map(({ scenario, held, finalState }) => ({ scenario, held, finalState })), ...(selfTest ? { mutation } : {}) }, null, 2));
    const violations = models.some(result => !result.held) || runtime.some(result => !result.held);
    console.log(selfTest ? 'SELF-TEST PASS: all seven scratch mutations were caught and the original properties rechecked; product code is unchanged.'
      : violations ? 'FINDINGS: read result.json and use /statechart to inspect the model and counterexamples.' : 'PASS: bounded model and host/RPC replays agree.');
    process.exitCode = selfTest ? 0 : violations ? 1 : 0;
  } catch (error) {
    console.error(error.stack || error.message); process.exitCode = 2;
  }
}

async function toolsJar() {
  const file = process.env.TLA2TOOLS || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tla2tools', version, 'tla2tools.jar');
  if (!existsSync(file)) {
    if (process.env.TLA2TOOLS) throw new Error('TLA2TOOLS does not exist: ' + file);
    const response = await fetch('https://github.com/tlaplus/tlaplus/releases/download/v' + version + '/tla2tools.jar', { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Cannot download pinned TLC: HTTP ' + response.status);
    const body = Buffer.from(await response.arrayBuffer()); assert.equal(sha(body), checksum, 'TLC checksum mismatch');
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  }
  assert.equal(sha(readFileSync(file)), checksum, 'Use the pinned TLC ' + version + ' jar');
  return resolve(file);
}
function javaBinary() {
  if (process.env.JAVA) return process.env.JAVA;
  if (spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0) return 'java';
  const installed = spawnSync('mise', ['where', 'java@temurin-21'], { encoding: 'utf8' });
  if (installed.status === 0 && installed.stdout.trim()) return join(installed.stdout.trim(), 'bin/java');
  throw new Error('Install Java 11+ and put it on PATH, or set JAVA to its executable. TLC is pinned and downloaded automatically.');
}
function modelCheck(module, property, constants, out, jar, java) {
  mkdirSync(out, { recursive: true }); cpSync(join(here, module + '.tla'), join(out, module + '.tla'));
  const stem = property + (Object.values(constants).every(Boolean) ? '' : '-mutant'), config = stem + '.cfg';
  writeFileSync(join(out, config), 'SPECIFICATION Spec\nCONSTANTS ' + Object.entries(constants).map(([name, value]) => name + ' = ' + (value ? 'TRUE' : 'FALSE')).join('\n') + '\nINVARIANTS TypeOK ' + property + '\n');
  const result = spawnSync(java, ['-XX:+UseParallelGC', '-Xmx512m', '-cp', jar, 'tlc2.TLC', '-workers', '1', '-fp', '0', '-lncheck', 'final',
    '-config', config, '-metadir', join(out, stem + '-states'), module + '.tla'], { cwd: out, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || ''); writeFileSync(join(out, stem + '.log'), output);
  if (result.error) throw result.error;
  const held = result.status === 0;
  if (!held && !output.includes('Invariant ' + property + ' is violated')) throw new Error('TLC did not reach a safety verdict; inspect ' + join(out, stem + '.log'));
  return { module, property, held, log: stem + '.log' };
}
