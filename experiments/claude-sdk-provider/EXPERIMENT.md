# Claude SDK provider experiment

Opt-in Pi provider `claude-sdk`, tested October 14, 2026. It uses Claude's local login through the official Agent SDK and leaves tool validation, permissions, and execution in Pi. This package is not loaded by Pi Remote's normal extension manifest and is not installed in the user's Pi configuration.

```text
Pi or Pi Remote
  → Pi session and provider extension
    → Claude Agent SDK
      → assistant tool call
    ← stream the call to Pi
  → Pi validates, asks permission, executes
    → return the result to the waiting SDK MCP handler
    ← Claude response and usage
```

## What passed

See [recorded results](verification.json). Tests use synthetic prompts and in-memory tools, not real shell commands or file mutations.

| Check | Evidence |
| --- | --- |
| Parallel identical calls | Two read-only SDK MCP handlers overlapped. Each received its assistant call ID through `_meta["claudecode/toolUseId"]`. Reverse-order results kept their identity. |
| Pi-owned execution | Two identical calls passed Pi preflight and executed exactly twice. Results echoed back from the SDK matched Pi's call IDs and content. |
| Denial | Pi preflight denied both calls. Zero executions. Claude received both errors. |
| Follow-up memory | A second user turn recovered a random marker through the same live query, without repeating tools. |
| Streaming and usage | Text and tool-argument deltas streamed. Summed Pi tokens and estimated cost matched cumulative SDK pipeline totals without double-counting. |
| Cancellation | Direct Pi cancellation settled in 1 ms in the recorded run and emitted an empty aborted response. |
| Registered CLI provider | `pi --list-models claude-sdk` discovered Haiku; a fresh isolated CLI invocation returned `SDK_CLI_OK`. |
| Pi Remote RPC | A real host-owned Pi worker discovered and selected the registered provider through the mobile model picker. Allow/Deny dialogs controlled execution, streaming reached the browser, Stop settled in 126 ms, and reloading preserved the synthetic conversation. |
| Offline regression checks | Strict TypeScript checking and 19 tests passed, including malformed or missing IDs, schema validation, truncated tool calls, Unicode, cancellation, rejected history edits, and safe errors. |

The browser proof uses Chromium with Playwright's iPhone 13 profile. It is not a real iPhone, Safari, or an opentunnel deployment proof. [Screenshot after reload](evidence/mobile-after-reload.png).

## Run it

Requirements: Node 22.19+, Pi 1.1.0, and a local first-party Claude login. SDK 0.3.296 bundles Claude Code 2.1.296. The separately installed `claude` command used for the authentication check was 2.1.299. No subscription tokens are copied into Pi, and no fake API key is supplied.

```sh
cd experiments/claude-sdk-provider
npm ci --ignore-scripts
npm run check
npm test
```

The offline suite never calls Claude or needs a login. CI runs these two checks in a separate job. Live checks consume Claude plan usage:

```sh
npm run test:correlation
npm run test:live
```

For the real RPC/mobile proof, install the repository's existing browser dependencies first:

```sh
# From the repository root:
npm ci --ignore-scripts
npx playwright install chromium
cd experiments/claude-sdk-provider
npm run test:remote
```

The mobile script creates its own temporary Pi configuration, session, host on an available loopback port, and browser context. It disables external relays, exposes only its synthetic tool, and closes its owned worker and host. It retains logs, traces, and screenshots in the printed evidence directory. Never use that test's known browser token for a deployment.

To try a text-only CLI prompt without loading normal Pi resources or executing tools:

```sh
# Start in experiments/claude-sdk-provider after npm ci.
provider="$PWD"
scratch="$(mktemp -d)"
mkdir "$scratch/agent" "$scratch/project"
cd "$scratch/project"
PI_CODING_AGENT_DIR="$scratch/agent" PI_OFFLINE=1 \
  pi -ne -ns -np -nc --no-mcp --no-tools --no-session \
  -e "$provider" --model claude-sdk/claude-haiku-5-5 --thinking off \
  -p 'Reply exactly SDK_CLI_OK. Do not call tools.'
```

Authentication discovery runs `claude auth status --json`, checks `loggedIn`, `claude.ai`, and `firstParty`, and does not launch an SDK query. API credentials and cloud-routing environment variables are rejected. The SDK's actual initialization event must also report no API key. Use the official Claude login flow, not Pi `/login`, for this provider.

## Implementation boundaries

- `index.ts` registers one experimental, text-only Haiku model through Pi's native provider API. No picker changes, global settings edits, or browser credentials.
- `bridge.ts` keeps one live SDK query per Pi session. Its MCP server advertises Pi's JSON schemas unchanged. Handlers wait for Pi results and never execute tools.
- SDK built-in tools, implicit MCP servers, hooks, auto-memory, project settings, and SDK session persistence are disabled.
- The provider checks the entire known conversation prefix and model, system prompt, tools, and explicit environment configuration. A mismatch closes the query rather than replaying tools or silently losing history.
- Pi request-payload and raw provider-stream hooks are supported. Payload replacement is rejected. The SDK does not expose underlying HTTP response headers, so no synthetic response or header events are invented.
- SDK result totals include pipeline usage. Cost is the SDK's nominal estimate, not a subscription-balance measurement or proof of what was charged. Intermediate and cancelled responses use observed tokens and Pi catalogue price estimates. Cost components are estimates; only the completed cumulative cost total is reconciled to the SDK.

Two live findings changed the implementation. Unannotated MCP tools can run serially, so waiting for every handler before returning the batch deadlocks. The bridge checks the first handler's ID support, returns the complete batch to Pi, and resolves subsequent handlers by their explicit IDs. The SDK also emits thinking frames despite `thinking: disabled`; those frames and signatures are preserved, but selectable reasoning modes are not supported.

Pi 1.1.0's lazy authentication wrapper turns an already-aborted request into a generic setup error before this provider runs. A documented `message_end` replacement normalizes that error only for `claude-sdk` while the active Pi signal is aborted. The fix neither changes tool execution nor patches Pi. The offline regression reproduces the native authentication path, and the live RPC proof asserts an empty `aborted` result.

## Do not use it for restored history yet

Start a fresh session. Restart, resume, compaction, forks, tree navigation, cross-provider history, images, nested model requests, steering during tool batches, model changes, and dynamic prompt/tool updates are unsupported. Cancellation closes the SDK query; start a new Pi session afterward. History operations are blocked while this provider is selected, and unrecognized transcripts fail explicitly.

The tool-ID metadata is a verified behavior of the pinned SDK, not an established public API guarantee. A later invalid handler closes the session, but a preceding Pi-approved batch may already have executed. Cancellation does not undo completed tools or forcibly stop a tool that ignores Pi's abort signal. Settlement timings above measure Pi completion, not OS child-process exit time.

Terminal print/JSON discovery and real RPC workers passed. Interactive terminal controls, the terminal-extension bridge path, multiple concurrent sessions, process restart, real filesystem/shell side effects, real-phone rendering, and production delivery remain unverified. Existing session-history research is in the [integration guide](../../docs/research/claude-agent-sdk-integration.md).
