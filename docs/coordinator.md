# Workers in ordinary sessions

Every Pi Remote session can coordinate background investigations and coding assignments. Ask for workers in your current conversation. There is no setup button, coordinator mode, or replacement conversation. The session keeps its history, model, instructions, extensions, and usual tools.

## Use workers

Requires Pi 1.4 or newer. Workers need a native Pi model because their restricted processes exclude custom provider extensions. They inherit the parent's native model by default. A parent using an extension-only provider can specify an available native worker model without changing its own model; the assistant must ask before choosing a different model unless you already authorized it.

1. Ask your current session to delegate independent investigations or development tasks. It can assign up to two active tasks and continue answering while they run. Ordinary messages do not create workers or coordinator records.
2. The compact **Workers** row immediately above the composer opens a translucent bottom sheet with the worker roster. It appears only after workers exist. Different conversations in the same project own separate workers.
3. Give every reply and command in this main conversation. The assistant presents decisions, relays answers to the intended task, reviews reports, and summarizes findings. It must clarify ambiguous references.
4. Tap a worker to inspect its live, read-only log without leaving the main conversation. **Task details** contains its assignment, question, and report. Use the header's Back arrow to return to the roster, or Close, Escape, or a downward pull to dismiss. Short pulls snap back; scrolling an already-scrolled log does not dismiss it. **Session details → Background tasks** opens the same sheet. Returned and accepted results remain distinct.

This works for host-managed sessions and sessions connected through the terminal bridge. Only independent conversations appear in the default global session list. Workers remain children, including when working or pinned. Explicit search and the worker sheet still reach their transcripts.

The sheet keeps the selected parent, composer, draft, attachments, and main reading position intact. Its separate read-only subscription watches one owned worker alongside the parent on the existing authenticated connection. Closing it or selecting another conversation clears that subscription. It reconnects after a host restart; recovery can add a continuation note without duplicating recorded instruction bodies. Explicitly opening a worker from session search still hides all input controls and offers a return to its parent.

Stopping the main response does not stop workers. Ask the assistant to stop a specific task.

## Coding assignments

For authorized development work, the assistant assigns `kind: code`. Requires a Git repository with a committed HEAD and Git 2.31 or newer. The host creates a detached Git worktree for each task. Coding workers have `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, and `task_report`. The parent conversation stays usable while they edit and run focused checks. Their workspace and integration state appear in Task details.

Worktrees start from the committed HEAD. Uncommitted parent changes are not copied. Assignments must carry relevant project constraints and must not assume local edits are present. Workspaces remain on disk after Stop, completion, or a host restart. They are not automatically deleted.

After a coding result returns, the assistant uses `inspect` to obtain its complete diff and immutable review revision. That snapshot includes tracked changes and nonignored new files, including worker commits, without modifying either real Git index. The diff is limited to 50,000 characters and the summary to 8,000; a truncated result needs complete review with the parent's ordinary tools before integration.

`integrate` requires that exact inspected revision and rejects changes made since review. Git checks the patch against the original repository before applying it. Conflicts preserve the parent working files and index, keep the task available for revision or manual resolution in the main conversation, and never invoke an automatic merge. A reviewed patch already present in the parent is verified with a reverse check and is not applied twice. Successful integration marks the task complete, without a commit or push. The parent reviews and validates the combined result before publishing. Use a new assignment for changes after integration. `accept` remains for investigation results.

Integration intent is persisted before applying a patch. An interrupted or uncertain apply is never automatically repeated. After inspection, `recover` with the reviewed revision only checks whether the complete patch is present or still applicable. It marks an already-present patch Integrated, or returns an unapplied patch to Result ready; partial/conflicting changes remain blocked. Existing request IDs still use the command journal. Preparation failures also preserve their task/workspace record rather than silently retrying.

## Worker permissions

Investigation assignments remain read-only and are the default when no kind is specified. They have only `read`, `grep`, `find`, `ls`, and `task_report`. Paths must resolve inside their project and outside private host data. Escaping symlinks are rejected. Coding file tools are confined to their worktree and reject escaping or dangling symlink writes. Delegating does not remove shell or editing tools from the parent conversation.

Coding shell commands run with the user's trusted-host privileges. Worktrees prevent accidental file collisions, not hostile commands or access to other host files. They are **not an OS sandbox**. Private Pi Remote environment variables are removed from shell commands, but this is not filesystem or network isolation. Delegate only trusted, explicitly authorized coding work. Workers must not access private host data, change other worktrees or Git configuration, push, spawn more agents, install software, or approve permission dialogs.

Restricted workers explicitly load the coordination extension and exclude other extensions, MCP servers, skills, prompt templates, and project instructions. Assignments must carry relevant constraints. These are model-tool restrictions in trusted host processes, not an operating-system sandbox. Ordinary Pi terminal resumes of worker files do not retain them. Legacy restricted coordinator files retain their previous permissions; new delegations never create one.

Worker `task_report` calls persist a question or result and end the turn. Idle alone does not mark completion. The host rejects direct client prompts, steering, follow-ups, aborts, model changes, compaction, and dialog responses to workers. Only trusted task-addressed operations can deliver instructions and Stop.

## Ownership and recovery

`coordinator-tasks.json` in the private Pi Remote directory stores membership, worker paths, scoped capabilities, states, and notifications. The first assignment records the existing parent session, without creating another conversation. Normal-session tool requests authenticate against that process's current session ownership lock. Their capabilities expire when ownership changes. Workers can report only their own task; parents can address only their own workers. No capabilities enter browser task state.

Assignments and commands use the existing command journal. A retry with the same request ID does not repeat work. Notification intent is saved before delivery. Questions and reports wake an idle parent, including a terminal-owned parent, without becoming apparent human input.

New tasks have a durable input mailbox and execution generations. A follow-up is saved immediately but waits for the current worker turn to finish; it is not injected into a running turn. Worker context receipts mark its exact input IDs read. Reports settle only that generation's inputs, and late attempts cannot publish results or begin another tool call. Recorded input bodies are not sent again; a recovery note refers to the retained history. Queued and recovering tasks count toward the two-task limit.\n\nAfter a failed turn or host restart, the host waits for the old RPC turn to settle, checks a complete saved transcript for matching project/workspace and tool results, and inspects coding worktree identity, HEAD and status. A clean boundary can continue the same session/worktree with at most two automatic attempts. A missing tool result, failed mutating tool, inconsistent history, incomplete workspace preparation, busy worker, or exhausted budget becomes **Needs inspection**, with one recovery question to the main conversation. It never fabricates a tool result or automatically retries an uncertain apply. Completed tool results inform the model; this is not an exactly-once guarantee for arbitrary shell/external effects.\n\nTask Stop cancels queued inputs, fences the old generation and any in-flight recovery check, and prevents automatic continuation. A message cannot overtake an unfinished Stop. A later explicit task instruction is new authorization, not permission to replay cancelled inputs. After resolving a blocked task, `recover` rechecks its safety rather than bypassing it. Pre-mailbox legacy tasks remain inspection-first on restart.\n\nA sent notification means Pi accepted input, not that the human read a summary. Interrupted notification delivery remains unknown; the inspector retains the report. Recovery covers workers, not arbitrary interrupted main-conversation turns, sleeping computers, orphaned shell processes, or power-loss durability.

Investigation workers and unintegrated coding tasks remain open Pi sessions for follow-ups. Integrated coding tasks are finished. There is no idle process eviction, automatic merge, recursive delegation, cross-project routing, or cloud execution. Work stops while the computer sleeps.

## Verification

Run `/skill:verify-pi-remote-coordinator` or `npm run test:coordinator`. The isolated proof drives ordinary existing and new sessions, the real terminal bridge, Pi processes, tools, files, browser, and recovery. Only model responses are deterministic. The proof includes native edits and shell checks in two code worktrees, reviewed integration, stale-review/conflict rejection, parent draft/index preservation, scoped Stop, and code-workspace restart recovery. It does not establish paid-model judgment, OS sandboxing, or physical iPhone behavior.

`npm run test:coordinator-recovery` adds native provider-failure, mid-tool kill, unread-input restart, stale-generation, retry-budget, Stop/check races, capacity and lost-integration-receipt cases, with phone screenshots.\n\n`npm run verify:coordinator` separately checks bounded command/report/acceptance/Stop ordering and recovery safety, then replays the corresponding boundaries against the real host. Its scope excludes code integration, which the native E2E proof covers.
