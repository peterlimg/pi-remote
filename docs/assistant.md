# Miso, the session assistant

Tap the cat beside search on the session list. The first tap creates Miso, one host-owned Pi conversation in a private `assistant` folder under the Pi Remote directory. Later taps reopen it. Miso does not appear in the session list.

## What Miso does

The host watches every independent session: not workers, helper runs or Miso itself. It records an event when a session starts waiting on a question or finishes a turn. Events are saved in `assistant.json` (mode 0600), batched for 30 seconds, and delivered to Miso once it is idle. Miso then reads what it needs and tells you in a few lines.

Miso has one tool, `sessions`:

- `overview`: every session's title, project, status, open question with options, and last reply preview.
- `read`: one session's last eight messages, each clipped to 2,000 characters.

It cannot answer questions, message or stop sessions, read files or run commands. It runs with `--no-extensions --no-mcp --no-skills --no-context-files` and only the `sessions` tool active. Session text is treated as data. The sessions API accepts only Miso's own token and rejects browser origins.

You answer questions in the session itself. The host only accepts an answer for the dialog id the phone saw.

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
npm run test:assistant     # real host and Pi processes; only model replies are scripted
```

`verification/assistant/AssistantFlow.tla` models the event ledger, wakes, answers and restarts. It also models the planned draft-and-send flow (`NoUnapprovedSend`, `AtMostOnceDelivery`, `CancelWins`) ahead of its implementation. The E2E proves access control, one delivery per question and finished turn, stale-answer rejection, a refused injected `bash` call, and restart behavior for interrupted and pending events. Neither covers model judgment or a physical iPhone.
