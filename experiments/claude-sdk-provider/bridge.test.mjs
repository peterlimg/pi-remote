import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@earendil-works/pi-agent-core';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { createModels } from '@earendil-works/pi-ai';
import { discoverAndLoadExtensions } from './node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Type } from 'typebox';
import { createBridge, sdkEnvironment } from './bridge.ts';
import extension from './index.ts';

const model = { ...anthropicProvider().getModels().find(m => m.id === 'claude-haiku-5-5'), provider: 'claude-sdk', api: 'claude-sdk', reasoning: false };
const parameters = Type.Object({ label: Type.String(), choice: Type.Optional(Type.Union([Type.Literal('a'), Type.Literal('b')])) }, { additionalProperties: false });
const declaration = { name: 'probe', description: 'Test tool', parameters };
const user = { role: 'user', content: 'test', timestamp: 1 };
const context = messages => ({ messages: [{ role: 'system', content: 'test', toolsAdded: [declaration], timestamp: 1 }, ...messages] });
const options = { sessionId: 'unit-session', timeoutMs: 3000 };
const fixtureUsage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 };
const wrap = event => ({ type: 'stream_event', parent_tool_use_id: null, event });
function* assistant(blocks, stopReason = 'end_turn', malformed = false, modelId = model.id) {
  yield wrap({ type: 'message_start', message: { id: 'msg-test', model: modelId, usage: fixtureUsage } });
  for (const [index, block] of blocks.entries()) {
    yield wrap({ type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' }
      : block.type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { ...block, input: {} } });
    if (block.type === 'thinking') {
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else if (block.type === 'text') {
      for (const text of [block.text.slice(0, 1), block.text.slice(1)]) yield wrap({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
    } else {
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: malformed ? '{' : JSON.stringify(block.input) } });
    }
    yield wrap({ type: 'content_block_stop', index });
  }
  yield wrap({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 20 } });
  yield wrap({ type: 'message_stop' });
}
function result(turn = 1, modelId = model.id) {
  return { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', total_cost_usd: turn * 0.004,
    modelUsage: { [modelId]: { inputTokens: turn * 30, outputTokens: turn * 40, cacheReadInputTokens: turn * 9, cacheCreationInputTokens: turn * 4 } } };
}
function fakeQuery(plan = {}) {
  const stats = { queries: 0, reads: 0, closes: 0, results: [] };
  const factory = args => {
    stats.queries++;
    stats.options = args.options;
    const client = new Client({ name: 'sdk-fixture', version: '1' });
    const stream = (async function* () {
      const [left, right] = InMemoryTransport.createLinkedPair();
      await args.options.mcpServers.pi.instance.connect(left);
      await client.connect(right);
      stats.listed = (await client.listTools()).tools;
      const source = args.prompt[Symbol.asyncIterator]();
      await source.next();
      yield { type: 'system', subtype: 'init', tools: ['mcp__pi__probe'], apiKeySource: plan.apiKeySource ?? 'none' };
      const input = plan.badArgs ? {} : { label: 'test' };
      const blocks = [0, 1].map(i => ({ type: 'tool_use', id: `tool-${i}`, name: 'mcp__pi__probe', input }));
      // MCP tools without read-only annotations can be scheduled serially by the SDK.
      const pending = (async () => {
        const results = [];
        for (const block of blocks) results.push(await client.callTool({ name: 'probe', arguments: input,
          ...plan.missingId ? {} : { _meta: { 'claudecode/toolUseId': plan.badId ?? block.id } } }));
        return results;
      })();
      void pending.catch(() => {});
      yield* assistant(plan.thinking ? [{ type: 'thinking', thinking: 'reason', signature: 'signed' }, ...blocks] : blocks,
        plan.truncated ? 'max_tokens' : 'tool_use', plan.malformed, args.options.model);
      stats.results = await pending;
      yield* assistant([{ type: 'text', text: plan.text ?? '😀done' }], 'end_turn', false, args.options.model);
      yield result(1, args.options.model);
      const second = await source.next();
      if (!second.done) {
        yield* assistant([{ type: 'text', text: 'recalled' }], 'end_turn', false, args.options.model);
        yield result(2, args.options.model);
      }
    })();
    const next = stream.next.bind(stream);
    stream.next = () => { stats.reads++; return next(); };
    stream.close = () => { stats.closes++; void client.close(); };
    return stream;
  };
  return { stats, factory };
}
function makeAgent(bridge, overrides = {}) {
  let executions = 0;
  const agent = new Agent({ sessionId: options.sessionId, toolExecution: 'parallel', streamFn: bridge.streamSimple,
    initialState: { model, systemPrompt: 'test', thinkingLevel: 'off', tools: [{ ...declaration, label: 'Probe',
      execute: async id => { executions++; return { content: [{ type: 'text', text: id }], details: undefined }; } }] },
    ...overrides,
  });
  return { agent, executions: () => executions };
}

test('parallel identical calls preserve schemas, stream Unicode, and keep cumulative usage across user turns', async () => {
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const observed = [];
  const { agent, executions } = makeAgent(bridge);
  agent.subscribe(event => { if (event.type === 'message_update') observed.push(event.assistantMessageEvent.type); });
  try {
    await agent.prompt('test');
    const messages = agent.state.messages.filter(m => m.role === 'assistant');
    assert.equal(messages.at(-1).stopReason, 'stop', messages.at(-1).errorMessage);
    assert.equal(messages[0].content.filter(b => b.type === 'toolCall').length, 2);
    assert.equal(executions(), 2);
    assert.equal(messages.at(-1).content[0].text, '😀done');
    assert.deepEqual(stats.listed[0].inputSchema, JSON.parse(JSON.stringify(parameters)));
    assert.deepEqual(stats.results.map(r => r.content[0].text), ['tool-0', 'tool-1']);
    assert(observed.includes('text_delta') && observed.includes('toolcall_delta'));
    assert.equal(observed.filter(t => t === 'toolcall_start').length, observed.filter(t => t === 'toolcall_end').length);
    await agent.prompt('next');
    assert.equal(stats.queries, 1);
    assert.equal(agent.state.messages.at(-1).content[0].text, 'recalled');
    const all = agent.state.messages.filter(m => m.role === 'assistant');
    assert.equal(all.reduce((s, m) => s + m.usage.input, 0), 60);
    assert(Math.abs(all.reduce((s, m) => s + m.usage.cost.total, 0) - 0.008) < 1e-10);
    assert.deepEqual(stats.options.tools, []);
    assert.deepEqual(stats.options.settingSources, []);
    assert.equal(stats.options.strictMcpConfig, true);
    assert.deepEqual(await stats.options.canUseTool('Bash'), { behavior: 'deny', message: 'Tool is not exposed by Pi.' });
  } finally { bridge.close(); }
});

test('Opus uses its requested SDK model and the same Pi-owned tool bridge', async () => {
  let provider;
  extension({ registerProvider: p => { provider = p; }, on: () => {} });
  const opus = provider.getModels().find(m => m.id === 'claude-opus-5-5');
  assert(opus);
  assert.deepEqual(opus.cost, anthropicProvider().getModels().find(m => m.id === opus.id).cost);
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const { agent, executions } = makeAgent(bridge);
  agent.state.model = opus;
  try {
    await agent.prompt('test');
    assert.equal(stats.options.model, opus.id);
    assert.equal(agent.state.messages.at(-1).model, opus.id);
    assert.equal(agent.state.messages.at(-1).stopReason, 'stop', agent.state.messages.at(-1).errorMessage);
    assert.equal(executions(), 2);
    assert.deepEqual(stats.options.tools, []);
    assert.equal(agent.state.messages.filter(m => m.role === 'assistant').reduce((sum, m) => sum + m.usage.input, 0), 30);
  } finally { bridge.close(); }
});

test('SDK thinking frames are preserved even when reasoning was requested off', async () => {
  const { factory } = fakeQuery({ thinking: true });
  const bridge = createBridge('/tmp', factory);
  const { agent } = makeAgent(bridge);
  try {
    await agent.prompt('test');
    const assistant = agent.state.messages.find(m => m.role === 'assistant');
    assert.equal(agent.state.messages.at(-1).stopReason, 'stop');
    assert.deepEqual(assistant.content[0], { type: 'thinking', thinking: 'reason', thinkingSignature: 'signed' });
  } finally { bridge.close(); }
});

test('SDK startup process markers do not invalidate a live query', async () => {
  const previous = process.env.CLAUDE_AGENT_SDK_VERSION;
  const { factory } = fakeQuery();
  const bridge = createBridge('/tmp', args => { process.env.CLAUDE_AGENT_SDK_VERSION = 'fixture'; return factory(args); });
  const { agent } = makeAgent(bridge);
  try {
    await agent.prompt('test');
    assert.equal(agent.state.messages.at(-1).stopReason, 'stop', agent.state.messages.at(-1).errorMessage);
  } finally {
    bridge.close();
    if (previous === undefined) delete process.env.CLAUDE_AGENT_SDK_VERSION;
    else process.env.CLAUDE_AGENT_SDK_VERSION = previous;
  }
});

test('Pi denial prevents execution and resolves both MCP handlers with errors', async () => {
  const { stats, factory } = fakeQuery({ text: 'DENIED' });
  const bridge = createBridge('/tmp', factory);
  let preflights = 0;
  const { agent, executions } = makeAgent(bridge, { beforeToolCall: async () => { preflights++; return { block: true, reason: 'Denied' }; } });
  try {
    await agent.prompt('test');
    assert.equal(executions(), 0);
    assert.equal(preflights, 2);
    assert.equal(stats.results.length, 2);
    assert(stats.results.every(r => r.isError));
    assert.equal(agent.state.messages.at(-1).content[0].text, 'DENIED');
  } finally { bridge.close(); }
});

test('SDK API-key authentication is rejected before dispatching Pi tools', async () => {
  const { factory } = fakeQuery({ apiKeySource: 'apiKeyHelper' });
  const bridge = createBridge('/tmp', factory);
  const { agent, executions } = makeAgent(bridge);
  try {
    await agent.prompt('test');
    assert.equal(agent.state.messages.at(-1).stopReason, 'error');
    assert.match(agent.state.messages.at(-1).errorMessage, /API-key authentication/);
    assert.equal(executions(), 0);
  } finally { bridge.close(); }
});

test('invalid model arguments are rejected by Pi before tool execution', async () => {
  const { stats, factory } = fakeQuery({ badArgs: true });
  const bridge = createBridge('/tmp', factory);
  const { agent, executions } = makeAgent(bridge);
  try {
    await agent.prompt('test');
    assert.equal(executions(), 0);
    assert.equal(stats.results.length, 2);
    assert(stats.results.every(r => r.isError));
  } finally { bridge.close(); }
});

for (const plan of [{ missingId: true }, { badId: '' }, { badId: 42 }, { malformed: true }, { truncated: true }]) {
  test(`fail closed before executing an unsafe batch: ${JSON.stringify(plan)}`, async () => {
    const { factory } = fakeQuery(plan);
    const bridge = createBridge('/tmp', factory);
    const { agent, executions } = makeAgent(bridge);
    try {
      await agent.prompt('test');
      assert.equal(agent.state.messages.at(-1).stopReason, 'error');
      assert.equal(executions(), 0);
    } finally { bridge.close(); }
  });
}

test('already-aborted calls never create or read an SDK query', async () => {
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const controller = new AbortController(); controller.abort();
  const message = await bridge.streamSimple(model, context([user]), { ...options, signal: controller.signal }).result();
  assert.equal(message.stopReason, 'aborted');
  assert.deepEqual(message.content, []);
  assert.equal(stats.queries, 0);
});

test('mid-stream cancellation preserves observed usage and suppresses partial content', async () => {
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const controller = new AbortController();
  const message = await bridge.streamSimple(model, context([user]), { ...options, signal: controller.signal,
    onProviderStreamEvent: event => { if (event.type === 'stream_event' && event.event.type === 'content_block_delta') controller.abort(); },
  }).result();
  assert.equal(message.stopReason, 'aborted');
  assert.deepEqual(message.content, []);
  assert.equal(message.usage.input, fixtureUsage.input_tokens);
  assert.equal(message.usage.totalTokens, 35);
  assert.equal(stats.closes, 1);
});

test('abort during Pi tools closes the query and suppresses late SDK content', async () => {
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const gate = Promise.withResolvers();
  let agent;
  ({ agent } = makeAgent(bridge, { initialState: { model, systemPrompt: 'test', thinkingLevel: 'off', tools: [{ ...declaration, label: 'Probe',
    execute: async () => { agent.abort(); await gate.promise; return { content: [{ type: 'text', text: 'late' }], details: undefined }; } }] } }));
  const running = agent.prompt('test');
  await new Promise(resolve => setImmediate(resolve));
  // Release non-cooperative fixture work; real tools receive Pi's abort signal.
  gate.resolve();
  try {
    await running;
    assert.equal(agent.state.messages.at(-1).stopReason, 'aborted');
    assert.deepEqual(agent.state.messages.at(-1).content, []);
    assert.equal(stats.closes, 1);
  } finally { bridge.close(); }
});

test('history edits, resumed histories, images, and request replacements fail without starting a new query', async () => {
  for (const [messages, opts] of [
    [[user, { role: 'assistant', content: [{ type: 'text', text: 'old' }] }, user], options],
    [[{ ...user, content: [{ type: 'image', data: 'a', mimeType: 'image/png' }] }], options],
    [[user], { ...options, onPayload: p => ({ ...p, prompt: 'replacement' }) }],
    [[user], { ...options, onPayload: p => { p.prompt = 'mutated'; } }],
  ]) {
    const { stats, factory } = fakeQuery();
    const bridge = createBridge('/tmp', factory);
    try {
      const result = await bridge.streamSimple(model, context(messages), opts).result();
      assert.equal(result.stopReason, 'error');
      assert.equal(stats.queries, 0);
    } finally { bridge.close(); }
  }
});

test('unsupported title requests cannot close an existing SDK conversation', async () => {
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const { agent } = makeAgent(bridge);
  try {
    await agent.prompt('test');
    const reads = stats.reads;
    const rejected = await bridge.streamSimple(model, context([user]), { reasoning: 'minimal', maxTokens: 120 }).result();
    assert.equal(rejected.stopReason, 'error');
    assert.match(rejected.errorMessage, /Nested requests/);
    assert.equal(stats.closes, 0);
    assert.equal(stats.reads, reads);
    await agent.prompt('next');
    assert.equal(agent.state.messages.at(-1).stopReason, 'stop', agent.state.messages.at(-1).errorMessage);
    assert.equal(agent.state.messages.at(-1).content[0].text, 'recalled');
    assert.equal(stats.queries, 1);
  } finally { bridge.close(); }
});

test('rewinding a live transcript fails without re-executing a tool', async () => {
  const { stats, factory } = fakeQuery();
  const bridge = createBridge('/tmp', factory);
  const { agent, executions } = makeAgent(bridge);
  try {
    await agent.prompt('test');
    const reads = stats.reads;
    const result = await bridge.streamSimple(model, context([user]), options).result();
    assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage, /history/);
    assert.equal(stats.reads, reads);
    assert.equal(executions(), 2);
  } finally { bridge.close(); }
});

test('unexpected failures are sanitized and API credentials cannot silently change billing', async () => {
  const bridge = createBridge('/tmp', () => { throw new Error('SECRET_DRIVER_TOKEN'); });
  const result = await bridge.streamSimple(model, context([user]), options).result();
  assert.equal(result.stopReason, 'error');
  assert(!JSON.stringify(result).includes('SECRET_DRIVER_TOKEN'));
  assert.throws(() => sdkEnvironment({ ANTHROPIC_API_KEY: 'secret' }), /local Claude Code login/);
  assert.throws(() => sdkEnvironment({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' }), /local Claude Code login/);
});

test('Pi native auth cancellation is normalized without starting an SDK query', async () => {
  const handlers = new Map();
  const models = createModels();
  extension({ registerProvider: p => models.setProvider(p), on: (name, handler) => handlers.set(name, handler) });
  const controller = new AbortController(); controller.abort();
  const setupError = await models.streamSimple(models.getModels()[0], context([user]), { ...options, signal: controller.signal }).result();
  const handler = handlers.get('message_end');
  const normalized = handler?.({ message: setupError }, { signal: controller.signal })?.message ?? setupError;
  assert.equal(normalized.stopReason, 'aborted');
  assert.deepEqual(normalized.content, []);
  const ordinary = { ...setupError, stopReason: 'error', errorMessage: 'real failure' };
  assert.equal(handler?.({ message: ordinary }, { signal: new AbortController().signal }), undefined);
  assert.equal(handler?.({ message: { ...ordinary, provider: 'another' } }, { signal: controller.signal }), undefined);
});

test('Pi loads the package without local copies of host-provided dependencies', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'pi-sdk-package-load-'));
  try {
    for (const file of ['index.ts', 'bridge.ts', 'package.json']) copyFileSync(new URL(file, import.meta.url), join(scratch, file));
    for (const dependency of ['@anthropic-ai/claude-agent-sdk', '@modelcontextprotocol/sdk', 'zod']) {
      const link = join(scratch, 'node_modules', dependency);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(fileURLToPath(new URL(`./node_modules/${dependency}`, import.meta.url)), link, 'dir');
    }
    const loaded = await discoverAndLoadExtensions([join(scratch, 'index.ts')], scratch, join(scratch, 'agent'));
    assert.deepEqual(loaded.errors, []);
    const provider = loaded.runtime.pendingNativeProviderRegistrations.find(p => p.provider.id === 'claude-sdk')?.provider;
    assert(provider);
    assert.deepEqual(provider.getModels().map(m => m.id), ['claude-haiku-5-5', 'claude-opus-5-5']);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('extension registers native ambient auth without a fake key and closes on lifecycle changes', () => {
  const handlers = new Map();
  let provider;
  extension({ registerProvider: p => { provider = p; }, on: (name, handler) => { handlers.set(name, handler); } });
  assert.equal(provider.id, 'claude-sdk');
  assert.deepEqual(provider.getModels().map(m => m.id), ['claude-haiku-5-5', 'claude-opus-5-5']);
  assert.equal(provider.auth.apiKey.login, undefined);
  assert(provider.getModels().every(m => !m.reasoning && m.input.join() === 'text' && m.maxTokens === 4096));
  assert(handlers.has('session_shutdown') && handlers.has('model_select'));
  const events = ['session_before_tree', 'session_before_fork', 'session_before_compact'];
  for (const event of events) assert.deepEqual(handlers.get(event)({}, { model, hasUI: false }), { cancel: true });
});
