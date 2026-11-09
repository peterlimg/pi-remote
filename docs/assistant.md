# Miso, the session assistant

Tap the cat beside search on the session list. The first tap creates Miso, one host-owned Pi conversation in a private `assistant` folder under the Pi Remote directory. Later taps reopen it. Miso does not appear in the session list.

## What Miso does

The host watches every independent session: not workers, helper runs or Miso itself. It records an event when a session starts waiting on a question or finishes a turn. Events are saved in `assistant.json` (mode 0600), batched for 30 seconds, and delivered to Miso once it is idle. Miso then reads what it needs and tells you in a few lines.

Miso has one tool, `sessions`:

- `overview`: every session's title, project, status, open question with options, and last reply preview.
- `read`: one session's last eight messages, each clipped to 2,000 characters.
- `draft`: prepare a message of at most 4,000 characters for one independent session, or revise an unsent draft. It cannot approve or send it. Overview also includes the latest 20 draft summaries.

It cannot answer questions, message or stop sessions, read files or run commands. It runs with `--no-extensions --no-mcp --no-skills --no-context-files` and only the `sessions` tool active. The host explicitly loads its assistant extension and, when installed, `pi-usage` to honor the user's Codex Fast setting. Session text is treated as data. The sessions API accepts only Miso's own token and rejects browser origins.

The first empty conversation greets you with a live-session count. A host-generated check-in shows current questions below Miso's messages. These cards contain the original session's title, question and options, not model-generated actions. Tap the session title to inspect its context, or answer directly in Miso. Confirmation dialogs require an explicit Allow or Deny; text and editor dialogs keep your draft while Miso updates.

Answers use the same authenticated phone channel and command journal as the original session. The host accepts only the current dialog id and valid options. A question answered elsewhere disappears from Miso; stale clicks cannot answer its replacement. Miso's own token can inspect sessions and prepare drafts, but cannot answer or approve anything. Question cards never send a new prompt or resume a saved session.

Session-change notifications and session reads have short activity labels. Expand them to inspect the original details.

## Approved message drafts

Ask Miso to prepare an instruction for a session. A draft card shows the recipient and exact text. You can edit and save it, discard it, or tap Send. Saving is not approval. If another revision arrives while you type, the card preserves your unsaved text for copying. Any change increments the revision, and approval of an older revision is rejected. The recipient cannot change within a draft.

Send is available only for idle, unblocked, host-owned Pi processes. Busy, waiting, terminal-bridge and offline sessions are left alone. No automatic resume or delayed approval queue is used. If work races with dispatch, the RPC uses follow-up delivery, never steering.

The host saves the approved revision and `delivering` intent before dispatch, then uses the command journal with the draft's stable ID. Repeated taps and requests cannot resend it. The states are `drafted → delivering → delivered/uncertain`, or `drafted → cancelled`. Discard wins only before dispatch begins; it cannot recall a sent instruction. `delivered` means accepted input, not successful work. An interrupted or failed acknowledgement becomes `uncertain` and has no retry button.

A completed session reply is captured only after a single new user message matches the approved text. Other interleaved input, a missing final reply, or a host restart leaves an inspection note rather than guessing. Feedback is bounded to 4,000 characters and survives restart once captured. Inspect the source session for the full history. Reply matching is conservative transcript correlation, not proof of external side effects.

The ledger retains up to 200 drafts and receipts without reusing IDs, with at most 20 pending drafts. Archival is not implemented. Atomic file replacement protects process-restart ordering, not sudden power loss or storage corruption.

## Delivery and restart

| Ledger state | Meaning |
| --- | --- |
| `pending` | Saved, not yet sent to Miso. Survives restart. |
| `sending` | Marked and saved before dispatch. |
| `sent` | Miso accepted it. |
| `unknown` | Dispatch failed or the host stopped mid-send. Never resent. |

Events also fire for the conversation you have open, because the phone does not yet report leaving a conversation. Transitions that happen while the host is down are not recorded, except that a session still waiting on a question is recorded again after restart. Miso needs a native Pi model; a default model provided only by an extension will not start.

## Verification

```sh
npm run verify:assistant   # TLC: all invariants hold, and each host guard's removal breaks its invariant
npm run test:assistant     # phone browser, real host and Pi processes; only model replies are scripted
```

Set `PI_REMOTE_ASSISTANT_RECORD=1` when running `npm run test:assistant` to retain a phone-sized `miso-proof.webm` and `clips.json` chapter times alongside the trace. The recording uses the same real host and Pi processes, with deterministic model replies. Chapter holds are added only when recording. Recorded runs keep the viewport phone-sized; normal runs also capture desktop layout.

`verification/assistant/AssistantFlow.tla` models the event ledger, wakes, answers and restarts. Its draft-and-send flow checks `NoUnapprovedSend`, `AtMostOnceDelivery` and `CancelWins`. `Assistant.draftAction` combines the TLA+ `Approve` and `SendBegin` actions in one synchronous prefix before awaited dispatch; draft edits and approvals compare revisions, and restart fences `delivering` as `uncertain`. The E2E proves first-open state, live question cards and reload, select/confirmation/text/editor answers, retained drafts and focus, cross-client removal, stale-answer and invalid-option rejection, access control, one delivery per question and finished turn, a refused injected `bash` call, and restart behavior for interrupted and pending events. Screenshots cover phone light/dark and desktop layouts; a browser trace records the actions. Draft checks cover the real `sessions` tool, editing, stale approval, cancelled/busy targets, duplicate sends and returned feedback. `test/assistant-delivery-e2e.mjs` controls only the Pi RPC boundary to delay/fail acknowledgement, kills the real host mid-send, and checks restart without replay and interleaved-input feedback rejection. The bounded model does not prove feedback correlation, model judgment, arbitrary external effects, storage power-loss durability or a physical iPhone.
