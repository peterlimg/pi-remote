# Reply, inspect reports, and stop one task

Worker questions and reports return to their owning coordinator. All user input stays in that main conversation. Opening a worker preserves the coordinator's draft and attachment, and stopping a task does not stop its sibling.

## Sub-features

- `question`: a persisted question names its task and owner.
- `reply`: the coordinator relays the main-session reply to the correct worker.
- `draft`: main drafts and attachments survive read-only worker inspection.
- `report`: a returned result remains distinct from an accepted result.
- `stop`: Stop affects only the addressed worker.

## How to get to it (user POV)

Read and answer the coordinator's question in the main conversation. The compact **Workers** row opens the roster in a bottom sheet. A worker row opens its read-only log; **Task details** contains assignments and reports. The **Back to workers** arrow returns to the roster and **Close workers** dismisses without selecting another session. The header stays within 74px, and there is no footer; the dialog retains an accessible read-only description. **Session details → Background tasks** opens the same sheet. It has no replies, Stop, acceptance, model, or permission controls.

## Driving it with Playwright

Preconditions: First inspection needs an answer and Second inspection is working.

- Inspect First inspection, then send `Keep the original identifier.` from a second main-conversation tab. Require both the first tab's main transcript and worker stream to update on the same connection. The sheet header becomes **Result ready** and the worker log receives the scoped instruction.
- Inspect **Task details → Returned result** and require `ALPHA_VALUE=stable`. There must be no direct reply, acceptance, or Stop controls. Close and send `Review and accept the first result.` in the main composer. Require **Accepted** in a second view.
- Keep an unsent coordinator draft, attach the fixture PNG, and scroll the main transcript up. Open **Workers → First inspection, Accepted**. Require no inputs inside the sheet, no apparent human bubbles for task instructions, and explicit failed labels for blocked tools. The selected parent and unchanged composer remain behind the modal.
- In a second browser tab, open the coordinator and send `Stop Second inspection.`. Require its reply in both main transcripts. Return the first sheet to its roster and require **Stopped** while First inspection stays **Accepted**. The native provider audit must show that only the held worker request was aborted.
- Dismiss and require the unsent draft, attachment, and main reading position unchanged. Browser command frames must target only the coordinator, never a worker.
- Repeat delegation in the terminal-owned session. Phone submissions must remain **You** messages, while the internal worker wake-up appears as **Prompted by an extension**. Require a returned worker question in that same main conversation.
- Inspect the matching command and report frames plus persisted task IDs. The full proof exercises these paths.

## Gotchas

Never treat a report as permission approval. The model must resolve the intended task from context or ask for clarification; the host never guesses a worker from the latest mention. Send and Stop in the main composer target the coordinator response. Scoped worker Stop must be requested in that conversation. A worker's last report may remain visible after follow-up work begins; its current task state determines whether that report is ready for acceptance.
