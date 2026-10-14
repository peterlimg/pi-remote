import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, createSdkMcpServer, type EffortLevel, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createAssistantMessageEventStream, calculateCost, getCurrentSystemPrompt, getCurrentTools, normalizeContext, parseStreamingJson,
  type AssistantMessage, type JsonObject, type Message, type Model, type SimpleStreamOptions, type TranscriptContext, type Usage,
} from '@earendil-works/pi-ai';

class BridgeError extends Error {}
function fail(message: string): never { throw new BridgeError(message); }
const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const counter = z.number().int().nonnegative();
const cost = z.number().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const checkpointSchema = z.object({ version: z.literal(1), sdkSessionId: z.string().uuid(), sdkMessageId: z.string().uuid(),
  prefix: z.array(digest).max(100000), configuration: digest,
  reported: z.object({ input: counter, output: counter, cacheRead: counter, cacheWrite: counter, totalTokens: counter,
    cost: z.object({ input: cost, output: cost, cacheRead: cost, cacheWrite: cost, total: cost }) }),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function rawUsage(current: Record<string, unknown>, model: Model<string>): Usage {
  const usage = zeroUsage();
  usage.input = Number(current.input_tokens ?? 0);
  usage.output = Number(current.output_tokens ?? 0);
  usage.cacheRead = Number(current.cache_read_input_tokens ?? 0);
  usage.cacheWrite = Number(current.cache_creation_input_tokens ?? 0);
  usage.cacheWrite1h = Number((current.cache_creation as { ephemeral_1h_input_tokens?: number })?.ephemeral_1h_input_tokens ?? 0);
  usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  calculateCost(model, usage);
  return usage;
}
const stoppedTool = (): CallToolResult => ({ content: [{ type: 'text', text: 'Pi stopped this SDK session.' }], isError: true });
const project = (message: Message) => JSON.stringify({ role: message.role, content: message.content,
  ...message.role === 'toolResult' ? { id: message.toolCallId, name: message.toolName, isError: message.isError } : {} });
function contentBlocks(content: string | Message['content']): CallToolResult['content'] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map(block => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type !== 'image') fail('Unsupported Claude SDK input block.');
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(block.mimeType) || !block.data ||
      block.data.length > 4718592 || Buffer.from(block.data, 'base64').toString('base64') !== block.data) {
      fail('Claude SDK images require valid base64 JPEG, PNG, GIF, or WebP data within Pi image limits.');
    }
    return { type: 'image', data: block.data, mimeType: block.mimeType };
  });
}
function userContent(content: string | Message['content']): SDKUserMessage['message']['content'] {
  return contentBlocks(content).map(block => block.type === 'text' ? { type: 'text', text: block.text }
    : block.type === 'image' ? { type: 'image', source: { type: 'base64', data: block.data,
      media_type: block.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' } }
    : fail('Unsupported Claude SDK input block.'));
}

export function sdkEnvironment(overrides: Record<string, string> = {}) {
  const env = { ...process.env, ...overrides };
  delete env.CLAUDECODE;
  if (Object.entries(env).some(([key, value]) => value && (key.startsWith('ANTHROPIC_') ||
    key === 'CLAUDE_CODE_OAUTH_TOKEN' || key.startsWith('CLAUDE_CODE_USE_')))) {
    fail('Claude SDK provider requires a local Claude Code login without API credentials or cloud routing.');
  }
  return env;
}

type Pending = {
  name: string;
  args: Record<string, unknown>;
  task: ReturnType<typeof Promise.withResolvers<CallToolResult>>;
  handlerStarted: boolean;
  ready: ReturnType<typeof Promise.withResolvers<void>>;
};

// Resume only SDK-owned, completed checkpoints; never rebuild an SDK transcript from Pi messages.
export function createBridge(cwd: string, createQuery: typeof query = query, state: { persistSession?: boolean; checkpoint?: unknown } = {}) {
  const saved = checkpointSchema.safeParse(state.checkpoint).data;
  let run: ReturnType<typeof query> | undefined;
  const controller = new AbortController();
  const stopped = Promise.withResolvers<never>();
  // close() may run between provider requests, with no active consumer yet.
  void stopped.promise.catch(() => {});
  let closed = false;
  let busy = false;
  let cancelListener: (() => void) | undefined;
  let prefix: string[] = saved?.prefix ?? [];
  let configuration: string | undefined = saved?.configuration;
  let sdkSessionId = saved?.sdkSessionId;
  let sdkMessageId = saved?.sdkMessageId;
  let completed = false;
  let activeModel: string | undefined;
  let activeEffort: EffortLevel | undefined;
  let thinkingEnabled = false;
  let awaiting: string[] = [];
  const calls = new Map<string, Pending>();
  const issued = new Set<string>();
  const unqualified = new Set<string>();
  const prompts: SDKUserMessage[] = [];
  const helpers = new Set<{ close(): void }>();
  let wake: (() => void) | undefined;
  let reported = saved?.reported ?? zeroUsage();

  function close() {
    if (closed) return;
    closed = true;
    cancelListener?.();
    controller.abort();
    for (const helper of helpers) helper.close();
    helpers.clear();
    wake?.();
    for (const call of calls.values()) call.task.resolve(stoppedTool());
    calls.clear();
    stopped.reject(new BridgeError('Claude SDK session closed. Start a new Pi session.'));
    run?.close();
  }
  async function* input() {
    while (!closed) {
      const prompt = prompts.shift();
      if (prompt) yield prompt;
      else await new Promise<void>(resolve => { wake = resolve; });
    }
  }
  function remember(id: string, name: string, args: Record<string, unknown>) {
    const previous = calls.get(id);
    if (previous) {
      if (previous.name !== name || !isDeepStrictEqual(previous.args, args)) fail('SDK tool-call identity mismatch.');
      return previous;
    }
    const entry = { name, args, task: Promise.withResolvers<CallToolResult>(), handlerStarted: false, ready: Promise.withResolvers<void>() };
    calls.set(id, entry);
    return entry;
  }

  function streamSimple(model: Model<string>, context: TranscriptContext, options: SimpleStreamOptions = {}): ReturnType<typeof createAssistantMessageEventStream> {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now(), content: [], stopReason: 'pending', usage: zeroUsage() };
    // Helpers receive transcript data, not a live SDK conversation or executable tools.
    if (!options.sessionId && !closed) {
      const helper = createBridge(cwd, createQuery);
      helpers.add(helper);
      const transcript = context.messages.filter(message => message.role !== 'system');
      const helperStream = helper.streamSimple(model, normalizeContext({ messages: [
        { role: 'system', content: getCurrentSystemPrompt(context.messages), timestamp: Date.now() },
        { role: 'user', content: `Input transcript as JSON data:\n${JSON.stringify(transcript)}`, timestamp: Date.now() },
      ] }), { ...options, sessionId: randomUUID(), toolChoice: 'none' });
      const release = () => { helpers.delete(helper); helper.close(); };
      void helperStream.result().then(release, release);
      return helperStream;
    }
    if (busy) {
      output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = output.stopReason === 'aborted' ? 'Cancelled.' : 'Concurrent requests to one Claude SDK session are unsupported.';
      if (output.stopReason === 'error') output.content = [{ type: 'text', text: output.errorMessage }];
      stream.push({ type: 'error', reason: output.stopReason, error: output });
      stream.end();
      return stream;
    }
    busy = true;
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        options.signal?.throwIfAborted();
        if (closed) fail('Claude SDK session is no longer available. Start a new Pi session.');
        if (options.fetch || options.apiKey || options.headers && Object.keys(options.headers).length || options.temperature !== undefined) {
          fail('Unsupported Claude SDK request options. Use local login and Pi-owned tools.');
        }
        const effort: EffortLevel = options.reasoning === 'minimal' || !options.reasoning ? 'low' : options.reasoning;
        if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) fail('Unsupported Claude SDK thinking effort.');
        const enabled = Boolean(options.reasoning);
        const maxTokens = options.maxTokens ?? Math.min(model.maxTokens, 16000);
        if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > model.maxTokens) fail('Invalid Claude SDK output token limit.');
        const env = sdkEnvironment(options.env);
        const tools = options.toolChoice === 'none' ? [] : getCurrentTools(context.messages);
        const byName = new Map(tools.map(tool => [tool.name, tool]));
        if (byName.size !== tools.length || tools.some(tool => !('type' in tool.parameters) || tool.parameters.type !== 'object')) fail('Unsupported Pi tool declarations.');
        const systemPrompt = getCurrentSystemPrompt(context.messages);
        const sdkSystemPrompt = tools.length ? `${systemPrompt}\n\nSDK tool-call names: ${tools.map(tool => `mcp__pi__${tool.name}`).join(', ')}. Pi instructions use unqualified names; call the SDK names exactly. Bare names and Claude Code built-in tools are unavailable.` : systemPrompt;
        // SDK adds process markers after startup; explicit overrides define the live query's configuration.
        const config = hash(JSON.stringify({ cwd, sessionId: options.sessionId, systemPrompt, tools, env: options.env, maxTokens }));
        const conversation = context.messages.filter(message => message.role !== 'system');
        const projected = conversation.map(message => hash(project(message)));
        if (configuration !== undefined && configuration !== config) fail('SDK prompt, tools, environment, or output limit changed. Start a new Pi session.');
        if (!prefix.every((value, index) => projected[index] === value)) fail('SDK history changed or was compacted. Start a new Pi session.');
        const delta = conversation.slice(prefix.length);
        let prompt: SDKUserMessage['message']['content'] | undefined;
        if (awaiting.length) {
          if (delta.length !== awaiting.length || delta.some(message => message.role !== 'toolResult') ||
            new Set(delta.map(message => message.role === 'toolResult' ? message.toolCallId : '')).size !== awaiting.length) {
            fail('Expected exactly one Pi result for every SDK tool call.');
          }
          for (const result of delta) {
            if (result.role !== 'toolResult' || !awaiting.includes(result.toolCallId) || calls.get(result.toolCallId)?.name !== result.toolName) {
              fail('Pi tool result does not match an outstanding SDK call.');
            }
            contentBlocks(result.content);
          }
        } else {
          if (delta.length !== 1 || delta[0].role !== 'user') fail('This provider requires a fresh session or one new user message in its known live history.');
          prompt = userContent(delta[0].content);
          const text = typeof prompt === 'string' ? prompt : prompt.filter(block => block.type === 'text').map(block => block.text).join('');
          if (text.trimStart().startsWith('/')) fail('SDK slash commands are unsupported. Use Pi commands instead.');
        }
        const payload = { model: model.id, prompt, toolResults: prompt === undefined ? delta : undefined, systemPrompt: sdkSystemPrompt, tools };
        const inspection = structuredClone(payload);
        const replacement = await options.onPayload?.(inspection, model);
        if (!isDeepStrictEqual(payload, inspection) || replacement !== undefined && !isDeepStrictEqual(payload, replacement)) fail('Replacing SDK request payloads is unsupported.');
        options.signal?.throwIfAborted();
        cancelListener?.();
        options.signal?.addEventListener('abort', close, { once: true });
        cancelListener = () => options.signal?.removeEventListener('abort', close);
        timer = setTimeout(() => { stopped.reject(new BridgeError('Claude SDK request timed out. Start a new Pi session.')); close(); }, options.timeoutMs ?? 120000);
        completed = false;
        if (!run) {
          for (const message of conversation) if (message.role === 'assistant') {
            for (const block of message.content) if (block.type === 'toolCall') issued.add(block.id);
          }
          const server = createSdkMcpServer({ name: 'pi', tools: [], alwaysLoad: true });
          // Preserve Pi's JSON schemas verbatim; Pi validates before executing.
          server.instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(tool => ({
            name: tool.name, description: tool.description, inputSchema: tool.parameters,
            _meta: { 'anthropic/alwaysLoad': true },
          })) }));
          server.instance.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            if (closed) return stoppedTool();
            const id = extra._meta?.['claudecode/toolUseId'];
            if (typeof id !== 'string' || !id || !byName.has(request.params.name)) {
              close();
              return stoppedTool();
            }
            try {
              const entry = remember(id, request.params.name, request.params.arguments ?? {});
              if (entry.handlerStarted) { close(); return stoppedTool(); }
              entry.handlerStarted = true;
              entry.ready.resolve();
              extra.signal.addEventListener('abort', close, { once: true });
              try { return await entry.task.promise; }
              finally { extra.signal.removeEventListener('abort', close); }
            } catch { close(); return stoppedTool(); }
          });
          run = createQuery({ prompt: input(), options: {
            cwd, model: model.id, systemPrompt: sdkSystemPrompt, env: { ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxTokens) },
            tools: [], mcpServers: tools.length ? { pi: server } : undefined, settingSources: [], strictMcpConfig: true,
            settings: { disableAllHooks: true, autoMemoryEnabled: false, autoCompactEnabled: false, idleCompaction: false },
            thinking: { type: enabled ? 'adaptive' : 'disabled' }, effort, includePartialMessages: true,
            persistSession: state.persistSession ?? false, resume: saved?.sdkSessionId, resumeSessionAt: saved?.sdkMessageId,
            abortController: controller,
            canUseTool: async name => byName.has(name.replace(/^mcp__pi__/, '')) && name.startsWith('mcp__pi__')
              ? { behavior: 'allow' } : { behavior: 'deny', message: 'Tool is not exposed by Pi.' },
          } });
          configuration = config;
          activeModel = model.id;
          activeEffort = effort;
          thinkingEnabled = enabled;
        } else {
          if (activeModel !== model.id) { await run.setModel(model.id); activeModel = model.id; }
          if (thinkingEnabled !== enabled) { await run.setMaxThinkingTokens(enabled ? 1 : 0); thinkingEnabled = enabled; }
          if (activeEffort !== effort) { await run.applyFlagSettings({ effortLevel: effort }); activeEffort = effort; }
        }
        options.signal?.throwIfAborted();
        if (prompt !== undefined) {
          prompts.push({ type: 'user', session_id: '', parent_tool_use_id: null, uuid: randomUUID(), message: { role: 'user', content: prompt } });
          wake?.();
        } else {
          for (const result of delta) {
            if (result.role === 'toolResult') calls.get(result.toolCallId)!.task.resolve({
              content: contentBlocks(result.content), isError: result.isError,
            });
          }
          awaiting = [];
        }
        stream.push({ type: 'start', partial: output });
        const blocks = new Map<number, { index: number; json: string; ended: boolean; internal?: boolean }>();
        let unqualifiedAttempts = 0;
        let currentUsage: Record<string, unknown> = {};
        let reason: string | null = null;
        let messageOpen = false;
        while (true) {
          options.signal?.throwIfAborted();
          const next = await Promise.race([run.next(), stopped.promise]);
          options.signal?.throwIfAborted();
          if (next.done) fail('SDK ended before completing a Pi response.');
          const event = next.value;
          await options.onProviderStreamEvent?.(event, model);
          options.signal?.throwIfAborted();
          if (closed) fail('Claude SDK session closed. Start a new Pi session.');
          if (event.type === 'system' && event.subtype === 'init') {
            sdkSessionId = event.session_id;
            if (event.apiKeySource !== 'none') fail('SDK resolved API-key authentication instead of local Claude login.');
            if (!isDeepStrictEqual([...event.tools].sort(), tools.map(tool => `mcp__pi__${tool.name}`).sort())) fail('SDK exposed tools outside Pi.');
          }
          if (event.type === 'system' && (event.subtype === 'compact_boundary' || event.subtype === 'status' && event.status === 'compacting') ||
            event.type === 'conversation_reset') fail('SDK context management changed its history. Start a new Pi session.');
          if (event.type === 'assistant' && event.error) fail(`Claude SDK reported ${event.error}. Check Claude Code login and start a new session.`);
          if (event.type === 'assistant' && !event.parent_tool_use_id) sdkMessageId = event.uuid;
          if (event.type === 'user' && !event.parent_tool_use_id && Array.isArray(event.message.content)) {
            for (const block of event.message.content) if (block.type === 'tool_result' && unqualified.has(block.tool_use_id)) {
              if (block.is_error !== true) fail('SDK did not reject an unqualified tool call.');
              unqualified.delete(block.tool_use_id);
            }
          }
          if (event.type === 'stream_event') {
            if (event.parent_tool_use_id) fail('SDK subagent messages are unsupported.');
            const raw = event.event;
            if (raw.type === 'message_start') {
              if (messageOpen) fail('Overlapping SDK model messages are unsupported.');
              if (unqualified.size) fail('SDK did not reject an unqualified tool call.');
              messageOpen = true; blocks.clear(); reason = null;
              currentUsage = { ...raw.message.usage };
              output.usage = rawUsage(currentUsage, model);
              output.responseId = raw.message.id;
              if (raw.message.model !== model.id) fail('SDK used an unexpected model.');
            }
            if (raw.type === 'content_block_start') {
              if (!messageOpen || blocks.has(raw.index)) fail('Malformed SDK content stream.');
              const index = output.content.length;
              const block = raw.content_block;
              if (block.type === 'text') {
                output.content.push({ type: 'text', text: block.text });
                stream.push({ type: 'text_start', contentIndex: index, partial: output });
              } else if (block.type === 'tool_use') {
                const name = block.name.replace(/^mcp__pi__/, '');
                if (!block.name.startsWith('mcp__pi__') || !byName.has(name)) {
                  if (!byName.has(block.name)) fail('SDK requested a tool outside Pi.');
                  if (!block.id || issued.has(block.id)) fail('SDK repeated a previously issued tool-call ID.');
                  if (++unqualifiedAttempts > 3) fail('SDK repeatedly requested unqualified Pi tool names. Start a new Pi session.');
                  issued.add(block.id);
                  unqualified.add(block.id);
                  // SDK rejects bare names internally; never dispatch them to Pi or stop its corrected retry.
                  blocks.set(raw.index, { index, json: '', ended: false, internal: true });
                  continue;
                }
                if (!block.input || typeof block.input !== 'object' || Array.isArray(block.input)) fail('Malformed SDK tool arguments.');
                output.content.push({ type: 'toolCall', id: block.id, name, arguments: block.input as JsonObject });
                stream.push({ type: 'toolcall_start', contentIndex: index, partial: output });
              } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                output.content.push(block.type === 'thinking'
                  ? { type: 'thinking', thinking: block.thinking, thinkingSignature: block.signature }
                  : { type: 'thinking', thinking: '[Reasoning redacted]', thinkingSignature: block.data, redacted: true });
                stream.push({ type: 'thinking_start', contentIndex: index, partial: output });
              } else fail(`Unsupported SDK content block: ${block.type}.`);
              blocks.set(raw.index, { index, json: '', ended: false });
            }
            if (raw.type === 'content_block_delta' || raw.type === 'content_block_stop') {
              const state = blocks.get(raw.index);
              if (!state || state.ended) fail('Malformed SDK content stream.');
              if (state.internal) {
                if (raw.type === 'content_block_stop') state.ended = true;
                else if (raw.delta.type !== 'input_json_delta') fail('Unsupported SDK content delta.');
                continue;
              }
              const block = output.content[state.index];
              if (raw.type === 'content_block_delta') {
                if (raw.delta.type === 'text_delta' && block.type === 'text') {
                  block.text += raw.delta.text;
                  stream.push({ type: 'text_delta', contentIndex: state.index, delta: raw.delta.text, partial: output });
                } else if (raw.delta.type === 'input_json_delta' && block.type === 'toolCall') {
                  state.json += raw.delta.partial_json;
                  block.arguments = parseStreamingJson(state.json);
                  stream.push({ type: 'toolcall_delta', contentIndex: state.index, delta: raw.delta.partial_json, partial: output });
                } else if (raw.delta.type === 'thinking_delta' && block.type === 'thinking') {
                  block.thinking += raw.delta.thinking;
                  stream.push({ type: 'thinking_delta', contentIndex: state.index, delta: raw.delta.thinking, partial: output });
                } else if (raw.delta.type === 'signature_delta' && block.type === 'thinking') {
                  block.thinkingSignature = (block.thinkingSignature ?? '') + raw.delta.signature;
                } else fail('Unsupported SDK content delta.');
              } else {
                state.ended = true;
                if (block.type === 'text') stream.push({ type: 'text_end', contentIndex: state.index, content: block.text, partial: output });
                if (block.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex: state.index, content: block.thinking, partial: output });
                if (block.type === 'toolCall') {
                  if (state.json) block.arguments = JSON.parse(state.json);
                  if (!block.arguments || typeof block.arguments !== 'object' || Array.isArray(block.arguments)) fail('Malformed SDK tool arguments.');
                  if (issued.has(block.id)) fail('SDK repeated a previously issued tool-call ID.');
                  issued.add(block.id);
                  remember(block.id, block.name, block.arguments);
                  stream.push({ type: 'toolcall_end', contentIndex: state.index, toolCall: block, partial: output });
                }
              }
            }
            if (raw.type === 'message_delta') {
              reason = raw.delta.stop_reason ?? reason;
              currentUsage = { ...currentUsage, ...Object.fromEntries(Object.entries(raw.usage).filter(([, value]) => value != null)) };
              output.usage = rawUsage(currentUsage, model);
            }
            if (raw.type === 'message_stop') {
              if (!messageOpen || [...blocks.values()].some(block => !block.ended)) fail('Incomplete SDK content stream.');
              messageOpen = false;
              const toolCalls = output.content.filter(block => block.type === 'toolCall');
              if (toolCalls.length) {
                if (reason !== 'tool_use' || new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) fail('SDK tool batch was incomplete or truncated.');
                awaiting = toolCalls.map(call => call.id);
                // Check ID metadata support; SDK may invoke this batch's handlers sequentially.
                await Promise.race([Promise.race(awaiting.map(id => calls.get(id)!.ready.promise)), stopped.promise]);
                options.signal?.throwIfAborted();
                output.stopReason = 'toolUse';
                break;
              }
            }
          }
          if (event.type === 'result') {
            if (messageOpen || awaiting.length) fail('SDK result arrived before completing its message.');
            if (unqualified.size) fail('SDK did not reject an unqualified tool call.');
            const totals = zeroUsage();
            for (const usage of Object.values(event.modelUsage)) {
              totals.input += usage.inputTokens; totals.output += usage.outputTokens;
              totals.cacheRead += usage.cacheReadInputTokens; totals.cacheWrite += usage.cacheCreationInputTokens;
            }
            for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
              totals[key] -= reported[key];
              if (totals[key] < 0) fail('SDK cumulative usage changed unexpectedly.');
            }
            totals.totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
            calculateCost(model, totals);
            totals.cost.total = event.total_cost_usd - reported.cost.total;
            output.usage = totals;
            if (event.subtype !== 'success' || event.is_error) fail('Claude SDK turn failed. Check Claude Code and start a new Pi session.');
            output.stopReason = event.stop_reason === 'max_tokens' ? 'length' : 'stop';
            completed = true;
            cancelListener?.(); cancelListener = undefined;
            break;
          }
        }
        prefix = [...projected, hash(project(output))];
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) reported[key] += output.usage[key];
        reported.cost.total += output.usage.cost.total;
        stream.push({ type: 'done', reason: output.stopReason as 'stop' | 'length' | 'toolUse', message: output });
      } catch (error) {
        output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = output.stopReason === 'aborted' ? 'Cancelled.' : error instanceof BridgeError ? error.message :
          'Claude SDK request failed. Check Claude Code login and start a new Pi session.';
        output.content = output.stopReason === 'aborted' ? [] : [{ type: 'text', text: output.errorMessage }];
        close();
        stream.push({ type: 'error', reason: output.stopReason, error: output });
      } finally {
        clearTimeout(timer);
        busy = false;
        stream.end();
      }
    })();
    return stream;
  }
  return { streamSimple, close, checkpoint: () => {
    if (!state.persistSession || closed || !completed || !sdkSessionId || !sdkMessageId || !configuration) return undefined;
    return { version: 1 as const, sdkSessionId, sdkMessageId, configuration, prefix: [...prefix], reported: structuredClone(reported) };
  } };
}
