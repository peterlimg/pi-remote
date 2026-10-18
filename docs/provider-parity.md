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
| Compaction | Request real compaction, require a saved compaction entry and retain the marker afterward. |
| Clone | Require an actual new Pi session file, not a provider-cancelled clone. Continuation in a cloned session is not checked here. |
| Recorded identities/usage | Every recorded call has exactly one matching Pi result; no reused call IDs; nonnegative usage with reconciled token totals. |

## Isolation and permissions

The host, projects, session files, artifacts and subagent runtime records are scratch resources. Browser actions drive login, messages, model selection, Stop and reload. Compaction/clone use Pi RPC. No original chat is prompted, changed or recovered.

Pi loads normal personal extensions, instructions and skills. The harness does not use `--no-extensions`, replacement agent profiles, zero-tool workers or copied credentials. It adds a small observer extension and a denial policy for `denied.txt` only. `--approve` trusts the harness-owned project configuration; it does not bypass Pi tool policy. Compaction alone sets project `keepRecentTokens: 0` to exercise a real summary on a small fixture. All other personal settings remain unchanged and their bytes are checked afterward.

Parent models use Medium reasoning for comparison. Children use the builtin `worker` and its default High reasoning, tools, context and acceptance settings. Tasks limit edits to one owned module or require read-only work; no custom agent replaces the normal worker. No child commits, stages, delegates further or contacts outside services as part of its task. The harness releases its gate on failure and closes its owned parent workers.

## Current limitations

This is a failing contract when a provider lacks a feature, not a smoke test that skips unsupported cases. SDK compaction and cloning are still explicitly blocked. Native Codex can report a user Stop as an `error` receipt (`This operation was aborted`) even when the next message succeeds. See [recorded results](../experiments/claude-sdk-provider/verification-parity.json); do not infer full interchangeability from passing tool/delegation rows.

Foreground Pi children borrow registered providers but not parent session hooks. The SDK adapter now gives each borrowed Pi session its own native bridge, preserving its full prompt and Pi tool schemas. A terminal child response closes only that child's bridge. The parent's query, checkpoint and audit remain separate. These borrowed contexts are ephemeral: durable/retained child resume requires loading the provider's own session hooks. The test covers fresh standard workers, not retained/forked children or every standard role.

Images, slash-command dialogs, nested delegation, custom roles/permission ceilings, arbitrary prompt changes, tree navigation, physical Safari and overnight/background failure recovery are not covered by this new matrix. Earlier focused tests remain separate evidence, not substitutes for these missing combinations.

The printed temporary evidence directory contains the result, private audit records, child transcripts, browser trace and failure screenshots. Do not commit its raw contents: normal settings can introduce private instructions and tool payloads. Commit only a reviewed, redacted evidence summary.
