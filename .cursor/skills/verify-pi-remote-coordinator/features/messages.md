# Reply, inspect reports, and stop one task

Worker questions and reports return to their owning coordinator. All user input stays in that main conversation. Opening a worker preserves the coordinator's draft and attachment, and stopping a task does not stop its sibling.

## Sub-features

- `question`: a persisted question names its task and owner.
- `reply`: the coordinator relays the main-session reply to the correct worker.
- `draft`: main drafts and attachments survive read-only worker inspection.
- `report`: a returned result remains distinct from an accepted result.
- `stop`: Stop affects only the addressed worker.

## How to get to it (user POV)

Read and answer the coordinator's question in the main conversation. The **Workers** tree opens read-only logs; **Session details → Background tasks** opens read-only assignments and reports. A worker's visible **Return to coordinator** control returns to its parent. Neither inspection view offers direct replies, Stop, or acceptance controls.

## Driving it with Playwright

Preconditions: First inspection needs an answer and Second inspection is working.

- Collapse Workers and send `Keep the original identifier.` in the main composer. Require the coordinator to acknowledge the addressed task, First inspection to return its report, and the tree to remain collapsed while states update.
- Open **Background tasks**, inspect **Returned result**, and require `ALPHA_VALUE=stable`. There must be no direct reply, acceptance, or Stop controls. Close and send `Review and accept the first result.` in the main composer. Require **Accepted** in a second view.
- Expand Workers. Keep an unsent coordinator draft and attach the fixture PNG. Open **First inspection, Accepted**. Require a read-only explanation, no visible composer, model controls, or permission input, and no apparent human bubbles for task instructions.
- In a second browser tab, open the coordinator and send `Stop Second inspection.`. Require its reply and the first tab's sibling tree to show **Stopped** while First inspection stays **Accepted**. The native provider audit must show that only the held worker request was aborted.
- Return to the coordinator and require its unsent draft and attachment unchanged. Browser command frames must target only the coordinator, never a worker.
- Inspect the matching command and report frames plus persisted task IDs. The full proof exercises these paths.

## Gotchas

Never treat a report as permission approval. The model must resolve the intended task from context or ask for clarification; the host never guesses a worker from the latest mention. Send and Stop in the main composer target the coordinator response. Scoped worker Stop must be requested in that conversation. A worker's last report may remain visible after follow-up work begins; its current task state determines whether that report is ready for acceptance.
