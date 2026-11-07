# Coordinator verification map

Read this index and the skill before driving the app. The primary interface is the phone browser. The scoped local coordination interface and host restart are secondary operator paths.

## Baseline preconditions

- Launch the isolated coordinator fixture at `http://127.0.0.1:8813`, or set `PI_REMOTE_COORDINATOR_TEST_PORT` consistently.
- Require Doctor to pass for your own fixture PID.
- Use a fresh iPhone 13 Chromium context and manual login with the public fixture token.
- Expect three pinned source sessions across two projects, including a terminal-owned session. No actual user project or paid model is involved.
- Only the provider is simulated. Pi processes, tool permission hooks, the host, persistence, and browser are real.
- Refuse an occupied port. Do not drive the production host with fixture credentials.

## Driving conventions

Use accessible names and existing DOM IDs. For repeated task actions, scope locators to the list item named for that task. The two fixture user messages `Investigate both fixture files.` and `Start an interrupted task.` select deterministic provider scenarios; arbitrary prompts do not prove the same behavior.

## Proof and skip reporting

Capture each action and its observable result, a second read of mutations, process identity across restart, file hashes, and native tool results. Keep artifacts after cleanup. A simulated provider is not a simulated host, but it still cannot prove planning quality with a paid model.

## Features

- [Assignment and conversation](assignment.md): in-place delegation from ordinary existing, fresh, and terminal-owned sessions, two independent tasks, and a responsive conversation.
- [Replies, reports, and Stop](messages.md): ownership, draft isolation, result acceptance, and scoped control.
- [Recovery and permissions](recovery.md): reload, native crash-point continuation, durable unread inputs, stale generations, bounded retries, Stop races, uncertainty, idempotence, and read-only authorization.
- [Coding and integration](coding.md): native edits/checks in separate worktrees, complete diff review, conflict protection, index preservation, and restart recovery.
