// Throwaway SDK contract experiment. Only synthetic prompts and an in-memory tool.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// Do not inherit a parent Claude session's routing, messaging, or nesting state.
for (const key of Object.keys(process.env)) {
  if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_')) delete process.env[key];
}
const cwd = new URL('./sandbox/', import.meta.url).pathname;
mkdirSync(cwd, { recursive: true });
const base = {
  cwd, model: 'haiku', tools: [], settingSources: [], strictMcpConfig: true,
  settings: { disableAllHooks: true, autoMemoryEnabled: false },
  persistSession: false, includePartialMessages: true, maxTurns: 3, maxBudgetUsd: 0.15,
  thinking: { type: 'disabled' },
  env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '256' },
  systemPrompt: 'You are testing a client protocol with synthetic data. Follow the request precisely. Be brief. Never call a tool more than once.',
  canUseTool: async () => ({ behavior: 'deny', message: 'Only the explicitly approved experiment tool is allowed.' }),
};
const results = [];
async function run(name, prompt, options = {}) {
  const abortController = options.abortController ?? new AbortController();
  const timer = setTimeout(() => abortController.abort(), 60000);
  const row = { name, events: {}, deltas: 0, toolCalls: [], toolResults: 0, text: '' };
  const started = Date.now();
  const q = query({ prompt, options: { ...base, ...options, abortController } });
  try {
    for await (const message of q) {
      row.events[message.type] = (row.events[message.type] ?? 0) + 1;
      if (message.type === 'system' && message.subtype === 'init') {
        row.sessionId = message.session_id;
        row.model = message.model;
        row.apiKeySource = message.apiKeySource;
        row.tools = message.tools;
        assert((message.tools ?? []).every(name => name === 'mcp__probe__probe'), 'Unexpected tool was exposed');
      }
      if (message.type === 'stream_event' && message.event.type === 'content_block_delta') row.deltas++;
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') row.text += block.text;
          if (block.type === 'tool_use') row.toolCalls.push({ name: block.name, id: block.id, input: block.input });
        }
      }
      if (message.type === 'user') row.toolResults += (message.message.content ?? []).filter?.(b => b.type === 'tool_result').length ?? 0;
      if (message.type === 'result') {
        row.result = message.subtype;
        row.resultText = message.result;
        row.turns = message.num_turns;
        row.estimatedCostUsd = message.total_cost_usd;
        row.usage = message.usage;
        row.errors = message.errors;
        row.sessionId = message.session_id;
      }
    }
  } catch (error) {
    row.error = { name: error.name, message: error.message };
  } finally {
    q.close(); clearTimeout(timer); row.durationMs = Date.now() - started;
    results.push(row);
    writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(row));
  }
  return row;
}
function probe(handler) {
  return {
    mcpServers: { probe: createSdkMcpServer({ name: 'probe', alwaysLoad: true, tools: [
      tool('probe', 'Return a synthetic opaque token. Call exactly once.', { label: z.string() }, handler,
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }),
    ] }) },
    allowedTools: ['mcp__probe__probe'],
  };
}
const marker = `MEMORY_${randomUUID()}`;
const smoke = await run('text-and-stream', `Remember this synthetic marker: ${marker}. Reply exactly ACK.`, { persistSession: true });
assert.equal(smoke.result, 'success');
assert.equal(smoke.text.trim(), 'ACK');
assert(smoke.deltas > 0);
const resume = await run('resume', 'Return only the exact synthetic marker I asked you to remember.', { resume: smoke.sessionId, persistSession: true });
assert.equal(resume.result, 'success');
assert.equal(resume.text.trim(), marker);

const prompt = 'Call mcp__probe__probe exactly once with label "test". Then reply with only its returned token.';
for (const maxTurns of [3, 1]) {
  let executions = 0;
  const token = `TOOL_${randomUUID()}`;
  const row = await run(`tool-maxTurns-${maxTurns}`, prompt, {
    maxTurns, ...probe(async () => {
      executions++;
      return { content: [{ type: 'text', text: token }] };
    }),
  });
  row.executions = executions;
  assert.equal(executions, 1);
  assert.equal(row.toolCalls.length, 1);
  if (maxTurns === 3) {
    assert.equal(row.result, 'success');
    assert.equal(row.text.trim(), token);
  } else {
    assert.equal(row.result, 'error_max_turns');
  }
}
const abortController = new AbortController();
let entered = false, cancelled = false, abortAt;
const abort = await run('abort-during-tool', prompt, {
  abortController, ...probe(async () => {
    entered = true;
    setTimeout(() => { abortAt = Date.now(); abortController.abort(); }, 50);
    try { await delay(30000, undefined, { signal: abortController.signal }); }
    catch (error) { if (error.name !== 'AbortError') throw error; cancelled = true; }
    return { content: [{ type: 'text', text: 'cancelled' }], isError: true };
  }),
});
assert(entered && cancelled);
// Observed SDK 0.3.296 throws ordinary Error, sometimes after a success result.
assert.match(abort.error?.message ?? '', /abort/i);
assert(Date.now() - abortAt < 5000);
abort.toolCancellation = 'cooperative handler observed the shared abort signal';
abort.finalResultBeforeAbortError = abort.result ?? null;
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2));
console.log('PASS: authentication, streaming, SDK resume, MCP round trip, maxTurns semantics, cooperative abort');
