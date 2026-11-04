# Recover ownership and enforce scoped permissions

Reloading or restarting preserves task ownership and reports. Interrupted work becomes uncertain instead of being repeated. Read-only workers cannot edit the project or control other tasks.

## Sub-features

- `reload`: task ownership, questions, and reports survive browser reload.
- `restart`: a new host process restores records and native sessions.
- `unknown`: interrupted work requires inspection and explicit continuation.
- `idempotence`: the same assignment or report request ID does not duplicate work.
- `scope`: coordinator and worker capabilities cannot address unrelated tasks.
- `input-boundary`: direct client worker commands and dialog answers fail without dispatch or task-state changes.
- `readonly`: project-only reads and no write or shell tools.

## How to get to it (user POV)

Reload the browser and reopen the coordinator. For restart, stop only the verification host you launched and start the same fixture root again. Inspect **Background tasks** after reconnecting. An uncertain task displays **Needs inspection**.

## Driving it with Playwright

Preconditions: passing coordinator proof through result acceptance and scoped Stop.

- Reload using `page.reload()`, reopen **Coordinator verification project**, then **Background tasks**. Require First inspection's accepted report and Second inspection's stopped state.
- Send `Start an interrupted task.`. Require **Interrupted inspection** to be working and the coordinator to have finished its response.
- Stop the owned fixture server with SIGTERM, wait for exit, and launch `test/coordinator-server.mjs` with the same `PI_COORDINATOR_FIXTURE_ROOT`. Require a new server PID and passing Doctor.
- Reload and reopen tasks. Require **Needs inspection** for interrupted work. Compare persisted user-prompt counts, coordinator event markers, and native provider request counts before and after restart. None may increase just because recovery ran.
- At the production scoped HTTP interface, replay the original assignment and report with their original request IDs. Require the same task count, event count, and accepted result. A fresh late report from the stopped worker must fail.
- Create a fresh ordinary session in the same project and delegate from it. Its capability cannot inspect the first session's task. A normal-session capability paired with another session ID must fail, as must a previous process's capability after restart. Worker attempts at coordinator actions and cross-origin requests must also fail.
- Through the real client socket, send prompt, steering, follow-up, abort, model, reasoning, compaction, and dialog-answer attempts directly to a worker. Require the exact safe read-only error, unchanged task state, and no new worker prompt. Test again after restart and at capacity. The actual serialized response, not just a status flag, is the proof.
- Check real Pi tool results for denied outside and symlink reads and unavailable write/bash. Verify original project hashes, unchanged directory entries, private state mode 0600, and absence of capability tokens in browser frames. The full proof performs these checks.

## Gotchas

Restarting the fixture must not select a new scratch root. Never edit the task database to manufacture an unknown state. Do not repeat uncertain actions with new request IDs. A sent notification means Pi accepted input, not that a human read it. Completed workers remain ordinary open Pi sessions in this first version; the fixture cleanup must stop all PIDs it created.
