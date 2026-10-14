# Integrating the Claude Agent SDK as a Pi model

This guide covers selecting Claude SDK access in Pi's `/model` while keeping Pi's tools and extensions. It differs from Amp's separate-agent mode. A [runnable opt-in prototype](../../experiments/claude-sdk-provider/EXPERIMENT.md) verifies the restricted fresh-session path with Haiku 5.5 and Opus 5.5. It requires separate installation and does not load through Pi Remote's default extension manifest.

Checked against `@anthropic-ai/claude-agent-sdk` 0.3.296, its shipped `sdk.d.ts`, and installed Pi 1.1.0. See [research and live evidence](claude-agent-sdk.md) for policy, experiments, and limitations.

## Ownership

```mermaid
sequenceDiagram
    participant Pi as Pi agent loop
    participant Bridge as Provider extension
    participant SDK as Claude Agent SDK
    participant Tools as Pi tools and permission hooks
    Pi->>Bridge: streamSimple(model, transcript, options)
    Bridge->>SDK: query(user input, SDK options)
    SDK-->>Bridge: assistant tool_use
    Note over SDK,Bridge: SDK MCP handler waits and executes nothing
    Bridge-->>Pi: toolCall, stopReason = toolUse
    Pi->>Tools: Validate, authorize, execute
    Tools-->>Pi: Tool result or denial
    Pi->>Bridge: Next streamSimple, transcript includes toolResult
    Bridge->>SDK: Resolve waiting MCP handler with Pi result
    SDK-->>Bridge: Next assistant response
    Bridge-->>Pi: Text, usage, stopReason = stop
```

The provider must not execute the tool in its MCP handler and then also emit a Pi tool call. Pi remains the only executor. The SDK still owns its internal model loop and transcript; the adapter coordinates the two, it does not remove the SDK loop.

## SDK interfaces to use

| SDK interface | Integration responsibility |
| --- | --- |
| `query({ prompt, options })` | Start the SDK conversation and consume typed events |
| `prompt: AsyncIterable<SDKUserMessage>` | Keep an interactive process open for successive user inputs; supports images and control methods |
| `createSdkMcpServer()` and `tool()` | Advertise Pi-backed tools to Claude through an in-process MCP server |
| `tools: []` | Remove SDK built-in tools so they cannot bypass Pi execution |
| `strictMcpConfig: true` | Limit MCP discovery to explicitly supplied servers |
| `settingSources: []` | Avoid implicitly loading user/project Claude settings alongside Pi's instructions |
| `includePartialMessages: true` | Receive `stream_event` deltas, not only complete assistant messages |
| `canUseTool` | Allow only the declared bridge tools into the SDK handler; Pi still decides whether the underlying action may execute |
| `supportedModels()` / `accountInfo()` | Obtain SDK model/account metadata after initialization; do not log account identities or credentials |
| `resume`, `forkSession`, `resumeSessionAt` | SDK history controls, not automatic equivalents of Pi's session tree |
| `interrupt()` | Interrupt streaming-input execution; queued inputs may remain, so it is not a sufficient hard-stop operation by itself |
| `close()` and `abortController` | Terminate the SDK query and cooperate with cancellation in host work |

`tool()` accepts a Zod raw shape; Pi declares tools with TypeBox/JSON Schema. A general adapter needs a checked schema conversion or an MCP server that preserves the original JSON Schema. Do not replace validation with an unrestricted `any` schema. The earlier single-call experiment uses one explicit schema. The registered prototype instead advertises Pi's original JSON schemas through the SDK MCP server's public list/call handlers; Pi remains the argument validator.

## Smallest SDK-facing example

This is a single-tool code sketch. `userPrompt`, `cwd`, and `piSystemPrompt` are supplied by the host. The event-to-Pi conversion is the next section, not hidden inside this snippet.

```ts
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// One outstanding synthetic tool result, as in the tested experiment.
const pending = Promise.withResolvers<CallToolResult>();
const abortController = new AbortController();
const server = createSdkMcpServer({
  name: 'pi',
  alwaysLoad: true,
  tools: [tool(
    'probe', 'Return a synthetic test token', { label: z.string() },
    async () => pending.promise,
  )],
});

const run = query({
  prompt: userPrompt,
  options: {
    cwd,
    model: 'haiku',
    systemPrompt: piSystemPrompt,
    tools: [],
    mcpServers: { pi: server },
    strictMcpConfig: true,
    settingSources: [],
    includePartialMessages: true,
    persistSession: false, // Scratch demo only, not restart support.
    abortController,
    canUseTool: async name => name === 'mcp__pi__probe'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Tool is not exposed by Pi' },
  },
});

// Called after Pi executes/denies the tool and its call ID is matched:
function returnPiToolResult(result: CallToolResult) {
  pending.resolve(result);
}

// Called on abort/shutdown; the caller must also reject new input:
function stop() {
  pending.resolve({ content: [{ type: 'text', text: 'Aborted' }], isError: true });
  run.close();
  abortController.abort();
}
```

The two callbacks run later through the adapter's lifecycle handling. For runnable code rather than a sketch, use the [assert-based Pi handoff experiment](https://github.com/peterlimg/pi-remote/blob/328a4fe/experiments/claude-agent-sdk/pi-handoff.mjs).

## Pi-facing provider logic

```text
streamSimple(model, transcript, options)
  if options.signal is aborted
    return an aborted Pi stream without touching the SDK

  if this is the next user input in the known live conversation
    start or feed this session's SDK query
  else if this supplies results for outstanding SDK tool calls
    validate call IDs and resolve the waiting MCP handlers
  else
    reject unsupported history changes rather than silently lose context

  consume SDK events
    stream_event     -> Pi text/thinking/tool argument deltas
    assistant        -> finalize blocks and preserve tool call IDs
    complete tool-call batch -> finish this Pi response with toolUse
    user/tool_result -> acknowledge SDK echo; do not execute or record twice
    result           -> finalize the Pi response and SDK usage accounting

  on abort
    stop accepting input; release waiting handlers; close SDK query
    suppress late content; emit one aborted terminal Pi event
```

Real implementation must handle a complete assistant tool-call batch, not just stop on its first tool block. Multiple same-name calls with identical arguments require reliable correlation to their SDK and Pi call IDs. The shipped MCP handler's `extra` argument is typed `unknown`; do not assume it contains a documented Anthropic tool-use ID. The earlier single-call experiment avoided that mapping problem.

[Static inspection of Amp's shipped adapter](amp-sdk-static-analysis.md) found that it reads `extra._meta["claudecode/toolUseId"]` and rejects calls without a string ID. The October 14 [correlation test and registered prototype](../../experiments/claude-sdk-provider/EXPERIMENT.md) verified this metadata with the pinned SDK, including identical parallel calls and reverse-order results. It remains an implementation behavior, not an established public SDK contract. Unannotated MCP handlers can be scheduled serially, so the bridge cannot wait for every handler before returning a complete batch to Pi.

A streaming-input query can span user turns. A `result` then ends the current run, not necessarily the lifetime of the input generator. The earlier experiment used string input and one live query; the registered prototype now verifies persistent input and a second user turn recovering a random marker.

## Extension and authentication boundary

Keep this in a separate Pi extension package, not in Pi Remote's browser bundle:

```text
pi-claude-sdk/
  index.ts       registerProvider + model metadata + session lifecycle
  bridge.ts      SDK query, pending tools, event conversion, cancellation
  bridge.test.ts tool round trip, denial, batching, abort, history mismatch
```

Use `pi.registerProvider()` with a native provider and custom `streamSimple`. Source Pi prompt/tool state from `getCurrentSystemPrompt(context.messages)` and `getCurrentTools(context.messages)`. Own query state per Pi session, not in one process-global singleton. Release it on session replacement, model changes, extension reload, and shutdown.

For local subscription access, sign in using Claude's supported local login and let the SDK resolve it. No token copying into `models.json`, no fabricated API key to bypass model availability, and no browser credential delivery. The provider must explicitly model ambient SDK authentication and report unavailable/expired login instead of advertising unconditional availability. Startup/CLI inspection should not launch a long-lived agent just because the extension factory loaded.

Pi Remote already discovers registered models via `ctx.modelRegistry.getAvailable()` in `extension/index.ts` and `get_available_models` in `src/rpc.mjs`. The registered prototype passes CLI discovery and a real RPC/mobile model-picker proof without redesigning the picker. The terminal-extension bridge path remains unverified.

## First implementation scope

The prototype supports fresh SDK-backed Pi sessions, text input, complete Pi tool batches, normal Pi permission hooks, streaming, cumulative usage, and hard cancellation. Fail clearly on unsupported resume, compaction, branch changes, or cross-provider history rather than flattening old messages into a new user prompt. Keep SDK context-management changes detectable so the two histories cannot silently diverge.

Before calling this a normal `/model` provider, verify parallel-call correlation, SDK-to-Pi checkpoint mapping, process restart, cross-provider handoff, images, reasoning settings, malformed streams, and actual serialized errors. Provider request/response instrumentation also needs an honest mapping: the SDK does not expose every underlying HTTP detail available to Pi's direct HTTP providers. Do not fabricate response headers.

The [prototype report](../../experiments/claude-sdk-provider/EXPERIMENT.md) distinguishes the newer registered-provider evidence from the earlier single-call experiment. Nineteen offline tests and live correlation, Pi permission, memory, usage, cancellation, CLI, and real RPC/mobile checks passed. General restoration, interactive terminal controls, images, concurrent sessions, and production delivery remain unverified.

## Primary references

- [SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- [Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Pi provider documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
