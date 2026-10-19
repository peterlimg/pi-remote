# Shared provider E2E contract

```sh
npm run test:provider-parity
```

**Opt-in, paid model requests.** Requires Pi 1.3, normal local provider logins, the standalone SDK provider, pi-subagents, and Playwright Chromium/WebKit. This is not a CI job. Install browser engines with the project's usual Playwright command if needed.

Install the SDK package using [the standalone installation instructions](sdk-package-installation.md). SDK journeys require the `claude-usage` extension command, verify its package source on every parent reopen and record its metadata. The `pi-claude-sdk` dependency in [package.json](../experiments/claude-sdk-provider/package.json) is the source of truth for the expected revision; an archived local adapter cannot silently satisfy this check.

The same scenarios run against the user's configured default model and `claude-sdk/claude-haiku-5-5`. Nothing switches models after a failed request. To select models or rerun independent scenarios:

```sh
PI_PARITY_MODELS=openai-codex/gpt-6.1-sol,claude-sdk/claude-haiku-5-5 npm run test:provider-parity
PI_PARITY_CASES=foreground-standard-worker,recorded-identities-and-usage npm run test:provider-parity
```

Keep dependent core scenarios together: file operations and earlier memory supply reload, switching and restart checks. A filtered run records other scenarios as skipped, not passed.

## What runs

| Scenario | Observable contract |
| --- | --- |
| Instructions and messages | Recall a marker supplied only by project instructions; providers expose the same normal parent tools. |
| File tools | Real write, read, edit and final file contents. |
| Permission denial | Pi blocks one write; no denied file or alternative execution. |
| Reload/history | Recall actual earlier data without another tool call. |
| Mobile WebKit | Reopen and render the saved conversation. Not physical Safari. |
| Provider round trip | Actual model requests on both providers in one chat; retain both markers on return. |
| Worker restart | Replace only the owned Pi worker; reuse saved history without tools. |
| Inherited parallel delegates | The named `parallel` workflow launches two builtin `delegate` children with default placement, model, thinking and acceptance. They count scratch directories and read five actual Git commits, report inherited project policy, and finish independent real tool conversations. The parent cannot read the task data. |
| Standard foreground worker | Fresh builtin `worker`, normal tools/context/acceptance profile; read input, edit one scratch module, read it back and run `node --check`. Check actual child transcript, exit status, provider, calls/results and the physical file. Then recall its result in the parent without tools. |
| Retained standard worker | A normal High worker reads a private value, edits one module and performs one counted effect without disclosing its value in the first report. Replace the parent, inspect/resume the exact retained run and require no-tool child recall, parent-child isolation, an unchanged effect and automatic notice/restart. SDK continuation remains red. `PI_PARITY_CHILD_HOOKS=1` tests the existing required-extension API only inside the fixture; it is not a production setting. |
| Background combination | Two standard workers wait on a read-only gate. Stop a real parent command while both remain pending; continue the parent; release the gate; receive automatic completions without polling/relaunches; reload and restart the parent; recall both actual outputs without tools. |
| First-turn Stop | Stop real `bash`, continue in the same chat without repeating it, and inspect the cancellation receipt. |
| Compaction | Read an unknown marker through normal tools and perform one counted filesystem effect. Require a real marker-preserving summary, no-tool recall and restart without repeating work. Manual and automatic variants use the same contract. |
| Clone | Read an unknown marker and perform one counted effect, clone through Pi RPC, then reopen both files through mobile UI. Teach each branch a private value; require independent recall after replacing both workers, unchanged inactive branch bytes, no tool replay and separate SDK native IDs. |
| Earlier fork | Fork before a later user request, retain an earlier tool-read marker but exclude the later private value, preserve both filesystem effects, and restart both branches with independent memory/native IDs. `PI_PARITY_FORK_QUEUED=1` queues that later request during a running tool. |
| Tree navigation | Move within one file to selected or abandoned history, exclude later private values unless a branch summary explicitly carries them, preserve both effects and every old audit entry, and restart each path without replay. `PI_PARITY_TREE_QUEUED=1` queues the selected request during a running tool; `PI_PARITY_TREE_SUMMARY=1` uses Pi's normal summary. |
| Recorded identities/usage | Every recorded call has exactly one matching Pi result; no reused call IDs; nonnegative usage with reconciled token totals. |

## Isolation and permissions

The host, projects, session files, artifacts and subagent runtime records are scratch resources. Browser actions drive login, messages, model selection, Stop and reload. Compaction/clone/fork use Pi RPC. Tree uses an owned observer command that calls Pi's public `navigateTree` API through RPC, with the same normal Pi label on every provider to persist the destination before mobile reopening and messages. It is not a new product tree picker. No original chat is prompted, changed or recovered.

Pi loads normal personal extensions, instructions and skills. The harness does not use `--no-extensions`, replacement agent profiles, zero-tool workers or copied credentials. It adds a small observer extension, its owned tree-navigation command and a denial policy for `denied.txt`. The optional child-hooks experiment registers the already loaded SDK extension for fixture children through pi-subagents' public API; it changes no installed package or profile. `--approve` trusts the harness-owned project configuration; it does not bypass Pi tool policy. Compaction alone sets project `keepRecentTokens: 0`. With `PI_PARITY_COMPACTION_AUTO=1`, bounded inert file reads and a project-local 45K threshold exercise automatic compaction at tool boundaries. All other personal settings remain unchanged and their bytes are checked afterward.

Parent models use Medium reasoning for comparison. Worker scenarios use the builtin `worker` and its default High reasoning, tools, context and acceptance settings. The inherited parallel-delegate scenario keeps the builtin `delegate` profile defaults and inherits the parent model, without a child thinking override. Tasks limit edits to one owned module or require read-only work; no custom agent replaces the normal profiles. No child commits, stages, delegates further or contacts outside services as part of its task. The harness releases its gate on failure and closes its owned parent workers.

## Open gaps

Use the [provider gap tracker](provider-gaps.md) for remaining limitations and unverified workflows. The [Pi-owned compaction implementation](sdk-compaction.md) replaces the old all-model Pi guard without enabling Haiku's failing SDK-native auto-compaction path. [Completed-branch cloning](sdk-cloning.md) and [earlier-message forks](sdk-forks.md) share owner-bound branch receipts. [Tree navigation](sdk-tree.md) starts fresh contexts within the same Pi file after validating both paths and optional summaries. This remains a failing contract when a provider lacks a feature, not a smoke test that skips unsupported cases. The [recorded results](../experiments/claude-sdk-provider/verification-parity.json) are evidence, not an all-green interchangeability claim.

The printed temporary evidence directory contains the result, private audit records, child transcripts, browser trace and failure screenshots. Do not commit its raw contents: normal settings can introduce private instructions and tool payloads. Commit only a reviewed, redacted evidence summary.
