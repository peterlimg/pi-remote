# Remaining provider parity gaps

Canonical open-items list, updated for Pi-owned parent compaction, cloning, earlier-message forks and tree navigation. Keep future gap updates here rather than repeating the list in chat or the README. The [shared E2E contract](provider-parity.md) explains the tests; [recorded parity results](../experiments/claude-sdk-provider/verification-parity.json) distinguish real-model checks, replay checks and skipped workflows.

## Confirmed limitations

| ID | Open item | Scope and evidence |
| --- | --- | --- |
| SDK-1 | Parent manual/threshold compaction is implemented; remaining compaction scope needs verification. | Real Codex, SDK Haiku and SDK Opus checks passed using Pi's normal summarizer and a validated fresh-SDK handoff. Borrowed foreground-worker compaction, overflow/length recovery and partial publication crashes remain unproven. SDK-native automatic compaction stays disabled intentionally. See [implementation and evidence](sdk-compaction.md). |
| SDK-2 | Parent cloning, earlier-message forks and validated tree navigation are implemented; remaining combinations need verification. | Saved branches use owner-bound receipts and fresh native contexts. Tree moves validate both paths, optionally use Pi's normal summary and preserve audit/effects. Queued moves with and without summaries passed real Codex, SDK Haiku and SDK Opus checks. See [cloning](sdk-cloning.md), [forks](sdk-forks.md) and [tree scope/evidence](sdk-tree.md). Child-local lifecycle and new phone controls are not enabled. |
| SDK-3 | Durable foreground-child continuation is incomplete. | A real standard-worker resume now reproduces the missing checkpoint. A test-only use of the existing pi-subagents API loads child-owned hooks and saves that checkpoint, without changing the extension; an upstream patch is not proven necessary. Resume then rejects real prompt changes between foreground and background, including an added Ponytail section. Safe prompt handoff and production-safe hook admission remain open. Parent-wide registration must not conflict with other policies or non-SDK ceilings. See [workflow and evidence](sdk-worker-continuation.md). |
| SDK-4 | General instruction/configuration changes cannot transparently reuse a native query. | Validated tool declarations and generated `tools` guidance can change through a handoff, including order-only regeneration on reload. Other prompt, environment and output-limit changes remain guarded. Any broader handoff must preserve operator instructions and verify accepted history rather than weaken the fingerprint checks. |
| SDK-5 | The upstream prompt-sensitive request rejection is unresolved. | Structured prompt projection mitigates the recorded generated-documentation trigger. It is not an upstream fix, and opaque/custom/inherited prompts can still be rejected. See the [billing/request-content investigation](research/claude-agent-sdk-billing.md). No billing change or credential workaround is justified by this response alone. |
| SDK-6 | Hookless foreground append-mode children still lack prompt-projection provenance. | The normal default-placement parallel `delegate` workflow now passes on Codex, SDK Haiku and SDK Opus. Its append-only safety override is projected only after matching the complete canonical Pi base; every appended instruction remains intact. Explicitly forcing the borrowed foreground route is not fixed by this change. See [inherited delegate scope/evidence](sdk-inherited-delegates.md). |
| CODEX-1 | Stop can be recorded as an error rather than cancellation. | The real Codex first-turn Stop returned `stopReason=error` with `This operation was aborted`. The next message succeeded without replay. This is a cancellation-status defect, not an SDK failure or proof that Stop cannot continue. |

## Compaction status and earlier ACK_0 findings

### Pi-owned parent compaction

The provider now accepts Pi's manual and threshold compaction after checking accepted history and matched tool results. Pi generates the summary once; a durable receipt binds the old source, new projection and configuration before another SDK context opens. Original audit entries and previous native transcripts remain preserved. See [the compaction design and verification](sdk-compaction.md).

The earlier parity result `Compaction cancelled` came from the all-model hook introduced in `7aac7e81` on October 14. It was a pre-existing integration restriction, not a new `ACK_0` reproduction. That blanket Pi-compaction block has been replaced by the validated handoff. Tree navigation now has its own validated handoff.

[The pinned standalone bridge](https://github.com/peterlimg/pi-claude-sdk/blob/bd9e41b2ba5ca2061099aaab56c496c2b454ea8e/bridge.ts) still disables SDK-native automatic/idle compaction and rejects unexpected native compaction events. This is deliberate: Pi is the single compaction owner for the new path. It does not enable or claim to fix the native Haiku failure below.

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

The new parent implementation is verified separately in [compaction-context evidence](../experiments/claude-sdk-provider/verification-compaction-context.json). Preserve the Haiku counterexamples. The research document's [native-compaction E2E gate](research/claude-agent-sdk-compaction.md#remaining-e2e-acceptance-gate) still applies before enabling SDK-native compaction; it is not evidence for that unimplemented alternative.

## Coverage gaps, not confirmed failures

These workflows still need shared realistic verification. Earlier narrow checks do not establish these combinations:

- Other standard roles and custom agents or permission ceilings beyond the verified builtin `worker` and default-placement parallel `delegate` journeys.
- Nested delegation and durable/retained/forked child continuation.
- Images and slash-command dialogs combined with tools, delegation, switching, Stop and restart.
- Arbitrary inherited/custom prompt changes and their provenance across child contexts.
- Branching combined with child-local lifecycle, images or slash-dialog workflows beyond the shared parent clone/fork/tree contracts.
- Long-running/overnight background work, hard crashes, dropped native resume anchors and partial checkpoint/projection publication.
- Physical Safari. Mobile Chromium and WebKit checks are not physical-device proof.

The baseline full matrix exercised Haiku and Codex. New compaction and branching checks also cover Opus, not its other complete journeys. Sonnet compaction/branching and complete parity remain unverified. No all-green full parity run is recorded, and full local/unit suites were not run for this work.

## Safety boundaries to keep

Unknown SDK failures, missing tool results and altered approved history must remain blocked or require explicit recovery. Do not invent successful results, replay historical commands or silently approve unknown outcomes to make a parity test pass. These protections are not gaps to remove.

Close an item with evidence for its actual user flow and affected providers/models. Keep real-model results separate from external-SDK replay, and retain failed/unsupported cases rather than hiding them as skips.
