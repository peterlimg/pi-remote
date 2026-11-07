-------------------------- MODULE RecoveryFlow --------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS GuardInputs, GuardGeneration, GuardStop, GuardEffects, GuardBudget
Inputs == {"assignment", "followup"}
Phases == {"queued", "working", "recovering", "checking", "blocked", "stopped", "reported"}
VARIABLES phase, epoch, oldEpoch, inputs, recorded, read, run, deliveries,
          attempts, failures, effect, stopped, checking, checkedEpoch, checkedInputs,
          staleAccepted, unsafeResume, stoppedRestart
vars == <<phase, epoch, oldEpoch, inputs, recorded, read, run, deliveries,
          attempts, failures, effect, stopped, checking, checkedEpoch, checkedInputs,
          staleAccepted, unsafeResume, stoppedRestart>>
Init == /\ phase = "queued" /\ epoch = 0 /\ oldEpoch = 0
        /\ inputs = {"assignment"} /\ recorded = {} /\ read = {} /\ run = {}
        /\ deliveries = [i \in Inputs |-> 0] /\ attempts = 0 /\ failures = 0
        /\ effect = "none" /\ stopped = FALSE /\ checking = FALSE
        /\ checkedEpoch = 0 /\ checkedInputs = {}
        /\ staleAccepted = FALSE /\ unsafeResume = FALSE /\ stoppedRestart = FALSE
Bodies(batch) == IF GuardInputs THEN batch \ recorded ELSE batch
Counts(batch) == [i \in Inputs |-> IF i \in Bodies(batch) THEN deliveries[i] + 1 ELSE deliveries[i]]
Dispatch ==
    /\ phase = "queued" /\ ~stopped /\ epoch < 8 /\ inputs # {}
    /\ phase' = "working" /\ epoch' = epoch + 1 /\ run' = inputs /\ read' = {}
    /\ recorded' = recorded \cup inputs /\ deliveries' = Counts(inputs)
    /\ UNCHANGED <<oldEpoch, inputs, attempts, failures, effect, stopped, checking,
                    checkedEpoch, checkedInputs, staleAccepted, unsafeResume, stoppedRestart>>
ReadInputs ==
    /\ phase = "working" /\ read' = run
    /\ UNCHANGED <<phase, epoch, oldEpoch, inputs, recorded, run, deliveries, attempts,
                    failures, effect, stopped, checking, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
Followup ==
    /\ phase \in {"working", "recovering", "queued"}
    /\ "followup" \notin inputs \cup recorded
    /\ inputs' = inputs \cup {"followup"}
    /\ UNCHANGED <<phase, epoch, oldEpoch, recorded, read, run, deliveries, attempts,
                    failures, effect, stopped, checking, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
StartTool ==
    /\ phase = "working" /\ run \subseteq read /\ effect = "none"
    /\ effect' = "pending"
    /\ UNCHANGED <<phase, epoch, oldEpoch, inputs, recorded, read, run, deliveries,
                    attempts, failures, stopped, checking, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
FinishTool ==
    /\ phase = "working" /\ effect = "pending" /\ effect' = "none"
    /\ UNCHANGED <<phase, epoch, oldEpoch, inputs, recorded, read, run, deliveries,
                    attempts, failures, stopped, checking, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
Report ==
    /\ phase = "working" /\ run \subseteq read /\ effect = "none"
    /\ inputs' = inputs \ run
    /\ phase' = IF inputs \ run = {} THEN "reported" ELSE "queued"
    /\ UNCHANGED <<epoch, oldEpoch, recorded, read, run, deliveries, attempts,
                    failures, effect, stopped, checking, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
Interrupt ==
    /\ phase = "working" /\ failures < 3 /\ epoch < 8
    /\ phase' = "recovering" /\ oldEpoch' = epoch /\ epoch' = epoch + 1
    /\ failures' = failures + 1
    /\ effect' = IF effect = "pending" THEN "uncertain" ELSE effect
    /\ UNCHANGED <<inputs, recorded, read, run, deliveries, attempts, stopped, checking,
                    checkedEpoch, checkedInputs, staleAccepted, unsafeResume, stoppedRestart>>
BeginRecoveryCheck ==
    /\ phase = "recovering" /\ ~stopped
    /\ (~GuardEffects \/ effect # "uncertain")
    /\ (~GuardBudget \/ attempts < 2)
    /\ phase' = "checking" /\ checking' = TRUE
    /\ checkedEpoch' = epoch /\ checkedInputs' = inputs
    /\ UNCHANGED <<epoch, oldEpoch, inputs, recorded, read, run, deliveries, attempts,
                    failures, effect, stopped, staleAccepted, unsafeResume, stoppedRestart>>
FinishRecoveryCheck ==
    /\ checking /\ epoch < 8 /\ attempts < 3
    /\ (~GuardStop \/ (~stopped /\ phase = "checking" /\ epoch = checkedEpoch))
    /\ (~GuardEffects \/ effect # "uncertain")
    /\ (~GuardBudget \/ attempts < 2)
    /\ phase' = "working" /\ epoch' = epoch + 1 /\ attempts' = attempts + 1
    /\ run' = checkedInputs /\ read' = {} /\ checking' = FALSE
    /\ recorded' = recorded \cup checkedInputs /\ deliveries' = Counts(checkedInputs)
    /\ unsafeResume' = unsafeResume \/ effect = "uncertain"
    /\ stoppedRestart' = stoppedRestart \/ stopped
    /\ UNCHANGED <<oldEpoch, inputs, failures, effect, stopped, checkedEpoch,
                    checkedInputs, staleAccepted>>
BlockRecovery ==
    /\ phase \in {"recovering", "checking"}
    /\ (effect = "uncertain" \/ attempts >= 2)
    /\ phase' = "blocked" /\ checking' = FALSE
    /\ UNCHANGED <<epoch, oldEpoch, inputs, recorded, read, run, deliveries, attempts,
                    failures, effect, stopped, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
Stop ==
    /\ phase \in {"queued", "working", "recovering", "checking"} /\ epoch < 8
    /\ phase' = "stopped" /\ stopped' = TRUE /\ epoch' = epoch + 1 /\ inputs' = {}
    /\ UNCHANGED <<oldEpoch, recorded, read, run, deliveries, attempts, failures,
                    effect, checking, checkedEpoch, checkedInputs,
                    staleAccepted, unsafeResume, stoppedRestart>>
LateReport ==
    /\ phase = "working" /\ oldEpoch > 0 /\ oldEpoch < epoch /\ run \subseteq read
    /\ ~GuardGeneration /\ staleAccepted' = TRUE /\ phase' = "reported"
    /\ UNCHANGED <<epoch, oldEpoch, inputs, recorded, read, run, deliveries, attempts,
                    failures, effect, stopped, checking, checkedEpoch, checkedInputs,
                    unsafeResume, stoppedRestart>>
Inspect == UNCHANGED vars
Next == Dispatch \/ ReadInputs \/ Followup \/ StartTool \/ FinishTool \/ Report
        \/ Interrupt \/ BeginRecoveryCheck \/ FinishRecoveryCheck \/ BlockRecovery
        \/ Stop \/ LateReport \/ Inspect
TypeOK == /\ phase \in Phases /\ epoch \in 0..8 /\ oldEpoch \in 0..8
          /\ inputs \subseteq Inputs /\ recorded \subseteq Inputs /\ read \subseteq Inputs
          /\ run \subseteq Inputs /\ deliveries \in [Inputs -> 0..4]
          /\ attempts \in 0..3 /\ failures \in 0..3 /\ effect \in {"none", "pending", "uncertain"}
          /\ stopped \in BOOLEAN /\ checking \in BOOLEAN /\ checkedEpoch \in 0..8
          /\ checkedInputs \subseteq Inputs /\ staleAccepted \in BOOLEAN
          /\ unsafeResume \in BOOLEAN /\ stoppedRestart \in BOOLEAN
NoDuplicateInputs == \A i \in Inputs : deliveries[i] <= 1
ReportsAreCurrent == ~staleAccepted
StopWinsRecovery == ~stoppedRestart
UncertainEffectsBlock == ~unsafeResume
RecoveryIsBounded == attempts <= 2
Spec == Init /\ [][Next]_vars
=============================================================================
