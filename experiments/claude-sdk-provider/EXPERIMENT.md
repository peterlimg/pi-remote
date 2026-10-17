# Claude SDK provider experiment

Opt-in Pi provider `claude-sdk` for Haiku 5.5, Sonnet 5.5, and Opus 5.5, tested October 14, 2026. It uses Claude's local login through the official Agent SDK and leaves tool validation, permissions, and execution in Pi. Pi Remote's normal extension manifest does not load this package; enable it separately with the installation command below.

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

## Everyday controls

The expanded provider passed strict TypeScript checking and 30 offline tests. Live SDK checks covered image inputs and tool results, model and effort changes, independent title generation, and completed-checkpoint recovery. CLI discovery listed all three models with thinking and image support; Sonnet with High returned `SDK_COMMON_CLI_OK`. The real Pi RPC/mobile fixture selected High through the reasoning picker, restarted its own worker, recovered the saved SDK conversation without repeating tools, exercised Allow/Deny/Stop, and retained the conversation on reload. See [current results](verification-common.json).

| Function | Behavior |
| --- | --- |
| Thinking | Pi Low, Medium, High, Extra high, and Max map to SDK adaptive thinking and matching effort. Minimal uses adaptive thinking with Low effort. Off requests disabled thinking with Low effort; SDK-emitted thinking still does not prove the model honored zero reasoning. |
| Change effort or model | Change between the three SDK models and thinking levels without discarding the live conversation. Live checks exercised High, Max, Low, Off, and Medium. All level mappings have offline coverage. |
| Images | Pi image attachments and image tool results reach the SDK as image blocks. JPEG, PNG, GIF, and WebP require canonical base64 within Pi's 4.5 MiB encoded-image limit. |
| Response limits | The default SDK response cap is now 16,000 tokens, not 4,096. Explicit caps are checked against Pi's model metadata, currently 128,000. The live title helper used 120. Full 128,000-token generation was not tested. The cap remains fixed within a query. |
| Session titles and helpers | Calls without a Pi session ID use separate, ephemeral SDK queries with no tools. They receive the requested system prompt and transcript as JSON data. They cannot execute tools or alter the foreground query. This is helper input, not history replay. |
| Restart and resume | Newly saved sessions record the SDK session and message IDs, conversation/configuration fingerprints, and reported usage after a completed turn. A new worker resumes that SDK checkpoint only when Pi's history and configuration match. No tool replay or Pi-to-SDK history reconstruction. |
| Mid-turn input | Pi-accepted instructions go directly to the live SDK input at Pi's tool boundary, alongside the original, ID-matched tool results. The SDK/model can fold or queue them; the bridge does not force an interrupt or restart. Already-running Pi tools are not automatically cancelled. |

Saved conversations now also create SDK transcripts under Claude Code's session storage, normally `~/.claude/projects/`. Pi checkpoint entries contain hashes and IDs, not extra conversation bodies or credentials. Ephemeral Pi sessions and helper requests disable SDK persistence. Deleting a Pi session does not delete its SDK copy; Claude Code's own retention applies.

Start a fresh session to adopt this upgrade. Old prototype sessions have no recoverable SDK checkpoint. Compaction, forks, and changed prompt/tool sets remain unsupported. Interrupted conversations require the explicit recovery operation below rather than a normal native resume.

## Explicit recovery after interruption

In an idle, saved SDK conversation, run `/sdk-recover` and confirm the warning. Then send a new message. This keeps the same Pi chat and starts a **new native SDK context**, using saved Pi history as labeled historical JSON. It does not pretend to resume the interrupted native turn, rewind its transcript, or reconstruct an unrecorded shell exit status. Previous native transcripts remain archived under Claude Code's existing retention policy.

Recorded Pi results are retained as data, never replayed actions. Missing results receive explicit historical recovery rows saying `Execution outcome unknown`. They are not synthetic successful Pi tool results. Original Pi entries are not rewritten. Images are retained, while thinking and provider signatures are omitted from the imported JSON.

Recovery requires a valid completed checkpoint and its unchanged prefix/configuration. The operator decision binds the approved history and interrupted call identities. Completed foreign-provider turns appended before the first SDK request are validated and imported as data, so working in GPT before returning to SDK does not invalidate that decision. Edited approved history, unfinished foreign turns, new uncheckpointed SDK work, changed configuration, or tampered recovery metadata still fail before SDK startup. The decision is marked started before launching its new query; the new native session ID is recorded, and the next completed checkpoint uses that native context and its own usage baseline. Previous Pi usage records remain unchanged.

New tool calls follow Pi's normal validation and permission policy, including the user's auto-approve settings. Recovery does not install a separate per-tool approval hook, including for previously recovered chats or after model changes and worker restarts. The one-time confirmation to start a new SDK context remains. Historical calls remain data, and an unknown result is not a successful receipt or an instruction to retry.

A fresh worker must load this command. It requires interactive confirmation, a saved completed checkpoint, and ordinary/custom-message context. Summary and terminal-command context remain unsupported. This is explicit context recovery, not a durable executor or automatic reconstruction of arbitrary command output. Production compaction remains disabled.

`npm run test:recovery` drives real Pi RPC, the production extension and bridge, MCP, and synthetic effects with SDK/control-provider replay peers. It kills a worker after an effect but before its result, reproduces the old guard, checks recovery cancellation/confirmation, and switches to a completed foreign turn before returning to SDK. It retains a prior zero-work stale-approval failure as context, verifies no historical replay or recovery-specific tool prompt, exercises normal Pi permission denial and argument validation, restarts the recovered worker, and retains duplicate-ID and history/configuration rejection. No model service or Claude login is used by this E2E. The check passed with Pi 1.2.0 and installed Pi 1.3.0; see [recovery verification](verification-recovery.json). Live SDK inference is a separate acceptance level.

## Managed lifecycle and safe host restarts

The host now has an explicit managed-session state machine, with a [state diagram and contract](../../docs/session-lifecycle.md). `agent_end` is not restart-safe. SDK turns need both final settlement and a saved-checkpoint receipt, in either order. Pending tool IDs survive in-flight input, dialogs block a restart, and generic Pi providers need settlement without an SDK checkpoint.

The reported failures were not deleted chats: the SDK agent ran the host-restart script from a still-running `bash` call. The host stopped before the call's result was recorded. The existing recovery guard correctly refused to replay that command. The restart script now queues a detached job, waits for lifecycle readiness, and uses an atomic idle-only stop on updated hosts. Explicit force-stop paths still interrupt work and can leave an unknown tool outcome blocked.

`npm run test:lifecycle` runs the real host, mobile browser, restart CLI/jobs and filesystem against a deterministic Pi RPC replay peer. It covers permission/tool/checkpoint/settlement gates, both receipt orders, in-flight input, generic-provider turns, rejected requests, complete host replacement, unchanged history, no tool replay, and blocked recovery after forced interruption. It requires no SDK login or model calls and runs in browser CI. This is protocol-replay E2E evidence, not live SDK inference. See [lifecycle verification](verification-lifecycle.json).

Live SDK validation on October 16 was separately blocked by an SDK API response: `API Error: 400 Third-party apps now draw from extra usage, not plan limits. Ask your workspace admin to add more and keep going.` Local Claude authentication still reported a first-party login. No billing configuration or authentication workaround was applied. This records the response for the tested workspace; it is not a general policy determination. Live full-host SDK acceptance was not completed in that run.

The operator-approved recovery attempt on October 17 reached its new native SDK session with the expected identity, then hit that same extra-usage response with zero native tool calls. The SDK labeled the assistant error `unknown`, which hid the billing prerequisite behind incorrect login/new-session advice. The bridge recognizes this specific response and reports that request's restriction, asking the workspace admin to check SDK entitlement and usage settings. It does not claim paid extra usage must be enabled or copy arbitrary native error text. Other assistant errors no longer assume a login problem. The RPC recovery E2E reproduces the old advice and verifies the corrected serialized response, omitted private details, and no extra effects on Pi 1.2.0 and 1.3.0. See the billing follow-up in [recovery verification](verification-recovery.json).

Later October 17 checks succeeded through the direct SDK, the existing Pi bridge, and installed Pi 1.3.0 RPC recovery with Sonnet 5.5 High while extra usage remained disabled. The RPC check used synthetic incomplete history and executed no tools; it is not a native MCP crash-recovery test. No authentication or billing changes were made. The earlier rejection's cause remains unconfirmed, so it does not justify a blanket recommendation to enable paid usage. The original chat was prepared again without a new model prompt or tool replay; its next reply remains unverified. See [billing investigation and evidence](../../docs/research/claude-agent-sdk-billing.md).

## Cross-provider handoff and recovery

A conversation can begin with another Pi provider or leave SDK Claude for completed successful turns with another model and return. Returning to SDK Claude resumes its last completed native checkpoint. Only the new Pi turns are appended as explicitly labeled historical JSON data, followed by the current user message. Historical tool calls are not sent as executable SDK calls or pending MCP results. Pi keeps its original audit history unchanged, and a new completed checkpoint fingerprints the entire accepted prefix so the same foreign turns are not imported again. Imported turns also enter the SDK's native transcript and follow its separate retention rules.

The handoff validates turn ordering, unique tool-call IDs, and a matching result for every foreign tool call before sending anything to the SDK. Images remain image blocks with source references in the historical JSON. Private reasoning and opaque provider signatures are omitted from that JSON. Existing prompt, tool-schema, environment, output-limit, and prefix hashes still have to match. Native SDK compaction remains disabled.

A valid saved checkpoint can also retain three known local rejections that occurred before an SDK request started: the old unavailable-session error, the old one-new-message restriction, and the stale recovery-approval snapshot error. These must be zero-usage, text-only errors with the exact known message. Their user requests and error records remain visible as historical context, not automatically retried actions. Unknown SDK failures, uncheckpointed SDK responses, interrupted SDK tools, changed prefixes, and incomplete foreign tool batches still fail closed during normal native resumes. The explicit recovery command above starts a separate native context instead.

`node handoff.mjs` exercises the installed Pi executable with real SDK Opus and Codex GPT-6.1 Sol, both existing official logins, the Pi Remote progress extension, an isolated host, and mobile Chromium. Only the synthetic probe can execute. Project-local settings disable compaction and retries; personal settings are checked unchanged, and no credentials are copied. The check covers an initial GPT conversation, SDK and GPT tool turns, image/code recall after returning, refresh, worker restart while away and after sync, a recorded local-rejection replay, and tampered-prefix/missing-result rejection before SDK startup. It consumes both plans' usage. npm's `test:handoff` uses the development Pi on its PATH instead. See [handoff E2E results](verification-handoff.json).

Existing workers need replacement to load this change. Recovery requires a verifiable provider-owned checkpoint and unchanged configuration. A pure non-SDK history can initialize a fresh native SDK conversation as context, but an arbitrary SDK transcript without its checkpoint cannot. No original conversations are rewritten, no tool replay is used, and no shared host restart is required.

## Idle provider-switch fix

A reported conversation could no longer accept SDK messages after the user selected another provider and returned to SDK Opus. The extension closed the native query on every switch away, even after a completed turn. Returning to the SDK reused that permanently closed bridge. Refreshing the page did not cause or repair the failure.

The first fix kept the completed query alive during picker-only provider changes. The handoff implementation above now returns through its completed checkpoint and supplies completed foreign turns as context. Switching away during an active SDK turn still closes that query; interrupted SDK tools are not resumed automatically.

The focused `npm run test:reconnect` check uses the Pi executable on PATH, real SDK Opus, a local host, and mobile Chromium. npm selects the development Pi dependency; run `node reconnect.mjs` directly to use your normal shell's Pi installation. It remembers a synthetic tool result, refreshes and sends a follow-up, selects a non-SDK control provider without inference, returns to SDK Opus, refreshes again, and checks recall, one native session, one tool execution, and matching call/result IDs. The control provider is synthetic and rejects inference. This case was missing from earlier tests, which covered SDK-to-SDK changes and reloads without leaving the SDK provider. See [reconnect E2E results](verification-reconnect.json).

This first fix did not revive already-closed queries. The current handoff recovery above additionally handles known zero-work local rejections without deleting their audit records. General in-place native Stop/error recovery and real iPhone/Safari behavior remain unverified. The explicit recovery command starts a separate native context.

## Mid-turn input fix

A second reported failure had the expected Pi tool result followed by a new user instruction. The bridge incorrectly required that the entire delta contain only tool results and closed the query. It now validates the original results separately and forwards the accepted user messages through SDK asynchronous input without replaying tools. Input UUIDs must be consumed before a final Pi response settles, including when the SDK queues them for a later turn. Pi's normal input processing, tool validation, and permission controls remain in place. SDK messages use literal Pi-composed content rather than Claude Code's file-mention or slash-command expansion.

The exact error was reproduced through a real Pi 1.2 RPC worker, SDK Opus Medium, local host, and mobile Chromium. A phone message arrived while a synthetic tool was waiting. After the fix, the model followed the new instruction, both tool results retained their IDs, browser reload preserved the conversation, and a follow-up used the same SDK session without repeating tools. Pi and SDK cumulative usage matched. The fixture closed its own worker and host. No unit tests were added or run for this fix. See [mid-turn E2E results](verification-steering.json).

Run this focused live check with `npm run test:steering` after installing the browser dependencies described below. It consumes Claude plan usage. A query already closed by the old failure cannot be revived; start a fresh worker to load this fix.

## Tool-name retry fix

A reported turn stopped after two successful searches because the SDK emitted bare `bash`, received its own unknown-tool error, and then requested `mcp__pi__bash`. The bridge had already aborted at the bare name. The phone showed no explanation because the failed assistant message had only `errorMessage`, which Pi Remote does not render as conversation text.

The SDK prompt now lists its exact MCP tool names. If it mistakenly uses an unqualified, declared Pi name, the bridge lets the SDK reject that unavailable name and retry. It never dispatches that attempt to Pi. A matching SDK error is required before the next model response; missing or successful results, undeclared names, duplicate IDs, and more than three unqualified attempts still fail closed. Sanitized failure text is now also emitted as visible message content. Pi remains the sole executor.

The recorded failure was reproduced in a deterministic offline test before the fix. Strict checking and all 35 offline tests passed with Pi 1.2.0 dependencies. The mobile Chromium UI-contract test also preserved the visible error after reload. The already-closed reported query cannot be recovered; keep that conversation and retry in a fresh session. The full repository suite and Safari were not run.

## Initial Opus 5.5 verification

The same bridge passed with `claude-opus-5-5`: 22 offline tests, strict TypeScript checking, registered CLI discovery and a real prompt, two Pi-owned calls, denial with zero executions, follow-up memory, cancellation, and matching SDK/Pi usage totals. The real RPC/mobile fixture selected Opus, streamed 26 updates, exercised Allow/Deny, settled Stop in 130 ms, and retained the conversation after reload. It closed its owned worker and host. See [Opus results](verification-opus.json).

These checks use isolated configuration and synthetic tools. They do not prove real-phone behavior.

## Installed host and opentunnel

The installed checkout was separately verified through the configured opentunnel connection with normal Pi resources and Pi 1.2.0. A fresh mobile Chromium session selected SDK Opus, read a test file through Pi's real `read` tool, returned its random marker, and recalled it on the next turn without another tool call. Reloading and reselecting the session preserved its conversation and model. The shared host stayed running; existing conversations and the default model were not changed. No production login links, tokens, or conversation snapshots were saved in shared artifacts. See the `productionInstallation` entry in [Opus results](verification-opus.json).

The expanded provider at `32a11b3` then passed on the installed host through opentunnel with Pi 1.2.0 and normal Pi resources. Opus High used Pi's real `read` tool. Switching to Sonnet Medium preserved the marker and correctly described an uploaded synthetic image. Only that scratch session's worker was stopped and resumed; the SDK remembered the marker without another read. Pi's `write`, `edit`, and `bash` tools then created and changed one new scratch file and ran a bounded file-existence/print command. All four tool results matched their Pi call IDs. Automatic title generation worked. A separate fresh browser reopened the conversation and read back its persisted model and effort. The test session was left on SDK Opus High.

The shared host PID remained unchanged, and the personal settings file was byte-for-byte unchanged. Both loopback and opentunnel served matching installed assets. No production credentials, screenshots, traces, storage dumps, or conversation bodies entered shared evidence. See `productionInstallation` in [current results](verification-common.json). These checks touched only newly created scratch files, not existing project files. Safari and real-phone hardware remain unchecked. Use a fresh session for your own tests.

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

Requirements: Node 22.19+, a local first-party Claude login, and Pi 1.2.0 for the pinned development checks. The reconnect E2E uses the installed Pi executable and was reproduced on Pi 1.3.0. The package retains its `^1.1.0` compatibility range; earlier recorded checks used 1.1.0. SDK 0.3.296 bundles Claude Code 2.1.296. The separately installed `claude` command used for the authentication check was 2.1.299. No subscription tokens are copied into Pi, and no fake API key is supplied.

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
PI_SDK_TEST_MODEL=claude-opus-5-5 PI_SDK_TEST_THINKING=high npm run test:remote
# Image inputs/results, model/effort changes, isolated helpers, and SDK checkpoint recovery:
npm run test:common
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

Tap `Reasoning effort` to select a level, for example High. Image attachments and Pi image-reading results are supported. Switching between SDK Haiku, Sonnet, and Opus preserves the conversation. Newly saved, completed SDK sessions can resume after their worker restarts. To disable this package later, run `pi remove "$PWD"` from the same directory and use fresh sessions.

## Implementation boundaries

- `index.ts` registers experimental Haiku, Sonnet, and Opus models with thinking and image support through Pi's native provider API. All three use the same bridge and authentication checks. Catalogue prices come from Pi's host-mapped `providers/all` entry point, without local copies of Pi's packages. An offline regression loads the package with only its runtime dependencies. No picker changes or browser credentials.
- `bridge.ts` keeps one live SDK query per Pi session. Its MCP server advertises Pi's JSON schemas unchanged. Handlers wait for Pi results and never execute tools.
- SDK built-in tools, implicit MCP servers, hooks, auto-memory, project settings, and SDK auto-compaction are disabled. Only saved Pi conversations enable SDK session persistence.
- The provider checks hashes of the entire known conversation prefix and its system prompt, tools, explicit environment, working directory, session ID, and output cap. Model and effort changes use SDK control requests. Other mismatches close the query rather than replaying tools or silently losing history.
- Pi request-payload and raw provider-stream hooks are supported. Payload replacement is rejected. The SDK does not expose underlying HTTP response headers, so no synthetic response or header events are invented.
- SDK result totals include pipeline usage. Cost is the SDK's nominal estimate, not a subscription-balance measurement or proof of what was charged. Intermediate and cancelled responses use observed tokens and Pi catalogue price estimates. Cost components are estimates; only the completed cumulative cost total is reconciled to the SDK.

Two live findings changed the implementation. Unannotated MCP tools can run serially, so waiting for every handler before returning the batch deadlocks. The bridge checks the first handler's ID support, returns the complete batch to Pi, and resolves subsequent handlers by their explicit IDs. The SDK also emits thinking frames despite `thinking: disabled`; those frames and signatures are preserved. Selectable effort now uses the SDK's adaptive-thinking controls.

Pi 1.1.0's lazy authentication wrapper turns an already-aborted request into a generic setup error before this provider runs. A documented `message_end` replacement normalizes that error only for `claude-sdk` while the active Pi signal is aborted. The fix neither changes tool execution nor patches Pi. The offline regression reproduces the native authentication path, and the live RPC proof asserts an empty `aborted` result.

## Remaining history limits

Native resume is limited to this provider's completed SDK checkpoints with a matching Pi prefix and configuration. Completed successful non-SDK turns can be imported as context, including when initializing a new SDK conversation. Arbitrary or pre-upgrade SDK histories without their checkpoint, compaction, forks, tree navigation, nested tool-enabled model requests, and dynamic prompt/tool updates remain unsupported. Cancellation closes the SDK query; interrupted SDK tools and unknown SDK errors are not automatically recovered. History-changing operations remain blocked while this provider is selected, and unrecognized transcripts fail explicitly.

The tool-ID metadata is a verified behavior of the pinned SDK, not an established public API guarantee. A later invalid handler closes the session, but a preceding Pi-approved batch may already have executed. Cancellation does not undo completed tools or forcibly stop a tool that ignores Pi's abort signal. Settlement timings above measure Pi completion, not OS child-process exit time.

Terminal print/JSON discovery and real RPC workers passed. Interactive terminal controls, the terminal-extension bridge path, multiple concurrent foreground sessions, arbitrary project mutations, and real-phone rendering remain unverified. Owned-worker restart passed in the real RPC/mobile fixture and on the configured host. Installed-host filesystem/shell checks touched only the synthetic scratch project. Verify your phone's configured host separately after installation. Existing session-history research is in the [integration guide](../../docs/research/claude-agent-sdk-integration.md).
