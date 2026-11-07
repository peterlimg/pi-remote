--------------------------- MODULE WorkerFlow ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS EnforceReportGuard, EnforceCompletionGuard

States == {"starting", "working", "waiting", "reported", "completed",
           "stopping", "stopped", "unknown"}
Commands == {"prompt", "abort"}

VARIABLES taskState, inFlight, hasInstruction, acceptedValid, reportFrom, restarted, latest
vars == <<taskState, inFlight, hasInstruction, acceptedValid, reportFrom, restarted, latest>>

\* One newly persisted task; transport acknowledgements have not arrived.
Init ==
    /\ taskState = "starting"
    /\ inFlight = {}
    /\ hasInstruction = FALSE
    /\ acceptedValid = FALSE
    /\ reportFrom = {}
    /\ restarted = FALSE
    /\ latest = "none"

\* beforeCommand is synchronous; dispatch then yields with the receipt pending.
BeginPrompt ==
    /\ "prompt" \notin inFlight
    /\ taskState' = "working"
    /\ inFlight' = inFlight \cup {"prompt"}
    /\ latest' = "prompt"
    /\ hasInstruction' = TRUE
    /\ acceptedValid' = FALSE
    /\ UNCHANGED <<reportFrom, restarted>>

BeginStop ==
    /\ "abort" \notin inFlight
    /\ taskState' = "stopping"
    /\ inFlight' = inFlight \cup {"abort"}
    /\ latest' = "abort"
    /\ acceptedValid' = FALSE
    /\ UNCHANGED <<hasInstruction, reportFrom, restarted>>

\* afterCommand(prompt) changes dispatch metadata, not task.state.
PromptAcknowledged ==
    /\ "prompt" \in inFlight
    /\ inFlight' = inFlight \ {"prompt"}
    /\ UNCHANGED <<taskState, hasInstruction, acceptedValid, reportFrom, restarted, latest>>

StopAcknowledged ==
    /\ "abort" \in inFlight
    /\ taskState' = IF latest = "abort" /\ taskState = "stopping" THEN "stopped" ELSE taskState
    /\ inFlight' = inFlight \ {"abort"}
    /\ UNCHANGED <<hasInstruction, acceptedValid, reportFrom, restarted, latest>>

PromptFails ==
    /\ "prompt" \in inFlight
    /\ taskState' = IF ~EnforceCompletionGuard \/ (latest = "prompt" /\ taskState \in {"working", "stopping"})
                    THEN "unknown" ELSE taskState
    /\ inFlight' = inFlight \ {"prompt"}
    /\ UNCHANGED <<hasInstruction, acceptedValid, reportFrom, restarted, latest>>

StopFails ==
    /\ "abort" \in inFlight
    /\ taskState' = IF ~EnforceCompletionGuard \/ (latest = "abort" /\ taskState \in {"working", "stopping"})
                    THEN "unknown" ELSE taskState
    /\ inFlight' = inFlight \ {"abort"}
    /\ UNCHANGED <<hasInstruction, acceptedValid, reportFrom, restarted, latest>>

ReportQuestion ==
    /\ hasInstruction
    /\ (~EnforceReportGuard \/ taskState = "working")
    /\ taskState' = "waiting"
    /\ reportFrom' = reportFrom \cup {taskState}
    /\ UNCHANGED <<inFlight, hasInstruction, acceptedValid, restarted, latest>>

ReportResult ==
    /\ hasInstruction
    /\ (~EnforceReportGuard \/ taskState = "working")
    /\ taskState' = "reported"
    /\ reportFrom' = reportFrom \cup {taskState}
    /\ UNCHANGED <<inFlight, hasInstruction, acceptedValid, restarted, latest>>

AcceptResult ==
    /\ taskState = "reported"
    /\ taskState' = "completed"
    /\ acceptedValid' = TRUE
    /\ UNCHANGED <<inFlight, hasInstruction, reportFrom, restarted, latest>>

\* Recovery does not resume promises belonging to the dead host.
Restart ==
    /\ ~restarted
    /\ taskState' = IF taskState \in {"starting", "working", "stopping"}
                    THEN "unknown" ELSE taskState
    /\ inFlight' = {}
    /\ restarted' = TRUE
    /\ UNCHANGED <<hasInstruction, acceptedValid, reportFrom, latest>>

Inspect == UNCHANGED vars

Next == BeginPrompt \/ BeginStop \/ PromptAcknowledged \/ StopAcknowledged
        \/ PromptFails \/ StopFails \/ ReportQuestion \/ ReportResult
        \/ AcceptResult \/ Restart \/ Inspect

TypeOK == /\ taskState \in States
          /\ inFlight \subseteq Commands
          /\ hasInstruction \in BOOLEAN
          /\ acceptedValid \in BOOLEAN
          /\ reportFrom \subseteq States
          /\ restarted \in BOOLEAN
          /\ latest \in Commands \cup {"none"}

\* Ghost history is reset only by a new explicit coordinator command.
AcceptedResultStable == acceptedValid => taskState = "completed"
ReportsRequireWorking == reportFrom \subseteq {"working"}

Spec == Init /\ [][Next]_vars
=============================================================================
