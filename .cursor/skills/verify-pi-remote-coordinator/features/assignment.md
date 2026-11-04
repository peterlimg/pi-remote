# Assign background investigations

A user asks their ordinary conversation for workers. That same session coordinates them without changing its history, model, instructions, or usual tools.

## Sub-features

- `implicit`: delegate directly from an existing, fresh, or terminal-owned session without coordinator setup.
- `identity`: preserve the parent file, history, title, model, and ordinary tools.
- `ownership`: two conversations in the same project keep separate workers.
- `parallel`: dispatch two independent Pi workers.
- `responsive`: receive another coordinator answer while a worker remains active.
- `hierarchy`: workers are children, absent from default global sections and visible directly in coordinator chat.
- `limit`: at most two tasks are active for a coordinator.

## How to get to it (user POV)

Open an ordinary project session and ask for workers through the normal composer. No coordinator setup or separate conversation exists. The collapsible, unboxed **Workers** tree immediately above the composer shows a main-conversation parent row and indented workers with their current states. Tap a worker for its read-only log. Use **Session details → Background tasks** for assignments, questions, and reports.

## Driving it with Playwright

Preconditions: baseline fixture, passing Doctor, manual login, no existing coordinator tasks.

- Open the source with `page.getByRole('button', { name: /Coordinator verification project/ }).click()`.
- Require the source title and existing note, no setup button, and no Workers tree. Send `Read alpha before delegating.`. Require an ordinary read and no coordinator record.
- After delegation require the same parent ID and file, an unchanged history prefix, and no new coordinator file. Every parent agent turn must still declare read, bash, edit, and write alongside remote_tasks. Classify intentionally tool-free title-generation requests separately. Workers must expose only their restricted tools.
- Fill `#prompt` with `Investigate both fixture files.` and click **Send message**.
- Open **Background tasks**. Require list items **First inspection** and **Second inspection**, backed by distinct Pi session files and PIDs. The first reaches **Needs answer**; the second remains **Working**.
- Close with **Done**. Require a visible **Workers** region containing buttons **First inspection, Needs answer** and **Second inspection, Working** without opening Session details. Check normal, narrow, short, and desktop viewports with readable names, 44-pixel touch targets, and room left for the transcript and composer. Require a tree bounded to `min(36dvh, 280px)` and transparent, square-cornered worker rows with no card shadows. Collapse it to one row at most 48px tall, require status counts to remain visible, then reopen with Space. The selected main conversation has `aria-current=page`, and a 1px connector groups the children. Require the order conversation → workers → composer, with at most 12 pixels between workers and composer. In the short viewport, scroll up and check that **Go to thread bottom** clears the workers and still returns to the latest messages.
- Return to the global list and require neither worker there. At the real list interface, check unsectioned, overview, Now, and Pinned lists, including a deliberately pinned worker. The coordinator must remain visible, and explicit name search must still find the worker. Repeat after reload and host restart.
- Send `Which tasks are still open?`, and require the reply to describe Second inspection as working without stopping it.
- A third assignment while both tasks are active must return a bounded error without another worker. The full proof exercises this at the production scoped coordination interface and checks that the task count stays two. It also fills both slots again and verifies that a coordinator follow-up cannot reactivate an accepted worker as a third active task. Direct human worker input is refused independently of task capacity.

## Gotchas

Saved sessions resume through the existing ordinary-session workflow. The fixture starts the first source normally before the phone connects; it never creates a restricted coordinator. The full proof also delegates through a fresh session and the terminal bridge, and checks same-project ownership isolation. A worker returning idle is not a completed task. A task record and a Pi process must both exist before claiming dispatch worked. Do not use the visual prototype route.
