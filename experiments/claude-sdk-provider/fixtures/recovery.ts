// An external SDK replay peer. Pi, its tool pipeline and the provider extension are real.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Type } from 'typebox';
import { createProvider, createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import install, { localLogin } from '../index.ts';

const log = value => appendFileSync(process.env.PI_RECOVERY_EVENTS!, JSON.stringify(value) + '\n');
const wrap = event => ({ type: 'stream_event', parent_tool_use_id: null, event });
async function* assistant(model, blocks, stop = 'end_turn', inputTokens = 10) {
  yield wrap({ type: 'message_start', message: { id: randomUUID(), model, usage: { input_tokens: inputTokens, output_tokens: 5 } } });
  for (const [index, block] of blocks.entries()) {
    const { json, earlyReceipt, ...contentBlock } = block;
    yield wrap({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...contentBlock, input: {} }
      : block.type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' } });
    if (block.type === 'tool_use') yield wrap({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json ?? JSON.stringify(block.input) } });
    else if (block.type === 'thinking') {
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      yield wrap({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else yield wrap({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    if (earlyReceipt) yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'Tool input could not be parsed as JSON.' },
    ] } };
    if (json !== undefined) await setImmediate();
    yield wrap({ type: 'content_block_stop', index });
  }
  yield wrap({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } });
  yield wrap({ type: 'message_stop' });
}
function replayQuery(args) {
  const session = args.options.resume ?? args.options.sessionId ?? randomUUID(), client = new Client({ name: 'recovery-replay', version: '1' });
  const previous = existsSync(process.env.PI_RECOVERY_EVENTS!) ? readFileSync(process.env.PI_RECOVERY_EVENTS!, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let turn = previous.findLast(row => row.type === 'native-complete' && row.session === session)?.turn ?? 0;
  let memory = previous.findLast(row => row.type === 'native-complete' && row.session === session)?.memory;
  const compactionMode = process.env.PI_RECOVERY_COMPACTION;
  const contextTest = Boolean(compactionMode || process.env.PI_RECOVERY_CLONE);
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
    const server = args.options.mcpServers?.pi;
    if (server) {
      const [left, right] = InMemoryTransport.createLinkedPair();
      await server.instance.connect(left); await client.connect(right);
    }
    const tools = server ? (await client.listTools()).tools.map(tool => 'mcp__pi__' + tool.name) : [];
    const source = args.prompt[Symbol.asyncIterator]();
    for (;;) {
      const next = await source.next(); if (next.done) return;
      const content = next.value.message.content;
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('');
      let request = content.filter(block => block.type === 'text').at(-1)?.text ?? '';
      const continuation = text.includes('Pi tool-set update.') && request.startsWith('Continue the user request');
      if (continuation || tools.includes('mcp__pi__extra') && ((text.includes('Pi tool-set update.') && text.includes('"text":"dynamic-tools"')) ||
        (text.includes('Pi-authorized context compaction.') && text.includes('"label":"dynamic-tools"')))) request = 'dynamic-tools';
      log({ type: 'prompt', session, recovered: text.includes('Operator-approved SDK context recovery'),
        foreign: text.includes('FOREIGN_DONE'), localRejection: text.includes('SDK history changed after recovery approval. Request recovery again.'),
        marker: text.includes(process.env.PI_RECOVERY_MARKER!), unknown: text.includes('Execution outcome unknown'),
        leakedSignature: text.includes('RECOVERY_PRIVATE_SIGNATURE'), images: content.filter(block => block.type === 'image').length,
        providerRejection: text.includes('"providerRejected":true'), foreignFailure: text.includes('"provider":"recovery-control"') && text.includes('"stopReason":"error"'),
        cancelled: text.includes('User-cancelled SDK continuation.'), toolUpdate: text.includes('Pi tool-set update.'), continuation,
        notices: ['NOTICE_A', 'NOTICE_B', 'NOTICE_C'].filter(marker => text.includes(marker)),
        noticeOrder: ['NOTICE_A', 'NOTICE_B', 'NOTICE_C'].map(marker => text.indexOf(marker)) });
      yield { type: 'system', subtype: 'init', session_id: invalidInit ? randomUUID() : session, tools, apiKeySource: 'none' };
      const summaryRequest = contextTest && !server;
      if (summaryRequest) {
        memory = text.match(/PI_(?:COMPACTION|CLONE)_[a-f0-9-]+/)?.[0];
        log({ type: 'compaction-helper', session, marker: Boolean(memory), tools: tools.length,
          nativeCompactionDisabled: args.options.settings.autoCompactEnabled === false });
        if (compactionMode === 'summary-error') throw new Error('Synthetic summary failure');
        if (compactionMode === 'summary-stop') await delay(30000, undefined, { signal: args.options.abortController.signal });
        if (compactionMode === 'notices') while (!existsSync(process.env.PI_RECOVERY_GATE!)) await delay(20, undefined, { signal: args.options.abortController.signal });
      }
      if (piDocs || request === 'billing-rejection') {
        yield { type: 'assistant', uuid: randomUUID(), error: 'unknown', parent_tool_use_id: null,
          message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 400 Third-party apps now draw from extra usage, not plan limits. Ask your workspace admin to add more and keep going. SYNTHETIC_PRIVATE_DETAIL' }] } };
        continue;
      }
      if (request.startsWith('malformed-')) {
        const mode = request.slice('malformed-'.length);
        const call = (id, input) => {
          const pending = client.callTool({ name: 'probe', arguments: input, _meta: { 'claudecode/toolUseId': id } });
          void pending.catch(() => {}); return pending;
        };
        const valid = async function* (label, id = 'toolu_' + randomUUID()) {
          const pending = call(id, { label });
          yield* assistant(args.options.model, [{ type: 'tool_use', id, name: 'mcp__pi__probe', input: { label } }], 'tool_use');
          await pending;
        };
        yield* valid('before-malformed');
        let badId;
        for (let attempt = 0; attempt < (mode === 'repeat' ? 4 : 1); attempt++) {
          badId = 'bad_' + randomUUID();
          const json = '{"label">"broken"}', input = { __unparsedToolInput: { raw: json, len: json.length } };
          log({ type: 'malformed', id: badId, mode });
          let pending = mode === 'early' ? call(badId, input) : undefined;
          const mixedId = 'toolu_' + randomUUID(), mixed = mode === 'mixed' ? call(mixedId, { label: 'after-malformed' }) : undefined;
          yield* assistant(args.options.model, [
            { type: 'tool_use', id: badId, name: 'mcp__pi__probe', input, json, earlyReceipt: mode === 'early-receipt' },
            ...(mixed ? [{ type: 'tool_use', id: mixedId, name: 'mcp__pi__probe', input: { label: 'after-malformed' } }] : []),
          ], 'tool_use');
          if (mode === 'late') pending = call(badId, input);
          const rejected = pending ? await pending : { isError: true };
          if (pending) log({ type: 'malformed-mcp-result', id: badId, isError: rejected.isError === true });
          if (mode !== 'missing' && mode !== 'early-receipt') yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
            { type: 'tool_result', tool_use_id: badId, is_error: mode === 'success' ? false : rejected.isError,
              content: 'Tool arguments could not be parsed as JSON. No tool executed. Retry with valid JSON.' },
          ] } };
          if (mixed) await mixed;
        }
        if (mode !== 'mixed') yield* valid('after-malformed', mode === 'duplicate' ? badId : undefined);
      } else {
        let label = text.startsWith('seed') ? 'seed' : text === 'interrupt' ? 'orphan' : text === 'allow-new' ? 'allowed'
          : text === 'deny-new' ? 'policy-denied' : text === 'invalid-new' ? 'invalid' : text === 'after-restart' ? 'after-restart'
          : request === 'cancel-after-tools' ? 'cancel-completed' : request === 'cancel-in-tool' ? 'cancel-running'
          : request === 'dynamic-tools' && !tools.includes('mcp__pi__extra') ? 'dynamic-tools' : undefined;
        if (label || text === 'reuse-id' || request === 'reuse-seed-id' || request === 'reuse-later-id') {
          const old = readFileSync(process.env.PI_RECOVERY_SESSION!, 'utf8').trim().split('\n').map(JSON.parse)
            .flatMap(entry => entry.message?.role === 'assistant' ? entry.message.content : [])
            .find(block => block.type === 'toolCall' && block.arguments.label === (request === 'reuse-seed-id' ? 'seed' : request === 'reuse-later-id' ? 'after-restart' : 'orphan'));
          const id = text === 'reuse-id' || request === 'reuse-seed-id' || request === 'reuse-later-id' ? old.id : 'toolu_' + randomUUID();
          label ??= 'orphan';
          const input = text === 'invalid-new' ? {} : { label };
          const pending = client.callTool({ name: 'probe', arguments: input, _meta: { 'claudecode/toolUseId': id } });
          void pending.catch(() => {});
          const blocks = text.startsWith('seed') ? [{ type: 'thinking', thinking: 'private reasoning', signature: 'RECOVERY_PRIVATE_SIGNATURE' }] : [];
          yield* assistant(args.options.model, [...blocks, { type: 'tool_use', id, name: 'mcp__pi__probe', input }], 'tool_use', compactionMode === 'auto' || compactionMode === 'auto-tools' && label === 'dynamic-tools' ? 5000 : 10);
          const result = await pending;
          if (contextTest) memory = JSON.stringify(result).match(/PI_(?:COMPACTION|CLONE)_[a-f0-9-]+/)?.[0] ?? memory;
          log({ type: 'result', label, error: result.isError === true });
        }
      }
      if (request === 'dynamic-tools') {
        const id = 'extra_' + randomUUID(), input = process.env.PI_RECOVERY_TOOL_CASE === 'validation' ? {} : { label: 'new-capability' };
        const listed = (await client.listTools()).tools.map(tool => tool.name);
        const permission = await args.options.canUseTool('mcp__pi__extra', input, { toolUseID: id });
        log({ type: 'dynamic-tools', listed, allowed: permission.behavior === 'allow' });
        const pending = client.callTool({ name: 'extra', arguments: input, _meta: { 'claudecode/toolUseId': id } });
        void pending.catch(() => {});
        yield* assistant(args.options.model, [{ type: 'tool_use', id, name: 'mcp__pi__extra', input }], 'tool_use');
        await pending;
      }
      if (request === 'assert-extra-disabled') log({ type: 'unavailable',
        listed: (await client.listTools()).tools.map(tool => tool.name),
        allowed: (await args.options.canUseTool('mcp__pi__extra', {}, { toolUseID: randomUUID() })).behavior === 'allow' });
      if (request.startsWith('cancel-')) {
        log({ type: 'cancel-ready', request });
        yield wrap({ type: 'message_start', message: { id: randomUUID(), model: args.options.model, usage: { input_tokens: 10, output_tokens: 5 } } });
        yield wrap({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        yield wrap({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial answer before Stop.' } });
        await delay(30000, undefined, { signal: args.options.abortController.signal });
      }
      if (contextTest) memory = [...text.matchAll(/PI_(?:COMPACTION|CLONE)_[a-f0-9-]+/g)].at(-1)?.[0] ?? memory;
      yield* assistant(args.options.model, [{ type: 'text', text: summaryRequest
        ? memory ? `## Goal\nRemember ${memory}.\n## Progress\nThe probe already completed. Never repeat recorded work.\n## Next steps\nContinue the current user request.`
          : '## Pending request\nContinue the latest user request. No additional tool work is required.'
        : contextTest && request.includes('recall') ? memory ?? 'MISSING_MARKER'
        : text.includes('Operator-approved SDK context recovery')
        ? 'RECOVERED ' + process.env.PI_RECOVERY_MARKER + ' with unknown prior effects.' : 'DONE' }]);
      yield { type: 'assistant', uuid: randomUUID() };
      turn++;
      log({ type: 'native-complete', session, turn, ...(contextTest ? { memory } : {}) });
      yield { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', user_message_uuids: [next.value.uuid], total_cost_usd: turn * 0.01,
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
    const summary = Boolean(process.env.PI_RECOVERY_COMPACTION && getCurrentTools(context.messages).length === 0);
    const summaryMarker = summary && JSON.stringify(context.messages).match(/PI_COMPACTION_[a-f0-9-]+/)?.[0];
    if (summary) log({ type: 'control-compaction', marker: Boolean(summaryMarker) });
    const tool = !summary && context.messages.at(-1).role !== 'toolResult';
    const foreignFailure = JSON.stringify(context.messages.at(-1).content).includes('foreign-rejection');
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: foreignFailure ? [] : tool ? [{ type: 'toolCall', id: 'control_' + randomUUID(), name: 'probe', arguments: { label: 'foreign' } }]
        : [{ type: 'text', text: summary ? `## Context\n${summaryMarker || 'Continue the pending user request.'}` : 'FOREIGN_DONE' }],
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
  localLogin.resolve = async () => ({ auth: {}, source: 'isolated SDK replay',
    ...(['environment', 'old-guard'].includes(process.env.PI_RECOVERY_TOOL_CASE!) ? { env: { PI_SYNTHETIC_SDK_SCOPE: process.env.PI_RECOVERY_REQUEST_SCOPE ?? 'base' } } : {}) });
  install(pi, replayQuery);
  const recordNotices = () => {
    for (const marker of ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']) pi.sendMessage({ customType: 'synthetic-child-notify', content: marker, display: true }, { triggerTurn: false });
  };
  pi.registerCommand('sdk-record-notices', { description: 'Record synthetic notices without starting a turn', handler: async () => recordNotices() });
  pi.registerCommand('sdk-fork-at', { description: 'Exercise Pi branching at an exact entry', handler: async (id, ctx) => {
    await ctx.fork(id.trim(), { position: 'at' });
  } });
  pi.registerCommand('sdk-tree', { description: 'Exercise Pi tree navigation', handler: async (args, ctx) => {
    const { target, ...options } = JSON.parse(args);
    try {
      const result = await ctx.navigateTree(target, options);
      log({ type: 'tree-result', target, ...result, leafId: ctx.sessionManager.getLeafId() });
    } catch (error) { log({ type: 'tree-result', target, error: error.message, leafId: ctx.sessionManager.getLeafId() }); }
  } });
  pi.registerCommand('sdk-notify', { description: 'Deliver a batch of synthetic child completion notices', handler: async () => {
    recordNotices();
    pi.sendUserMessage('Acknowledge all completed child notices. Do not restart work or call tools.');
  } });
  pi.on('before_agent_start', event => {
    event.systemPromptOptions.promptGuidelines.push('PORTABLE_GUIDELINE');
    event.systemPromptOptions.toolGuidelines.probe = ['PORTABLE_TOOL_GUIDE'];
    event.systemPromptOptions.sections.late_policy = 'PORTABLE_LATE_POLICY';
    if (process.env.PI_RECOVERY_DOC_OVERRIDE === '1') event.systemPromptOptions.sections.docs = 'PORTABLE_DOC_OVERRIDE';
  });
  pi.on('context_with_system', event => {
    if (event.messages.some(message => message.role === 'toolResult' && message.toolName === 'probe')) {
      if (process.env.PI_RECOVERY_TOOL_CASE === 'missing-result') return { messages: event.messages.filter(message => message.role !== 'toolResult') };
      if (process.env.PI_RECOVERY_TOOL_CASE === 'history') return { messages: event.messages.map(message => message.role === 'user' ? { ...message, content: 'TAMPERED' } : message) };
    }
    if (process.env.PI_RECOVERY_REWRITE === '1') return { messages: [
      { role: 'system', content: 'PORTABLE_OPAQUE_REWRITE', timestamp: 0 }, ...event.messages.filter(message => message.role !== 'system'),
    ] };
  });
  pi.on('tool_call', event => {
    if (event.toolName === 'extra' && process.env.PI_RECOVERY_TOOL_CASE === 'permission') return { block: true, reason: 'Denied by normal Pi policy.' };
    if (event.toolName === 'probe' && event.input.label === 'policy-denied') {
      return { block: true, reason: 'Denied by the normal Pi permission policy.' };
    }
  });
  pi.registerTool({ name: 'probe', label: 'Recovery probe', description: 'Record one synthetic effect.',
    parameters: Type.Object({ label: Type.String() }, { additionalProperties: false }),
    execute: async (id, { label }, signal) => {
      log({ type: 'execution', id, label });
      if (process.env.PI_RECOVERY_EFFECTS) appendFileSync(process.env.PI_RECOVERY_EFFECTS, label + '\n');
      if (label === 'seed' && ['queued', 'boundary'].includes(process.env.PI_RECOVERY_FORK!)) {
        pi.sendUserMessage('Remember ' + process.env.PI_RECOVERY_FORK_LATE,
          { deliverAs: process.env.PI_RECOVERY_FORK === 'boundary' ? 'steer' : 'followUp' });
      }
      if (label === 'dynamic-tools') {
        pi.setActiveTools([...pi.getActiveTools(), 'extra']);
        log({ type: 'selection', active: pi.getActiveTools(), available: pi.getAllTools().map(tool => tool.name) });
        if (['environment', 'old-guard'].includes(process.env.PI_RECOVERY_TOOL_CASE!)) process.env.PI_RECOVERY_REQUEST_SCOPE = 'changed';
        if (process.env.PI_RECOVERY_TOOL_CASE === 'queued-input') {
          for (const marker of ['NOTICE_A', 'NOTICE_B', 'NOTICE_C']) pi.sendMessage({ customType: 'synthetic-child-notify', content: marker, display: true }, { triggerTurn: false });
        }
      }
      if (label === 'orphan') while (!existsSync(process.env.PI_RECOVERY_GATE!)) await delay(20, undefined, { signal });
      if (label === 'cancel-running') await delay(30000, undefined, { signal });
      return { content: [{ type: 'text', text: label === 'seed' || label === 'cancel-completed' ? process.env.PI_RECOVERY_MARKER! : 'APPROVED_NEW_EFFECT' }], details: undefined };
    } });
  if (process.env.PI_RECOVERY_DYNAMIC === '1') {
    pi.registerTool({ name: 'extra', label: 'Lazy extra capability', description: 'One synthetic tool enabled at runtime.',
      ...(process.env.PI_RECOVERY_TOOL_CASE === 'instructions' ? { promptGuidelines: ['PROTECTED_DYNAMIC_POLICY'] } : {}),
      parameters: Type.Object({ label: Type.String() }, { additionalProperties: false }),
      execute: async (id, { label }) => {
        log({ type: 'execution', id, label });
        if (process.env.PI_RECOVERY_EFFECTS) appendFileSync(process.env.PI_RECOVERY_EFFECTS, label + '\n');
        return { content: [{ type: 'text', text: 'EXTRA_DONE' }], details: undefined };
      } });
    pi.registerCommand('hide-extra', { description: 'Deactivate the synthetic extra tool', handler: async () => {
      pi.setActiveTools(pi.getActiveTools().filter(name => name !== 'extra'));
    } });
    pi.on('session_start', (_event, ctx) => {
      if (!ctx.sessionManager.getBranch().some(row => row.message?.role === 'system' && row.message.toolsAdded?.some(tool => tool.name === 'extra'))) {
        pi.setActiveTools(pi.getActiveTools().filter(name => name !== 'extra'));
      }
    });
  }
}
