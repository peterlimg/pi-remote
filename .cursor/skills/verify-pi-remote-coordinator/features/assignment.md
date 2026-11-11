# Assign background investigations

A user asks their ordinary conversation for workers. That same session coordinates them without changing its history, model, instructions, or usual tools.

## Sub-features

- `implicit`: delegate directly from an existing, fresh, or terminal-owned session without coordinator setup.
- `identity`: preserve the parent file, history, title, model, and ordinary tools.
- `ownership`: two conversations in the same project keep separate workers.
- `parallel`: dispatch two independent Pi workers.
- `responsive`: receive another coordinator answer while a worker remains active.
- `hierarchy`: workers are children, absent from default global sections and visible directly in coordinator chat.
- `parent-activity`: the parent appears Working in Now while an owned worker is starting/working/stopping, without changing its actual agent status or composer. `test/browser/session-worker-activity.spec.mjs` covers overview, active collection, unwatched updates, icons, priority, exclusions and live removal through real host task/report boundaries with replayed Pi endpoints.
- `limit`: at most two tasks are active for a coordinator.
- `sdk`: `npm run test:coordinator-sdk` verifies SDK source admission, real Pi/MCP permission checks, report → tool-free checkpoint → follow-up → host restart, coding worktrees/integration and scoped Stop. Default mode replaces only the external SDK peer; `PI_COORDINATOR_SDK_LIVE=1` makes paid model calls. Requires the experiment's pinned SDK dependencies and a loaded `pi-claude-sdk` 0.1.1+ package. It does not verify pi-subagents' borrowed foreground route.

## How to get to it (user POV)

Open an ordinary project session and ask for workers through the normal composer. No coordinator setup or separate conversation exists. The compact **Workers** row immediately above the composer opens a translucent bottom sheet with an unboxed roster and current states. Tap a worker for its read-only log and **Task details**. The selected parent remains active behind the sheet. **Session details → Background tasks** opens the same roster.

## Driving it with Playwright

Preconditions: baseline fixture, passing Doctor, manual login, no existing coordinator tasks.

- Open the source with `page.getByRole('button', { name: /Coordinator verification project/ }).click()`.
- Require the source title and existing note, no setup button, and no Workers row. Send `Read alpha before delegating.`. Require an ordinary read and no coordinator record.
- Before delegation, send a quick single-file request and then **No workers. Read alpha.txt and summarize it here.** Require both to finish inline with no coordinator membership. Then send **Investigate both fixture files.**, which does not explicitly ask for workers. The scripted provider reads the packaged `coordinate-work` skill through the real read tool before assigning. Audit actual Pi requests for the advertised skill, automatic-delegation policy and no-workers override; restricted workers must not inherit delegation skills. This proves package/prompt delivery and the scripted workflow, not a paid model's choice or obedience.
- After delegation require the same parent ID and file, an unchanged history prefix, and no new coordinator file. Every parent agent turn must still declare read, bash, edit, and write alongside remote_tasks. Classify intentionally tool-free title-generation requests separately. Workers must expose only their restricted tools.
- Fill `#prompt` with `Investigate both fixture files.` and click **Send message**.
- Open **Background tasks**. Require list items **First inspection** and **Second inspection**, backed by distinct Pi session files and PIDs. The first reaches **Needs answer**; the second remains **Working**.
- Close with **Close workers**. Require the compact **Workers** region to stay at most 48px tall and keep status counts visible. Open it with Space and require a native modal sheet with buttons **First inspection, Needs answer** and **Second inspection, Working**. Check normal, narrow, short, and desktop viewports with readable names, 44-pixel targets, and transparent, square-cornered rows without card shadows. The sheet is at most `min(72dvh, 640px)` high, with a 74% background tint, 10px blur, and opaque foreground. Escape closes it. Require the main order conversation → workers → composer, with at most 12 pixels between row and composer. In the short viewport, **Go to thread bottom** must clear the compact row and still reach latest messages. Native pull-down gestures must follow the finger, snap back on short/cancelled pulls, and dismiss deliberately without intercepting scrolling in a non-top worker log.
- Return to the global list and require neither worker there. At the real list interface, check unsectioned, overview, Now, and Pinned lists, including a deliberately pinned worker. The coordinator must remain visible, and explicit name search must still find the worker. Repeat after reload and host restart.
- Send `Which tasks are still open?`, and require the reply to describe Second inspection as working without stopping it.
- A third assignment while both tasks are active must return a bounded error without another worker. The full proof exercises this at the production scoped coordination interface and checks that the task count stays two. It also fills both slots again and verifies that a coordinator follow-up cannot reactivate an accepted worker as a third active task. Direct human worker input is refused independently of task capacity.

## Gotchas

Saved sessions resume through the existing ordinary-session workflow. The fixture starts the first source normally before the phone connects; it never creates a restricted coordinator. The full proof also delegates through a fresh session and the terminal bridge, and checks same-project ownership isolation. A worker returning idle is not a completed task. A task record and a Pi process must both exist before claiming dispatch worked. Do not use the visual prototype route.
