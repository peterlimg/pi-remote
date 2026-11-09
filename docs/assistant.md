# Miso, the session assistant

Tap the cat beside search on the session list. The first tap creates Miso, one host-owned Pi conversation in a private `assistant` folder under the Pi Remote directory. Later taps reopen it. Miso does not appear in the session list.

## What Miso does

The host watches every independent session: not workers, helper runs or Miso itself. It records an event when a session starts waiting on a question or finishes a turn. Events are saved in `assistant.json` (mode 0600), batched for 30 seconds, and delivered to Miso once it is idle. Miso then reads what it needs and tells you in a few lines.

Miso has one tool, `sessions`:

- `overview`: every session's title, project, status, open question with options, and last reply preview.
- `read`: one session's last eight messages, each clipped to 2,000 characters.

It cannot answer questions, message or stop sessions, read files or run commands. It runs with `--no-extensions --no-mcp --no-skills --no-context-files` and only the `sessions` tool active. The host explicitly loads its assistant extension and, when installed, `pi-usage` to honor the user's Codex Fast setting. Session text is treated as data. The sessions API accepts only Miso's own token and rejects browser origins.

The first empty conversation greets you with a live-session count. A host-generated check-in shows current questions below Miso's messages. These cards contain the original session's title, question and options, not model-generated actions. Tap the session title to inspect its context, or answer directly in Miso. Confirmation dialogs require an explicit Allow or Deny; text and editor dialogs keep your draft while Miso updates.

Answers use the same authenticated phone channel and command journal as the original session. The host accepts only the current dialog id and valid options. A question answered elsewhere disappears from Miso; stale clicks cannot answer its replacement. Miso's own token remains read-only. No card sends a new prompt or resumes a saved session.

Session-change notifications and session reads have short activity labels. Expand them to inspect the original details.

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

`verification/assistant/AssistantFlow.tla` models the event ledger, wakes, answers and restarts. It also models the planned draft-and-send flow (`NoUnapprovedSend`, `AtMostOnceDelivery`, `CancelWins`) ahead of its implementation. The E2E proves first-open state, live question cards and reload, select/confirmation/text/editor answers, retained drafts and focus, cross-client removal, stale-answer and invalid-option rejection, access control, one delivery per question and finished turn, a refused injected `bash` call, and restart behavior for interrupted and pending events. Screenshots cover phone light/dark and desktop layouts; a browser trace records the actions. Neither covers model judgment or a physical iPhone.
