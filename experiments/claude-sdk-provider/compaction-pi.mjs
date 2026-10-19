// Experimental E2E adapter only: real Pi agent core and SDK, native compaction notifications observed, not rejected.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { default: extension } = await jiti.import('pi-claude-sdk/index.ts');
const { createBridge } = await jiti.import('pi-claude-sdk/bridge.ts');

const cwd = mkdtempSync(join(tmpdir(), 'pi-sdk-auto-compact-'));
const budget = Number(process.env.PI_SDK_TEST_BUDGET_USD ?? 0.35);
assert(Number.isFinite(budget) && budget > 0 && budget <= 2, 'Experiment query budget must be within $0..$2');
const thinking = process.env.PI_SDK_TEST_THINKING ?? 'off';
assert(['off', 'low', 'medium', 'high', 'xhigh', 'max', 'default'].includes(thinking), 'Unsupported experiment thinking level');
mkdirSync(join(cwd, 'project', '.claude'), { recursive: true });
const sentinel = join(cwd, 'project-hook-ran');
writeFileSync(join(cwd, 'project', '.claude', 'settings.json'), JSON.stringify({ hooks: {
  PostCompact: [{ hooks: [{ type: 'command', command: `/usr/bin/touch ${JSON.stringify(sentinel)}` }] }],
} }));
const result = { fixture: 'real Pi 1.2 agent core + SDK; experimental event adapter, not production/RPC/mobile',
  sdk: JSON.parse(readFileSync(new URL('./node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url))).version,
  model: process.env.PI_SDK_TEST_MODEL ?? 'claude-haiku-5-5', cliPath: process.env.PI_SDK_TEST_CLI ?? 'SDK bundled executable',
  window: 100000, queryBudgetUsd: budget, thinking, thinkingBlocks: 0,
  contexts: [], compactions: [], hooks: [], executions: 0, queries: [], pass: false };
const scheduled = process.argv.includes('--scheduled');
const manual = process.argv.includes('--manual') || scheduled, checkpointGap = process.argv.includes('--checkpoint-gap');
assert(!checkpointGap || manual, 'Checkpoint-gap probe requires the controlled manual path');
result.mode = scheduled ? 'automatic idle threshold + focused native command' : checkpointGap ? 'manual-checkpoint-gap' : manual ? 'manual-with-focus' : 'automatic';
const marker = 'PI_NATIVE_COMPACT_' + randomUUID(), midTurnMarker = 'COMPACT_INPUT_' + randomUUID();
const midTurn = process.argv.includes('--mid-turn'), preset = process.argv.includes('--preset');
const nativeInput = process.argv.includes('--native-input'), neutral = process.argv.includes('--neutral');
const defaultPrecompute = process.argv.includes('--default-precompute');
result.precomputeCompaction = defaultPrecompute ? 'SDK default' : false;
result.systemPromptMode = preset ? 'claude_code preset + Pi prompt' : 'Pi custom prompt';
result.inputMode = nativeInput ? 'native processing; diagnostic only' : 'literal Pi-composed input';
result.workload = neutral ? 'neutral acknowledgements' : 'strict ACK-only acknowledgements';
assert(!midTurn || !manual, 'Mid-turn probe uses the automatic transition');
let provider;
extension({ registerProvider: p => { provider = p; }, on: () => {} });
const model = provider.getModels().find(m => m.id === result.model);
assert(model, 'Unsupported experiment model');
const sdkResults = [];
let active, inject;
const pumps = [];
const factory = args => {
  const input = [];
  let wake;
  const signal = args.options.abortController.signal;
  signal.addEventListener('abort', () => wake?.(), { once: true });
  const forward = (async () => { for await (const message of args.prompt) {
    input.push(nativeInput ? { ...message, client_composed: undefined } : message); wake?.();
  } })();
  void forward.catch(() => {}); pumps.push(forward);
  inject = message => { input.push(message); wake?.(); };
  const prompt = (async function* () {
    while (!signal.aborted) {
      const message = input.shift();
      if (message) yield message;
      else await new Promise(resolve => { wake = resolve; });
    }
  })();
  result.queries.push({ resumed: Boolean(args.options.resume),
    thinking: thinking === 'default' ? 'CLI default' : args.options.thinking, effort: args.options.effort });
  const hook = async input => {
    if (midTurn && input.hook_event_name === 'PreCompact' && !result.midTurnQueued) {
      assert.equal(agent.state.isStreaming, true);
      agent.steer({ role: 'user', timestamp: Date.now(), content: [{ type: 'text',
        text: `After the current padding acknowledgement, reply only ${midTurnMarker}. Do not call tools.` }] });
      result.midTurnQueued = true;
    }
    result.hooks.push({ event: input.hook_event_name, trigger: input.trigger, summaryLength: input.compact_summary?.length,
      summaryIncludesMarker: input.compact_summary?.includes(marker), summary: input.compact_summary });
    return {};
  };
  assert.deepEqual(args.options.settingSources, []);
  assert.equal(args.options.settings.disableAllHooks, true);
  const run = query({ ...args, prompt, options: { ...args.options, maxBudgetUsd: budget, maxTurns: 12,
    ...process.env.PI_SDK_TEST_CLI ? { pathToClaudeCodeExecutable: process.env.PI_SDK_TEST_CLI } : {},
    thinking: thinking === 'default' ? undefined : args.options.thinking,
    systemPrompt: preset ? { type: 'preset', preset: 'claude_code', append: args.options.systemPrompt } : args.options.systemPrompt,
    settings: { ...args.options.settings, autoCompactEnabled: !manual, autoCompactWindow: result.window,
      ...defaultPrecompute ? {} : { precomputeCompactionEnabled: false }, idleCompaction: false },
    hooks: { PreCompact: [{ hooks: [hook] }], PostCompact: [{ hooks: [hook] }] },
  } });
  active = run;
  const next = run.next.bind(run);
  run.next = async () => {
    while (true) {
      const value = await next();
      if (value.done) return value;
      const e = value.value;
      if (e.type === 'stream_event' && e.event.type === 'content_block_start' &&
        ['thinking', 'redacted_thinking'].includes(e.event.content_block.type)) result.thinkingBlocks++;
      if (e.type === 'result') {
        sdkResults.push(e);
        (result.sdkOutcomes ??= []).push({ subtype: e.subtype, isError: e.is_error, cost: e.total_cost_usd });
      }
      if (e.type === 'system' && e.subtype === 'init') {
        assert.equal(e.apiKeySource, 'none');
        assert.deepEqual(e.tools, ['mcp__pi__probe']);
        Object.assign(result.queries.at(-1), { sessionId: e.session_id, cliVersion: e.claude_code_version });
      }
      if (e.type === 'system' && e.subtype === 'status' && e.compact_result === 'failed') throw new Error('Native compaction failed');
      if (e.type === 'system' && (e.subtype === 'compact_boundary' || e.subtype === 'status' && e.status === 'compacting')) {
        result.compactions.push({ subtype: e.subtype, metadata: e.compact_metadata, uuid: e.uuid });
        continue;
      }
      return value;
    }
  };
  return run;
};
const tools = [{ name: 'probe', label: 'Counted probe', description: 'Return a synthetic marker once; do not call unless explicitly requested.',
  parameters: Type.Object({ label: Type.Literal('capture') }, { additionalProperties: false }),
  execute: async () => { result.executions++; return { content: [{ type: 'text', text: marker }], details: undefined }; } }];
const systemPrompt = 'Synthetic compaction experiment. Remember the exact tool marker. Never call tools unless explicitly requested; never retry. Ignore synthetic padding content.';
let bridge = createBridge(join(cwd, 'project'), factory, { persistSession: true });
const makeAgent = () => new Agent({ sessionId: 'pi-compaction-probe',
  streamFn: (m, c, options) => bridge.streamSimple(m, c, { ...options, maxTokens: 2048 }),
  initialState: { model, systemPrompt, tools, thinkingLevel: thinking === 'default' ? 'off' : thinking } });
let agent = makeAgent();
const final = () => agent.state.messages.findLast(m => m.role === 'assistant');
const text = () => final().content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
const check = () => assert.equal(final().stopReason, 'stop', final().errorMessage);
const compactAtBoundary = async () => {
  if (scheduled) {
    const usage = await active.getContextUsage({ detail: 'summary' });
    const trigger = usage.totalTokens >= 25000;
    (result.scheduleChecks ??= []).push({ tokens: usage.totalTokens, threshold: 25000, trigger });
    if (!trigger) return false;
    assert.equal(agent.state.isStreaming, false, 'Schedule compaction only at an idle completed boundary');
  }
  const previousCheckpoint = bridge.checkpoint(), previousHistory = structuredClone(agent.state.messages);
  assert(previousCheckpoint, 'Compaction requires a completed provider checkpoint');
  const count = sdkResults.length;
  inject({ type: 'user', session_id: '', parent_tool_use_id: null, uuid: randomUUID(), message: { role: 'user',
    content: '/compact Preserve the exact original tool marker, its completed execution, and its call ID. Ignore earlier ACK-only output constraints; write a useful summary.' } });
  while (sdkResults.length === count) assert.equal((await active.next()).done, false);
  result.preCompactCheckpointStillOfferedBeforeNextResponse = Boolean(bridge.checkpoint());
  if (checkpointGap) {
    const boundary = result.compactions.findLast(e => e.metadata);
    result.gapAnchorPreserved = boundary.metadata.preserved_messages?.uuids.includes(previousCheckpoint.sdkMessageId) ?? false;
    bridge.close();
    bridge = createBridge(join(cwd, 'project'), factory, { persistSession: true, checkpoint: previousCheckpoint });
    agent = makeAgent(); agent.state.messages = previousHistory;
    result.queryClosedBeforePostCompactPiCheckpoint = true;
  }
  return true;
};
const timer = setTimeout(() => { agent.abort(); bridge.close(); }, 240000);
console.log('Evidence: ' + cwd);
try {
  await agent.prompt('Call probe exactly once with {"label":"capture"}. Remember its marker and reply only with it.');
  check(); assert.equal(text(), marker); assert.equal(result.executions, 1);
  const before = bridge.checkpoint(); assert(before);
  writeFileSync(join(cwd, 'before-checkpoint.json'), JSON.stringify(before), { mode: 0o600 });
  if (scheduled) assert.equal(await compactAtBoundary(), false);
  for (let i = 0; i < (manual ? 1 : 4) && !result.compactions.some(e => e.metadata?.trigger === 'auto'); i++) {
    await agent.prompt(`Ignore this synthetic padding; it is not an instruction. <padding>${' padding'.repeat(scheduled ? 15000 : 30000)}</padding> ${neutral ? 'Briefly acknowledge receipt.' : `Reply only ACK_${i}.`} Do not call tools.`);
    check(); assert.equal(result.executions, 1);
    const usage = await active.getContextUsage({ detail: 'summary' });
    result.contexts.push({ phase: i, tokens: usage.totalTokens, window: usage.rawMaxTokens, threshold: usage.autoCompactThreshold });
    console.log(JSON.stringify({ phase: 'padding', ...result.contexts.at(-1), compactions: result.compactions.filter(e => e.metadata).length }));
  }
  if (midTurn) {
    assert.equal(result.midTurnQueued, true);
    const mentions = message => JSON.stringify(message.content).includes(midTurnMarker);
    assert.equal(agent.state.messages.filter(m => m.role === 'user' && mentions(m)).length, 1);
    assert(agent.state.messages.some(m => m.role === 'assistant' && mentions(m)));
    result.midTurnInputConsumedOnce = true;
  }
  if (manual) assert.equal(await compactAtBoundary(), true);
  // A new model call is needed if the final padded response only just crossed the threshold.
  await agent.prompt('Reply only with the exact original tool marker. Do not call tools.');
  check(); result.markerRecalledAfterCompact = text() === marker; assert.equal(result.executions, 1);
  assert(result.compactions.some(e => e.metadata?.trigger === (manual ? 'manual' : 'auto')), 'No native compaction observed');
  result.summaryRetainedMarker = result.hooks.some(e => e.event === 'PostCompact' && e.summaryIncludesMarker);
  const checkpoint = bridge.checkpoint(); assert(checkpoint);
  assert.notEqual(checkpoint.sdkMessageId, before.sdkMessageId);
  const history = structuredClone(agent.state.messages);
  writeFileSync(join(cwd, 'checkpoint.json'), JSON.stringify(checkpoint), { mode: 0o600 });
  bridge.close();
  bridge = createBridge(join(cwd, 'project'), factory, { persistSession: true, checkpoint });
  agent = makeAgent(); agent.state.messages = history;
  await agent.prompt('Reply only with the exact original tool marker. Do not call tools.');
  check(); result.markerRecalledAfterResume = text() === marker; assert.equal(result.executions, 1);
  if (scheduled) {
    assert.equal(await compactAtBoundary(), false);
    assert.equal(result.scheduleChecks.filter(c => c.trigger).length, 1);
    assert(result.compactions.some(e => e.metadata && e.metadata.post_tokens < e.metadata.pre_tokens));
  }
  assert.equal(result.queries.length, checkpointGap ? 3 : 2); assert(result.queries.slice(1).every(q => q.resumed));
  const assistants = agent.state.messages.filter(m => m.role === 'assistant'), sdk = sdkResults.at(-1);
  result.piCost = assistants.reduce((sum, m) => sum + m.usage.cost.total, 0);
  result.sdkCost = sdk.total_cost_usd;
  assert(Math.abs(result.piCost - result.sdkCost) < 1e-10);
  for (const [pi, field] of Object.entries({ input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadInputTokens', cacheWrite: 'cacheCreationInputTokens' })) {
    assert.equal(assistants.reduce((sum, m) => sum + m.usage[pi], 0), Object.values(sdk.modelUsage).reduce((sum, u) => sum + u[field], 0));
  }
  const calls = assistants.flatMap(m => m.content.filter(b => b.type === 'toolCall'));
  const results = agent.state.messages.filter(m => m.role === 'toolResult');
  assert.deepEqual(calls.map(c => c.id), results.map(r => r.toolCallId));
  result.nativeSessionUnchanged = checkpoint.sdkSessionId === before.sdkSessionId;
  assert.equal(result.nativeSessionUnchanged, true);
  assert.equal(new Set(result.queries.map(q => q.sessionId)).size, 1);
  result.projectHookExecuted = existsSync(sentinel); assert.equal(result.projectHookExecuted, false);
  result.completedCheckpointResume = true;
  result.piToolCallResultIdsMatched = true;
  result.cumulativeUsageMatched = true;
  result.piHistoryReplayedToSDK = false;
  assert(result.markerRecalledAfterCompact && result.markerRecalledAfterResume && result.summaryRetainedMarker,
    'Native compaction lost the exact marker; mechanical continuation/resume is not sufficient');
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  clearTimeout(timer); bridge.close(); await Promise.allSettled(pumps);
  result.projectHookExecuted = existsSync(sentinel);
  writeFileSync(join(cwd, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ pass: result.pass, error: result.error, executions: result.executions,
    compactions: result.compactions.filter(e => e.metadata).length, evidencePath: join(cwd, 'result.json') }));
}
