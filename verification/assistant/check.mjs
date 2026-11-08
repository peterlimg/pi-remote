#!/usr/bin/env node
// Model-checks Miso's event and send rules, then turns each host guard off to prove its invariant can fail.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toolsJar, javaBinary, version } from '../tlc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const invariants = ['TypeOK', 'EventsDurableBeforeWake', 'AtMostOnceEvent', 'QuestionsSurface', 'AnswerHitsSeenQuestion', 'NoUnapprovedSend', 'AtMostOnceDelivery', 'CancelWins'];
const guards = ['EnforceMarkBeforeDispatch', 'EnforceNoResend', 'EnforceDialogMatch', 'EnforceApprovedRevision', 'EnforceCancel'];
// Each host guard and the promise that breaks without it.
const controls = [['EnforceMarkBeforeDispatch', 'EventsDurableBeforeWake'], ['EnforceNoResend', 'AtMostOnceEvent'], ['EnforceNoResend', 'AtMostOnceDelivery'],
  ['EnforceDialogMatch', 'AnswerHitsSeenQuestion'], ['EnforceApprovedRevision', 'NoUnapprovedSend'], ['EnforceCancel', 'CancelWins']];
const evidence = mkdtempSync(join(tmpdir(), 'pi-assistant-formal-'));
cpSync(join(here, 'AssistantFlow.tla'), join(evidence, 'AssistantFlow.tla'));
console.log('Evidence: ' + evidence);

function check(name, disabled, checked) {
  const config = name + '.cfg';
  writeFileSync(join(evidence, config), 'SPECIFICATION Spec\nCONSTANTS ' + guards.map(guard => guard + ' = ' + (guard === disabled ? 'FALSE' : 'TRUE')).join('\n') +
    '\nCONSTRAINT Bounded\nINVARIANTS ' + checked.join(' ') + '\n');
  const result = spawnSync(java, ['-XX:+UseParallelGC', '-Xmx1g', '-cp', jar, 'tlc2.TLC', '-workers', 'auto', '-config', config, '-metadir', join(evidence, name + '-states'), 'AssistantFlow.tla'],
    { cwd: evidence, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || ''); writeFileSync(join(evidence, name + '.log'), output);
  if (result.error) throw result.error;
  const violated = output.match(/Invariant (\w+) is violated/)?.[1];
  if (result.status !== 0 && !violated) throw new Error('TLC did not reach a verdict; inspect ' + join(evidence, name + '.log'));
  return { name, disabled, violated, states: Number([...output.matchAll(/(\d+) distinct states found/g)].at(-1)?.[1]) };
}

let jar, java;
try { jar = await toolsJar(); java = javaBinary(); }
catch (error) { console.error(error.message); process.exit(2); }
const normal = check('normal', undefined, invariants);
const negative = controls.map(([guard, invariant]) => ({ ...check(guard + '-' + invariant, guard, ['TypeOK', invariant]), expected: invariant }));
const findings = [...(normal.violated ? [`${normal.violated} is violated with every guard on`] : []),
  ...negative.filter(item => item.violated !== item.expected).map(item => `Turning off ${item.disabled} did not break ${item.expected}; the invariant may be vacuous`)];
const result = { tool: 'TLC ' + version, normal, negative, findings };
writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
console.log(`All invariants hold over ${normal.states} states.`);
for (const item of negative) console.log(`${item.disabled} off -> ${item.violated ? item.violated + ' violated' : 'no violation'}`);
for (const finding of findings) console.error('FINDING: ' + finding);
process.exitCode = findings.length ? 1 : 0;
