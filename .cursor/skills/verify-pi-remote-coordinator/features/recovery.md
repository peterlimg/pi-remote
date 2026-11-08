# Recover bounded work and enforce scoped permissions

Reload preserves task ownership and reports. New tasks can resume authorized unfinished work from a complete saved boundary; uncertain side effects remain blocked. All decisions stay in the main conversation.

## Native crash-point proof

```sh
PI_REMOTE_RECOVERY_TEST_PORT=8815 npm run test:coordinator-recovery
```

Use `PI_REMOTE_TEST_CHANNEL=chrome` for installed Chrome. This refuses an occupied port, launches an isolated host with real Pi processes and native tools, drives the phone inspector, and prints a retained `pi-task-recovery-proof-*` evidence directory. Task assignment/control uses the production scoped HTTP interface; it never modifies task records or browser state. Model responses and external failure points are deterministic.

Require these observable results:

1. **Recovery counter** performs a real successful shell append, then its provider fails. The same task/session/worktree resumes, reads the saved counter, writes a remaining file and reports. Counter has exactly one line; two transport messages contain only one original input body. Capture **same-task-recovered**.
2. Review its complete patch. The fixture Git shim executes real `git apply`, then deliberately loses its success receipt. Require integration unknown. Explicit `recover` with that revision verifies the already-present patch without a second apply. Parent index and local draft remain unchanged.
3. **Recovery inbox** receives a follow-up while its current turn is held. Restart only the owned fixture host. The follow-up body must appear once, the original body must not repeat, and the replacement generation must reject a stale report and mismatched input receipt. Release the provider gate and require a returned result. Capture **queued-input-recovered**.
4. **Recovery budget** always fails. Require exactly two automatic continuations and one persisted recovery escalation, not an endless loop.
5. Corrupt only a fixture session's recorded input text after its read receipt. Require an inconsistent-history block, not redelivery. Stop one task while recovery is pending and another while real Git workspace inspection is held. Release the inspection and require Stopped with no new input transport message or model turn.
6. **Uncertain tool** starts a real long-running shell command which writes a marker. Kill only its audited Pi PID while its tool result is absent. Require Needs inspection and one recovery question, one marker and no replacement turn. Capture **uncertain-tool-blocked**. The fixture separately kills its known shell child during cleanup; Stop is not an OS process-tree sandbox.
7. With two other active tasks, `recover` must reject reactivation without changing the blocked task.

Inspect result.json, tasks.json, provider-audit.json, screenshots/ARIA, host logs and cleanup.json. Neither deterministic responses nor saved tool receipts prove paid-model judgment or exactly-once arbitrary external effects. A background shell child may outlive its Pi process. Missing receipts must never be filled in to force continuation.

## Existing workflow and permission regression

Run `npm run test:coordinator` through result acceptance and scoped Stop.

- Reload, reopen **Coordinator verification project → Workers**, and require accepted/stopped states.
- Send `Start an interrupted task.`. Keep its log open, SIGTERM only the owned host, and restart `test/coordinator-server.mjs` with the same `PI_COORDINATOR_FIXTURE_ROOT`. Require a new PID, passing Doctor and an automatically reconnected sheet showing Working after safe continuation. Parent selection and original input-body counts remain unchanged. Only interrupted workers may invoke the model with recovery notes.
- Replay original assignment/report request IDs, including the report's original execution generation. Task/event counts and accepted outcome stay unchanged. Fresh stopped-worker reports fail.
- Another same-project parent cannot inspect/control these tasks. Mismatched session capabilities and expired pre-restart capabilities fail, as do worker coordinator actions and cross-origin requests.
- Direct client worker prompt/steer/follow-up/abort/model/reasoning/compaction/dialog-answer commands return **Worker logs are read-only. Send instructions to the coordinator.** No dispatch or task-state change is permitted. Repeat after restart and at capacity.
- Worker inspection/history is limited to a child of the selected parent. Reject parent/non-worker IDs and another owner's child. Same-parent resync retains inspection; selecting another conversation clears it.
- Investigation tools deny outside/symlink reads and provide no write/bash. Require unchanged project hashes/entries, one private `coordinator-tasks/<main-session-id>.json` per main conversation with mode 0600 inside a mode-0700 directory, and no capabilities in browser frames. Coding shell restrictions are guidance on a trusted host, not an OS sandbox.

## Session-owned task storage

Run `npx playwright test test/browser/session-task-storage.spec.mjs`. It uses a real isolated host and the scoped task HTTP API, with seeded legacy sessions and no model calls. Require matching partial migration to finish, questions/reports/mailboxes and capabilities to survive, updates to touch only their owning main's file, cross-main inspection to fail, and reload to preserve both sessions. The original shared file must remain only as an unchanged `.migrated` backup. A conflicting partial migration must fail closed without replacing either copy.

## Cleanup and limits

Never kill by process name, edit the task ledger, reuse another fixture root or retry uncertain actions with fresh request IDs. Use only this run's recorded PIDs and marker-owned paths. Both proofs retain evidence and remove their owned scratch data after checking Pi exits. Uncertain main-conversation turns and notification delivery are not automatically replayed by worker recovery.
