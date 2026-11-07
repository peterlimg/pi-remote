# Workers in ordinary sessions

Every Pi Remote session can coordinate background investigations. Ask for workers in your current conversation. There is no setup button, coordinator mode, or replacement conversation. The session keeps its history, model, instructions, extensions, and usual tools.

## Use workers

Requires Pi 1.4 or newer. Workers need a native Pi model because their restricted processes exclude custom provider extensions. They inherit the parent's native model by default. A parent using an extension-only provider can specify an available native worker model without changing its own model; the assistant must ask before choosing a different model unless you already authorized it.

1. Ask your current session to delegate independent investigations. It can assign up to two active tasks and continue answering while they run. Ordinary messages do not create workers or coordinator records.
2. The compact **Workers** row immediately above the composer opens a translucent bottom sheet with the worker roster. It appears only after workers exist. Different conversations in the same project own separate workers.
3. Give every reply and command in this main conversation. The assistant presents decisions, relays answers to the intended task, reviews reports, and summarizes findings. It must clarify ambiguous references.
4. Tap a worker to inspect its live, read-only log without leaving the main conversation. **Task details** contains its assignment, question, and report. Use **Workers** to return to the roster, or **Return to conversation**, Close, Escape, or a downward pull to dismiss. Short pulls snap back; scrolling an already-scrolled log does not dismiss it. **Session details → Background tasks** opens the same sheet. Returned and accepted results remain distinct.

This works for host-managed sessions and sessions connected through the terminal bridge. Only independent conversations appear in the default global session list. Workers remain children, including when working or pinned. Explicit search and the worker sheet still reach their transcripts.

The sheet keeps the selected parent, composer, draft, attachments, and main reading position intact. Its separate read-only subscription watches one owned worker alongside the parent on the existing authenticated connection. Closing it or selecting another conversation clears that subscription. It reconnects after a host restart without replaying instructions. Explicitly opening a worker from session search still hides all input controls and offers a return to its parent.

Stopping the main response does not stop workers. Ask the assistant to stop a specific task.

## Worker permissions

Workers support investigation, not code changes or shell execution. They have only `read`, `grep`, `find`, `ls`, and `task_report`. Paths must resolve inside their project and outside private host data. Escaping symlinks are rejected. Delegating does not remove shell or editing tools from the parent conversation.

Restricted workers explicitly load the coordination extension and exclude other extensions, MCP servers, skills, prompt templates, and project instructions. Assignments must carry relevant constraints. These are model-tool restrictions in trusted host processes, not an operating-system sandbox. Ordinary Pi terminal resumes of worker files do not retain them. Legacy restricted coordinator files retain their previous permissions; new delegations never create one.

Worker `task_report` calls persist a question or result and end the turn. Idle alone does not mark completion. The host rejects direct client prompts, steering, follow-ups, aborts, model changes, compaction, and dialog responses to workers. Only trusted task-addressed operations can deliver instructions and Stop.

## Ownership and recovery

`coordinator-tasks.json` in the private Pi Remote directory stores membership, worker paths, scoped capabilities, states, and notifications. The first assignment records the existing parent session, without creating another conversation. Normal-session tool requests authenticate against that process's current session ownership lock. Their capabilities expire when ownership changes. Workers can report only their own task; parents can address only their own workers. No capabilities enter browser task state.

Assignments and commands use the existing command journal. A retry with the same request ID does not repeat work. Notification intent is saved before delivery. Questions and reports wake an idle parent, including a terminal-owned parent, without becoming apparent human input.

On restart, interrupted work and notification delivery become **unknown** instead of being replayed. Inspect existing work before explicitly continuing it. A sent notification means Pi accepted input, not that the human read a summary. The task inspector retains the record if a queued notification is lost during restart.

Finished workers remain open Pi sessions for follow-ups. There is no idle process eviction, automatic merge, recursive delegation, cross-project routing, or cloud execution. Work stops while the computer sleeps.

## Verification

Run `/skill:verify-pi-remote-coordinator` or `npm run test:coordinator`. The isolated proof drives ordinary existing and new sessions, the real terminal bridge, Pi processes, tools, files, browser, and recovery. Only model responses are deterministic. It does not establish paid-model judgment or physical iPhone behavior.
