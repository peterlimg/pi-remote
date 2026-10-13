// Throwaway single-tool bridge. Not a production provider: no history replay or model switching.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Agent } from '@earendil-works/pi-agent-core';
import { AssistantMessageEventStream, getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

for (const key of Object.keys(process.env)) {
  if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_')) delete process.env[key];
}
const cwd = new URL('./sandbox/', import.meta.url).pathname;
mkdirSync(cwd, { recursive: true });
const results = [];
const model = {
  id: 'claude-haiku-5-5', name: 'SDK probe', provider: 'sdk-experiment', api: 'sdk-experiment',
  baseUrl: '', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 256,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
for (const scenario of process.argv.slice(2).length ? process.argv.slice(2) : ['allow', 'deny', 'abort']) {
  const stats = { scenario, providerCalls: 0, sdkHandlers: 0, piExecutions: 0, piPreflights: 0, sdkReadsAfterAbort: 0, piEvents: [], sdkEvents: [] };
  const token = `PI_TOOL_${randomUUID()}`;
  const handlerStarted = Promise.withResolvers();
  const toolResult = Promise.withResolvers();
  const sdkAbort = new AbortController();
  let q, handedCall, abortAt;
  const started = Date.now();
  const server = createSdkMcpServer({ name: 'probe', alwaysLoad: true, tools: [
    tool('probe', 'Return an opaque test token. Call exactly once.', { label: z.string() }, async args => {
      stats.sdkHandlers++;
      handlerStarted.resolve(args);
      // No actual work here: Pi's normal tool loop must execute and authorize it.
      return toolResult.promise;
    }, { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }),
  ] });
  const close = () => {
    toolResult.resolve({ content: [{ type: 'text', text: 'aborted' }], isError: true });
    q?.close(); sdkAbort.abort();
  };
  const timer = setTimeout(close, 60000);
  const agent = new Agent({
    initialState: {
      model, thinkingLevel: 'off',
      systemPrompt: 'Protocol test. Use probe exactly once when requested. Reply only with its token, or DENIED if the tool is denied. Never retry a tool.',
      tools: [{
        name: 'probe', label: 'Probe', description: 'Return an opaque test token.',
        parameters: Type.Object({ label: Type.String() }),
        execute: async (_id, args, signal) => {
          stats.piExecutions++;
          assert.deepEqual(args, { label: 'test' });
          if (scenario === 'abort') {
            setTimeout(() => { abortAt = Date.now(); agent.abort(); }, 50);
            await delay(30000, undefined, { signal });
          }
          return { content: [{ type: 'text', text: token }], details: undefined };
        },
      }],
    },
    beforeToolCall: () => {
      stats.piPreflights++;
      if (scenario === 'deny') return { block: true, reason: 'Denied by Pi test policy.' };
    },
    streamFn: (_model, context, options) => {
      stats.providerCalls++;
      const stream = new AssistantMessageEventStream();
      const message = {
        role: 'assistant', provider: model.provider, api: model.api, model: model.id,
        timestamp: Date.now(), content: [], stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        try {
          options.signal.throwIfAborted();
          if (!q) {
            options.signal.addEventListener('abort', close, { once: true });
            const user = context.messages.findLast(m => m.role === 'user');
            const prompt = typeof user.content === 'string' ? user.content : user.content.map(c => c.text ?? '').join('');
            q = query({ prompt, options: {
              cwd, model: 'haiku', tools: [], settingSources: [], strictMcpConfig: true,
              settings: { disableAllHooks: true, autoMemoryEnabled: false },
              persistSession: false, maxTurns: 3, maxBudgetUsd: 0.15,
              thinking: { type: 'disabled' }, abortController: sdkAbort,
              systemPrompt: getCurrentSystemPrompt(context.messages),
              env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '256' },
              mcpServers: { probe: server },
              canUseTool: async name => name === 'mcp__probe__probe'
                ? { behavior: 'allow' }
                : { behavior: 'deny', message: 'Only the probe bridge is allowed.' },
            } });
          } else {
            assert.equal(stats.providerCalls, 2, 'Prototype accepts one tool round trip only');
            const result = context.messages.findLast(m => m.role === 'toolResult');
            assert.equal(result.toolCallId, handedCall.id);
            assert.deepEqual(await handlerStarted.promise, handedCall.input);
            stats.returnedToolError = result.isError;
            toolResult.resolve({ content: result.content, isError: result.isError });
          }
          stream.push({ type: 'start', partial: message });
          while (true) {
            if (options.signal.aborted) stats.sdkReadsAfterAbort++;
            const next = await q.next();
            assert(!next.done, 'SDK ended without completing the provider turn');
            const event = next.value;
            stats.sdkEvents.push(event.type);
            if (event.type === 'system' && event.subtype === 'init') {
              assert.deepEqual(event.tools, ['mcp__probe__probe']);
            }
            if (event.type === 'assistant') {
              for (const block of event.message.content) {
                const index = message.content.length;
                if (block.type === 'text') {
                  message.content.push({ type: 'text', text: '' });
                  stream.push({ type: 'text_start', contentIndex: index, partial: message });
                  message.content[index].text = block.text;
                  stream.push({ type: 'text_delta', contentIndex: index, delta: block.text, partial: message });
                  stream.push({ type: 'text_end', contentIndex: index, content: block.text, partial: message });
                }
                if (block.type === 'tool_use') {
                  assert.equal(block.name, 'mcp__probe__probe');
                  assert(!handedCall, 'Prototype accepts one tool call only');
                  handedCall = block;
                  const call = { type: 'toolCall', id: block.id, name: 'probe', arguments: block.input };
                  message.content.push(call);
                  stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
                  stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: call, partial: message });
                  message.stopReason = 'toolUse';
                }
              }
              if (message.stopReason === 'toolUse') {
                stream.push({ type: 'done', reason: 'toolUse', message });
                stream.end(); return;
              }
            }
            if (event.type === 'result') {
              assert.equal(event.subtype, 'success');
              stats.estimatedCostUsd = event.total_cost_usd;
              stream.push({ type: 'done', reason: 'stop', message });
              stream.end(); return;
            }
          }
        } catch (error) {
          message.stopReason = options.signal.aborted ? 'aborted' : 'error';
          message.errorMessage = error.message;
          stream.push({ type: 'error', reason: message.stopReason, error: message });
          stream.end();
        }
      })();
      return stream;
    },
  });
  agent.subscribe(event => stats.piEvents.push(event.type));
  try {
    await agent.prompt('Call probe exactly once with label "test". Then reply with only its returned token, or DENIED if denied.');
    stats.messages = agent.state.messages.filter(m => m.role !== 'system');
    stats.durationMs = Date.now() - started;
    assert.equal(stats.sdkHandlers, 1);
    assert.equal(stats.piPreflights, 1);
    assert.equal(stats.piExecutions, scenario === 'deny' ? 0 : 1);
    assert.equal(stats.piEvents.filter(e => e === 'tool_execution_start').length, 1);
    if (scenario === 'abort') {
      assert(abortAt && Date.now() - abortAt < 5000);
      assert.equal(stats.sdkReadsAfterAbort, 0);
      const final = agent.state.messages.findLast(m => m.role === 'assistant');
      assert.equal(final.stopReason, 'aborted');
      assert.deepEqual(final.content, []);
      stats.abortSettleMs = Date.now() - abortAt;
    } else {
      assert.equal(stats.providerCalls, 2);
      const final = agent.state.messages.findLast(m => m.role === 'assistant');
      assert.equal(final.stopReason, 'stop', final.errorMessage);
      assert.equal(final.content.map(c => c.text ?? '').join('').trim(), scenario === 'deny' ? 'DENIED' : token);
      assert.equal(stats.returnedToolError, scenario === 'deny');
    }
    stats.pass = true;
  } finally {
    close(); clearTimeout(timer);
    results.push(stats);
    writeFileSync(new URL(process.argv.length > 2 ? './pi-handoff-targeted-results.json' : './pi-handoff-results.json', import.meta.url), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(stats));
  }
}
console.log(`PASS: ${results.map(r => r.scenario).join(', ')}`);
