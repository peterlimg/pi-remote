# Pi Remote verification map

Read this index before driving the app. These files describe user paths and the evidence each needs. A passing check of one entry point does not verify the others.

## Baseline preconditions

- Launch with [the skill](../SKILL.md) at `http://127.0.0.1:8799` and require Doctor to pass for your fixture PID.
- Use a fresh Chromium context with the iPhone 13 profile. The fixture token is `browser-test-token-only-123456789012345`.
- Expect `Project Alpha` and `Project Beta`, seeded conversations, and 20 scan warnings. Use a fresh server for baseline-sensitive checks; a command changes its shared state.
- The real local host talks to simulated Pi bridge agents. No model, external relay, or production Pi session is involved.
- Port 8799 cannot be shared, including with the existing browser suite. Never attach to another run's instance.

## Driving conventions

The snippets use `page`, `context`, and `expect` from the skill's Playwright setup. Except for access recipes, begin authenticated on the session list. Prefer accessible names and the existing DOM IDs. Mobile navigation uses `Show sessions`; on desktop, select directly in the sidebar.

Regression commands run from the repository root with no manually running fixture. They use the existing Playwright-managed server. Add `--trace on` for action evidence and copy `test-results/` outside that directory before another invocation. Tests that route the browser WebSocket are UI-contract checks only.

## Proof and skip reporting

Record feature ID, entry point, revision, dirty paths, fixture type, command, and exit code. Capture actions in a trace, a screenshot and ARIA snapshot of the resulting state, and a second read of mutations. Keep artifacts after cleanup. Distinguish a simulated acknowledgement from actual Pi execution.

The executable smoke proof covers manual login, reopen, and sign out only. The remaining recipes are a map for later verification, not a claim that every feature was exercised when the skill was generated. Report blocked entry points and their missing preconditions explicitly.

## Features

- [Access](access.md): token entry, QR-link entry, reopen, sign out, invalid credentials.
- [Sessions](sessions.md): mobile/desktop selection, search, task previews, diagnostics, pagination and resume boundaries.
- [Conversation](conversation.md): Markdown, tool details, project details, navigation, scrolling.
- [Messages](messages.md): send, drafts, desktop shortcuts, abort, image attachment and acknowledgement boundaries.
- [Commands](commands.md): discovery, touch/keyboard completion, session-specific commands, `/new`, model and reasoning boundaries.

## Not yet mapped in detail

Pi installation and `/pi-remote` setup/status/stop, QR generation, Render deployment, real worker resumption, extension dialogs, usage output, reconnect recovery, and model/provider execution need separate entry-point recipes. Relevant regression sources include `test/pi-smoke.mjs`, `test/integration.test.mjs`, `test/worker-relay.test.mjs`, and `test/browser/{dialogs,reconnect,image-recovery,send-feedback,usage-status}.spec.mjs`. Read their prerequisites before running; do not extrapolate local UI evidence to these paths.
