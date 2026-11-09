----------------------------- MODULE WakeFlow -----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS EnforceFreshWake, EnforceObserved
Facts == 1..2
VARIABLES current, recorded, pending, viewed, opening, deliveries, badWake
vars == <<current, recorded, pending, viewed, opening, deliveries, badWake>>

Init == /\ current = 0 /\ recorded = {} /\ pending = {}
        /\ viewed = FALSE /\ opening = FALSE
        /\ deliveries = [f \in Facts |-> 0] /\ badWake = FALSE

\* A real question/reply has a stable key; the observed watermark survives restart.
Change(f) ==
    /\ f \notin recorded
    /\ current' = f /\ recorded' = recorded \cup {f}
    /\ pending' = IF viewed THEN pending ELSE pending \cup {f}
    /\ UNCHANGED <<viewed, opening, deliveries, badWake>>

\* Status churn with the same underlying fact must not enqueue it again.
ObserveCurrent ==
    /\ current \in Facts /\ ~EnforceObserved
    /\ pending' = pending \cup {current}
    /\ UNCHANGED <<current, recorded, viewed, opening, deliveries, badWake>>

Withdraw == /\ current # 0 /\ current' = 0
            /\ UNCHANGED <<recorded, pending, viewed, opening, deliveries, badWake>>
View == /\ ~viewed /\ viewed' = TRUE /\ pending' = {}
        /\ UNCHANGED <<current, recorded, opening, deliveries, badWake>>
Leave == /\ viewed /\ viewed' = FALSE
         /\ UNCHANGED <<current, recorded, pending, opening, deliveries, badWake>>

\* Starting/resuming Miso yields; a question can be answered or viewed meanwhile.
Begin == /\ pending # {} /\ ~opening /\ opening' = TRUE
         /\ UNCHANGED <<current, recorded, pending, viewed, deliveries, badWake>>

\* The production gate runs again synchronously before dispatch, after startup.
Dispatch ==
    /\ opening
    /\ EnforceFreshWake => (~viewed /\ current \in pending)
    /\ badWake' = (badWake \/ viewed \/ current \notin pending)
    /\ deliveries' = [f \in Facts |-> IF f = current THEN deliveries[f] + 1 ELSE deliveries[f]]
    /\ pending' = {} /\ opening' = FALSE
    /\ UNCHANGED <<current, recorded, viewed>>

Skip == /\ opening /\ (viewed \/ current \notin pending)
        /\ pending' = {} /\ opening' = FALSE
        /\ UNCHANGED <<current, recorded, viewed, deliveries, badWake>>

\* Stale presence is ephemeral; durable fact receipts and watermarks are not.
Restart == /\ opening' = FALSE /\ viewed' = FALSE
           /\ UNCHANGED <<current, recorded, pending, deliveries, badWake>>

Next == (\E f \in Facts : Change(f)) \/ ObserveCurrent \/ Withdraw \/ View \/ Leave
        \/ Begin \/ Dispatch \/ Skip \/ Restart
Spec == Init /\ [][Next]_vars
Bounded == \A f \in Facts : deliveries[f] <= 2
TypeOK == /\ current \in 0..2 /\ recorded \subseteq Facts /\ pending \subseteq Facts
          /\ viewed \in BOOLEAN /\ opening \in BOOLEAN /\ badWake \in BOOLEAN
          /\ deliveries \in [Facts -> 0..3]
OnlyFreshWakes == ~badWake
AtMostOnceChange == \A f \in Facts : deliveries[f] <= 1
=============================================================================
