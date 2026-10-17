# Durable execution and interrupted SDK recovery

Investigated October 16, 2026. The initial design and read-only evidence follow below. The implemented [`/sdk-recover` operation](../../experiments/claude-sdk-provider/EXPERIMENT.md#explicit-recovery-after-interruption) provides an operator-approved **new SDK context** from the same Pi chat, using Pi's existing tool validation and permission policy rather than an additional recovery-wide approval mode. It preserves the old native transcript rather than attempting the in-place native continuation discussed here. It does not implement a durable executor or reconstruct unrecorded command output. The restart lifecycle fix remains in place.

## Finding

We can restore a recorded result, or record an honest interruption. We cannot reconstruct an unrecorded command's stdout, exit status, or side effects from the fact that the host restarted.

The reported conversation has more evidence than its Pi transcript alone:

- Its completed checkpoint's 47-message prefix still matches the saved Pi history.
- The checkpoint's native SDK anchor still exists.
- One Pi `bash` call has no Pi result.
- The SDK transcript contains that exact tool-use ID, `mcp__pi__bash` name, and arguments, plus one matching error result. Its text indicates interruption and contains no exit-code evidence.
- The Pi file was unchanged by inspection. The interrupted command was not rerun, and no model request was made.

The native error is evidence that the SDK observed an interruption. It is **not** a receipt proving how the shell command finished. A recovery record must retain that distinction.

A second inspected conversation has a matching 112-message checkpoint prefix and no outstanding Pi tool calls, but still has SDK responses after its checkpoint. Therefore, restoring missing Pi results alone does not solve all SDK recovery: native continuation state must also be reconciled.

Private, content-redacted audit evidence: `/tmp/pi-sdk-recovery.sPgpxN/audit.jsonl`. The audit uses the SDK's read-only `getSessionMessages()` interface. Session identifiers, commands, and tool output are intentionally not reproduced here.

## What Pi Durable provides

A complete first-party README was available in the local npm metadata cache for `@earendil-works/pi-durable` 1.0.4, cached October 6. Its recovery contract is useful:

- `submit()` durably admits input. Reusing a `requestId` returns the existing submission instead of submitting twice.
- Each tool call is a durable task. The runtime commits its intent before `execute()`.
- After interruption, only a tool explicitly declared `replay: "safe"` may rerun automatically. Otherwise, the model receives an `interrupted` error with the output committed so far.
- Partial output commits default to a 100 ms interval. Partial output is not a final receipt.
- `Harness.open()` on the same storage plus `resume()` continues unfinished work.
- The per-conversation `pi.provider` UUID supplies provider affinity. It is not our native Claude SDK session ID or a replacement for the SDK checkpoint.
- One process must own storage. That version does not provide cross-process locking.

Its documented SQLite adapter uses WAL with `synchronous = NORMAL`, covering process crashes but not guaranteeing the newest commit after power or host failure. The JSONL adapter offers `{ fsync: true }`. Storage durability must match the failure we claim to survive.

This is a separate runtime, not an extension flag for our existing `AgentSession` RPC worker. Replacing Pi's current tools with Durable's built-in `CodingTools` would also replace parts of our execution pipeline. Preserve Pi's validation, permission hooks, result transformations, image handling, extensions, and audit ownership rather than bypassing them.

The cached README is complete but historical. Newer indexed primary documentation describes the same unsafe-tool interruption policy; current implementation and normative-spec review remain incomplete because full-page retrieval was blocked. Do not treat this as validation of a current-version migration.

## Two different recovery problems

### Tool execution and receipts

The installed Pi 1.3.0 execution path is:

```text
execute tool
  -> after-tool hooks and image normalization
  -> tool_execution_end
  -> message_end hooks and public event
  -> SessionManager.appendMessage(toolResult)
  -> next provider request delivers the result to the SDK bridge
```

`message_end` extensions can replace finalized messages, including tool results. A receipt captured in an earlier `tool_result` hook may not be the final Pi-visible result. A host merely observing RPC also cannot guarantee that it saved the result before either process died.

The durable commit must belong to the execution pipeline, after the applicable result transformations and before publishing completion. Store the final result and its task status atomically. Bind it to the conversation, branch, tool-use ID, tool name, arguments digest, and execution/configuration version. An arguments-only cache is unsafe: two intentional calls can have identical arguments.

On reopen:

| Durable evidence | Recovery action |
| --- | --- |
| Valid final receipt matching the original call | Reuse the exact result without executing or rerunning historical hooks. |
| Matching result in another authoritative store | Validate identity and provenance before importing it. Preserve where it came from. |
| Intent or partial output, no final receipt | Record `interrupted`, `isError: true`, and explicitly unknown effects. Do not invent an exit code. |
| Interrupted tool explicitly reviewed as replay-safe | Permit replay under that tool's policy, through Pi's normal execution controls. |
| Identity, branch, configuration, or receipt mismatch | Refuse recovery and preserve the evidence. |

An `interrupted` error restores honest conversation context. It does not mean the command did nothing or authorize automatic replay. New tool calls follow Pi's normal validation and permission policy. The explicit recovery decision is not a reconstructed completion receipt, and an operator-requested retry must not be mislabeled as receipt reuse.

Some operations have independently checkable goals. A restart job can verify the expected host generation and revision, for example. Record that as reconciliation evidence, not as the original shell command's recovered exit status. Prefer such typed, verifiable operations over trying to infer arbitrary shell behavior.

### Native SDK continuation

The current [bridge](../../experiments/claude-sdk-provider/bridge.ts) persists completed native checkpoints, but its pending MCP callbacks, tool batches, and accepted-input tracking live in memory. `historyContent()` intentionally rejects SDK work after the saved checkpoint. That guard cannot simply be removed when a Pi result is restored.

A recovery adapter must reconcile:

- The original verified prefix and unchanged configuration.
- Every later Pi tool call and its known result or explicit interruption.
- The SDK's exact tool-use IDs, result carriers, and native chain UUIDs.
- Queued user messages and SDK entries that Pi had not yet observed.
- Usage and cost already reported for the interrupted turn, without charging them twice in Pi's accounting.

SDK 0.3.296 declares two relevant controls:

- `resumeSessionAt` accepts any native chain-entry UUID, including a later tool-result carrier. An assistant UUID is not always the latest safe point.
- `resumeDropsTurn` validates a truncating headless resume and refuses to discard entries belonging to something other than the declared turn. A refusal is deterministic. Preserve the evidence and stop for reconciliation, rather than retrying the same truncation or silently dropping queued input.

These declarations identify a candidate recovery method. They do not prove that our MCP bridge can resume an interrupted turn. Actual SDK behavior, callback identity, accepted input, and accounting must pass a live isolated E2E before this path is enabled. Do not silently rewind, fork, or replace a native conversation to force recovery through.

## Smallest useful implementation order

1. **Add an explicit operator recovery operation for interrupted sessions.** Inspect both stores first. Show which results are recorded, which are SDK interruption evidence, and which effects remain unknown. Apply only after confirmation, with exclusive ownership and an unchanged-file check. Preserve original audit entries, and record recovery provenance rather than rewriting history or inserting a successful result.
2. **Reconcile the native SDK continuation.** Use a verified native carrier and preserved inputs, or leave the session blocked with an actionable reason. For the reported chat, the matching native interruption result is a candidate, not proof of successful shell execution. Keep all existing identity, configuration, authentication, and history checks.
3. **Make future executions durable.** Spike Pi Durable's task/result storage behind a Pi-owned executor in isolation. Reuse its task checkpoints and replay policy rather than building a second workflow engine. Do not migrate all existing conversations or enable native compaction as a side effect.

A completed receipt can be restored automatically after verification. An uncertain historical execution needs an explicit recovery decision. Those are separate operations and should have different UI wording.

## E2E acceptance before enabling recovery

Use scratch conversations and synthetic effects. No unit tests, production tool replay, or recovery experiments against the original conversation.

- Kill after intent, before a final receipt: unsafe execution becomes interrupted, not retried.
- Kill after an effect but before its receipt: effects stay unknown; no second effect occurs.
- Kill after a final receipt but before Pi records or publishes it: recover the identical result; execute once.
- Kill after Pi records the result but before SDK acceptance: deliver the recorded result without re-execution and verify the original SDK call identity.
- Kill after SDK acceptance but before the final SDK checkpoint: preserve native lineage, queued input, and usage, then continue with one new user message.
- Put an unobserved user message beyond a proposed native anchor: refuse destructive rewind without losing it.
- Tamper with IDs, arguments, configuration, prefix, or receipts: reject before execution or inference.
- Repeat a recovery request: apply its record once.
- Fail result persistence: never publish a durable-success claim.

The existing [lifecycle E2E](../../test/lifecycle-e2e.mjs) proves restart gating and fail-closed unknown-result behavior with RPC replay. It does not validate this new recovery adapter. The last live SDK acceptance attempt was blocked by the workspace's extra-usage requirement. This investigation made no new inference requests and did not change billing or authentication.

## Sources

- [Pi Durable 1.0.4 README](https://unpkg.com/@earendil-works/pi-durable@1.0.4/README.md), read in full from the cached public npm packument. Package `gitHead`: `7c10bd4337495ee613f2224843ecdf349b80d1df`. README SHA-256: `c43ab96d438118de49a632802ed4cf455feb2b38d91ba5281673b5828c29704f`.
- [Current Pi Durable package](https://github.com/earendil-works/pi/tree/main/packages/durable) and [normative specification](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md). Full current-source retrieval was blocked; no claim of a complete current implementation audit.
- [Pi Durable first-party announcement](https://earendil.com/posts/pi-durable/), indexed passages only.
- [SDK 0.3.296 declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.296/sdk.d.ts), inspected locally: `getSessionMessages`, `SessionMessage`, `SDKUserMessage`, `resumeSessionAt`, `resumeDropsTurn`, and `SessionStore`. A `SessionStore` mirror is secondary to the native local write and may drop a failed mirrored batch; it is not a Pi execution receipt.
- Installed Pi 1.3.0 source, inspected locally: `pi-agent-core/dist/agent-loop.js`, `pi-coding-agent/dist/core/agent-session.js`, `session-manager.js`, and extension types. No changes made to that installation.
