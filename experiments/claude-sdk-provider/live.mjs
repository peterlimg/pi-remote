// Opt-in subscription-backed integration checks. All tool work is synthetic and in memory.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { createBridge } from './bridge.ts';

const cwd = mkdtempSync(join(tmpdir(), 'pi-sdk-provider-live-'));
const rows = [];
const model = { ...anthropicProvider().getModels().find(m => m.id === 'claude-haiku-5-5'),
  provider: 'claude-sdk', api: 'claude-sdk', reasoning: false, input: ['text'] };
const prompt = 'Remember marker MARKER. Call probe exactly TWICE in the SAME assistant message, in parallel, both with {"label":"test"}. Never retry. Then reply with both tool tokens, one per line, or DENIED if Pi denies both calls.';
for (const scenario of process.argv.slice(2).length ? process.argv.slice(2) : ['allow', 'deny', 'abort']) {
  const row = { scenario, preflights: 0, executions: 0, events: [], sdkOrder: [], costs: [], tokens: [] };
  const marker = `MEMORY_${randomUUID()}`;
  const bridge = createBridge(cwd, args => query({ ...args, options: { ...args.options, maxTurns: 8, maxBudgetUsd: 0.2 } }));
  row.sdkToolResults = [];
  let abortAt;
  const agent = new Agent({
    sessionId: randomUUID(), toolExecution: 'parallel',
    initialState: { model, thinkingLevel: 'off',
      systemPrompt: 'Synthetic protocol test. Follow the exact requested parallel tool schedule. Tool errors must not be retried. Remember markers for subsequent user turns.',
      tools: [{ name: 'probe', label: 'Probe', description: 'Return a distinct synthetic token.',
        parameters: Type.Object({ label: Type.String() }, { additionalProperties: false }),
        execute: async (id, args, signal) => {
          row.executions++;
          assert.deepEqual(args, { label: 'test' });
          if (scenario === 'abort') {
            setTimeout(() => { abortAt ??= Date.now(); agent.abort(); }, 50);
            await delay(30000, undefined, { signal });
          }
          const token = `TOKEN_${randomUUID()}`;
          row.tokens.push({ id, token });
          return { content: [{ type: 'text', text: token }], details: undefined };
        } }],
    },
    beforeToolCall: async () => {
      row.preflights++;
      if (scenario === 'deny') return { block: true, reason: 'Denied by Pi test policy.' };
    },
    streamFn: bridge.streamSimple,
    onProviderStreamEvent: async event => {
      row.sdkOrder.push(event.type === 'stream_event' ? `${event.event.type}${event.event.type === 'content_block_start' ? ':' + event.event.content_block.type : ''}` : event.type);
      if (event.type === 'user' && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result') row.sdkToolResults.push({ id: block.tool_use_id,
            text: typeof block.content === 'string' ? block.content : block.content.map(b => b.text ?? '').join(''), isError: block.is_error ?? false });
        }
      }
      if (event.type === 'result') {
        row.costs.push(event.total_cost_usd);
        row.sdkTotals = Object.values(event.modelUsage).reduce((a, u) => ({
          input: a.input + u.inputTokens, output: a.output + u.outputTokens,
          cacheRead: a.cacheRead + u.cacheReadInputTokens, cacheWrite: a.cacheWrite + u.cacheCreationInputTokens,
        }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      }
    },
  });
  agent.subscribe(event => row.events.push(event.type));
  const timer = setTimeout(() => agent.abort(), 60000);
  try {
    await agent.prompt(prompt.replace('MARKER', marker));
    const final = agent.state.messages.findLast(message => message.role === 'assistant');
    assert.equal(row.preflights, 2, final?.errorMessage);
    assert.equal(row.executions, scenario === 'deny' ? 0 : 2);
    if (scenario === 'abort') {
      assert(abortAt);
      row.abortSettleMs = Date.now() - abortAt;
      assert(row.abortSettleMs < 5000);
      assert.equal(final.stopReason, 'aborted');
      assert.deepEqual(final.content, []);
    } else {
      assert.equal(final.stopReason, 'stop', final.errorMessage);
      const text = final.content.map(block => block.text ?? '').join('');
      if (scenario === 'allow') for (const { token } of row.tokens) assert(text.includes(token));
      else assert.match(text.trim(), /^DENIED(?:\s+DENIED)*$/);
      const results = agent.state.messages.filter(message => message.role === 'toolResult');
      assert.equal(results.length, 2);
      assert(results.every(result => result.isError === (scenario === 'deny')));
      assert.equal(row.sdkToolResults.length, 2);
      for (const sdkResult of row.sdkToolResults) {
        const piResult = results.find(r => r.toolCallId === sdkResult.id);
        assert(piResult);
        assert.equal(sdkResult.text, piResult.content.map(b => b.text ?? '').join(''));
        assert.equal(sdkResult.isError, piResult.isError);
      }
      if (scenario === 'allow') {
        await agent.prompt('Reply only with the exact remembered marker from the preceding user message. Do not call tools.');
        const recalled = agent.state.messages.findLast(message => message.role === 'assistant');
        assert.equal(recalled.stopReason, 'stop', recalled.errorMessage);
        assert.equal(recalled.content.map(block => block.text ?? '').join('').trim(), marker);
        assert.equal(row.executions, 2);
      }
      const assistants = agent.state.messages.filter(message => message.role === 'assistant');
      row.piTotals = assistants.reduce((a, m) => ({
        input: a.input + m.usage.input, output: a.output + m.usage.output,
        cacheRead: a.cacheRead + m.usage.cacheRead, cacheWrite: a.cacheWrite + m.usage.cacheWrite,
      }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      assert.deepEqual(row.piTotals, row.sdkTotals, 'Pi token accounting must equal cumulative SDK pipeline usage');
      row.piCost = assistants.reduce((sum, m) => sum + m.usage.cost.total, 0);
      assert(Math.abs(row.piCost - row.costs.at(-1)) < 1e-10, 'Pi must not double-count cumulative SDK cost');
      assert(row.events.includes('message_update'), 'Expected real streaming updates');
    }
    row.pass = true;
  } catch (error) {
    row.pass = false;
    row.error = error.message;
    throw error;
  } finally {
    bridge.close(); clearTimeout(timer);
    row.messages = agent.state.messages.filter(message => message.role !== 'system');
    rows.push(row);
    writeFileSync(join(cwd, 'evidence.json'), JSON.stringify(rows, null, 2));
    console.log(JSON.stringify({ ...row, evidencePath: join(cwd, 'evidence.json') }, null, 2));
  }
}
