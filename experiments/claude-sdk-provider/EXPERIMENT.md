# Claude SDK provider experiment

Opt-in Pi provider `claude-sdk` for Haiku 5.5 and Opus 5.5, tested October 14, 2026. It uses Claude's local login through the official Agent SDK and leaves tool validation, permissions, and execution in Pi. Pi Remote's normal extension manifest does not load this package; enable it separately with the installation command below.

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

## Opus 5.5 verification

The same bridge passed with `claude-opus-5-5`: 21 offline tests, strict TypeScript checking, registered CLI discovery and a real prompt, two Pi-owned calls, denial with zero executions, follow-up memory, cancellation, and matching SDK/Pi usage totals. The real RPC/mobile fixture selected Opus, streamed 26 updates, exercised Allow/Deny, settled Stop in 130 ms, and retained the conversation after reload. It closed its owned worker and host. See [Opus results](verification-opus.json).

These checks use isolated configuration and synthetic tools. They do not prove a production installation or real-phone behavior.

## Initial Haiku checks

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
| Offline regression checks | The initial Haiku verification passed strict TypeScript checking and 19 tests, including malformed or missing IDs, schema validation, truncated tool calls, Unicode, cancellation, rejected history edits, and safe errors. Opus adds a model-routing regression. |

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
# Repeat the Pi-owned tool, denial, cancellation, memory, and usage checks with Opus:
PI_SDK_TEST_MODEL=claude-opus-5-5 npm run test:live
```

For the real RPC/mobile proof, install the repository's existing browser dependencies first:

```sh
# From the repository root:
npm ci --ignore-scripts
npx playwright install chromium
cd experiments/claude-sdk-provider
npm run test:remote
# Exercise Opus through the same real RPC/mobile fixture:
PI_SDK_TEST_MODEL=claude-opus-5-5 npm run test:remote
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
  -e "$provider" --model claude-sdk/claude-opus-5-5 --thinking off \
  -p 'Reply exactly SDK_CLI_OK. Do not call tools.'
```

Authentication discovery runs `claude auth status --json`, checks `loggedIn`, `claude.ai`, and `firstParty`, and does not launch an SDK query. API credentials and cloud-routing environment variables are rejected. The SDK's actual initialization event must also report no API key. Use the official Claude login flow, not Pi `/login`, for this provider.

## Enable it for the phone

After installing the dependencies, run this from `experiments/claude-sdk-provider` in the checkout your local Pi Remote host uses:

```sh
npm ci --ignore-scripts --omit=dev
pi install "$PWD"
```

This adds the provider to your personal Pi package configuration without changing your default model. In Pi Remote, start a **fresh session**, tap the model button or use `/model`, and choose `Claude SDK Opus 5.5 (experimental)`. Its full ID is `claude-sdk/claude-opus-5-5`. Existing workers do not load newly installed extensions until reloaded or replaced; starting a fresh session creates a new worker. No Pi Remote host restart is needed.

Keep reasoning off and use text only. Selectable reasoning modes are unsupported, even when the SDK emits thinking content. The experimental output limit is 4,096 tokens. To disable this package later, run `pi remove "$PWD"` from the same directory and use fresh sessions.

## Implementation boundaries

- `index.ts` registers experimental, text-only Haiku and Opus models through Pi's native provider API. Both use the same bridge and authentication checks. Catalogue prices come from Pi's host-mapped `providers/all` entry point, without local copies of Pi's packages. An offline regression loads the package with only its runtime dependencies. No picker changes or browser credentials.
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

Terminal print/JSON discovery and real RPC workers passed. Interactive terminal controls, the terminal-extension bridge path, multiple concurrent sessions, process restart, real filesystem/shell side effects, and real-phone rendering remain unverified by these isolated checks. Verify your phone's configured host separately after installation. Existing session-history research is in the [integration guide](../../docs/research/claude-agent-sdk-integration.md).
