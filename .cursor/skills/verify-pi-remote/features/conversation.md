# Conversation

A conversation shows user and assistant messages, formatted replies, collapsible tool output, and project details without crowding the phone screen.

## Sub-features

- `conversation-markdown`: render formatting without executing embedded markup.
- `conversation-tool`: use the live `View activity` button above the composer, or the completed request's activity link, then open and close individual tool arguments and output.
- `conversation-project`: reveal the selected project's full directory.
- `conversation-bottom`: return to the latest message in a long thread.
- `conversation-history`: scroll back through the saved branch, including messages before compaction, while live replies continue.

## How to get to it (user POV)

- Open a session from the list or desktop sidebar.
- Choose `Session details` in the conversation header.
- While Pi works, tap `View activity` above the composer. Completed requests keep one activity link after their replies. Open a tool inside the log, or focus either summary and press Enter.
- Scroll up in a long conversation, then choose `Go to thread bottom`.

## Driving it with Playwright

Preconditions: authenticated baseline, no command sent yet. Start with Project Alpha.

- **Open.** `await page.getByRole('button', { name: /Project Alpha/ }).click()`; require `#transcript` to contain `Working on Project Alpha`.
- **Formatting.** Require `await expect(page.locator('.message-text strong')).toHaveText('The relay is ready.')` and `.message-text pre code` text `npm test\n`. Require `#transcript script, #transcript img, #transcript a[href^="javascript:"]` count 0. The seeded malicious text must not become executable markup or a remote image request; inspect the trace network as well.
- **Project.** `await page.locator('.session-info summary').click()`; require `#project` visible with text `/projects/Project Alpha`. Click again to collapse. The summary's accessible name is `Session details`.
- **Tool.** Require `.tool-activity-label` to say `View activity`, with its live log summary hidden. Set `const tool = page.locator('#transcript details.tool')`; require it hidden. Click `page.getByRole('button', { name: 'View activity', exact: true })`, then `await tool.locator('summary').click()` to reveal `Relay configuration output`; click again to hide it. Repeat with `await tool.locator('summary').focus(); await page.keyboard.press('Enter')` to prove keyboard entry separately. Closing the live log returns focus to its composer button.
- **Shell output.** Return via `Show sessions`, open Project Beta, and set `const shell = page.locator('[data-tool-id="run-checks"]')`. Require one `.tool-activity` for the request, with its shell command hidden. Click the live `View activity` button, then the shell's `summary`; require `.tool-output` to contain `check 1: passed`. This is seeded output, not evidence that npm tests ran.
- **Bottom button.** Run `npm run test:browser -- test/browser/scroll.spec.mjs --grep 'bottom button' --trace on`. It supplies the long thread missing from baseline. The handle is `page.getByRole('button', { name: 'Go to thread bottom' })`; require the latest message visible and following subsequent replies after choosing it. This spec simulates the browser WebSocket.
- **History.** Run `npm run test:browser -- test/browser/history.spec.mjs`. It uses real JSONL files and an isolated real host, with only Pi's bridge simulated. It proves scrollback beyond 100 records, equal/out-of-order timestamps, pre-compaction history, forward paging after eviction, unchanged historical DOM during live updates, bounded pages/live patches and page bytes, encrypted historical image/video reads with session/branch boundaries, and browsing above 32 MiB. History loads automatically near either scroll edge, including wheel, keyboard and touch input when collapsed tools leave no scrolling room. There are no idle paging buttons. Only an active request shows `Loading…` with `role=status` and a busy transcript; scroll again to retry a failed request. `Go to thread bottom` returns directly to live replies. The browser keeps at most 200 historical records, not the entire session.
- **Live progress.** One `#agent-activity` row above the composer follows actual reading, searching, editing, command execution and reply streaming. Raw commands and file paths stay inside the log. Waiting for input and tool failures remain visible; elapsed time uses supplied task timestamps and does not claim completion. `test/browser/activity.spec.mjs` covers status changes, session switching, waiting, disconnect, reduced motion and keyboard-sized layouts.
- **Regression.** Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'conversation renders|one activity log|streaming tool input' --trace on` for the real local host paths and safe tool rendering. `test/browser/tool-activity.spec.mjs` simulates the browser WebSocket to check per-request grouping, visible failures, elapsed time, hidden extension prompts, and expansion/focus across streaming and completion.

## Gotchas

- A screenshot of collapsed tools does not prove output can be opened. Keep the trace of opening and closing plus an expanded screenshot.
- Do not click the seeded Render documentation link during an offline/local-only proof.
- Stable `data-tool-id` values distinguish Beta's several tools better than positional selectors.
- Chromium with a phone viewport does not prove native iOS keyboard or Safari behavior.
