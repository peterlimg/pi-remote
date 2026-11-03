# Assign background investigations

A user starts a read-only coordinator for the current project and gives it work while keeping the main conversation available.

## Sub-features

- `create`: opt in from an existing project session.
- `parallel`: dispatch two independent Pi workers.
- `responsive`: receive another coordinator answer while a worker remains active.
- `limit`: at most two tasks are active for a coordinator.

## How to get to it (user POV)

Open a project session, then **Session details → Start read-only coordinator**. Send an investigation through the normal composer. **Background tasks** below the header opens assignments and current task states.

## Driving it with Playwright

Preconditions: baseline fixture, passing Doctor, manual login, no existing coordinator tasks.

- Open the source with `page.getByRole('button', { name: /Coordinator verification project/ }).click()`.
- Open `page.getByLabel('Session details', { exact: true })`, then click **Start read-only coordinator**. Require `#title` to read **Coordinator · project** and the **Read-only coordinator** introduction.
- Fill `#prompt` with `Investigate both fixture files.` and click **Send message**.
- Open **Background tasks**. Require list items **First inspection** and **Second inspection**, backed by distinct Pi session files and PIDs. The first reaches **Needs answer**; the second remains **Working**.
- Close with **Done**, send `Which tasks are still open?`, and require the reply to describe Second inspection as working without stopping it.
- A third assignment while both tasks are active must return a bounded error without another worker. The full proof exercises this at the production scoped coordination interface and checks that the task count stays two. It also fills both slots again and verifies that neither a coordinator follow-up nor a direct human reply can reactivate an accepted worker as a third active task.

## Gotchas

The source sessions are saved and pinned, so starting a coordinator must not require resuming the source first. A worker returning idle is not a completed task. A task record and a Pi process must both exist before claiming dispatch worked. Do not use the visual prototype route.
