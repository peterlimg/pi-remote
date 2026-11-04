# Project coordinators

A coordinator keeps the conversation separate from background investigations. It creates ordinary host-managed Pi sessions and tracks their assignments, questions, and results on the local computer.

## Start and use one

Requires Pi 1.4 or newer and a native Pi model. Custom provider extensions such as the Claude SDK provider are not loaded in restricted coordinator sessions.

1. Open a session in the project and choose **Session details → Start read-only coordinator**.
2. Ask for an investigation. The coordinator can assign up to two active tasks and continue answering you while they run.
3. The collapsible **Workers** tree immediately above the composer shows the main conversation and its worker logs, without cards. Tap a worker to inspect it; the same tree remains available while you read.
4. Give every reply and command in the main conversation. The coordinator presents decisions, relays answers to the intended task, reviews reports, and summarizes the findings. For example, tell it to stop a named investigation without stopping its siblings. It must clarify ambiguous references.
5. Worker logs have no input controls. **Return to coordinator** restores your main draft and attachments. **Session details → Background tasks** opens read-only assignments, questions, and reports. Returned and accepted results remain distinct.

Only independent conversations, including coordinators, appear in the default global session list. Workers stay under their coordinator, including when working or pinned. Explicit search and the coordinator's worker controls still reach their transcripts.

The composer is unchanged for normal and coordinator sessions and is hidden during worker inspection. Stopping a coordinator response does not stop its workers. Ask the coordinator to stop a specific task. The tree preserves its open/closed choice while you switch between owner and child and while live task states change.

## Read-only scope

This version supports investigation, not code changes or shell execution. Workers have only `read`, `grep`, `find`, `ls`, and `task_report`. File paths must resolve inside the selected project and outside private host data. Symlink targets outside the project are rejected. The coordinator has only `remote_tasks`.

Restricted sessions load the coordination extension explicitly and exclude other extensions, MCP servers, skills, prompt templates, and project instructions. Assignments must carry the user's relevant constraints. These are model-tool restrictions in host-managed processes, not an operating-system sandbox against malicious installed code. Ordinary Pi terminal resumes do not carry these restrictions; keep coordinator work in Pi Remote.

Worker `task_report` calls explicitly record a question or result and end the turn. Idle by itself does not mark a task complete. Direct client prompts, steering, follow-ups, aborts, model changes, compaction, and dialog responses to workers are rejected. Only trusted coordinator operations may deliver task instructions and scoped Stop. These are local host input boundaries, not an operating-system sandbox.

## Ownership and recovery

`coordinator-tasks.json` in the private Pi Remote data directory stores coordinator membership, worker session paths, scoped capability tokens, task states, and notification records. Tokens never appear in browser task state. Each worker can report only its own task; coordinator operations address only owned tasks.

Assignments and commands use the existing command journal. A retry with the same request ID does not create another task or repeat an acknowledged command. Notification intent is saved before sending it to the coordinator.

On restart, interrupted work and notification delivery become **unknown** instead of being replayed. Inspect the existing worker and give an explicit continuation. Questions and reports remain available. A notification marked sent means Pi acknowledged its input; it does not prove that the user has read a summary. The task sheet remains the durable record if a queued notification is lost during a restart.

Finished workers remain ordinary open Pi sessions for follow-ups. This first version has no idle process eviction, automatic merge, recursive delegation, cross-project routing, or cloud execution. Work does not continue while the local computer is asleep.

## Verification

Run `/skill:verify-pi-remote-coordinator` or `npm run test:coordinator` for an isolated end-to-end proof. Its model responses are deterministic fixtures; the host, Pi processes, tools, files, browser, and recovery paths are real. A fixture proof does not establish paid-model planning quality or physical iPhone behavior.
