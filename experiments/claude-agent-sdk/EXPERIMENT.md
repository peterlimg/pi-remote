# Throwaway Claude Agent SDK / Pi experiment

Question: can the official SDK use the existing local Claude login, and can Pi keep ownership of tool execution?

These are live, assert-based experiments, not a production provider. Checked October 13, 2026 on macOS with Node 26.5.0, Agent SDK 0.3.296, Claude Code 2.1.296, and Pi agent-core/AI 1.1.0. The SDK's `haiku` alias resolved to `claude-haiku-5-5`.

## Run

Requires a supported Node version and an existing Claude login, or separately supplied supported API credentials. Running this consumes model usage. Each SDK query has a $0.15 estimated budget and 60-second timeout; the budget is not a hard billing cap. The experiment disables built-in tools and project/user settings. It registers only an in-memory synthetic tool and sends no repository contents.

```sh
cd experiments/claude-agent-sdk
npm ci
npm test
```

`experiment.mjs` checks the SDK directly. `pi-handoff.mjs` runs a real Pi `Agent` with an experimental stream function. `node pi-handoff.mjs abort` runs only the Pi cancellation check. Scripts create a local `sandbox/` and replace their JSON result files. The direct SDK memory test persists synthetic session history in Claude's normal session directory so it can resume it. They do not change Pi configuration.

The scripts discard inherited `CLAUDE_*` process-routing variables before launching independent SDK sessions. They leave the local login in place and do not read or copy credential files.

## Observations

The existing local login reported `claude.ai`, first-party provider, and a Team subscription. No Anthropic key variable was present. SDK initialization reported `apiKeySource: none`, and requests succeeded. This verifies technical access for this account, not approval to distribute a subscription-backed product or the billing ledger behind each request.

| Check | Observed outcome |
| --- | --- |
| Text and partial streaming | Exact ACK response and partial content events |
| SDK resume | A new query recovered a random marker from the preceding session |
| SDK custom MCP tool | One handler execution, then a final answer containing the handler's random token |
| `maxTurns: 1` | Handler still executed once, then SDK returned `error_max_turns` |
| SDK controller abort during the handler | Cooperative handler cancelled, but SDK emitted a final answer and success result before throwing ordinary `Error: Claude Code process aborted by user` |
| Pi tool handoff | Two Pi provider calls, one SDK bridge handler, one Pi preflight, one real Pi tool execution, correct final token |
| Pi permission denial | Pi preflight blocked the call, zero Pi tool executions, SDK received the error and answered DENIED |
| Pi abort | After explicit SDK close and an early signal check, no SDK reads after abort and Pi's final assistant message was empty with stop reason `aborted` |

The direct SDK cancellation behavior occurred in both the initial run and final validation. The first script originally asserted the exception class was `AbortError`; that assertion failed because this version threw ordinary `Error`. The final script asserts an abort error message and records any result emitted beforehand rather than misclassifying this as clean cancellation.

The first Pi abort check incorrectly expected no second provider invocation. Pi does invoke the provider with an already-aborted signal after this tool cancellation. Checking that signal before touching the SDK made the final abort check settle in less than 1 ms in final validation, versus about 2 seconds before the early check. This measures Pi settlement, not operating-system child-process exit latency.

## Handoff under test

```text
SDK assistant tool_use
  -> Pi assistant toolCall
  -> Pi argument validation and permission hook
  -> Pi execute(), or a denied tool result
  -> next Pi provider call resolves the waiting MCP handler
  -> SDK observes Pi's tool result and generates its answer
```

The SDK MCP handler performs no underlying tool work. It waits for a result from Pi. That separation prevents duplicate execution in the tested uninterrupted run.

## Deliberate omissions

The bridge supports one synthetic tool call in one live query. It is not registered in Pi's model catalog. It does not implement general transcript replay, SDK process restoration, branch/compaction mapping, model switching, concurrent sessions, parallel tools, images, or provider instrumentation. It buffers complete SDK assistant messages rather than mapping partial deltas. Pi-side usage is deliberately zeroed; SDK cost estimates remain in the experiment results, so this is not a billing implementation. Cancellation uses a cooperative timer, not a real subprocess or a tool with external side effects.

`results.json` and `pi-handoff-results.json` are the captured final validation. All three Pi scenarios passed. Subscription policy and mobile behavior remain unverified.
