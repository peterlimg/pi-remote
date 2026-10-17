// An external SDK replay peer. Pi, its tool pipeline and the provider extension are real.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Type } from 'typebox';
import { createProvider, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import install, { localLogin } from '../index.ts';

const log = value => appendFileSync(process.env.PI_RECOVERY_EVENTS!, JSON.stringify(value) + '\n');
const wrap = event => ({ type: 'stream_event', parent_tool_use_id: null, event });
function* assistant(model, blocks, stop = 'end_turn') {
  yield wrap({ type: 'message_start', message: { id: randomUUID(), model, usage: { input_tokens: 10, output_tokens: 5 } } });
  for (const [index, block] of blocks.entries()) {
    yield wrap({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} }
      : block.type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' } });
    if (block.type === 'tool_use') yield wrap({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    else if (block.type === 'thinking') {
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else yield wrap({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    yield wrap({ type: 'content_block_stop', index });
  }
  yield wrap({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } });
  yield wrap({ type: 'message_stop' });
}
function replayQuery(args) {
  const session = args.options.resume ?? args.options.sessionId ?? randomUUID(), client = new Client({ name: 'recovery-replay', version: '1' });
  const previous = existsSync(process.env.PI_RECOVERY_EVENTS!) ? readFileSync(process.env.PI_RECOVERY_EVENTS!, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let turn = previous.findLast(row => row.type === 'native-complete' && row.session === session)?.turn ?? 0;
  const invalidInit = process.env.PI_RECOVERY_BAD_INIT === '1';
  const sdkPrompt = typeof args.options.systemPrompt === 'string' ? args.options.systemPrompt : args.options.systemPrompt?.append ?? '';
  const piDocs = sdkPrompt.includes('providers (docs/custom-provider.md)') && sdkPrompt.includes('pi packages (docs/packages.md)');
  log({ type: 'query', session, resumed: Boolean(args.options.resume), resumedAt: Boolean(args.options.resumeSessionAt), invalidInit,
    portable: args.options.systemPrompt?.preset === 'claude_code', piDocs,
    globalPolicy: sdkPrompt.includes('PORTABLE_GLOBAL_POLICY'), projectPolicy: sdkPrompt.includes('PORTABLE_PROJECT_POLICY'),
    skill: sdkPrompt.includes('PORTABLE_SKILL'), append: sdkPrompt.includes('PORTABLE_APPEND'),
    toolGuidance: sdkPrompt.includes('PORTABLE_TOOL_GUIDE'), guideline: sdkPrompt.includes('PORTABLE_GUIDELINE'),
    latePolicy: sdkPrompt.includes('PORTABLE_LATE_POLICY'), customDocs: sdkPrompt.includes('PORTABLE_DOC_OVERRIDE'),
    customPrompt: sdkPrompt.includes('PORTABLE_CUSTOM_PROMPT') });
  const stream = (async function* () {
    const [left, right] = InMemoryTransport.createLinkedPair();
    await args.options.mcpServers.pi.instance.connect(left); await client.connect(right);
    const tools = (await client.listTools()).tools.map(tool => 'mcp__pi__' + tool.name);
    const source = args.prompt[Symbol.asyncIterator]();
    for (;;) {
      const next = await source.next(); if (next.done) return;
      const content = next.value.message.content;
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('');
      const request = content.filter(block => block.type === 'text').at(-1)?.text ?? '';
      log({ type: 'prompt', session, recovered: text.includes('Operator-approved SDK context recovery'),
        foreign: text.includes('FOREIGN_DONE'), localRejection: text.includes('SDK history changed after recovery approval. Request recovery again.'),
        marker: text.includes(process.env.PI_RECOVERY_MARKER!), unknown: text.includes('Execution outcome unknown'),
        leakedSignature: text.includes('RECOVERY_PRIVATE_SIGNATURE'), images: content.filter(block => block.type === 'image').length,
        providerRejection: text.includes('"providerRejected":true'), foreignFailure: text.includes('"provider":"recovery-control"') && text.includes('"stopReason":"error"') });
      yield { type: 'system', subtype: 'init', session_id: invalidInit ? randomUUID() : session, tools, apiKeySource: 'none' };
      if (piDocs || request === 'billing-rejection') {
        yield { type: 'assistant', uuid: randomUUID(), error: 'unknown', parent_tool_use_id: null,
          message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 400 Third-party apps now draw from extra usage, not plan limits. Ask your workspace admin to add more and keep going. SYNTHETIC_PRIVATE_DETAIL' }] } };
        continue;
      }
      let label = text.startsWith('seed') ? 'seed' : text === 'interrupt' ? 'orphan' : text === 'allow-new' ? 'allowed'
        : text === 'deny-new' ? 'policy-denied' : text === 'invalid-new' ? 'invalid' : text === 'after-restart' ? 'after-restart' : undefined;
      if (label || text === 'reuse-id') {
        const old = readFileSync(process.env.PI_RECOVERY_SESSION!, 'utf8').trim().split('\n').map(JSON.parse)
          .flatMap(entry => entry.message?.role === 'assistant' ? entry.message.content : []).find(block => block.type === 'toolCall' && block.arguments.label === 'orphan');
        const id = text === 'reuse-id' ? old.id : 'toolu_' + randomUUID();
        label ??= 'orphan';
        const input = text === 'invalid-new' ? {} : { label };
        const pending = client.callTool({ name: 'probe', arguments: input, _meta: { 'claudecode/toolUseId': id } });
        void pending.catch(() => {});
        const blocks = text.startsWith('seed') ? [{ type: 'thinking', thinking: 'private reasoning', signature: 'RECOVERY_PRIVATE_SIGNATURE' }] : [];
        yield* assistant(args.options.model, [...blocks, { type: 'tool_use', id, name: 'mcp__pi__probe', input }], 'tool_use');
        const result = await pending;
        log({ type: 'result', label, error: result.isError === true });
      }
      yield* assistant(args.options.model, [{ type: 'text', text: text.includes('Operator-approved SDK context recovery')
        ? 'RECOVERED ' + process.env.PI_RECOVERY_MARKER + ' with unknown prior effects.' : 'DONE' }]);
      yield { type: 'assistant', uuid: randomUUID() };
      turn++;
      log({ type: 'native-complete', session, turn });
      yield { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', total_cost_usd: turn * 0.01,
        modelUsage: { [args.options.model]: { inputTokens: turn * 100, outputTokens: turn * 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    }
  })();
  stream.close = () => { void client.close(); };
  stream.setModel = async () => {};
  stream.applyFlagSettings = async () => {};
  stream.setMaxThinkingTokens = async () => {};
  return stream;
}
export default function (pi) {
  pi.on('project_trust', () => ({ trusted: 'yes' }));
  const { compat: _compat, ...metadata } = getBuiltinModels('anthropic').find(model => model.id === 'claude-haiku-5-5');
  const controlStream = (model, context) => {
    const tool = context.messages.at(-1).role !== 'toolResult';
    const foreignFailure = JSON.stringify(context.messages.at(-1).content).includes('foreign-rejection');
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: foreignFailure ? [] : tool ? [{ type: 'toolCall', id: 'control_' + randomUUID(), name: 'probe', arguments: { label: 'foreign' } }] : [{ type: 'text', text: 'FOREIGN_DONE' }],
      stopReason: foreignFailure ? 'error' : tool ? 'toolUse' : 'stop', ...(foreignFailure ? { errorMessage: 'The control provider rejected this request.' } : {}),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: message });
    if (foreignFailure) stream.push({ type: 'error', reason: 'error', error: message });
    else stream.push({ type: 'done', reason: message.stopReason, message });
    stream.end(); return stream;
  };
  pi.registerProvider(createProvider({ id: 'recovery-control', name: 'Isolated recovery control',
    auth: { apiKey: { name: 'Replay control', resolve: async () => ({ auth: {}, source: 'isolated replay' }) } },
    models: [{ ...metadata, provider: 'recovery-control', api: 'recovery-control', id: 'plain', name: 'Recovery control' }],
    api: { stream: controlStream, streamSimple: controlStream } }));
  // Test authentication only; no native CLI or model service is used by this peer.
  localLogin.resolve = async () => ({ auth: {}, source: 'isolated SDK replay' });
  install(pi, replayQuery);
  pi.on('before_agent_start', event => {
    event.systemPromptOptions.promptGuidelines.push('PORTABLE_GUIDELINE');
    event.systemPromptOptions.toolGuidelines.probe = ['PORTABLE_TOOL_GUIDE'];
    event.systemPromptOptions.sections.late_policy = 'PORTABLE_LATE_POLICY';
    if (process.env.PI_RECOVERY_DOC_OVERRIDE === '1') event.systemPromptOptions.sections.docs = 'PORTABLE_DOC_OVERRIDE';
  });
  pi.on('context_with_system', event => {
    if (process.env.PI_RECOVERY_REWRITE === '1') return { messages: [
      { role: 'system', content: 'PORTABLE_OPAQUE_REWRITE', timestamp: 0 }, ...event.messages.filter(message => message.role !== 'system'),
    ] };
  });
  pi.on('tool_call', event => {
    if (event.toolName === 'probe' && event.input.label === 'policy-denied') {
      return { block: true, reason: 'Denied by the normal Pi permission policy.' };
    }
  });
  pi.registerTool({ name: 'probe', label: 'Recovery probe', description: 'Record one synthetic effect.',
    parameters: Type.Object({ label: Type.String() }, { additionalProperties: false }),
    execute: async (id, { label }, signal) => {
      log({ type: 'execution', id, label });
      if (label === 'orphan') while (!existsSync(process.env.PI_RECOVERY_GATE!)) await delay(20, undefined, { signal });
      return { content: [{ type: 'text', text: label === 'seed' ? process.env.PI_RECOVERY_MARKER! : 'APPROVED_NEW_EFFECT' }], details: undefined };
    } });
}
