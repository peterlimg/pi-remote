--------------------------- MODULE AssistantFlow ---------------------------
EXTENDS Naturals, FiniteSets

\* Miso: the host records session events, wakes Miso with them, the phone answers
\* questions it saw, and (phase 3) sends drafts only after the phone approves them.
\* Each Enforce* constant is a guard in the host; check.mjs turns each off to prove
\* the matching invariant is not vacuous.
CONSTANTS EnforceMarkBeforeDispatch, EnforceNoResend, EnforceDialogMatch, EnforceApprovedRevision, EnforceCancel

Events == 1..3
Dialogs == 1..2
Revisions == 1..2
Ledger == {"none", "pending", "sending", "sent", "unknown"}
DraftStates == {"none", "drafted", "approved", "delivering", "delivered", "uncertain", "cancelled"}

VARIABLES
    session,      \* one watched session: "idle", "working" or "waiting"
    dialog,       \* its open question, 0 when none
    asked,        \* question ids already opened; ids are never reused
    ledger,       \* event id -> delivery state, saved in assistant.json
    question,     \* event id -> the question it reports, 0 for a finished turn
    miso,         \* "idle" or "busy"
    inflight,     \* events in the current wake dispatch
    landed,       \* the current wake reached Miso before its acknowledgement
    received,     \* event id -> times Miso received it
    card,         \* question the phone shows, 0 when none
    misdirected,  \* an answer reached a question other than the one shown
    draft, rev, approvals, approved, sending, sendLanded, deliveries, deliveredRevs,
    cancelled     \* the phone cancelled the draft at some point

vars == <<session, dialog, asked, ledger, question, miso, inflight, landed, received, card, misdirected,
          draft, rev, approvals, approved, sending, sendLanded, deliveries, deliveredRevs, cancelled>>
eventVars == <<ledger, question, miso, inflight, landed, received>>
draftVars == <<draft, rev, approvals, approved, sending, sendLanded, deliveries, deliveredRevs, cancelled>>

Init ==
    /\ session = "idle" /\ dialog = 0 /\ asked = {}
    /\ ledger = [e \in Events |-> "none"] /\ question = [e \in Events |-> 0]
    /\ miso = "idle" /\ inflight = {} /\ landed = FALSE /\ received = [e \in Events |-> 0]
    /\ card = 0 /\ misdirected = FALSE
    /\ draft = "none" /\ rev = 0 /\ approvals = {} /\ approved = 0
    /\ sending = 0 /\ sendLanded = FALSE /\ deliveries = 0 /\ deliveredRevs = {} /\ cancelled = FALSE

\* Assistant.observe runs synchronously on the state change that caused the event.
Record(e, d) ==
    /\ ledger[e] = "none"
    /\ ledger' = [ledger EXCEPT ![e] = "pending"]
    /\ question' = [question EXCEPT ![e] = d]

Start ==
    /\ session = "idle" /\ session' = "working"
    /\ UNCHANGED <<dialog, asked, eventVars, card, misdirected, draftVars>>

Finish ==
    /\ session = "working" /\ session' = "idle"
    /\ \E e \in Events : Record(e, 0)
    /\ UNCHANGED <<dialog, asked, miso, inflight, landed, received, card, misdirected, draftVars>>

Ask(d) ==
    /\ session = "working" /\ d \notin asked
    /\ session' = "waiting" /\ dialog' = d /\ asked' = asked \cup {d}
    /\ \E e \in Events : Record(e, d)
    /\ UNCHANGED <<miso, inflight, landed, received, card, misdirected, draftVars>>

\* The session withdraws its question, for example after Stop.
Withdraw ==
    /\ dialog # 0 /\ dialog' = 0 /\ session' = "working"
    /\ UNCHANGED <<asked, eventVars, card, misdirected, draftVars>>

\* The phone refreshes; until then it may still show an older question.
Refresh ==
    /\ card # dialog /\ card' = dialog
    /\ UNCHANGED <<session, dialog, asked, eventVars, misdirected, draftVars>>

\* service.answer checks the dialog id the phone sends.
Answer ==
    /\ card # 0 /\ dialog # 0
    /\ EnforceDialogMatch => card = dialog
    /\ misdirected' = (misdirected \/ card # dialog)
    /\ session' = "working" /\ dialog' = 0 /\ card' = 0
    /\ UNCHANGED <<asked, eventVars, draftVars>>

\* Assistant.wake marks the batch "sending" and saves it before dispatching.
WakeBegin ==
    /\ miso = "idle" /\ inflight = {}
    /\ LET batch == {e \in Events : ledger[e] = "pending"} IN
        /\ batch # {}
        /\ inflight' = batch
        /\ ledger' = [e \in Events |-> IF e \in batch /\ EnforceMarkBeforeDispatch THEN "sending" ELSE ledger[e]]
    /\ UNCHANGED <<session, dialog, asked, question, miso, landed, received, card, misdirected, draftVars>>

WakeLand ==
    /\ inflight # {} /\ ~landed
    /\ landed' = TRUE /\ miso' = "busy"
    /\ received' = [e \in Events |-> IF e \in inflight THEN received[e] + 1 ELSE received[e]]
    /\ UNCHANGED <<session, dialog, asked, ledger, question, inflight, card, misdirected, draftVars>>

WakeAck ==
    /\ inflight # {} /\ landed
    /\ ledger' = [e \in Events |-> IF e \in inflight THEN "sent" ELSE ledger[e]]
    /\ inflight' = {} /\ landed' = FALSE
    /\ UNCHANGED <<session, dialog, asked, question, miso, received, card, misdirected, draftVars>>

\* A failed dispatch may still have reached Miso.
WakeFail ==
    /\ inflight # {}
    /\ ledger' = [e \in Events |-> IF e \in inflight THEN "unknown" ELSE ledger[e]]
    /\ inflight' = {} /\ landed' = FALSE
    /\ UNCHANGED <<session, dialog, asked, question, miso, received, card, misdirected, draftVars>>

MisoSettle ==
    /\ miso = "busy" /\ inflight = {} /\ miso' = "idle"
    /\ UNCHANGED <<session, dialog, asked, ledger, question, inflight, landed, received, card, misdirected, draftVars>>

\* Miso creates or edits the draft. Editing voids an earlier approval.
Draft ==
    /\ draft \in {"none", "drafted", "approved"} /\ rev < 2
    /\ rev' = rev + 1
    /\ draft' = IF EnforceApprovedRevision \/ draft # "approved" THEN "drafted" ELSE "approved"
    /\ approved' = IF EnforceApprovedRevision THEN 0 ELSE approved
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, approvals, sending, sendLanded, deliveries, deliveredRevs, cancelled>>

\* The phone approves revision r, which may be stale.
Approve(r) ==
    /\ draft = "drafted" /\ r \in 1..rev
    /\ EnforceApprovedRevision => r = rev
    /\ draft' = "approved" /\ approved' = r /\ approvals' = approvals \cup {r}
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, rev, sending, sendLanded, deliveries, deliveredRevs, cancelled>>

Cancel ==
    /\ draft \in {"drafted", "approved"} /\ draft' = "cancelled" /\ cancelled' = TRUE
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, rev, approvals, approved, sending, sendLanded, deliveries, deliveredRevs>>

\* The send intent is saved before dispatch; the current text is what goes out.
SendBegin ==
    /\ sending = 0
    /\ \/ draft = "approved"
       \/ ~EnforceCancel /\ draft = "cancelled" /\ approved # 0
    /\ draft' = "delivering" /\ sending' = rev
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, rev, approvals, approved, sendLanded, deliveries, deliveredRevs, cancelled>>

SendLand ==
    /\ draft = "delivering" /\ ~sendLanded
    /\ sendLanded' = TRUE /\ deliveries' = deliveries + 1 /\ deliveredRevs' = deliveredRevs \cup {sending}
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, draft, rev, approvals, approved, sending, cancelled>>

SendAck ==
    /\ draft = "delivering" /\ sendLanded
    /\ draft' = "delivered" /\ sending' = 0 /\ sendLanded' = FALSE
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, rev, approvals, approved, deliveries, deliveredRevs, cancelled>>

SendFail ==
    /\ draft = "delivering"
    /\ draft' = "uncertain" /\ sending' = 0 /\ sendLanded' = FALSE
    /\ UNCHANGED <<session, dialog, asked, eventVars, card, misdirected, rev, approvals, approved, deliveries, deliveredRevs, cancelled>>

\* Host restart: anything mid-flight becomes uncertain and is never repeated automatically.
Restart ==
    /\ ledger' = [e \in Events |-> IF ledger[e] = "sending" THEN (IF EnforceNoResend THEN "unknown" ELSE "pending") ELSE ledger[e]]
    /\ inflight' = {} /\ landed' = FALSE /\ miso' = "idle"
    /\ draft' = IF draft = "delivering" THEN (IF EnforceNoResend THEN "uncertain" ELSE "approved") ELSE draft
    /\ sending' = 0 /\ sendLanded' = FALSE
    /\ UNCHANGED <<session, dialog, asked, question, received, card, misdirected, rev, approvals, approved, deliveries, deliveredRevs, cancelled>>

Next ==
    \/ Start \/ Finish \/ \E d \in Dialogs : Ask(d) \/ Withdraw \/ Refresh \/ Answer
    \/ WakeBegin \/ WakeLand \/ WakeAck \/ WakeFail \/ MisoSettle
    \/ Draft \/ \E r \in Revisions : Approve(r) \/ Cancel \/ SendBegin \/ SendLand \/ SendAck \/ SendFail
    \/ Restart

Spec == Init /\ [][Next]_vars

\* Bounds the mutants, whose resends would otherwise loop forever.
Bounded == (\A e \in Events : received[e] <= 2) /\ deliveries <= 2

TypeOK ==
    /\ session \in {"idle", "working", "waiting"} /\ dialog \in 0..2 /\ asked \subseteq Dialogs
    /\ ledger \in [Events -> Ledger] /\ question \in [Events -> 0..2]
    /\ miso \in {"idle", "busy"} /\ inflight \subseteq Events /\ landed \in BOOLEAN /\ received \in [Events -> 0..3]
    /\ card \in 0..2 /\ misdirected \in BOOLEAN
    /\ draft \in DraftStates /\ rev \in 0..2 /\ approvals \subseteq Revisions /\ approved \in 0..2
    /\ sending \in 0..2 /\ sendLanded \in BOOLEAN /\ deliveries \in 0..3 /\ deliveredRevs \subseteq Revisions /\ cancelled \in BOOLEAN

\* Miso only receives events that were saved and marked before the dispatch.
EventsDurableBeforeWake == \A e \in Events : received[e] > 0 => ledger[e] \in {"sending", "sent", "unknown"}
\* No event reaches Miso twice, across failures and restarts.
AtMostOnceEvent == \A e \in Events : received[e] <= 1
\* A waiting session always has its question recorded for Miso.
QuestionsSurface == session = "waiting" => \E e \in Events : question[e] = dialog /\ ledger[e] # "none"
\* An answer only reaches the question the phone showed.
AnswerHitsSeenQuestion == ~misdirected
\* Only text the phone approved is ever delivered.
NoUnapprovedSend == deliveredRevs \subseteq approvals
\* A draft is delivered at most once.
AtMostOnceDelivery == deliveries <= 1
\* A cancelled draft is never delivered.
CancelWins == cancelled => deliveries = 0
=============================================================================
