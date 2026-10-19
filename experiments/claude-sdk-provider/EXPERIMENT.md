# Claude SDK provider experiment

Opt-in Pi provider `claude-sdk` for Haiku 5.5, Sonnet 5.5, and Opus 5.5, tested October 14, 2026. It uses Claude's local login through the official Agent SDK and leaves tool validation, permissions, and execution in Pi. Pi Remote's normal extension manifest does not load this package; enable it separately with the installation command below.

The standalone package is [pi-claude-sdk](https://github.com/peterlimg/pi-claude-sdk). Its `v0.1.0` runtime matches this directory at `607f786`. This directory remains for current installations and Pi Remote integration tests; the export does not switch an installed provider. Do not load both packages in one Pi session.

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

## SDK-facing prompt

Normal Pi turns use Claude Code's SDK preset with Pi's tool guidance, rules, project/operator context, skills, working directory, appended instructions and custom sections attached verbatim. Pi's generated identity and documentation-routing index stay in Pi's canonical transcript rather than replacing the SDK's own base prompt. Custom prompts and operator-supplied `docs` sections are retained. Tool declarations, permission checks and execution remain Pi-owned.

The provider captures the final structured prompt at each turn. An unaccounted provider-context rewrite fails before SDK startup instead of discarding instructions. An opaque inherited prompt containing the known rejected documentation combination also fails locally. This is a mitigation for the [content-sensitive SDK rejection](../../docs/research/claude-agent-sdk-billing.md), not an upstream billing fix or an authentication change.

The checkpoint fingerprint now covers both the canonical Pi prompt and the SDK-facing preset/append. A checkpoint from the old prompt format requires `/sdk-recover` and confirmation before starting a new native context. It cannot silently resume with different instructions. Known zero-usage, text-only billing rejections remain historical failures and may be retried on the next user message, even before the first checkpoint. Unknown SDK failures and interrupted tools remain blocked. Completed foreign-provider failures can be imported as historical data, never replayed actions.

`npm run test:recovery` now starts with a normal Pi prompt and covers this boundary, late extension instructions, custom prompts/sections, rejection retries, old-checkpoint migration and unchanged Pi tool permissions. The previous short custom test prompt could not reproduce the documentation-index rejection.

The installed `b07002c` provider also passed through opentunnel with normal project resources and all 14 Pi tools declared. SDK Opus used Pi's real `read` once, returned the scratch marker and recalled it after reload without another tool call. The checkpoint matched the projected preset/append fingerprint; Pi's canonical prompt, personal settings and shared host PID stayed unchanged. The owned test worker was closed. See `portablePromptFollowUp` in [recorded evidence](verification-recovery.json).

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

Start a fresh session to adopt this upgrade. Old prototype sessions have no recoverable SDK checkpoint. Pi-owned manual/threshold compaction uses the validated handoff below. SDK-native compaction and general prompt changes remain unsupported. Tree navigation uses its own validated same-file handoff. Cloning and earlier-message forks use owner-bound branch handoffs. Tool-only updates use their separate handoff below. Recorded Stop turns with matching Pi results can continue as described below. Missing results and unknown SDK failures require explicit recovery rather than a normal native resume.

## Completed-branch cloning

An idle saved branch can be cloned through Pi's normal clone operation. The source stays unchanged. A receipt in the new file binds its copied history, configuration owner and target Pi ID. The first new SDK message starts an independent native context from labeled historical data, not the parent's native query. Old tools cannot replay; new calls retain ordinary Pi permissions and argument validation. Each branch subsequently saves and resumes its own checkpoint.

`npm run test:clone` covers independent branch memory/restart, the receipt-to-checkpoint crash boundary, repeated clone-start events, consecutive clones, compaction around activation, provider switching, Stop, dynamic tools, permission/validation errors and blocked unsafe sources or altered receipts. The shared real-model `clone-contract` also verifies unknown tool-read markers, counted effects, private branch values and reopening both branches through the phone UI. Cloning itself uses Pi RPC, not a new phone control. See [cloning design and scope](../../docs/sdk-cloning.md) and [reviewed evidence](verification-clone.json). Tree navigation remains blocked.

## Earlier-message forks

Pi can fork an idle saved chat before an earlier user message, including the first message, queued follow-ups and matched tool-boundary points. The outgoing chat must validate independently; selecting older history cannot approve missing outcomes or unknown SDK failures. A target bridge reads the selected branch's own checkpoint/receipt. When no checkpoint was saved there yet, a later accepted prefix can attest the target, carrying only its complete system checkpoint for configuration verification. Later user/assistant text is not imported. Tool calls with results omitted by the selected point remain blocked.

New checkpoints retain their Pi owner ID. Legacy owners come from a matching configuration hash in existing branch receipts. This preserves the configuration check for clone, compact, then fork into inherited history. Neither the original file nor existing filesystem effects are rewound. The fork starts a new SDK context and saves its own checkpoint after a new message.

`npm run test:fork` covers projection/ownership, source and branch restarts, compacted and queued points, tools/permissions/validation, Stop/notices and rejected corrupt or incomplete work. The shared `fork-contract` drives real models and mobile messages; `PI_PARITY_FORK_QUEUED=1` submits the selected request while a real source tool gate is running. Fork itself uses Pi RPC. See [scope and design](../../docs/sdk-forks.md) and [reviewed evidence](verification-fork.json).

## Tree navigation

Saved parent sessions can navigate to validated or abandoned paths within one Pi file. The provider checks outgoing and destination history separately, records navigation intent, lets Pi optionally summarize the abandoned work, then binds the selected projection and configuration before a fresh native SDK conversation opens. Returning to a path also starts fresh rather than rewinding a native transcript. Recorded IDs across stored branches cannot execute again. Filesystem effects and old audit entries remain unchanged.

`npm run test:tree` exercises real Pi navigation/RPC/persistence/MCP with only the external SDK replayed, including summary failure/Stop, compaction/cloning, other providers, queued points, permissions, missing receipts and corrupted history/configuration. The shared paid `tree-contract` uses normal profiles and mobile messages. `PI_PARITY_TREE_QUEUED=1` selects a request queued during a running tool; `PI_PARITY_TREE_SUMMARY=1` intentionally imports abandoned context through Pi's summary. Navigation uses an owned command calling the public Pi API, not a new phone tree picker. See [scope and design](../../docs/sdk-tree.md) and [reviewed evidence](verification-tree.json).

## Pi-owned compaction

Pi now owns manual and threshold compaction, as for other Pi providers. Its normal summarizer runs in an isolated tool-free SDK request. The provider validates the accepted source and matched results, lets Pi append its ordinary compaction entry, and records a receipt binding the original source, new projection and configuration. A new native query receives only the summary and kept history as labeled data. It never replays old tools or deletes the Pi audit. A failed/malformed transition remains blocked.

`npm run test:compaction` drives real Pi RPC, default compaction, persistence, provider and MCP with only the external SDK replayed. Twenty-three cases passed on Pi 1.2 and 1.3, including automatic compaction at a loader/tool boundary, repeated summaries, owned-worker SIGKILL after receipt, failed/stopped summaries, provider switches, queued notices, later activation/Stop and blocked missing outcomes or altered state. Summary usage stays in Pi totals. The same summary appearing twice is handled by binding the latest persisted compaction rather than Pi's potentially older event ID.

Separate shared mobile Chromium checks passed real manual and automatic compaction on Codex, SDK Haiku and SDK Opus with normal resources. They require an actual unknown marker in the generated summary, one filesystem effect, no-tool recall and owned-worker restart. SDK-native automatic/idle compaction remains disabled; this is not a claim that native Haiku `ACK_0` compaction is fixed. See [implementation and scope](../../docs/sdk-compaction.md) and [reviewed evidence](verification-compaction-context.json).

## Runtime tool activation

Pi loaders such as `subagents_enable` change the active tool declarations before the next model request. The old SDK bridge treated that expected change as a configuration violation and failed before launching a child. Pi's loader had already succeeded; Claude Code login and billing were not the cause.

The Pi bridge now owns successive immutable native SDK queries. A tool-only update verifies the accepted Pi prefix, matches every outstanding tool result, and reconstructs the previous configuration from Pi's system-message history. That complete previous fingerprint must match with the current environment, working directory, Pi session and output limit. Only tool declarations and the generated `tools` prompt section may differ. Explicit section edits and other instruction changes still fail closed.

After validation, the old SDK query closes and a new one receives the complete current instructions and tool schemas. Recorded Pi work is JSON context, never replayed calls. At a live tool boundary, the new input asks for the remaining work rather than repeating the original user command. Actual new user input is preserved. Pi still validates arguments, applies permissions and executes every new tool. The previous native transcript and Pi audit stay intact; SDK usage starts a new native-context baseline without rewriting old Pi usage.

An already-recorded exact, zero-usage configuration rejection can also continue when its tool results and configuration pass these checks. Unknown SDK failures, missing results and changed protected settings are not treated as permission to reconstruct arbitrary work. This is Pi's `subagent` tool over MCP, not Claude Code's built-in Agent tool.

`npm run test:tools` exercises real Pi RPC, dynamic selection, MCP and execution with only the external SDK peer replayed. Cases cover first-turn activation, a prior checkpoint, worker restart, removal, Stop after handoff, an old guard rejection, permission denial, argument validation, and blocked environment/instruction/missing-result/history changes. CI runs this offline check. `npm run test:subagents` is opt-in and consumes Claude allowance. It requires an installed pi-subagents package, selectable with `PI_SDK_TEST_SUBAGENTS`, and accepts `PI_SDK_TEST_PI` for the installed Pi CLI.

The real mobile check starts with a non-SDK tool selection, switches to Haiku Max before prompting, enables once and launches one fresh SDK child. The child is constrained to zero tools and its actual SDK transcript, model and exit status are checked. Its result was reopened by stable parent-session ID after a navigation-only selector failure, without another prompt or child launch. A no-network preflight of the reported saved chat also passed without modifying it. See [recorded evidence](verification-tools.json). Physical Safari, forked child contexts and asynchronous child completion are not covered by this live check.

## Retained worker continuation

The shared `retained-standard-worker` journey now tests the normal High worker after replacing its parent. The borrowed foreground route does not save a child checkpoint and cannot safely resume. Test-only `PI_PARITY_CHILD_HOOKS=1` loads the existing SDK hooks through pi-subagents' public API and does save that checkpoint without changing the extension. The subsequent background resume changes real prompt sections and remains blocked. This is not an authentication failure and does not justify dropping current instructions or enabling blanket required extensions. See [workflow boundaries](../../docs/sdk-worker-continuation.md) and [reviewed evidence](verification-worker-continuation.json).

The investigation also reproduces a parent reload defect: generated tool guidance can reorder while declarations stay identical. That now uses the existing fresh-context tool handoff; operator overrides and non-tool/configuration changes remain protected. Offline `test:tools` includes order-only regeneration and rejection of changed/removed operator text or changed generated content.

## Shared provider acceptance

The [shared provider E2E](../../docs/provider-parity.md) runs the same real phone/Pi journeys with normal personal resources and builtin `worker` agents on Codex and Claude SDK. It checks actual file changes, child transcripts, permissions, switching, Stop, automatic completion notices, reload and owned-worker restart. Unsupported operations remain failing contracts rather than omitted scenarios. Results are in [the parity evidence](verification-parity.json); maintain the open items in the [provider gap tracker](../../docs/provider-gaps.md).

That matrix exposed a standard foreground child borrowing its parent's stateful SDK provider. The child's prompt failed the parent's provenance check and closed the parent query. Borrowed Pi session IDs now receive separate ephemeral bridges with their entire child prompt and Pi schemas intact. Tool validation/execution and the normal worker profile remain Pi-owned. A completed or failed child closes only its own bridge. Durable borrowed-child resumes still need child-local provider hooks; arbitrary inherited prompts are not rewritten to bypass upstream rejection.

## Extension completion notices

Several background child notifications can arrive before Pi starts the next SDK request. Pi presents them as consecutive user inputs. The old bridge treated every input except the last as completed history, then rejected that history because no assistant response followed the earlier notifications. The reported parent turn had completed; this was a local, zero-usage rejection of new input, not a missing child result.

The bridge now separates the entire trailing group of user inputs from historical turns and forwards every text/image block in order. The same grouping applies to tool-set handoffs. Recovery approval still rejects unapproved late input; notices already included in the approved snapshot are covered. A recorded exact zero-work incomplete-history rejection can be retained as local failure data on retry. Unknown SDK errors and unmatched tool calls/results remain blocked; no historical action is replayed and no result is invented.

`npm run test:notices` uses real Pi extension messages and RPC with only the external SDK peer replayed. It covers a live query, first request, worker restart, foreign-provider history, approved recovery, the previous guard failure and a blocked unknown error. The tool-update E2E also covers notices queued at the handoff boundary.

For a live two-child asynchronous check, run `PI_SDK_TEST_ASYNC=1 PI_SDK_TEST_PI=<installed Pi CLI> npm run test:subagents`. The Haiku Medium parent launches two fresh SDK children, receives their automatic completion notices and acknowledges both outputs without another launch. Actual child transcripts must show SDK responses and zero tool calls. The test isolates subagent runtime records under its scratch directory and reopens the parent by stable ID. This live check passed, and a no-network preflight of the reported saved conversation passed without changing it or restarting its subagents. See [recorded evidence](verification-notices.json). Forked children and physical Safari remain unverified.

## Stop and continue

Stop closes the current native SDK query. The next message now starts a new SDK context in the same Pi chat when the cancelled turn has a recorded Pi result for every tool call. This also works before the first completed checkpoint, after a worker restart, and for an already-recorded zero-work rejection from the old cancellation guard. The saved Pi conversation and previous native transcript stay unchanged. Historical calls are imported only as labeled data, never replayed actions. No extra recovery confirmation is needed for this recorded cancellation path.

A cancelled tool's error result does not prove no effects occurred. The new context is told to preserve the recorded results, follow the new message and check effects before repeating interrupted actions. Missing results, unknown SDK errors, changed configuration/history and duplicate IDs still fail closed. Previously approved unknown outcomes inside a validated completed prefix remain explicitly unknown; cancellation does not invent their results or require approving them again.

`npm run test:cancel` uses real Pi RPC Stop/clear-queue, the provider and MCP with an external SDK replay peer. It covers Stop after completed tools on the first turn, a prior checkpoint, worker restart, cancellation during a tool, text-only Stop, an old guard rejection, and blocked missing-result/unknown-error histories. The recovery E2E separately checks Stop after a previously recovered unknown outcome. Native SDK context rebuilding discards unrecorded reasoning and starts a new SDK usage/cache context; it is not native pause/resume. The cancellation E2E passed on Pi 1.2.0 and 1.3.0, including the old guard error. Real Haiku High on installed Pi 1.3 also passed Stop during the first tool, the corrected next message, reload/follow-up and current-context usage reconciliation without repeating the old tool. A no-network preflight of the reported saved chat passed history validation without modifying it. See [recorded evidence](verification-cancel.json).

Run the opt-in live mobile check with `PI_SDK_TEST_STOP=1 PI_SDK_TEST_MODEL=claude-haiku-5-5 PI_SDK_TEST_THINKING=high node steering.mjs`. It consumes Claude allowance and uses only its synthetic probe.

## Explicit recovery after interruption

In an idle, saved SDK conversation, run `/sdk-recover` and confirm the warning. Then send a new message. This keeps the same Pi chat and starts a **new native SDK context**, using saved Pi history as labeled historical JSON. It does not pretend to resume the interrupted native turn, rewind its transcript, or reconstruct an unrecorded shell exit status. Previous native transcripts remain archived under Claude Code's existing retention policy.

Recorded Pi results are retained as data, never replayed actions. Missing results receive explicit historical recovery rows saying `Execution outcome unknown`. They are not synthetic successful Pi tool results. Original Pi entries are not rewritten. Images are retained, while thinking and provider signatures are omitted from the imported JSON.

Recovery requires a valid completed checkpoint and its unchanged prefix/configuration. The operator decision binds the approved history and interrupted call identities. Completed foreign-provider turns appended before the first SDK request are validated and imported as data, so working in GPT before returning to SDK does not invalidate that decision. Edited approved history, unfinished foreign turns, new uncheckpointed SDK work, changed configuration, or tampered recovery metadata still fail before SDK startup. The decision is marked started before launching its new query; the new native session ID is recorded, and the next completed checkpoint uses that native context and its own usage baseline. Previous Pi usage records remain unchanged.

New tool calls follow Pi's normal validation and permission policy, including the user's auto-approve settings. Recovery does not install a separate per-tool approval hook, including for previously recovered chats or after model changes and worker restarts. The one-time confirmation to start a new SDK context remains. Historical calls remain data, and an unknown result is not a successful receipt or an instruction to retry.

A fresh worker must load this command. It requires interactive confirmation and a saved completed checkpoint. The provider uses Pi's public projection and message conversion, including recorded summary and terminal-command context. This is explicit context recovery, not a durable executor or automatic reconstruction of arbitrary command output. Pi compaction uses the separate validated transition described below.

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

History import also retains exact known zero-work local guard errors and the recognized billing rejection. These must be zero-usage, text-only errors with the exact known message. Local and provider rejections are labeled separately; billing failures are not described as requests that never reached the SDK. Their user requests and error records remain visible as historical context, not automatically retried actions. Unknown SDK failures, uncheckpointed SDK responses, interrupted SDK tools, changed prefixes, and incomplete foreign tool batches still fail closed during normal native resumes. The explicit recovery command above starts a separate native context instead.

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

## Malformed tool arguments

A later Haiku Medium turn successfully searched and wrote an SVG, then produced invalid JSON for an edit. Claude Code recorded its own input-validation error, but the bridge's strict `JSON.parse` threw first and replaced the failure with incorrect login/new-session advice. The earlier checks covered valid JSON and fail-closed malformed batches, not SDK correction after a completed tool effect.

Tool arguments now stay buffered until the complete SDK model message validates. Text and thinking still stream; tool-call start/delta/end events publish only for validated JSON. A malformed call never becomes an executable Pi call. If its MCP handler arrived early, it receives an error without execution; a late handler for that retired ID is also rejected. The SDK must report an error for that exact call before the next model response. It can then propose a corrected call under normal Pi validation and permissions. Missing or successful rejection receipts, reused IDs and more than three malformed attempts fail closed. Prior successful tool calls are not replayed.

`npm run test:malformed` drives real Pi RPC, the production bridge and MCP with an external SDK replay peer. It covers SDK-local rejection, early/late MCP callbacks, mixed valid/invalid batches, follow-up in one query, and the fail-closed cases above. No model account or real user conversation is used. Run `node malformed.mjs local` for the smallest reproducer. An already-failed turn with uncheckpointed work still needs explicit `/sdk-recover` confirmation; the fix does not rewrite that history or rerun its file write. The nine-case E2E passed on Pi 1.2.0 and 1.3.0, the existing recovery/permission E2E passed on 1.3.0, and real Haiku parallel calls, follow-up recall and usage reconciliation passed. See [recorded evidence](verification-malformed.json).

The installed `d0ea432` provider also passed through opentunnel with normal resources and Haiku Medium. Pi wrote, edited and read a scratch markup file exactly once each, then recalled its marker after reopening without another tool call. The same native session, original tool IDs, personal settings and shared host PID were retained; the owned test worker was closed. That live run generated no malformed call. The deterministic SDK-replay cases above verify malformed correction. Its initial run-ID search missed the generated session title; reopening by the saved title completed the follow-up without repeating file operations.

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
- `bridge.ts` owns one current SDK query per Pi session, replacing it at validated tool-only or Pi-compaction boundaries. Each query's MCP server advertises that Pi tool snapshot's JSON schemas unchanged. Handlers wait for Pi results and never execute tools.
- SDK built-in tools, implicit MCP servers, hooks, auto-memory, project settings, and SDK auto-compaction are disabled. Only saved Pi conversations enable SDK session persistence.
- The provider checks hashes of the entire known conversation prefix and its system prompt, tools, explicit environment, working directory, session ID, and output cap. Model and effort changes use SDK control requests. Verified tool-only changes start a new native context; other mismatches close the query rather than replaying tools or silently losing history.
- Pi request-payload and raw provider-stream hooks are supported. Payload replacement is rejected. The SDK does not expose underlying HTTP response headers, so no synthetic response or header events are invented.
- SDK result totals include pipeline usage. Cost is the SDK's nominal estimate, not a subscription-balance measurement or proof of what was charged. Intermediate and cancelled responses use observed tokens and Pi catalogue price estimates. Cost components are estimates; only the completed cumulative cost total is reconciled to the SDK.

Two live findings changed the implementation. Unannotated MCP tools can run serially, so waiting for every handler before returning the batch deadlocks. The bridge checks the first handler's ID support, returns the complete batch to Pi, and resolves subsequent handlers by their explicit IDs. The SDK also emits thinking frames despite `thinking: disabled`; those frames and signatures are preserved. Selectable effort now uses the SDK's adaptive-thinking controls.

Pi 1.1.0's lazy authentication wrapper turns an already-aborted request into a generic setup error before this provider runs. A documented `message_end` replacement normalizes that error only for `claude-sdk` while the active Pi signal is aborted. The fix neither changes tool execution nor patches Pi. The offline regression reproduces the native authentication path, and the live RPC proof asserts an empty `aborted` result.

## Remaining history limits

Native resume is limited to this provider's completed SDK checkpoints with a matching Pi prefix and configuration. Completed non-SDK turns, including recorded errors without outstanding tool calls, can be imported as context when initializing or resuming an SDK conversation. Recognized zero-work SDK rejections and validated cancelled turns do not require a checkpoint. Validated tool-only updates and Pi-owned compaction can replace native context while retaining the Pi chat and audit. Completed-branch clones and earlier forks start independent native contexts under separately bound Pi IDs. Tree navigation uses fresh contexts within the same Pi file, including validated abandoned paths and optional Pi summaries. Arbitrary SDK histories without valid checkpoints/receipts, durable child-local lifecycle and general dynamic prompt updates remain unsupported. Cancellation closes the SDK query; recorded Stop turns with matching Pi tool results rebuild on the next message. Missing tool results and unknown SDK errors are not automatically recovered. Unvalidated history changes remain blocked, including when another provider is selected, and unrecognized transcripts fail explicitly.

The tool-ID metadata is a verified behavior of the pinned SDK, not an established public API guarantee. A later invalid handler closes the session, but a preceding Pi-approved batch may already have executed. Cancellation does not undo completed tools or forcibly stop a tool that ignores Pi's abort signal. Settlement timings above measure Pi completion, not OS child-process exit time.

Terminal print/JSON discovery and real RPC workers passed. Interactive terminal controls, the terminal-extension bridge path, multiple concurrent foreground sessions, arbitrary project mutations, and real-phone rendering remain unverified. Owned-worker restart passed in the real RPC/mobile fixture and on the configured host. Installed-host filesystem/shell checks touched only the synthetic scratch project. Verify your phone's configured host separately after installation. Existing session-history research is in the [integration guide](../../docs/research/claude-agent-sdk-integration.md).
