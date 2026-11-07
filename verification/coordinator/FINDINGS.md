# Coordinator ordering findings

Source confirmed at `5720555fe156c9b538c21373d5a7aad0514212fd`. Product code was not changed by this verification.

## Accepted results can be overwritten by old RPC outcomes

Promise: a persisted acceptance remains valid until a new explicit instruction or Stop. Harm: the user loses the Accepted state for a result they already reviewed, even though its report text remains stored.

### Delayed instruction failure

1. `beforeCommand` saves `working` and dispatches an instruction; the RPC reply remains pending.
2. `report` receives the worker result and saves `reported`.
3. The coordinator accepts it; `action` saves `completed`.
4. The earlier instruction reply fails. `SessionService.command` calls `failedCommand`, which unconditionally writes `unknown`. The initial `assign` catch also writes `unknown`.

TLC's shortest counterexample has these four steps after initialization. The real-host `accepted-prompt-failure` replay confirms `completed → unknown` through the production HTTP, journal, ledger, and RPC paths.

### Delayed Stop acknowledgement

1. An initial instruction is acknowledged and working.
2. Stop starts and saves `stopping`; its abort reply is held.
3. A new explicit instruction starts, returns a result, and is accepted as `completed`.
4. The earlier abort reply arrives. `afterCommand` unconditionally writes `stopped`.

The real-host `accepted-stop-ack` replay confirms `completed → stopped`. The model also reaches this bad state. These two cases share the absence of completion-to-command/turn correlation; this document does not prescribe or apply a fix.

The `accepted-prompt-ack` control confirms that a delayed successful instruction acknowledgement preserves `completed`; the replay is not simply labeling every pending reply as a failure.

## Report-state guard holds and the mutation is detected

`report` currently rejects a result while Stop is pending. `ReportsRequireWorking` holds in the bounded model, and `late-report` confirms a rejected HTTP response with task state still `stopping`.

The self-test removes that production guard only in a disposable source copy and disables the matching model gate. TLC then finds an invalid report, and the same HTTP/RPC replay accepts the report and changes the task to `reported`. Restoring the guard returns this check to passing; the unrelated acceptance findings remain visible.

The following chart is the **intentional broken variant**, not the current report gate:

```mermaid
---
title: "Coordinator and worker task flow"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Breaks ReportsRequireWorking
    lg1: Path to the ReportsRequireWorking bug
  }
  class lg0 breaks
  class lg1 bugPath
  s0: Starting worker
  s1: Worker running
  s2: Stop pending
  s3: Question waiting
  [*] --> s0
  s0 --> s1: coordinator sends an instruction
  s1 --> s2: coordinator requests Stop
  s2 --> s3: worker asks a question
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s1 bugPath
  class s2 bugPath
  class s3 breaks
  class s3 bugPath
```

## Checked statechart

TLC reached 85 model states and 410 steps. This view groups the two overwritten-acceptance outcomes under one bad state. It omits acknowledgement-only/inspection stutters, redundant Stop requests, and failures unrelated to acceptance; the checker still explores them.

```mermaid
---
title: "Coordinator and worker task flow"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Breaks AcceptedResultStable
    lg1: Path to the AcceptedResultStable bug
  }
  class lg0 breaks
  class lg1 bugPath
  s0: Starting worker
  s1: Stop pending
  s2: Needs inspection
  s3: Worker running
  s4: Result ready
  s5: Question waiting
  s6: Worker stopped
  s7: Result accepted
  s8: Accepted result lost
  [*] --> s0
  s0 --> s2: host restarts
  s0 --> s3: coordinator sends an instruction
  s1 --> s2: host restarts
  s1 --> s6: Stop acknowledgement arrives
  s1 --> s3: coordinator sends an instruction
  s2 --> s3: coordinator sends an instruction
  s3 --> s4: worker returns a result
  s3 --> s5: worker asks a question
  s3 --> s1: coordinator requests Stop
  s3 --> s2: instruction reply fails or times out or host restarts
  s4 --> s7: coordinator accepts the result
  s4 --> s1: coordinator requests Stop
  s5 --> s1: coordinator requests Stop
  s6 --> s3: coordinator sends an instruction
  s7 --> s1: coordinator requests Stop
  s7 --> s8: instruction reply fails or times out or Stop acknowledgement arrives
  s4 --> s3: coordinator sends an instruction
  s5 --> s3: coordinator sends an instruction
  s7 --> s3: coordinator sends an instruction
  s8 --> s3: coordinator sends an instruction
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s3 bugPath
  class s4 bugPath
  class s7 bugPath
  class s8 breaks
  class s8 bugPath
```

## Reproduce and read the evidence

Run `npm run verify:coordinator`; exit 1 currently means the acceptance findings reproduced. Run `npm run verify:coordinator -- --self-test` to check mutation sensitivity. The printed evidence directory contains `result.json` and one JSON trace per replay. Use the generated `verify-coordinator-formal` skill and `/statechart` to interpret the model.

Bounds: one coordinator, one worker, one pending prompt and one pending abort, one restart. The RPC endpoint is a fault-controlled fixture, not native Pi. No paid model requests, user-project edits, capacity proof, request-ID replay proof, filesystem permission proof, UI proof, or liveness claim is made. Native Pi timing guarantees could narrow the reachable schedules; they are not assumed by the host-boundary check.
