# Safe Claude SDK compaction integration

Subsequent provider work chose [Pi-owned compaction with a validated SDK context handoff](../sdk-compaction.md), rather than the native-compaction implementation candidate discussed below. The parent manual/threshold path has separate live/replay evidence. SDK-native automatic compaction remains disabled, and the historical Haiku/Opus findings below are unchanged.

Research with isolated live experiments. Production provider code, personal configuration, and active conversations were not changed. The experiments called the real SDK with synthetic data and consumed Claude plan usage. No unit tests were added or run.

Inspected versions: Claude Agent SDK `0.3.296`, Pi `1.2.0`, provider implementation at `351cd6c`.

## Recommendation

Keep the SDK as owner of its model context, with Pi retaining tool validation, permissions, execution, and the durable audit history. Do not run two independent summarizers or rebuild an SDK conversation by replaying Pi tools.

**Native auto-compaction is now a tested Opus candidate, not a safe all-model toggle.** A real Pi-agent/SDK run with Opus 5.5, SDK `0.3.296`, and explicitly selected CLI `2.1.300` preserved the marker, tool identity, completed-session resume, and cumulative usage through native automatic compaction. Haiku still failed the same memory check across the CLI, input, and thinking controls below. The root cause of that model-dependent result remains open; the earlier Haiku failures do not establish that all SDK auto-compaction is broken.

A threshold-driven, focused native `/compact` also passed on Haiku and Opus at completed idle boundaries. That is an automatic scheduler using the native manual command, not SDK-native automatic compaction, and it cannot protect an unbounded tool-heavy turn in flight. Keep the production guard until the actual Coding Agent/RPC path, model switching, and failure recovery are verified.

```text
Pi-approved tools and accepted input
  -> existing SDK conversation
  -> SDK-native compaction
  -> validated compaction event and context measurement
  -> completed SDK checkpoint recorded in Pi
```

A native SDK compaction does not inherently require deleting or rewriting Pi's audit transcript. The present bridge guard is an implementation restriction, not an SDK requirement. If Pi's active projection is later shortened too, that is a separate, explicitly authorized projection change. Its new fingerprint and kept boundary must be committed consistently; ordinary history-edit detection must remain strict.

## Amp comparison and next control

[Static inspection of Amp's newer public build](amp-sdk-static-analysis.md#compaction-follow-up-in-the-newer-public-build) confirms that its local SDK relay forwards all SDK events on one live query without a compaction-specific rejection. Its factory does not impose our auto-compaction disable flag. It delegates to the configured Claude executable and supplied settings, environment, arguments, and appended preset prompt; its private backend may add behavior not visible in the client.

That build embeds SDK client `0.3.276`. Our client `0.3.296` now has explicit CLI controls for `2.1.296` and `2.1.300`. Haiku failed on both; Opus passed on `2.1.300`. We have not run Amp or its older client, and its actual selected CLI/backend configuration remains unknown. Borrow its SDK ownership model, not its broader settings/tool/permission exposure.

## Verified automatic-compaction follow-up

These checks kept local login, Pi-only tools, `settingSources: []`, disabled project hooks, and literal Pi input unless a diagnostic explicitly changed the input mode. A scratch project PostCompact shell-hook sentinel stayed absent. No production provider or personal settings were changed.

| Control | Observed result |
| --- | --- |
| Haiku, client `0.3.296`, bundled CLI `2.1.296` versus explicit CLI `2.1.300` | Both failed marker recall after compact/resume. The summary remained `ACK_0`. Upgrading the CLI alone did not fix this case. |
| Haiku, native input processing instead of literal input | Failed with the same summary. This provides no reason to weaken Pi's literal-input protection. |
| Haiku, neutral acknowledgements instead of strict `ACK_n` replies | Failed. The summary was a 33-character acknowledgement without the marker. The exact ACK instruction is not necessary to reproduce marker loss. The workload still uses synthetic padding. |
| Haiku, default precomputation, then preset plus default precomputation | Both failed. The safe Amp-like combination did not fix Haiku; user/project settings and SDK built-in tools remained disabled. |
| Direct SDK automatic compaction without the Pi bridge | Haiku failed marker recall and resume. The counterexample does not require Pi's tool-boundary adapter. |
| Native automatic compaction with Opus 5.5 and CLI `2.1.300` | **Passed.** Native `trigger: auto`, 121,532 to 60,886 tokens, a 1,740-character marker-preserving summary, successful follow-up and completed-checkpoint resume, one tool execution, matching IDs and cumulative usage. |
| Idle-threshold controller with Haiku and Opus | **Both passed.** It skipped compaction below a test-only 25K threshold, triggered once at about 31.5K, and skipped again after resume. Native boundaries reported about 971 tokens after compact for Haiku and 858 for Opus. Both preserved memory, one execution, IDs, usage, and hook isolation. These boundaries correctly say `trigger: manual`. |
| Opus budget controls | An instrumented scheduled run hit `error_max_budget_usd` at a $0.35 setting. A native automatic run hit the same error at a $1 setting despite retaining the marker in its summary. These are incomplete checks, not memory failures. The passing scheduled and native-auto runs used $0.50 and $2 settings respectively. |

The passing native-auto Opus run reported cumulative estimated cost `$1.2735315`; the passing scheduled Opus run reported `$0.4134077`. These are SDK estimates, not subscription billing. `maxBudgetUsd` is not a hard spending ceiling: the $1 probe reported `$1.2424911` before rejecting continuation. Preserve budget stops rather than counting an observed boundary as a complete pass.

### Haiku thinking controls

The inspected Amp Claude Code model selector includes Haiku 5.5, and its SDK factory passes model/effort without explicitly setting `thinking`. Our earlier failures forced thinking Off. Three new isolated runs tested that difference with SDK `0.3.296`, CLI `2.1.300`, the same 100K window, literal input, and unchanged prompts/tools.

| Thinking configuration | Result |
| --- | --- |
| Adaptive thinking, Low effort | Failed marker recall after compact and resume. Summary `ACK_0`; one thinking block observed. |
| CLI-default thinking, Low effort | Failed the same checks with the same summary; two thinking blocks observed. Only the thinking option was left to the CLI, not the entire configuration. |
| Adaptive thinking, High effort | Failed the same checks with the same summary; three thinking blocks observed. |

All three runs completed the SDK turns successfully, executed the Pi tool once, matched tool IDs and cumulative usage, and left the project-hook sentinel absent. These are semantic memory failures, not budget stops. Thinking-block counts describe the normal assistant stream, not visibility into the internal compactor's reasoning. Explicitly disabling thinking is therefore not necessary to reproduce this counterexample. This does not establish Amp's live Haiku behavior or prove that Haiku compaction always fails.

All runs are recorded in [sanitized evidence](../../experiments/claude-sdk-provider/verification-compaction.json). The automatic Opus proof used thinking Off, effort Low, and a 100K native policy window with an 84,952-token threshold. It is one synthetic Pi-agent-core run, not full Coding Agent/RPC/mobile verification, a 1M-window stress test, or evidence for Sonnet. Opus with bundled CLI `2.1.296`, High/Max effort, and Amp's older client remain untested here.

### How to borrow the design for Pi

1. **Keep one SDK query and let the SDK compact its own context.** In `bridge.ts`, a future implementation should handle validated compact status/boundary events instead of closing the query. Keep the separate `conversation_reset` rejection and Pi-history fingerprint checks. Do not reconstruct or truncate Pi's audit history just because the native context shrank.
2. **Start with the exact tested model/CLI policy.** Opus with client `0.3.296` and explicit CLI `2.1.300` is a candidate. The production bridge currently selects the SDK's bundled CLI, so flipping its flag alone does not reproduce that proof. Verify or select the intended executable. Do not silently enable the failed Haiku path; switching models needs a corresponding live policy change and E2E coverage. Helpers must retain their isolated queries.
3. **Commit context transitions and checkpoints safely.** Preserve native lineage, input UUIDs, Pi tool IDs, and cumulative usage through compaction. `index.ts` currently persists checkpoints on `agent_settled`; recovery between native compaction and that event still needs verification. The scratch scheduled adapter even offers its old checkpoint until a subsequent Pi response, so it must not be shipped as production code. Verify or invalidate stale anchors, preserve audit history, and fail explicitly on inconsistent recovery.
4. **Report native context separately and keep Pi from running a second summarizer.** Use `getContextUsage()` and the actual native threshold. Do not translate Pi's reserve/kept-tail settings by assumption or call Pi `compact()` inside a live SDK turn. The idle-threshold native-command scheduler is a possible bounded fallback, not a replacement for mid-turn compaction.

This is a verified implementation direction, not permission to remove the guard alone. The remaining E2E gate below still applies, including failures and model switches. No implementation or active-session rollout was performed.

## Live findings

[Sanitized results](../../experiments/claude-sdk-provider/verification-compaction.json) retain successes and failures. Full local summaries stay private; shared evidence contains only selected facts, counts, and estimates.

| Experiment | Result |
| --- | --- |
| Native focused `/compact`, Haiku and Opus | Both passed. Pre/PostCompact callbacks ran with `disableAllHooks: true`. The scratch project shell hook did not execute. The marker survived compact/resume, and the synthetic tool executed once. |
| Effective native window | A 100K policy reported an 84,952-token trigger. Updating the top-level setting to 20K still reported 100K. With auto-compaction off, the Pi-agent experiment reported the model's 1M window and no auto threshold. Do not assume arbitrary small windows or a Pi reserve-token translation. |
| Real Pi agent core, focused manual compact | Passed with the experimental event adapter. Native boundary metadata reported about 61.5K tokens before and 1.1K after. The marker survived, tool/result IDs matched, and completed-checkpoint resume repeated no tool. Pi/SDK cumulative tokens and estimated cost matched. |
| Query closed after compact, before a new Pi checkpoint | Passed when the pre-compact anchor was explicitly present in the SDK's preserved-message set. This was a controlled close, not SIGKILL or a partial-file-write crash. An older anchor is not necessarily stale merely because compaction happened; check native lineage before designing extra journal machinery. |
| Automatic compact, custom Pi prompt | Mechanically continued/resumed with matching IDs and usage, but failed marker recall. The generated summary was five characters, `ACK_0`. Original audit history was not deleted. |
| Input queued during automatic compact | The Pi agent accepted the instruction once and the SDK answered it. The earlier marker was still missing after compact/resume. This exercised Pi agent-core steering, not browser/RPC delivery. |
| Automatic compact, Claude Code preset plus Pi prompt | Failed the same marker test with the same five-character summary. Replacing the custom prompt with a preset is not an established fix. |

The Pi cases use the real Pi 1.2 agent loop and SDK, with Pi executing the counted tool. A scratch adapter enables native compaction and observes known compaction notifications instead of passing them to the production guard. It is **not** a deployed provider, full Coding Agent compaction scheduler, RPC, or mobile-browser proof. The automatic scenarios intentionally exit nonzero when memory validation fails, even when mechanical continuation and accounting pass.

The negative workload deliberately contains long irrelevant padding and strict earlier ACK-only output instructions. It is reproducible in the recorded custom-prompt, queued-input, and preset runs. Root cause and generality remain open; do not turn this evidence into a claim that the SDK guarantees lossless summaries. Also do not silently accept a tiny summary just because `compact_result` says success.

## Verified interfaces and runtime observations

| Interface | What it establishes |
| --- | --- |
| SDK `Settings.autoCompactEnabled` | Native automatic compaction can be enabled. |
| SDK `Settings.autoCompactWindow`, `modelSettings[model].autoCompactWindow` | A native policy window is configurable. The per-model declaration documents 100,000–1,000,000 tokens or `auto`. This is not Pi's `reserveTokens` or `keepRecentTokens`. |
| `Query.applyFlagSettings()` | Session-scoped settings can be updated without writing personal settings files. |
| `SDKStatusMessage` | Reports `compacting` and optional `compact_result: success/failed`. |
| `SDKCompactBoundaryMessage` | Reports manual/automatic trigger, pre/post token counts, boundary UUID, and optional preserved-message relinking metadata. The boundary itself is not a summary string. |
| `PostCompactHookInput.compact_summary` | Programmatic Pre/PostCompact callbacks executed with the bridge's non-managed `disableAllHooks: true` and `settingSources: []`. No need to relax those settings for the tested SDK. Managed-policy variants remain untested. |
| `Query.getContextUsage({ detail: 'summary' })` | Reports active context estimates and native compaction state without per-category token-count calls. Returned fields include `totalTokens`, `rawMaxTokens`, `autoCompactThreshold`, and `isAutoCompactEnabled`. |
| SDK result `modelUsage` | Includes internal compaction calls and is cumulative across streaming-input turns. Use it for reconciled totals, not as an active-context measurement. |
| Pi `session_before_compact` | Can cancel Pi compaction or supply a custom `summary`, `firstKeptEntryId`, `tokensBefore`, details, and usage. |
| Pi `session_compact` / `session_compact_failed` | Allows recording successful or failed projection changes. |

The pinned `Query` interface has no typed `compact()` method. Do not invent one. Any manual SDK command route must be discovered and proven separately. Normal Pi-composed input must stay literal; allowing arbitrary user slash commands through is not the solution.

## Minimum safe implementation scope

1. **Keep the existing tool and authentication isolation.** Retain Pi-only MCP tools, unchanged schemas and call IDs, strict MCP configuration, explicit local login, no SDK built-in tools, no auto-memory, and no user/project settings. Do not relax managed policy or enable shell hooks to obtain a summary.
2. **Handle native compaction as a state transition.** Accept recognized native compaction status/boundary events instead of unconditionally closing the bridge. Continue rejecting unrelated conversation resets and unverified history edits. Do not treat a status notification alone as a committed compaction.
3. **Track native context separately from usage totals.** Pi's full audit history and SDK cumulative pipeline tokens do not measure the SDK's current compacted context. Expose native context and its effective threshold honestly. A catalogued 1M capability does not prove the native compaction policy waits until 1M.
4. **Persist a safe checkpoint after completion.** Save the native session ID, a verified native anchor, the Pi history/configuration fingerprint, compaction metadata, and reconciled usage only after every Pi result and accepted input is accounted for. Keep original audit entries. A completed post-compaction response anchor passed. A pre-compact anchor explicitly preserved by the SDK also passed the controlled-close gap. Do not assume all older anchors are safe or all are invalid. Hard-crash behavior and dropped anchors must be tested before deciding whether an additional durable pending/invalidation record is necessary.
5. **Keep Pi from independently compacting the SDK session.** Delegate model-context compaction to the SDK. If Pi's active projection also needs trimming for memory and context estimation, mirror the authoritative SDK summary and retained segment only after their mapping is verified. Do not assume Pi's 20K kept tail equals the SDK's kept messages or silently rebase the fingerprint.

This is a direction, not an implementation already proven safe. Context telemetry, crash consistency, and any Pi projection mirroring are part of completing it, not optional polish after flipping `autoCompactEnabled`.

## Important lifecycle and policy traps

- Pi `AgentSession.compact()` calls `await this.abort()` **before** `session_before_compact`. The current bridge closes on that abort. Calling `ctx.compact()` from a live SDK stream can therefore destroy the query before the hook can coordinate anything. Schedule manual work only at an eligible idle point; do not use manual compaction as an in-flight auto-compaction shortcut.
- SDK-native compaction must not cause Pi to lose or repeat a pending tool result or accepted mid-turn message. Preserve the existing input UUID tracking and call/result checks.
- Programmatic Pre/PostCompact callbacks did run with `disableAllHooks: true`; keep that restriction and the empty settings sources. The scratch project PostCompact command sentinel remained absent. This does not establish behavior under every managed-policy setting, nor justify bypassing managed policy. Callbacks provide a route that need not depend on SDK transcript files for ephemeral sessions.
- `getSessionMessages()` reconstructed the owned compacted chain. The observed compact-summary user entry had an extra `isCompactSummary` field, while a system entry's `message` was undefined. These shapes are version-specific observations, not a stable schema promised by the declared `unknown` body. Always scope reads to the provider-owned session and directory; never mutate the vendor JSONL or scan unrelated histories.
- SDK preserved-message UUIDs and Pi entry IDs are not interchangeable. The bridge can combine multiple SDK messages into one Pi assistant response, and SDK-internal rejected tool attempts need not appear as Pi tool executions. Exact retained-tail mirroring therefore needs an explicit mapping, not positional guessing.
- Pi reserve/kept-tail settings cannot be advertised as working SDK controls without a verified translation. Initially expose the native window/threshold separately.

## Reproduce the experiments

After the existing package dependencies are installed:

```sh
cd experiments/claude-sdk-provider
npm run experiment:compact-sdk
PI_SDK_TEST_MODEL=claude-opus-5-5 npm run experiment:compact-sdk
npm run experiment:compact-pi -- --manual
npm run experiment:compact-pi -- --manual --checkpoint-gap
# Counterexamples: expect nonzero exits until their memory failure is resolved.
npm run experiment:compact-pi
npm run experiment:compact-pi -- --mid-turn
npm run experiment:compact-pi -- --preset
```

Follow-up controls reuse the same scripts. `PI_SDK_TEST_CLI` selects an executable only in these experiments. Native input processing is diagnostic only; ordinary Pi input must stay literal.

```sh
# Haiku counterexamples, expected nonzero exits:
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-pi
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-pi -- --native-input
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-pi -- --neutral
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-pi -- --default-precompute
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-pi -- --preset --default-precompute
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-sdk -- --auto
# Thinking controls, also expected nonzero memory-check exits:
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" PI_SDK_TEST_THINKING=low npm run experiment:compact-pi
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" PI_SDK_TEST_THINKING=default npm run experiment:compact-pi
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" PI_SDK_TEST_THINKING=high npm run experiment:compact-pi
# Passing native automatic Opus check on the recorded CLI 2.1.300:
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" PI_SDK_TEST_MODEL=claude-opus-5-5 \
  PI_SDK_TEST_BUDGET_USD=2 npm run experiment:compact-pi
# Passing idle-threshold controller, native manual command:
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" npm run experiment:compact-pi -- --scheduled
PI_SDK_TEST_CLI="$HOME/.local/bin/claude" PI_SDK_TEST_MODEL=claude-opus-5-5 \
  PI_SDK_TEST_BUDGET_USD=0.5 npm run experiment:compact-pi -- --scheduled
```

These are live experiments, not mocks or unit tests. The default SDK query budget setting is $0.35. The Pi-agent fixture accepts an explicit test budget above $0 and up to $2; resumed totals are cumulative, not a new billing statement. All working files and tool effects belong to newly created scratch directories. Persistent native SDK transcripts remain subject to Claude Code retention. Public script entrypoints do not run from the normal `npm test` command or extension loader.

## Remaining E2E acceptance gate

No new unit tests. Before enabling production compaction, add the actual Coding Agent/RPC/browser path and a safe policy for the observed Haiku failure. Exercise Opus-to-Haiku/Sonnet switching, queued input during native compaction, and the intended CLI and thinking levels. Do not use existing conversations to reach a threshold.

1. Run a synthetic tool with a counted side effect in a new scratch directory. Force native compaction in the isolated session, continue, and verify remembered markers, exact tool/result IDs, one execution, and reconciled usage including compaction.
2. Send a user message near the compaction transition. Require it to be consumed once, preserve its order, and verify a subsequent follow-up without restarting the SDK conversation.
3. Close only the owned worker after a completed post-compaction checkpoint, resume it, and verify memory with no tool replay.
4. Stop the owned worker between native compaction and checkpoint/projection publication. Reopening must either recover from a verified consistent record or fail explicitly without executing tools; never silently resume a stale checkpoint.
5. Include an untrusted scratch hook sentinel and verify that compaction does not execute it. Exercise summary/compaction failure without deleting audit history or advancing the checkpoint as if it succeeded.

## Public web research

**I found related public reports, but no reliable indexed match for the exact `ACK_0` failure or a confirmed fix for our SDK/CLI pair.** A separate quoted search for `ACK_0` with Claude/Haiku and compaction returned unrelated uses of that token. This is a bounded search result, not proof that no matching report exists.

Retrieval was limited. Radius and OpenAI web search surfaced primary documentation and GitHub issue pages, but direct fetches of the selected pages were blocked by this environment's fake-IP network-address safety check. That check was not changed. The descriptions below come from search-indexed primary sources; full issue threads, maintainer responses, current status, and fixes were not independently verified. User reports are not vendor-confirmed diagnoses.

| Primary source | Indexed finding | Relation to our case |
| --- | --- | --- |
| [Claude Code #75759](https://github.com/anthropics/claude-code/issues/75759) | Reports compaction omitting earlier work in the same session, including files the agent created. | Similar memory-loss symptom, but not an exact Haiku 5.5 or version-matched reproduction. |
| [Claude Code #24677](https://github.com/anthropics/claude-code/issues/24677) | Reports a Cowork compaction loop with system context consuming 86.5% of the window. The indexed description attributes oversized, sometimes verbatim summaries to Haiku. | A Haiku-related report, but its oversized-summary/context-exhaustion failure differs from our five-character summary. |
| [Claude Code #96950](https://github.com/anthropics/claude-code/issues/96950) | Reports assistant text preceding a tool call disappearing from the transcript after automatic compaction. | A transcript-retention problem. Our Pi audit remains intact, so do not treat it as the same failure. |
| [Agent SDK TypeScript #381](https://github.com/anthropics/claude-agent-sdk-typescript/issues/381) | Reports automatic compaction no longer triggering after SDK `0.3.202`, compared with `0.3.146`. | Not the observed mechanism here: our runs emitted native automatic boundaries and reduced context. Triggering and summary correctness are separate checks. |
| [Claude Code #38358](https://github.com/anthropics/claude-code/issues/38358) | Requests a `compactionModel` option for using a cheaper model during compaction. | A feature request is not evidence that the option exists in our SDK or that changing a summarizer model fixes this bug. |
| [Anthropic API threshold-compaction documentation](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold) | Indexed documentation covers Haiku 5.5 and custom summarization `instructions` that replace the default prompt. It recommends stating what to preserve and forbidding tool calls during summarization. | This documents Messages API server-side compaction, not the behavior or options of a long-lived Claude Code/Agent SDK query. Do not copy the API's `instructions` field into SDK settings by assumption. |

### What the documentation does and does not explain

The indexed API guidance also says custom-instruction summaries do not see earlier thinking blocks. That does not explain our lost marker: the marker was visible Pi tool output, not information present only in hidden reasoning. Our thinking controls also reproduced the failure with adaptive Low, adaptive High, and CLI-default thinking.

The public material supports treating compaction as lossy and checking important retained facts. It does not establish that Haiku is categorically unsupported, that our exact failure is an acknowledged Anthropic bug, or that Amp has the same problem. No live Amp test ran because its CLI authorization remained blocked.

For Pi, keep the existing conclusions bounded to the recorded experiments. The focused native `/compact` path passed on both models, and native automatic compaction passed in the recorded Opus configuration. Preserve the failed Haiku cases, do not enable every model globally, and do not introduce an undocumented `compactionModel` setting or a second Pi summarizer based on these reports. A change to summary instructions needs its own SDK-native control and the existing memory/resume/one-execution acceptance checks.

No new live Claude/Amp experiment calls, unit tests, production configuration changes, or upstream issue posts were made for this web research. The third-party release-note articles found in search were not treated as proof of a fix because the corresponding official release entry could not be verified.

## Sources and verification limits

- [Pinned SDK dependency](../../experiments/claude-sdk-provider/package-lock.json), installed `@anthropic-ai/claude-agent-sdk/sdk.d.ts`: `Query`, `Settings`, `SDKCompactBoundaryMessage`, `SDKStatusMessage`, `PostCompactHookInput`, `GetSessionMessagesOptions`, `SDKControlGetContextUsageResponse`, and SDK result usage documentation.
- [Current standalone bridge](https://github.com/peterlimg/pi-claude-sdk/blob/main/bridge.ts) and [registration/lifecycle hooks](https://github.com/peterlimg/pi-claude-sdk/blob/main/index.ts).
- Pi 1.2.0 installed sources: `dist/core/agent-session.js` manual `compact()`; `dist/core/extensions/types.d.ts` compaction events; `dist/core/compaction/compaction.d.ts` custom result shape; `docs/compaction.md`; `examples/extensions/custom-compaction.ts`.
- [Pi compaction reference source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) and [extension interface source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts). Local 1.2.0 files, rather than a moving GitHub main branch, were used for the findings above.

Official web documentation could not be fetched because this environment's network-address safety check rejected the resolved site address. That check was not weakened or bypassed. Interface findings come from pinned local sources; live findings come from the linked isolated results. Full Coding Agent/RPC/mobile integration, managed-policy variants, dropped-anchor behavior, forced compaction failure, hard crashes, and exact Pi retained-tail mirroring remain unverified. No production compaction support has been enabled.
