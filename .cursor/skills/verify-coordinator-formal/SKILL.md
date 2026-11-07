---
name: verify-coordinator-formal
description: Model-check command/report/acceptance ordering and bounded recovery inputs, generations, Stop, uncertain effects and retry limits; replay the critical races through a real isolated host.
---

# Verify coordinator ordering and recovery

Run from the repository root. These are bounded safety checks, not a whole-system proof. Product files must remain unchanged by verification. The reviewed source commit is recorded only in `verification/coordinator/coverage.json`.

## Promises and harm

| Property | Promise | What a break means |
| --- | --- | --- |
| `AcceptedResultStable` | Older RPC outcomes cannot revoke an accepted result. | Reviewed work silently becomes uncertain/stopped. |
| `ReportsRequireWorking` | New reports persist only while working. | A stopped or already-reported attempt publishes again. |
| `NoDuplicateInputs` | A recorded input body is not delivered again during recovery. | An instruction may repeat its side effects. |
| `ReportsAreCurrent` | Only the current execution generation can publish a new report. | An obsolete attempt replaces current work. |
| `StopWinsRecovery` | Stop prevents automatic continuation, including a pending recovery callback. | Work restarts after the user stopped it. |
| `UncertainEffectsBlock` | A missing tool outcome prevents automatic continuation. | An outside action could run twice. |
| `RecoveryIsBounded` | At most two automatic attempts precede escalation. | Broken work retries indefinitely. |

TLC 1.7.4 is pinned by SHA-256 in check.mjs. Java 11+ is required, preferably Temurin 21. The runner uses `JAVA`, PATH Java, or mise Temurin 21. `TLA2TOOLS` may select the pinned jar; otherwise it is downloaded and cached.

## Run

```sh
npm run verify:coordinator
npm run verify:coordinator -- --self-test
```

The command prints a retained `pi-coordinator-formal-*` evidence directory with result.json, independent TLC verdicts/configurations and HTTP/RPC traces. Exit 0 means the checked properties hold; 1 means findings; 2 means setup, source drift, model/runtime disagreement or checker failure. Never suppress a finding or weaken an invariant to get green output.

Read both models through **`/statechart`**, following that skill and using scratch copies:

- `verification/coordinator/WorkerFlow.tla`, config and view: command completion, reports, acceptance, Stop and restart.
- `verification/coordinator/RecoveryFlow.tla`, config and view: durable inputs, generation replacement, asynchronous reconciliation, Stop, tool uncertainty and retry exhaustion.

Read shortest counterexamples and show the chart in the reader's words. Inspection/unchanged-state steps are omitted only from the drawing. A safety pass does not prove eventual progress.

## Source mapping and atomicity

| Action / boundary | Source to inspect |
| --- | --- |
| Initial task, durable mailbox, queued follow-up | `Coordinators.assign`, `queueInput`, `action(message)` in src/coordinator.mjs |
| Before/after/failed command | `beforeCommand`, `afterCommand`, `failedCommand`: command-ID guard and synchronous ledger writes surrounding awaited dispatch |
| Read receipt / current report / acceptance | `report`, `action(accept)`; extension/coordinator.mjs `context`, `tool_call`, `task_report` |
| Recorded bodies versus unread input | src/task-input.mjs `encodeTaskInput`; src/history-worker.mjs `taskRecovery` branch scan |
| Interrupt, check, continue or block | `interrupt`, `advanceTask`, `deliver`, `blockRecovery`; capture generation and recheck after every awaited read/start boundary |
| Stop and reactivation | `action(stop/message/recover)`; cancel inputs and fence pending recovery before abort; reject continuation during Stop |
| Restart | Constructor fences mailbox generations, preserves inputs/budget and restores recoverable work; legacy tasks remain inspection-first |
| Workspace identity/status | src/task-workspaces.mjs `inspectWorkspace`; not a general filesystem transaction or process-tree inspection |
| RPC/checkpoint gaps | src/service.mjs command/dispatch/restore; src/live-session.mjs WorkerSession; src/rpc.mjs requests |
| Durable request receipts | src/commands.mjs CommandJournal.execute; fresh request IDs are assumed in these models |

`SessionService.matches` may add read-only worker-activity counts for session lists, with `web/protocol.js` deriving display activity. This does not change runtime status, command permissions or the task ledger; presentation remains outside both models. Review such covered-source changes for side effects before advancing the sync record.

A model action is one synchronous state-changing prefix/completion, not the entire awaited operation. WorkerFlow projects mailbox recovering and blocked states to `unknown`; RecoveryFlow distinguishes them. WorkerFlow prohibits a prompt overtaking unfinished Stop. `latest`, acceptedValid and reportFrom abstract command identity and ghost history. RecoveryFlow abstracts a bounded set of input IDs and epochs rather than UUIDs and text.

## Runtime and negative controls

Normal verification runs nine real-host traces: delayed prompt ACK/failure, Stop serialization/accepted result, late report, deduplicated recovery input, stale generation, Stop during recovery, missing tool outcome and retry exhaustion. The real host enforces HTTP authorization, ledger updates, journal receipts and subprocess RPC. Only the Pi endpoint is controlled by test/fixtures/coordinator-flow-pi.mjs; it records its user/tool events at that existing process boundary and makes no model calls.

Self-test makes seven disposable source copies. It separately disables each matching model guard and production behavior: report-state gate, completion gate, body deduplication, report generation, Stop cancellation/fencing, uncertain-tool check and retry budget. Both TLC and the matching real-host replay must fail. The original model/runtime must pass after restoration; covered source hashes must remain unchanged. This proves sensitivity to those broken variants, not every possible bug.

Also run the native-Pi `npm run test:coordinator-recovery` proof after changing these boundaries. It adds real provider failures, mid-shell Pi kill, host restart with unread follow-up, Stop during in-flight Git inspection, capacity, lost Git apply acknowledgement and phone evidence. Deterministic responses are not paid-model judgment.

## Bounds and exclusions

- WorkerFlow: one owner/worker, one pending prompt and abort, one restart, fresh request IDs.
- RecoveryFlow: two inputs, three interrupted turns, up to eight epochs, one Stop, one unfinished assignment episode, at most two automatic attempts.
- Successful atomic ledger writes and coherent complete history reads; no fsync/power-loss guarantee.
- No multiple-worker/capacity proof, duplicate-request proof, OS sandbox, arbitrary shell exactly-once semantics, orphan-process reconciliation, interrupted-main-turn recovery, notification liveness, code integration transaction, UI or paid-model timing proof. Native E2E covers selected integrations, not all these exclusions.

## When covered code changes

1. Read changed functions and compare await boundaries, guards and persistence with both models. The runner refuses source drift; fetch the sync commit if missing.
2. Read every violation through /statechart and compare its replay. Model/runtime disagreement is a checker problem until investigated, not automatically a product bug.
3. Preserve findings; do not patch product code merely because this verification task found a bug without authorization.
4. For authorized changes, reconcile models/replays, run both checks and the native crash proof, and update FINDINGS.md.
5. Only then advance coverage.json to the reviewed source commit. Never advance it merely to bypass drift.

Use `/maintain-formal-verification-skill` when a later covered change was not reconciled.
