// Live, synthetic test. No SDK built-in tools, hooks, project settings, or file mutations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const cwd = mkdtempSync(join(tmpdir(), 'pi-sdk-correlation-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  key !== 'CLAUDECODE' && !key.startsWith('CLAUDE_') && !key.startsWith('ANTHROPIC_')));
const controller = new AbortController();
const pending = new Map();
const tokens = new Map();
const toolUses = [];
const toolResults = [];
const evidence = { sdkVersion: '0.3.296', cliVersion: '2.1.296', overlap: 0, handlerIds: [], toolUses, toolResults };
let run;
const stop = () => {
  controller.abort();
  for (const task of pending.values()) task.resolve({ content: [{ type: 'text', text: 'Cancelled' }], isError: true });
  pending.clear();
  run?.close();
};
const server = createSdkMcpServer({ name: 'pi', alwaysLoad: true, tools: [
  tool('probe', 'Return a distinct synthetic token. Call twice together with identical input.', { label: z.string() }, async (args, extra) => {
    assert.deepEqual(args, { label: 'test' });
    const id = extra?._meta?.['claudecode/toolUseId'];
    assert.equal(typeof id, 'string', 'Missing SDK tool-use-ID metadata');
    assert(id.length > 0);
    assert(!tokens.has(id), 'Duplicate handler invocation for the same ID');
    const task = Promise.withResolvers();
    pending.set(id, task);
    tokens.set(id, `TOKEN_${randomUUID()}`);
    evidence.handlerIds.push(id);
    evidence.overlap = Math.max(evidence.overlap, pending.size);
    if (pending.size === 2) {
      // Return in reverse order to catch correlation based on arrival order.
      for (const [callId, waiting] of [...pending].reverse()) {
        pending.delete(callId);
        waiting.resolve({ content: [{ type: 'text', text: tokens.get(callId) }] });
      }
    }
    return task.promise;
  }, { alwaysLoad: true, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }),
] });
const timer = setTimeout(stop, 60000);
try {
  run = query({
    prompt: 'Call mcp__pi__probe exactly twice in the SAME assistant message, in parallel, both with {"label":"test"}. Both results are needed. Do not call sequentially or retry. Then reply with both returned tokens, one per line.',
    options: {
      cwd, model: 'haiku', tools: [], settingSources: [], strictMcpConfig: true,
      settings: { disableAllHooks: true, autoMemoryEnabled: false },
      persistSession: false, maxTurns: 3, maxBudgetUsd: 0.2,
      thinking: { type: 'disabled' }, abortController: controller,
      includePartialMessages: true, mcpServers: { pi: server },
      systemPrompt: 'Synthetic protocol test. Follow the specified parallel tool-call schedule exactly.',
      env: { ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '512' },
      canUseTool: async name => name === 'mcp__pi__probe'
        ? { behavior: 'allow' } : { behavior: 'deny', message: 'Only the test tool is exposed.' },
    },
  });
  for await (const event of run) {
    if (event.type === 'system' && event.subtype === 'init') {
      assert.deepEqual(event.tools, ['mcp__pi__probe']);
      evidence.model = event.model;
      evidence.apiKeySource = event.apiKeySource;
    }
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') toolUses.push({ id: block.id, input: block.input });
        if (block.type === 'text') evidence.text = (evidence.text ?? '') + block.text;
      }
    }
    if (event.type === 'user' && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (block.type === 'tool_result') toolResults.push({ id: block.tool_use_id, content: block.content, isError: block.is_error ?? false });
      }
    }
    if (event.type === 'result') {
      evidence.result = event.subtype;
      evidence.usage = event.usage;
      evidence.estimatedCostUsd = event.total_cost_usd;
    }
  }
  assert.equal(evidence.result, 'success');
  assert.equal(evidence.overlap, 2, 'Model did not issue overlapping identical calls');
  assert.equal(toolUses.length, 2);
  assert.equal(toolResults.length, 2);
  assert.deepEqual(toolUses.map(t => t.id).sort(), [...tokens.keys()].sort());
  for (const result of toolResults) {
    assert.equal(result.isError, false);
    const text = typeof result.content === 'string' ? result.content : result.content.map(b => b.text ?? '').join('');
    assert.equal(text, tokens.get(result.id), 'SDK attached a result to the wrong tool ID');
    assert(evidence.text.includes(text), 'Final assistant omitted the returned token');
  }
  evidence.pass = true;
} catch (error) {
  evidence.pass = false;
  evidence.error = error.message;
  throw error;
} finally {
  stop();
  clearTimeout(timer);
  const path = join(cwd, 'evidence.json');
  writeFileSync(path, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, evidencePath: path }, null, 2));
}
