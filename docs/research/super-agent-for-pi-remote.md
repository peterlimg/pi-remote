# A coordinator conversation for Pi Remote

## Recommendation

Borrow the post's separation of conversation and execution. Add an optional coordinator conversation for one project, backed by ordinary host-managed Pi sessions. Keep the session browser as an inspection and manual-control path.

The smallest useful version accepts an explicitly requested task, creates its worker, keeps receiving new requests while that worker runs, and delivers results or questions back in the coordinator conversation. Follow-ups carry a selected task ID. Do not start with inferred cross-project routing or autonomous GitHub intake.

```text
Phone: one coordinator conversation
  ├─ Task A → Pi session A → result or question
  └─ Task B → Pi session B → result or question

Tap a task to reply, stop it, or inspect its session.
```

An attention inbox is a useful smaller UI change, but does not solve the post's main problem on its own. Someone still has to assign work and remember which conversation owns it.

## What the sources actually support

The [linked post](https://x.com/Blackmambaer/status/2116722042976571463) describes a Router that owns human interaction and independent Workers that execute tasks. It presents the ability to follow only 3–5 sessions as an observation, not a measured universal limit. The post was retrieved through [FxTwitter's mirror](https://api.fxtwitter.com/blackmambaer/status/2116722042976571463), because direct X access returned 403.

DeepSeek's [first-party prototype README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md) confirms a single-repository agent with separate work items, sessions and directories, GitHub intake, optional Feishu intake, and a panel for work needing a person. It explicitly calls the code a research prototype, not an official product, and says it differs from the article and omits some of its designs. It is a DeepSeek Harness bundle, not a drop-in Pi extension.

The [design philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md) requires explicit requests or written rules, narrow authorization, and messages only when a person needs to act or can use the result. The [panel document](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md) prioritizes work needing a person, then health, then history. Those are good product rules for a phone app regardless of execution architecture.

The [original architecture article](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg) required a verification challenge and could not be read directly. Its specific Router/Worker implementation and performance claims were not independently verified against that primary source. No throughput, cost-saving or overnight-reliability claim is justified by this investigation.

## Existing Pi Remote support and gaps

Source inspected at `d0781b2`.

| Need | Existing support | Missing behavior |
| --- | --- | --- |
| Parallel execution | [`SessionService`](../../src/service.mjs) starts and restores separate host-managed Pi workers. | Durable task ownership and coordinator-to-worker delivery. A `WorkerSession` currently means a managed Pi process, not a task record. |
| Send, steer, stop and answer | The service dispatches commands and answers to a specified session. [`client-channel.mjs`](../../src/client-channel.mjs) exposes them to authenticated clients. | A narrow coordinator tool interface restricted to its own tasks. Existing client access is not a suitable per-task authorization policy. |
| Quiet session browsing | `isHelperSession` and `matches` in the service hide recognized helper sessions while retaining search access. [`helper-sessions.spec.mjs`](../../test/browser/helper-sessions.spec.mjs) covers that behavior. | Explicit coordinator-worker membership. Do not hide new workers by imitating helper filenames. |
| Attention signals | [`state.mjs`](../../src/state.mjs) reports working/waiting/idle. [`protocol.js`](../../web/protocol.js) groups active sessions and sorts waiting sessions first. | An actionable question or result attached to its task, with durable acknowledgement. Idle is not evidence of successful completion. |
| Reconnect and restart safety | [`CommandJournal`](../../src/commands.mjs) persists command intent/results and refuses uncertain replay. The [managed lifecycle](../session-lifecycle.md) gates safe restarts and restores worker ownership. | Persistent task/session mapping, report delivery records and recovery rules. Restoring a process is not restoring a task manager. |

Keep orchestration on the local computer. The phone remains a client, and opentunnel remains transport. This does not require a cloud agent or a more powerful Render relay. It also does not make work continue while the computer is asleep or offline.

## Small first implementation

- One opt-in project coordinator. Start with two concurrent independent tasks and an explicit scope for each. The coordinator dispatches and summarizes; coding and slow tools stay in workers so the conversation remains responsive.
- Persist each task's ID, owning coordinator, worker session ID, project/work directory, requested scope, last report and unresolved question. Preserve ownership after compaction and host restart rather than relying on conversational memory.
- Create and address workers through the existing service. Expose only scoped task operations to the coordinator, not unrestricted access to every session or a shell. A prompt saying "only coordinate" is not a permission check.
- Bind replies through a task chip or reply action. New work is explicit. Ask when a free-text follow-up is ambiguous instead of silently guessing which worker should receive it.
- Show questions and deliverable results in the coordinator conversation. Allow task-specific Stop and session inspection. Retain direct session access for recovery; do not remove existing browsing.
- Use separate work directories for concurrent changes to the same repository. Context isolation alone does not prevent two workers from editing the same files. Worktree preparation must preserve unrelated local changes.
- Journal coordinator dispatch and report delivery with stable IDs. Preserve current unknown-outcome handling and permission dialogs. Never replay tools, mark unknown effects successful, or automatically approve a worker's question.

This reaches the service and its persistence, authenticated local coordinator tools, phone event/protocol handling, task/reply controls, and focused browser/lifecycle E2E fixtures. It is not a rename of the session list.

Do not make retained pi-subagents children a prerequisite for the first version. Ordinary host-managed sessions already fit the execution role. The documented [provider gaps](../provider-gaps.md) include incomplete durable foreground-child continuation and unverified nested/overnight workflows; hiding those children would not resolve their recovery problems.

## Acceptance before enabling it

Use isolated hosts and deterministic workers first, then a separately authorized real-model check:

1. Start two tasks from one conversation. A third message remains usable while both workers are busy.
2. Reply to task A's question and stop task B. Only the addressed worker receives each action; task A's permission is not silently granted.
3. Reload the phone and safely restart the host. Task/session ownership and unanswered questions survive; completed results are not announced twice.
4. Interrupt an acknowledged dispatch or tool outcome. Recovery exposes uncertainty without creating a duplicate worker or replaying a side effect.
5. Concurrent code tasks use separate work directories. Unrelated local changes and existing manually controlled sessions remain untouched.

No application code was changed and no prototype was run for this research. GitHub/CI triggers, proactive fixes, semantic routing, automatic merges, cloud execution and a watchdog are deliberately outside this first scope.
