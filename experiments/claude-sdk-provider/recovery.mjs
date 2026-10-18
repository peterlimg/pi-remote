// E2E: real Pi RPC, provider extension, MCP and tool effects; an isolated SDK replay peer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { crc32, deflateSync } from 'node:zlib';
import { RpcWorker } from '../../src/rpc.mjs';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-recovery-e2e-')), project = join(evidence, 'project');
for (const dir of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(dir, { recursive: true });
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'),
  PI_RECOVERY_SESSION: join(evidence, 'session.jsonl'), PI_RECOVERY_GATE: join(evidence, 'complete-orphan'),
  PI_RECOVERY_MARKER: 'RECOVERY_' + randomUUID() });
mkdirSync(join(project, '.pi/skills/portable'), { recursive: true });
writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
writeFileSync(join(evidence, 'agent/AGENTS.md'), 'PORTABLE_GLOBAL_POLICY: preserve this operator instruction.');
writeFileSync(join(project, 'AGENTS.md'), 'PORTABLE_PROJECT_POLICY: preserve this project instruction.');
writeFileSync(join(project, '.pi/skills/portable/SKILL.md'), '---\nname: portable\ndescription: PORTABLE_SKILL verification fixture.\n---\nUse only when requested.\n');
writeFileSync(process.env.PI_RECOVERY_SESSION, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
const sessionFile = process.env.PI_RECOVERY_SESSION;
const settingsFile = join(homedir(), '.pi/agent/settings.json');
const digest = text => createHash('sha256').update(text).digest('hex');
const settingsBefore = existsSync(settingsFile) ? digest(readFileSync(settingsFile)) : undefined;
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const effects = () => records().filter(row => row.type === 'execution').map(row => row.label);
const last = () => entries().findLast(entry => entry.message?.role === 'assistant')?.message;
const appendMessage = (rows, message) => {
  const entry = { type: 'message', id: randomUUID(), parentId: rows.at(-1).id, timestamp: new Date().toISOString(), message };
  rows.push(entry); return entry;
};
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const result = { fixture: 'real Pi RPC, extension, bridge and MCP; SDK protocol replay without model calls',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), node: process.version, pass: false };
let worker, settled = 0;
const dialogs = [];
async function until(check, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await delay(20); }
}
function start(file = sessionFile, systemPrompt) {
  process.env.PI_RECOVERY_SESSION = file;
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '-ne', '-np', '--no-mcp',
    '--tools', 'read,probe', '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5',
    '--thinking', 'off', '--append-system-prompt', 'PORTABLE_APPEND', ...(systemPrompt ? ['--system-prompt', systemPrompt] : [])] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled++; if (event.type === 'extension_ui_request' && event.method === 'confirm') dialogs.push(event); });
  return worker.request('get_state');
}
async function send(text, images) {
  const before = settled;
  await worker.request('prompt', { message: text, ...(images ? { images } : {}) });
  await until(() => {
    assert(!dialogs.some(dialog => dialog.title === 'Review tool after SDK recovery'), 'Recovered chats must retain normal Pi tool permissions without an extra approval prompt.');
    return settled > before;
  }, 'turn settlement');
  return last();
}
async function answer(confirmed) {
  await until(() => dialogs.length, 'operator confirmation');
  const dialog = dialogs.shift();
  worker.process.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: dialog.id, confirmed }) + '\n');
  return dialog;
}
console.log('Evidence: ' + evidence);
try {
  await start();
  result.stage = 'seed';
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(32 * 129, 255); for (let row = 0; row < 32; row++) pixels[row * 129] = 0;
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
  assert.equal((await send('seed', [{ type: 'image', data: png, mimeType: 'image/png' }])).stopReason, 'stop');
  await until(() => entries().some(e => e.customType === 'claude-sdk-checkpoint'), 'completed checkpoint');
  assert.deepEqual(effects(), ['seed']);
  const firstQuery = records().find(row => row.type === 'query');
  for (const key of ['portable', 'globalPolicy', 'projectPolicy', 'skill', 'append', 'toolGuidance', 'guideline', 'latePolicy']) assert.equal(firstQuery[key], true, key);
  assert.equal(firstQuery.piDocs, false);
  assert.match(getCurrentSystemPrompt(entries().map(entry => entry.message).filter(Boolean)), /providers \(docs\/custom-provider\.md\)/);
  result.portablePromptPreservesInstructionsSkillsAndLateToolGuidance = true;
  result.piTranscriptRetainsCanonicalPrompt = true;
  result.stage = 'interrupted-tool';
  await worker.request('prompt', { message: 'interrupt' });
  await until(() => effects().includes('orphan'), 'one interrupted effect');
  await worker.command({ type: 'prompt', text: '/sdk-recover' });
  assert.equal((await worker.request('get_state')).isStreaming, true);
  assert.equal(dialogs.length, 0);
  assert(!entries().some(e => e.customType === 'claude-sdk-recovery'));
  result.busyRecoveryDoesNotInterruptTool = true;
  worker.process.kill('SIGKILL'); await worker.exited;
  const original = readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8');
  await start();
  const queriesBefore = records().filter(row => row.type === 'query').length;
  const failed = await send('verify blocked');
  assert.equal(failed.stopReason, 'error');
  assert.match(failed.errorMessage, /uncheckpointed SDK responses|interrupted SDK tools/);
  assert.equal(records().filter(row => row.type === 'query').length, queriesBefore);
  result.originalFailureReproduced = true;
  const beforeRecovery = readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8');
  const commandNames = (await worker.request('get_commands')).commands.map(command => command.name);
  assert(commandNames.includes('sdk-recover'), 'An interrupted SDK conversation needs an explicit /sdk-recover operation.');
  result.stage = 'cancel-recovery';
  const cancelled = worker.command({ type: 'prompt', text: '/sdk-recover' });
  const warning = await answer(false);
  await cancelled;
  assert.match(warning.message, /new SDK context/i);
  assert.equal(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8'), beforeRecovery);
  result.cancelDoesNotMutateHistory = true;
  result.stage = 'approve-recovery';
  const accepted = worker.command({ type: 'prompt', text: '/sdk-recover' });
  await answer(true); await accepted;
  await until(() => entries().some(e => e.customType === 'claude-sdk-recovery'), 'persisted recovery decision');
  const approvedHistory = readFileSync(sessionFile, 'utf8');
  await worker.close();
  const negatives = [
    ['history', rows => { rows.find(e => e.message?.role === 'user').message.content[0].text = 'CHANGED'; }],
    ['decision', rows => { rows.findLast(e => e.customType === 'claude-sdk-recovery').data.history[0] = '0'.repeat(64); }],
    ['identity', rows => { rows.findLast(e => e.customType === 'claude-sdk-recovery').data.interrupted[0].id = 'other-call'; }],
    ['checkpoint', rows => { rows.findLast(e => e.customType === 'claude-sdk-recovery').data.checkpointHash = '0'.repeat(64); }],
    ['late-input', rows => { rows.push({ type: 'message', id: 'late-user', parentId: rows.at(-1).id, timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'LATE_INPUT', timestamp: Date.now() } }); }],
    ['unapproved-sdk', rows => {
      appendMessage(rows, { role: 'user', content: 'Unapproved SDK work', timestamp: Date.now() });
      appendMessage(rows, { ...failed, stopReason: 'stop', errorMessage: undefined, content: [{ type: 'text', text: 'UNAPPROVED_SDK_RESPONSE' }] });
    }],
    ['incomplete-foreign', rows => {
      appendMessage(rows, { role: 'user', content: 'Unfinished foreign work', timestamp: Date.now() });
      appendMessage(rows, { ...failed, provider: 'recovery-control', api: 'recovery-control', stopReason: 'toolUse', errorMessage: undefined,
        content: [{ type: 'toolCall', id: 'control-pending', name: 'probe', arguments: { label: 'pending-foreign' } }] });
    }],
    ['configuration', () => {}],
  ];
  for (const [name, mutate] of negatives) {
    const rows = approvedHistory.trim().split('\n').map(JSON.parse); mutate(rows);
    const file = join(evidence, name + '.jsonl'); writeFileSync(file, rows.map(e => JSON.stringify(e)).join('\n') + '\n');
    await start(file, name === 'configuration' ? 'Changed recovery configuration.' : undefined);
    const count = records().filter(row => row.type === 'query').length;
    const rejected = await send('must reject');
    assert.equal(rejected.stopReason, 'error', name);
    assert.equal(records().filter(row => row.type === 'query').length, count, name + ' must reject before SDK startup');
    await worker.close();
  }
  assert.equal(readFileSync(sessionFile, 'utf8'), approvedHistory);
  result.changedHistoryDecisionIdentityConfigurationAndLateInputRejected = true;
  const mismatched = join(evidence, 'native-identity.jsonl'); writeFileSync(mismatched, approvedHistory);
  process.env.PI_RECOVERY_BAD_INIT = '1';
  await start(mismatched);
  const invalidNative = await send('identity check');
  assert.equal(invalidNative.stopReason, 'error');
  assert.match(invalidNative.errorMessage, /recovery session identity mismatch/);
  assert(!entries().some(e => e.customType === 'claude-sdk-recovery-session'));
  assert.deepEqual(effects(), ['seed', 'orphan']);
  await worker.close(); delete process.env.PI_RECOVERY_BAD_INIT;
  result.unexpectedNativeIdentityRejected = true;
  await start();
  result.stage = 'foreign-turn-before-recovery';
  await worker.command({ type: 'setModel', provider: 'recovery-control', modelId: 'plain' });
  assert.equal((await send('foreign turn')).stopReason, 'stop');
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign']);
  await worker.command({ type: 'setModel', provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
  await worker.close();
  const history = entries(), rejection = 'SDK history changed after recovery approval. Request recovery again.';
  const oldGuard = [appendMessage(history, { role: 'user', content: 'Previous SDK return attempt', timestamp: Date.now() }),
    appendMessage(history, { ...failed, errorMessage: rejection, content: [{ type: 'text', text: rejection }] })];
  appendFileSync(sessionFile, oldGuard.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await start();
  const recovered = await send('recall');
  assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
  assert.match(recovered.content.filter(block => block.type === 'text').map(block => block.text).join(''), /RECOVERED/);
  assert.equal(recovered.usage.input, 100, 'A new SDK epoch must not subtract the old epoch usage baseline.');
  assert(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').startsWith(beforeRecovery));
  assert(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').startsWith(original));
  const queries = records().filter(row => row.type === 'query' && !row.invalidInit);
  const recoveredPrompt = records().find(row => row.type === 'prompt' && row.recovered && row.session === queries[1]?.session);
  assert(recoveredPrompt?.marker && recoveredPrompt.unknown && recoveredPrompt.foreign && recoveredPrompt.localRejection && !recoveredPrompt.leakedSignature);
  assert.equal(recoveredPrompt.images, 1);
  assert.equal(queries.length, 2);
  assert.notEqual(queries[0].session, queries[1].session);
  assert.equal(queries[1].resumed, false);
  assert.equal(queries[1].resumedAt, false);
  assert.equal(entries().findLast(e => e.customType === 'claude-sdk-recovery-started').data.sdkSessionId, queries[1].session);
  assert.equal(entries().findLast(e => e.customType === 'claude-sdk-recovery-session').data.sdkSessionId, queries[1].session);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign']);
  result.completedForeignTurnAfterApprovalImported = true;
  result.historyRetainedWithoutToolReplay = true;
  result.explicitNewNativeContext = true;
  result.unknownEffectsAndImagesRetained = true;
  result.signaturesOmitted = true;
  result.stage = 'normal-tool-policy';
  assert.equal((await send('allow-new')).stopReason, 'stop');
  assert.equal(dialogs.length, 0);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed']);
  assert.equal((await send('deny-new')).stopReason, 'stop');
  assert.equal(records().findLast(row => row.type === 'result' && row.label === 'policy-denied').error, true);
  assert.equal((await send('invalid-new')).stopReason, 'stop');
  assert.equal(records().findLast(row => row.type === 'result' && row.label === 'invalid').error, true);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed']);
  result.newToolsUseNormalPiPermissions = true;
  result.normalPermissionDenialAndValidationPreserved = true;
  result.stage = 'restart-recovered-worker';
  await worker.close(); await start();
  const followup = await send('followup');
  assert.equal(followup.stopReason, 'stop', followup.errorMessage);
  const latest = records().filter(row => row.type === 'query').at(-1);
  assert.equal(latest.resumed, true);
  assert.equal((await send('after-restart')).stopReason, 'stop');
  assert.equal(dialogs.length, 0);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed', 'after-restart']);
  result.checkpointAndNormalPermissionsSurviveWorkerRestart = true;
  result.stage = 'cancel-after-recovered-history';
  const beforeStop = settled;
  await worker.request('prompt', { message: 'cancel-text' });
  await until(() => records().some(row => row.type === 'cancel-ready' && row.request === 'cancel-text'), 'partial answer after recovered history');
  await worker.command({ type: 'abort' });
  await until(() => settled > beforeStop, 'cancelled recovered turn');
  assert.equal(last().stopReason, 'aborted');
  assert.equal((await send('followup')).stopReason, 'stop');
  const stoppedHistory = records().filter(row => row.type === 'prompt').at(-1);
  assert.equal(stoppedHistory.cancelled, true);
  assert.equal(stoppedHistory.unknown, true, 'Previously approved unknown outcomes must stay explicit after Stop.');
  assert.equal(records().filter(row => row.type === 'query').at(-1).resumed, false);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed', 'after-restart']);
  result.cancelRetainsPreviouslyApprovedUnknownOutcomes = true;
  result.stage = 'reused-call-id';
  const reused = await send('reuse-id');
  assert.equal(reused.stopReason, 'error');
  assert.match(reused.errorMessage, /repeated a previously issued tool-call ID/);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed', 'after-restart']);
  result.duplicateIdsRemainRejected = true;
  await worker.close();
  result.stage = 'billing-rejection';
  const billingFile = join(evidence, 'billing.jsonl');
  writeFileSync(billingFile, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
  await start(billingFile);
  const billing = await send('billing-rejection');
  assert.equal(billing.stopReason, 'error');
  assert.match(billing.errorMessage, /workspace extra usage/i);
  assert.match(billing.errorMessage, /workspace admin/i);
  assert.match(billing.errorMessage, /check SDK entitlement/i);
  assert.doesNotMatch(billing.errorMessage, /login|new session|SYNTHETIC_PRIVATE_DETAIL|requires workspace extra usage for SDK requests|add extra usage/);
  assert.deepEqual(billing.content, [{ type: 'text', text: billing.errorMessage }]);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed', 'after-restart']);
  result.billingPrerequisiteShownWithoutPrivateDetailsOrLoginAdvice = true;
  result.stage = 'retry-rejected-request';
  const rejectedHistory = readFileSync(billingFile, 'utf8');
  const unknownFile = join(evidence, 'unknown-error.jsonl');
  const unknown = entries();
  const unknownMessage = unknown.findLast(entry => entry.message?.role === 'assistant').message;
  unknownMessage.errorMessage = 'Unknown SDK failure'; unknownMessage.content = [{ type: 'text', text: unknownMessage.errorMessage }];
  writeFileSync(unknownFile, unknown.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await worker.close(); await start(unknownFile);
  const beforeUnknown = records().filter(row => row.type === 'query').length;
  assert.equal((await send('must remain blocked')).stopReason, 'error');
  assert.equal(records().filter(row => row.type === 'query').length, beforeUnknown);
  await worker.close(); await start(billingFile);
  assert.equal((await send('billing-rejection')).stopReason, 'error');
  await worker.command({ type: 'setModel', provider: 'recovery-control', modelId: 'plain' });
  assert.equal((await send('foreign-rejection')).stopReason, 'error');
  await worker.command({ type: 'setModel', provider: 'claude-sdk', modelId: 'claude-haiku-5-5' });
  assert.equal((await send('recall')).stopReason, 'stop');
  assert(readFileSync(billingFile, 'utf8').startsWith(rejectedHistory));
  const importedRejections = records().filter(row => row.type === 'prompt').at(-1);
  assert.equal(importedRejections.providerRejection, true);
  assert.equal(importedRejections.foreignFailure, true);
  assert.equal(dialogs.length, 0);
  assert.equal((await send('billing-rejection')).stopReason, 'error');
  assert.equal((await send('recall')).stopReason, 'stop', 'A rejected request must not poison the bridge in the same worker.');
  assert.equal(records().filter(row => row.type === 'query').at(-1).resumed, true);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed', 'after-restart']);
  result.knownNoWorkRejectionsRetryWithoutRecoveryOrHistoryLoss = true;
  result.unknownSdkFailuresRemainBlocked = true;
  result.stage = 'legacy-prompt-checkpoint';
  await worker.close();
  const legacy = entries(), legacyMessages = legacy.map(entry => entry.message).filter(Boolean);
  const legacyConfiguration = digest(JSON.stringify({ cwd: project, sessionId: legacy[0].id,
    systemPrompt: getCurrentSystemPrompt(legacyMessages), tools: getCurrentTools(legacyMessages), maxTokens: 16000 }));
  legacy.findLast(entry => entry.customType === 'claude-sdk-checkpoint').data.configuration = legacyConfiguration;
  const legacyFile = join(evidence, 'legacy-prompt.jsonl');
  writeFileSync(legacyFile, legacy.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await start(legacyFile);
  const beforeMigration = records().filter(row => row.type === 'query').length;
  const needsMigration = await send('do not silently change the native prompt');
  assert.equal(needsMigration.stopReason, 'error');
  assert.match(needsMigration.errorMessage, /previous prompt format.*sdk-recover/i);
  assert.equal(records().filter(row => row.type === 'query').length, beforeMigration);
  const migration = worker.command({ type: 'prompt', text: '/sdk-recover' });
  await answer(true); await migration;
  assert.equal((await send('recall')).stopReason, 'stop');
  assert.equal(records().filter(row => row.type === 'query').at(-1).resumed, false);
  assert.notEqual(entries().findLast(entry => entry.customType === 'claude-sdk-checkpoint').data.configuration, legacyConfiguration);
  await worker.close(); await start(legacyFile);
  assert.equal((await send('followup')).stopReason, 'stop');
  assert.equal(records().filter(row => row.type === 'query').at(-1).resumed, true);
  assert.deepEqual(effects(), ['seed', 'orphan', 'foreign', 'allowed', 'after-restart']);
  result.legacyPromptRequiresApprovedContextResetWithoutToolReplay = true;
  await worker.close();
  for (const mode of ['rewrite', 'docs', 'custom']) {
    result.stage = 'portable-' + mode;
    const file = join(evidence, mode + '.jsonl');
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    if (mode === 'rewrite') process.env.PI_RECOVERY_REWRITE = '1';
    if (mode === 'docs') process.env.PI_RECOVERY_DOC_OVERRIDE = '1';
    await start(file, mode === 'custom' ? 'PORTABLE_CUSTOM_PROMPT' : undefined);
    const queriesBefore = records().filter(row => row.type === 'query').length;
    const response = await send('verify prompt ownership');
    if (mode === 'rewrite') {
      assert.equal(response.stopReason, 'error');
      assert.match(response.errorMessage, /preserve.*prompt|prompt.*preserve/i);
      assert.equal(records().filter(row => row.type === 'query').length, queriesBefore);
    } else {
      assert.equal(response.stopReason, 'stop', response.errorMessage);
      assert.equal(records().filter(row => row.type === 'query').at(-1)[mode === 'docs' ? 'customDocs' : 'customPrompt'], true);
    }
    await worker.close(); delete process.env.PI_RECOVERY_REWRITE; delete process.env.PI_RECOVERY_DOC_OVERRIDE;
  }
  result.opaqueRewritesFailClosedAndExplicitPromptOverridesArePreserved = true;
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  await worker?.close();
  result.personalSettingsUnchanged = settingsBefore === (existsSync(settingsFile) ? digest(readFileSync(settingsFile)) : undefined);
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
