# Safe Claude SDK compaction integration

Research only. No provider, personal configuration, active session, or compaction setting was changed. No SDK query, inference, or test was launched for this investigation.

Inspected versions: Claude Agent SDK `0.3.296`, Pi `1.2.0`, provider implementation at `351cd6c`.

## Recommendation

Make the SDK the sole owner of its model context. Pi remains the tool validator, permission authority, executor, and durable audit history. Do not run two independent summarizers and do not rebuild an SDK conversation by replaying Pi tools.

```text
Pi-approved tools and accepted input
  -> existing SDK conversation
  -> SDK-native compaction
  -> validated compaction event and context measurement
  -> completed SDK checkpoint recorded in Pi
```

A native SDK compaction does not inherently require deleting or rewriting Pi's audit transcript. The present bridge guard is an implementation restriction, not an SDK requirement. If Pi's active projection is later shortened too, that is a separate, explicitly authorized projection change. Its new fingerprint and kept boundary must be committed consistently; ordinary history-edit detection must remain strict.

## Verified from the pinned interfaces

| Interface | What it establishes |
| --- | --- |
| SDK `Settings.autoCompactEnabled` | Native automatic compaction can be enabled. |
| SDK `Settings.autoCompactWindow`, `modelSettings[model].autoCompactWindow` | A native policy window is configurable. The per-model declaration documents 100,000–1,000,000 tokens or `auto`. This is not Pi's `reserveTokens` or `keepRecentTokens`. |
| `Query.applyFlagSettings()` | Session-scoped settings can be updated without writing personal settings files. |
| `SDKStatusMessage` | Reports `compacting` and optional `compact_result: success/failed`. |
| `SDKCompactBoundaryMessage` | Reports manual/automatic trigger, pre/post token counts, boundary UUID, and optional preserved-message relinking metadata. The boundary itself is not a summary string. |
| `PostCompactHookInput.compact_summary` | A programmatic post-compaction hook can receive the generated summary. Its availability under the bridge's hook restrictions still needs verification. |
| `Query.getContextUsage({ detail: 'summary' })` | Reports active context estimates and native compaction state without per-category token-count calls. Returned fields include `totalTokens`, `rawMaxTokens`, `autoCompactThreshold`, and `isAutoCompactEnabled`. |
| SDK result `modelUsage` | Includes internal compaction calls and is cumulative across streaming-input turns. Use it for reconciled totals, not as an active-context measurement. |
| Pi `session_before_compact` | Can cancel Pi compaction or supply a custom `summary`, `firstKeptEntryId`, `tokensBefore`, details, and usage. |
| Pi `session_compact` / `session_compact_failed` | Allows recording successful or failed projection changes. |

The pinned `Query` interface has no typed `compact()` method. Do not invent one. Any manual SDK command route must be discovered and proven separately. Normal Pi-composed input must stay literal; allowing arbitrary user slash commands through is not the solution.

## Minimum safe implementation scope

1. **Keep the existing tool and authentication isolation.** Retain Pi-only MCP tools, unchanged schemas and call IDs, strict MCP configuration, explicit local login, no SDK built-in tools, no auto-memory, and no user/project settings. Do not relax managed policy or enable shell hooks to obtain a summary.
2. **Handle native compaction as a state transition.** Accept recognized native compaction status/boundary events instead of unconditionally closing the bridge. Continue rejecting unrelated conversation resets and unverified history edits. Do not treat a status notification alone as a committed compaction.
3. **Track native context separately from usage totals.** Pi's full audit history and SDK cumulative pipeline tokens do not measure the SDK's current compacted context. Expose native context and its effective threshold honestly. A catalogued 1M capability does not prove the native compaction policy waits until 1M.
4. **Persist a safe checkpoint after completion.** Save the native session ID, a valid post-compaction message anchor, the Pi history/configuration fingerprint, compaction metadata, and reconciled usage only after a successful completed turn with every Pi result and accepted input accounted for. Keep original audit entries. Add a durable pending/invalidation record if an old checkpoint could otherwise be mistaken for a safe post-compaction checkpoint after a crash.
5. **Keep Pi from independently compacting the SDK session.** Delegate model-context compaction to the SDK. If Pi's active projection also needs trimming for memory and context estimation, mirror the authoritative SDK summary and retained segment only after their mapping is verified. Do not assume Pi's 20K kept tail equals the SDK's kept messages or silently rebase the fingerprint.

This is a direction, not an implementation already proven safe. Context telemetry, crash consistency, and any Pi projection mirroring are part of completing it, not optional polish after flipping `autoCompactEnabled`.

## Important lifecycle and policy traps

- Pi `AgentSession.compact()` calls `await this.abort()` **before** `session_before_compact`. The current bridge closes on that abort. Calling `ctx.compact()` from a live SDK stream can therefore destroy the query before the hook can coordinate anything. Schedule manual work only at an eligible idle point; do not use manual compaction as an in-flight auto-compaction shortcut.
- SDK-native compaction must not cause Pi to lose or repeat a pending tool result or accepted mid-turn message. Preserve the existing input UUID tracking and call/result checks.
- The bridge currently passes `disableAllHooks: true`. Do not assume a `PostCompact` callback will run with that restriction. Verify the supported callback policy in isolation; managed hook restrictions must not be bypassed. A documented read of the provider-owned persisted SDK session is an alternative to investigate for saved sessions, not a license to scrape unrelated histories or mutate SDK JSONL. Ephemeral sessions need a solution that does not rely on a transcript file.
- `getSessionMessages()` supports `dir` and `includeSystemMessages`, and reconstructs the native chain. The returned message body is `unknown`; this declaration alone does not establish a stable compact-summary payload shape.
- SDK preserved-message UUIDs and Pi entry IDs are not interchangeable. The bridge can combine multiple SDK messages into one Pi assistant response, and SDK-internal rejected tool attempts need not appear as Pi tool executions. Exact retained-tail mirroring therefore needs an explicit mapping, not positional guessing.
- Pi reserve/kept-tail settings cannot be advertised as working SDK controls without a verified translation. Initially expose the native window/threshold separately.

## Focused E2E acceptance gate

No new unit tests. Use one isolated host, real Pi RPC, pinned SDK, mobile browser, and synthetic tools. Obtain approval before a token-heavy auto-compaction proof; do not use existing sessions to reach the threshold.

1. Run a synthetic tool with a counted side effect in a new scratch directory. Force native compaction in the isolated session, continue, and verify remembered markers, exact tool/result IDs, one execution, and reconciled usage including compaction.
2. Send a user message near the compaction transition. Require it to be consumed once, preserve its order, and verify a subsequent follow-up without restarting the SDK conversation.
3. Close only the owned worker after a completed post-compaction checkpoint, resume it, and verify memory with no tool replay.
4. Stop the owned worker between native compaction and checkpoint/projection publication. Reopening must either recover from a verified consistent record or fail explicitly without executing tools; never silently resume a stale checkpoint.
5. Include an untrusted scratch hook sentinel and verify that compaction does not execute it. Exercise summary/compaction failure without deleting audit history or advancing the checkpoint as if it succeeded.

## Sources and verification limits

- [Pinned SDK dependency](../../experiments/claude-sdk-provider/package-lock.json), installed `@anthropic-ai/claude-agent-sdk/sdk.d.ts`: `Query`, `Settings`, `SDKCompactBoundaryMessage`, `SDKStatusMessage`, `PostCompactHookInput`, `GetSessionMessagesOptions`, `SDKControlGetContextUsageResponse`, and SDK result usage documentation.
- [Current bridge](../../experiments/claude-sdk-provider/bridge.ts) and [registration/lifecycle hooks](../../experiments/claude-sdk-provider/index.ts).
- Pi 1.2.0 installed sources: `dist/core/agent-session.js` manual `compact()`; `dist/core/extensions/types.d.ts` compaction events; `dist/core/compaction/compaction.d.ts` custom result shape; `docs/compaction.md`; `examples/extensions/custom-compaction.ts`.
- [Pi compaction reference source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) and [extension interface source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts). Local 1.2.0 files, rather than a moving GitHub main branch, were used for the findings above.

Official web documentation could not be fetched because this environment's network-address safety check rejected the resolved site address. That check was not weakened or bypassed. The findings above come from pinned local interfaces and Pi implementation, not an executed SDK compaction. Runtime event order, callback restrictions, retained-tail mapping, and crash recovery remain unverified.
