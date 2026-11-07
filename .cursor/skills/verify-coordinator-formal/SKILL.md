---
name: verify-coordinator-formal
description: Model-check coordinator/worker instruction, report, acceptance, Stop, and restart ordering, then replay the critical races through a real isolated host. Use when changing task state transitions, asynchronous command completion, report validation, or recovery.
---

# Verify coordinator and worker ordering

Run from the repository root. This is a bounded safety check, not a proof of all orchestration behavior. It does not change worker permissions or product code.

## Promises and harm

| Property | Promise | What a break means |
| --- | --- | --- |
| `AcceptedResultStable` | Once a result is accepted, an older RPC outcome cannot revoke that acceptance; a new explicit instruction or Stop may change it. | A reviewed result silently changes from Accepted to Needs inspection or Stopped. |
| `ReportsRequireWorking` | A report can be persisted only while its task is working. | A stopped or stopping worker can publish a stale result as current work. |

TLA+ fits this question because the risk is the ordering of separate synchronous host steps around asynchronous RPC replies. TLC 1.7.4 is pinned by SHA-256 in `verification/coordinator/check.mjs`. Java 11+ is required, preferably Temurin 21. The runner uses `JAVA`, Java on PATH, or an installed mise Temurin 21. `TLA2TOOLS` may select the pinned jar; otherwise it is cached and downloaded on first use.

## Run

```sh
npm run verify:coordinator
```

The command prints an absolute `pi-coordinator-formal-*` evidence directory and saves `result.json`, independent TLC verdicts, model/config files, and HTTP/RPC replay traces. Exit 0 means the checked properties hold, exit 1 means findings, and exit 2 means setup, source drift, or checker failure. Do not treat a checker error as a product bug or suppress a finding to obtain green output.

**At sync commit `96f889e271d5750d9b7c50ad1e8021d19ee0e70f`, exit 0 is expected.** The delayed instruction-failure and old Stop-acknowledgement replays preserve accepted results. The report-state guard also holds. See `verification/coordinator/FINDINGS.md`.

Read every TLA+ result with **`/statechart`**, following its installed skill. Use `verification/coordinator/WorkerFlow.tla`, its config, and `WorkerFlow.view.mjs`; work in a scratch directory as that skill instructs. Read its shortest paths and show the chart in the reader's words. The view hides redundant Stop requests and failures that do not revoke acceptance; all such actions remain checked. Inspect/acknowledgement steps that leave the displayed state unchanged are omitted from the drawing, not from verification.

## Source coverage and atomic steps

The authoritative sync record is `verification/coordinator/coverage.json`. Covered code is currently confirmed at the commit above.

| Model action / replay boundary | Source to inspect |
| --- | --- |
| Initial `starting` task | `src/coordinator.mjs`, `Coordinators.assign` before its first await |
| `BeginPrompt`, `BeginStop` | `Coordinators.beforeCommand`: synchronous guard, new command ID, state update, and ledger save |
| `PromptAcknowledged`, `StopAcknowledged` | `Coordinators.afterCommand`; only the current receipt is applied, and Stop ACK changes state only while stopping |
| `PromptFails`, `StopFails` | `Coordinators.failedCommand`; only current active work becomes unknown. The initial `assign` catch handles starting-state failures only |
| `ReportQuestion`, `ReportResult` | `Coordinators.report`: working-state gate and persisted report before yielding |
| `AcceptResult` | `Coordinators.action`, accept branch: reported gate and persisted completed state |
| `Restart` | `Coordinators` constructor: starting/working/stopping become unknown; dead-host promises do not resume |
| RPC gaps between those steps | `src/service.mjs`, `SessionService.command` and `dispatch`; `src/live-session.mjs`, `WorkerSession.dispatch`; `src/rpc.mjs`, `RpcWorker.request` and `command` |
| Real request receipts used by replay | `src/commands.mjs`, `CommandJournal.execute`; the model assumes fresh request IDs, so this is not an idempotency proof |

One model action represents one synchronous state-changing prefix/completion. Dispatch and its later completion are **not** one action. Queue-clear inside Stop is abstracted as part of its pending RPC interval because it does not change the task ledger. `latest` abstracts the current command ID under the one-pending-command-per-kind bound. `acceptedValid` and `reportFrom` are ghost history for checking promises, not production fields.

## Bounds and assumptions

- One coordinator and one worker, one prompt and one abort simultaneously pending, at most one host restart.
- Finite task states and fresh request IDs. Workers may deliver questions/results while RPC replies are pending.
- Successful atomic ledger writes at modeled boundaries; no power-loss/fsync guarantee.
- The replay uses real HTTP authorization, task bookkeeping, command receipts, persistence, and RPC subprocesses. Only the Pi RPC endpoint is controlled by `test/fixtures/coordinator-flow-pi.mjs` to hold/fail acknowledgements. It makes no model calls or user-project edits.
- Not checked: multiple-worker capacity/ownership, duplicate request IDs, worker tool/filesystem policy, code-worktree integration, report-to-turn freshness, native Pi timing guarantees, liveness, and UI behavior. Keep the existing native-Pi coordinator E2E proof for those integration boundaries it covers.

## Prove the check can fail

```sh
npm run verify:coordinator -- --self-test
```

This uses two disposable source copies. One removes the real `Coordinators.report` working-state gate and disables `EnforceReportGuard` in the model. The other removes the current/active-completion gate in `failedCommand` and disables `EnforceCompletionGuard`. Both mutations must violate their matching property in TLC and the real-host replay. Each copy is restored/discarded, the original property is rechecked, and covered product files must remain unchanged. A self-test pass proves sensitivity to these mutations, not an unbounded correctness guarantee.

## When code or a verdict changes

1. Read the changed functions in the coverage table and compare their await boundaries with the TLA+ actions. The runner refuses covered source drift; fetch the sync commit if a shallow checkout lacks it.
2. For a model violation, read `/statechart`, then inspect the matching real-host replay. If the replay does not agree, investigate the model, fault assumptions, or replay before reporting a product bug.
3. Do not weaken an invariant to match a bug, and do not change product code merely because this skill found one. Preserve the finding and its sequence; ask before fixing it.
4. For an intended change, update the model/replays to describe it, rerun the check and mutation self-test, and update the findings document.
5. Only after confirming the new mapping, move `coverage.json`'s sync commit and this skill's coverage record to the reviewed source commit. Do not advance the commit simply to bypass source review.

Use `/maintain-formal-verification-skill` when a later change did not recheck this coverage.
