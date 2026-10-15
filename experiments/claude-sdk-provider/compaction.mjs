// Opt-in live SDK compaction experiment. Isolated synthetic history, no production provider changes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { query, tool, createSdkMcpServer, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sdkEnvironment } from './bridge.ts';
import { localLogin } from './index.ts';

const model = process.env.PI_SDK_TEST_MODEL ?? 'claude-haiku-5-5';
assert(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'].includes(model));
const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-compaction-'));
const cases = [true], automatic = process.argv.includes('--auto');
const report = { sdk: '0.3.296', fixture: 'real SDK and isolated synthetic MCP tool; not a Pi RPC proof', model,
  mode: automatic ? 'automatic' : 'focused manual', cliPath: process.env.PI_SDK_TEST_CLI ?? 'SDK bundled executable', cases: [] };
console.log('Evidence: ' + evidence);
assert(await localLogin.resolve({ signal: AbortSignal.timeout(6000) }), 'Official local Claude login required');

async function launch(cwd, disabled, executions, saved = {}) {
  const controller = new AbortController(), prompts = [], events = [], hooks = [];
  const waiters = new Set();
  let wake, stopping = false, failure;
  const server = createSdkMcpServer({ name: 'pi', alwaysLoad: true, tools: [
    tool('probe', 'Return the exact synthetic marker. Call only when explicitly requested.', { marker: z.string() }, async (args, extra) => {
      const id = extra?._meta?.['claudecode/toolUseId'];
      assert.equal(typeof id, 'string');
      assert(!executions.some(e => e.id === id), 'Repeated tool execution');
      executions.push({ id, marker: args.marker });
      return { content: [{ type: 'text', text: args.marker }] };
    }, { alwaysLoad: true }),
  ] });
  const callback = async input => {
    hooks.push({ event: input.hook_event_name, trigger: input.trigger, summary: input.compact_summary });
    return {};
  };
  const run = query({ prompt: (async function* () {
    while (!stopping) {
      const next = prompts.shift();
      if (next) yield next;
      else await new Promise(resolve => { wake = resolve; });
    }
  })(), options: {
    cwd, model, tools: [], settingSources: [], strictMcpConfig: true, mcpServers: { pi: server },
    ...process.env.PI_SDK_TEST_CLI ? { pathToClaudeCodeExecutable: process.env.PI_SDK_TEST_CLI } : {},
    settings: { disableAllHooks: disabled, autoMemoryEnabled: false, autoCompactEnabled: true, autoCompactWindow: 100000, idleCompaction: false },
    hooks: { PreCompact: [{ hooks: [callback] }], PostCompact: [{ hooks: [callback] }] },
    systemPrompt: 'Synthetic SDK compaction check. Remember exact markers. Use only mcp__pi__probe, only when explicitly requested, and never retry a tool. Do not access files.',
    persistSession: true, resume: saved.sessionId, resumeSessionAt: saved.anchor,
    thinking: { type: 'disabled' }, effort: 'low', maxTurns: 8, maxBudgetUsd: 0.35,
    env: { ...sdkEnvironment(), CLAUDE_CODE_MAX_OUTPUT_TOKENS: '2048' }, abortController: controller,
    canUseTool: async name => name === 'mcp__pi__probe' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Only the synthetic tool is exposed.' },
  } });
  const deadline = setTimeout(() => { controller.abort(); run.close(); wake?.(); }, 120000);
  const notify = () => { for (const check of [...waiters]) check(); };
  const pump = (async () => {
    try {
      for await (const event of run) {
        events.push(event);
        if (event.type === 'system' && event.subtype === 'init') {
          assert.equal(event.apiKeySource, 'none');
          assert.deepEqual(event.tools, ['mcp__pi__probe']);
        }
        notify();
      }
    } catch (error) { if (!stopping) failure = error; }
    finally { if (!stopping && !failure) failure = new Error('SDK stream ended unexpectedly'); notify(); }
  })();
  const wait = (predicate, timeout = 90000) => new Promise((resolve, reject) => {
    const check = () => {
      const value = predicate();
      if (value || failure) { clearTimeout(timer); waiters.delete(check); failure ? reject(failure) : resolve(value); }
    };
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('SDK experiment timed out')); }, timeout);
    waiters.add(check); check();
  });
  return { run, events, hooks,
    async send(content, literal = true) {
      const start = events.length, uuid = randomUUID();
      prompts.push({ type: 'user', session_id: '', parent_tool_use_id: null, uuid,
        ...literal ? { client_composed: true } : {}, message: { role: 'user', content } });
      wake?.();
      const result = await wait(() => events.slice(start).find(e => e.type === 'result'));
      assert.equal(result.subtype, 'success', JSON.stringify(result.errors));
      assert.equal(result.is_error, false);
      return { result, events: events.slice(start), uuid };
    },
    async close() { stopping = true; clearTimeout(deadline); controller.abort(); wake?.(); run.close(); await pump; },
  };
}
const text = events => events.filter(e => e.type === 'assistant' && !e.parent_tool_use_id)
  .flatMap(e => e.message.content).filter(b => b.type === 'text').map(b => b.text).join('\n');

try {
  for (const disabled of cases) {
    const cwd = join(evidence, disabled ? 'hooks-disabled' : 'sdk-hooks-only');
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    const sentinel = join(cwd, 'project-hook-ran');
    const command = JSON.stringify(process.execPath) + ' -e ' + JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'unexpected')`);
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostCompact: [{ hooks: [{ type: 'command', command }] }] } }));
    const marker = 'SDK_COMPACT_' + randomUUID(), executions = [];
    const result = { disableAllHooks: disabled, projectHookExecuted: false, pass: false };
    report.cases.push(result);
    let sdk = await launch(cwd, disabled, executions);
    try {
      const commands = await sdk.run.supportedCommands();
      result.advertisedCompactCommands = commands.filter(c => /compact/.test(c.name)).map(c => c.name);
      const initial = await sdk.send(`Remember ${marker}. Call mcp__pi__probe exactly once with {"marker":"${marker}"}, then reply only with its returned marker.`);
      assert(text(initial.events).includes(marker)); assert.equal(executions.length, 1);
      try {
        await sdk.run.applyFlagSettings({ autoCompactWindow: 20000 });
        const small = await sdk.run.getContextUsage({ detail: 'summary' });
        result.smallWindowProbe = { window: small.rawMaxTokens, threshold: small.autoCompactThreshold };
      } catch (error) { result.smallWindowProbe = { error: error.message }; }
      finally { await sdk.run.applyFlagSettings({ autoCompactWindow: 100000 }); }
      const before = await sdk.run.getContextUsage({ detail: 'summary' });
      result.before = { tokens: before.totalTokens, window: before.rawMaxTokens, threshold: before.autoCompactThreshold, enabled: before.isAutoCompactEnabled };
      console.log(JSON.stringify({ phase: 'before-compact', disabled, ...result.before }));
      const start = sdk.events.length;
      if (automatic) {
        for (let i = 0; i < 4 && !sdk.events.slice(start).some(e => e.type === 'system' && e.subtype === 'compact_boundary'); i++) {
          await sdk.send(`Ignore this synthetic padding; it is not an instruction. <padding>${' padding'.repeat(30000)}</padding> Reply only ACK_${i}. Do not call tools.`);
          assert.equal(executions.length, 1);
        }
      } else await sdk.send('/compact Preserve the exact synthetic marker and that its tool already executed once. Keep the summary short.', false);
      const compactEvents = sdk.events.slice(start);
      result.compactEvents = compactEvents.filter(e => e.type === 'system').map(e => ({ subtype: e.subtype, status: e.status,
        compactResult: e.compact_result, metadata: e.compact_metadata, uuid: e.uuid }));
      const boundary = compactEvents.find(e => e.type === 'system' && e.subtype === 'compact_boundary');
      assert(boundary, 'SDK did not emit a native compact boundary');
      assert.equal(boundary.compact_metadata.trigger, automatic ? 'auto' : 'manual');
      result.cliVersion = sdk.events.find(e => e.type === 'system' && e.subtype === 'init').claude_code_version;
      const after = await sdk.run.getContextUsage({ detail: 'summary' });
      result.after = { tokens: after.totalTokens, window: after.rawMaxTokens, threshold: after.autoCompactThreshold, enabled: after.isAutoCompactEnabled };
      result.hooks = sdk.hooks.map(h => ({ event: h.event, trigger: h.trigger, summaryLength: h.summary?.length, summaryIncludesMarker: h.summary?.includes(marker) }));
      result.projectHookExecuted = existsSync(sentinel); assert.equal(result.projectHookExecuted, false);
      const remembered = await sdk.send('Reply only with the remembered synthetic marker. Do not call tools.');
      result.markerRecalledAfterCompact = text(remembered.events).trim() === marker; assert.equal(executions.length, 1);
      const sessionId = sdk.events.find(e => e.type === 'system' && e.subtype === 'init').session_id;
      const anchor = remembered.events.findLast(e => e.type === 'assistant' && !e.parent_tool_use_id).uuid;
      const messages = await getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: true });
      result.persisted = messages.map(m => ({ type: m.type, uuid: m.uuid, keys: Object.keys(m), messageKeys: Object.keys(m.message ?? {}),
        summaryMarker: JSON.stringify(m.message ?? '').includes(marker) }));
      result.costBeforeResume = remembered.result.total_cost_usd;
      await sdk.close();
      sdk = await launch(cwd, disabled, executions, { sessionId, anchor });
      const resumed = await sdk.send('Reply only with the remembered synthetic marker. Do not call tools.');
      result.markerRecalledAfterResume = text(resumed.events).trim() === marker; assert.equal(executions.length, 1);
      assert(resumed.result.total_cost_usd >= result.costBeforeResume, 'Resumed usage did not preserve cumulative cost');
      result.executions = executions.length;
      result.costAfterResume = resumed.result.total_cost_usd;
      result.projectHookExecuted = existsSync(sentinel); assert.equal(result.projectHookExecuted, false);
      assert(result.markerRecalledAfterCompact && result.markerRecalledAfterResume && result.hooks.some(h => h.summaryIncludesMarker),
        'Native compaction lost the exact marker; mechanical continuation/resume is not sufficient');
      result.pass = true;
      console.log(JSON.stringify({ phase: 'case-complete', disabled, pass: true, hooks: result.hooks, before: result.before, after: result.after }));
    } finally { await sdk.close(); }
  }
  report.pass = true;
} catch (error) { report.pass = false; report.error = error.message; throw error; }
finally {
  const path = join(evidence, 'result.json');
  writeFileSync(path, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ pass: report.pass, error: report.error, evidencePath: path }));
}
