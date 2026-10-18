# Shared provider E2E contract

```sh
npm run test:provider-parity
```

**Opt-in, paid model requests.** Requires Pi 1.3, normal local provider logins, the SDK provider, pi-subagents, and Playwright Chromium/WebKit. This is not a CI job. Install browser engines with the project's usual Playwright command if needed.

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
| Standard foreground worker | Fresh builtin `worker`, normal tools/context/acceptance profile; read input, edit one scratch module, read it back and run `node --check`. Check actual child transcript, exit status, provider, calls/results and the physical file. Then recall its result in the parent without tools. |
| Background combination | Two standard workers wait on a read-only gate. Stop a real parent command while both remain pending; continue the parent; release the gate; receive automatic completions without polling/relaunches; reload and restart the parent; recall both actual outputs without tools. |
| First-turn Stop | Stop real `bash`, continue in the same chat without repeating it, and inspect the cancellation receipt. |
| Compaction | Read an unknown marker through normal tools and perform one counted filesystem effect. Require a real marker-preserving summary, no-tool recall and restart without repeating work. Manual and automatic variants use the same contract. |
| Clone | Require an actual new Pi session file, not a provider-cancelled clone. Continuation in a cloned session is not checked here. |
| Recorded identities/usage | Every recorded call has exactly one matching Pi result; no reused call IDs; nonnegative usage with reconciled token totals. |

## Isolation and permissions

The host, projects, session files, artifacts and subagent runtime records are scratch resources. Browser actions drive login, messages, model selection, Stop and reload. Compaction/clone use Pi RPC. No original chat is prompted, changed or recovered.

Pi loads normal personal extensions, instructions and skills. The harness does not use `--no-extensions`, replacement agent profiles, zero-tool workers or copied credentials. It adds a small observer extension and a denial policy for `denied.txt` only. `--approve` trusts the harness-owned project configuration; it does not bypass Pi tool policy. Compaction alone sets project `keepRecentTokens: 0`. With `PI_PARITY_COMPACTION_AUTO=1`, bounded inert file reads and a project-local 45K threshold exercise automatic compaction at tool boundaries. All other personal settings remain unchanged and their bytes are checked afterward.

Parent models use Medium reasoning for comparison. Children use the builtin `worker` and its default High reasoning, tools, context and acceptance settings. Tasks limit edits to one owned module or require read-only work; no custom agent replaces the normal worker. No child commits, stages, delegates further or contacts outside services as part of its task. The harness releases its gate on failure and closes its owned parent workers.

## Open gaps

Use the [provider gap tracker](provider-gaps.md) for remaining limitations and unverified workflows. The [Pi-owned compaction implementation](sdk-compaction.md) replaces the old all-model Pi guard without enabling Haiku's failing SDK-native auto-compaction path. This remains a failing contract when a provider lacks a feature, not a smoke test that skips unsupported cases. The [recorded results](../experiments/claude-sdk-provider/verification-parity.json) are evidence, not an all-green interchangeability claim.

The printed temporary evidence directory contains the result, private audit records, child transcripts, browser trace and failure screenshots. Do not commit its raw contents: normal settings can introduce private instructions and tool payloads. Commit only a reviewed, redacted evidence summary.
