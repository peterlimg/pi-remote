# Reply, inspect reports, and stop one task

Worker questions and reports return to their owning coordinator. Opening a worker preserves the coordinator's draft, and stopping a task does not stop its sibling.

## Sub-features

- `question`: a persisted question names its task and owner.
- `reply`: reply through that worker's normal composer.
- `draft`: coordinator and worker drafts stay separate.
- `report`: a returned result remains distinct from an accepted result.
- `stop`: Stop affects only the addressed worker.

## How to get to it (user POV)

Tap a named worker in the coordinator chat's compact worker row to open it directly. **Tasks** at the end of the row opens details with **Reply in worker** for a question and **Open worker** for inspection, **Accept result** for a returned report, or **Stop task** for active work. A worker's visible **Return to coordinator** control returns to its parent.

## Driving it with Playwright

Preconditions: First inspection needs an answer and Second inspection is working.

- Fill the coordinator's `#prompt` with `Keep my coordinator draft.` without sending it.
- In `page.getByRole('region', { name: 'Workers', exact: true })`, click the button **First inspection, Needs answer** directly, without Session details or the task sheet. Require the title **First inspection**, an empty prompt, and the visible **Return to coordinator** control.
- Send `Keep the original identifier.`. Return to the coordinator and require the unsent coordinator draft to remain unchanged.
- Reopen **Background tasks**, inspect **Returned result**, and require `ALPHA_VALUE=stable`. Click **Accept result** and require **Accepted** in a second view.
- In Second inspection's list item, click **Stop task**. Require **Stopped** there while First inspection stays **Accepted**. The native provider audit must show that only the held worker request was aborted.
- Inspect the matching command and report frames plus persisted task IDs. The full proof exercises these paths.

## Gotchas

Never treat a report as permission approval. Plain messages to the coordinator do not automatically route to whichever worker was most recently mentioned. Send and Stop in the normal composer still target the selected session. A worker's last report may remain visible after follow-up work begins; its current task state determines whether that report is ready for acceptance.
