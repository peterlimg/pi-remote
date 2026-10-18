# Remaining provider parity gaps

Canonical open-items list after `20f2e25`. Keep future gap updates here rather than repeating the list in chat or the README. The [shared E2E contract](provider-parity.md) explains the tests; [recorded parity results](../experiments/claude-sdk-provider/verification-parity.json) distinguish real-model checks, replay checks and skipped workflows.

## Confirmed limitations

| ID | Open item | Scope and evidence |
| --- | --- | --- |
| SDK-1 | Compaction is not integrated into the production provider. | The Pi compaction hook cancels for **every `claude-sdk` model**, native automatic/idle compaction is disabled, and unexpected native compact events reject continuation. The latest Haiku matrix result was `Compaction cancelled`, not a new summary-memory failure. See the distinction below. |
| SDK-2 | Cloning, forks and tree navigation are blocked. | The same provider-wide history guard blocks these operations. The shared test confirmed a cancelled SDK clone while Codex created a new session. Safe SDK checkpoint/history lineage remains to be implemented. |
| SDK-3 | Durable foreground-child continuation is incomplete. | Fresh standard foreground workers now work, including real edits and validation. Borrowed foreground SDK bridges close on completion and do not persist child-local provider checkpoints. Resuming retained/completed children needs their own provider session hooks and E2E coverage. Normal parent-chat reload and completed-checkpoint restart already work. |
| SDK-4 | General instruction/configuration changes cannot transparently reuse a native query. | Validated tool declarations plus the generated `tools` section can change through a handoff. Other prompt, environment and output-limit changes remain guarded. Any broader handoff must preserve operator instructions and verify accepted history rather than weaken the fingerprint checks. |
| SDK-5 | The upstream prompt-sensitive request rejection is unresolved. | Structured prompt projection mitigates the recorded generated-documentation trigger. It is not an upstream fix, and opaque/custom/inherited prompts can still be rejected. See the [billing/request-content investigation](research/claude-agent-sdk-billing.md). No billing change or credential workaround is justified by this response alone. |
| CODEX-1 | Stop can be recorded as an error rather than cancellation. | The real Codex first-turn Stop returned `stopReason=error` with `This operation was aborted`. The next message succeeded without replay. This is a cancellation-status defect, not an SDK failure or proof that Stop cannot continue. |

## Compaction is two separate issues

### The current all-model integration guard

The latest shared matrix called Pi's ordinary compaction command. The installed provider cancelled it through `blockHistoryChange` in [index.ts](../experiments/claude-sdk-provider/index.ts). That condition checks the provider name, not Haiku, Opus or Sonnet. Git history dates this guard to `7aac7e81` on October 14, before the latest parity work.

[bridge.ts](../experiments/claude-sdk-provider/bridge.ts) also sets `autoCompactEnabled: false` and `idleCompaction: false`, and rejects unexpected native compaction status/boundary events. The matrix therefore did **not** run a native summarizer or reproduce `ACK_0`. This is an existing integration restriction exposed by the new test, not a newly discovered model-compaction regression.

Simply removing the hook is insufficient. SDK context ownership, checkpoint lineage, Pi projection changes, context telemetry and failure recovery still need coordinated handling. Pi's `compact()` also aborts before its compaction hook, so it is not a safe in-flight SDK compaction shortcut.

### The earlier native automatic-compaction memory failure

The [compaction research](research/claude-agent-sdk-compaction.md) and [sanitized experiment results](../experiments/claude-sdk-provider/verification-compaction.json) establish these narrower findings:

| Recorded experiment | Outcome |
| --- | --- |
| Haiku 5.5 native automatic compaction, SDK `0.3.296`, CLI `2.1.296` and `2.1.300` | Repeated marker loss after compact/resume. Many summaries were only `ACK_0`. Adaptive Low, adaptive High and CLI-default thinking also failed the recorded memory test. |
| Haiku with neutral replies, and direct SDK without the Pi bridge | Marker loss persisted. Neutral replies produced a short acknowledgement rather than useful retained context. The literal `ACK_0` instruction and Pi's adapter are not necessary for the recorded failure. |
| Opus 5.5 native automatic compaction, SDK `0.3.296`, explicitly selected CLI `2.1.300`, thinking Off, Low effort, 100K window | One synthetic Pi 1.2 agent-core run passed marker recall, continuation, completed-checkpoint resume, one tool execution, call/result identity and cumulative usage. |
| Focused native manual `/compact`, Haiku and Opus | Both passed the isolated memory/resume checks. The idle-threshold scheduler also passed on both, but it invokes the native manual command between completed turns and cannot protect an unbounded turn in flight. |
| Sonnet native automatic compaction; Opus automatic compaction with bundled CLI `2.1.296` or High/Max reasoning | Not verified by those experiments. |

So the **observed `ACK_0` counterexamples were Haiku runs**, while one Opus configuration passed. That does not prove only Haiku can fail, that Haiku always fails, or that production Opus compaction is ready. The passing Opus configuration differs from the production bundled executable and was not a full Coding Agent/RPC/phone compaction flow.

Before closing SDK-1, satisfy the research document's [remaining E2E gate](research/claude-agent-sdk-compaction.md#remaining-e2e-acceptance-gate): useful memory retention, model switching, queued input exactly once, unchanged tool identities/effects, checkpoint recovery across compaction, correct native context/usage reporting and unchanged hook/tool/permission isolation. Preserve the Haiku counterexamples rather than enabling every model globally.

## Coverage gaps, not confirmed failures

These workflows still need shared realistic verification. Earlier narrow checks do not establish these combinations:

- Other standard roles and custom agents or permission ceilings beyond the verified builtin `worker` journeys.
- Nested delegation and durable/retained/forked child continuation.
- Images and slash-command dialogs combined with tools, delegation, switching, Stop and restart.
- Arbitrary inherited/custom prompt changes and their provenance across child contexts.
- Continuing after tree navigation or cloning once implementation exists; the current clone test checks session creation only.
- Long-running/overnight background work, hard crashes, dropped native resume anchors and partial checkpoint/projection publication.
- Physical Safari. Mobile Chromium and WebKit checks are not physical-device proof.

The latest shared matrix exercised Haiku and Codex. It does not establish the same complete journeys on Sonnet and Opus. No all-green full parity run is recorded, and full local/unit suites were not run for this work.

## Safety boundaries to keep

Unknown SDK failures, missing tool results and altered approved history must remain blocked or require explicit recovery. Do not invent successful results, replay historical commands or silently approve unknown outcomes to make a parity test pass. These protections are not gaps to remove.

Close an item with evidence for its actual user flow and affected providers/models. Keep real-model results separate from external-SDK replay, and retain failed/unsupported cases rather than hiding them as skips.
