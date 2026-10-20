# Conversation

A conversation shows user and assistant messages, formatted replies, collapsible tool output, and project details without crowding the phone screen.

## Sub-features

- `conversation-markdown`: render formatting without executing embedded markup.
- `conversation-tool`: expand grouped activity, then open and close individual tool arguments and output.
- `conversation-project`: reveal the selected project's full directory.
- `conversation-bottom`: return to the latest message in a long thread.
- `conversation-history`: scroll back through the saved branch, including messages before compaction, while live replies continue.

## How to get to it (user POV)

- Open a session from the list or desktop sidebar.
- Choose `Session details` in the conversation header.
- Tap an activity summary, then a tool inside it, or focus either summary and press Enter.
- Scroll up in a long conversation, then choose `Go to thread bottom`.

## Driving it with Playwright

Preconditions: authenticated baseline, no command sent yet. Start with Project Alpha.

- **Open.** `await page.getByRole('button', { name: /Project Alpha/ }).click()`; require `#transcript` to contain `Working on Project Alpha`.
- **Formatting.** Require `await expect(page.locator('.message-text strong')).toHaveText('The relay is ready.')` and `.message-text pre code` text `npm test\n`. Require `#transcript script, #transcript img, #transcript a[href^="javascript:"]` count 0. The seeded malicious text must not become executable markup or a remote image request; inspect the trace network as well.
- **Project.** `await page.locator('.session-info summary').click()`; require `#project` visible with text `/projects/Project Alpha`. Click again to collapse. The summary's accessible name is `Session details`.
- **Tool.** Require `.tool-activity-label` to say `Read 1 file`. Set `const tool = page.locator('#transcript details.tool')`; require it hidden. Click the activity summary, then `await tool.locator('summary').click()` to reveal `Relay configuration output`; click again to hide it. Repeat with `await tool.locator('summary').focus(); await page.keyboard.press('Enter')` to prove keyboard entry separately.
- **Shell output.** Return via `Show sessions`, open Project Beta, and set `const shell = page.locator('[data-tool-id="run-checks"]')`. Require the last `.tool-activity-label` to say `Ran 1 command, read 2 files` and the shell command to be hidden. Open that activity, then the shell's `summary`; require `.tool-output` to contain `check 1: passed`. This is seeded output, not evidence that npm tests ran.
- **Bottom button.** Run `npm run test:browser -- test/browser/scroll.spec.mjs --grep 'bottom button' --trace on`. It supplies the long thread missing from baseline. The handle is `page.getByRole('button', { name: 'Go to thread bottom' })`; require the latest message visible and following subsequent replies after choosing it. This spec simulates the browser WebSocket.
- **History.** Run `npm run test:browser -- test/browser/history.spec.mjs`. It uses real JSONL files and an isolated real host, with only Pi's bridge simulated. It proves scrollback beyond 100 records, equal/out-of-order timestamps, pre-compaction history, cached return scrolling after DOM eviction, unchanged historical DOM during live updates, bounded pages/live patches and page bytes, encrypted historical image/video reads with session/branch boundaries, and browsing above 32 MiB. Only scrolling toward older, unloaded messages fetches history and shows `Loading…` with `role=status` and a busy transcript; scroll up again to retry a failed request. Returning downward reuses loaded newer records without a request or loading indicator, including wheel, keyboard and touch input when collapsed tools leave no scrolling room. Reaching the end resumes live replies without using `Go to thread bottom`; that button remains a shortcut. A pending older response cannot restore history after returning to live replies. The browser renders at most 200 historical records, retaining evicted newer records in memory until the reader returns to live replies or changes sessions.
- **Tool images.** Run `npm run test:browser -- test/browser/images.spec.mjs --grep 'thread images' --trace on`. Screenshots appear directly in the conversation while activity and tool details remain collapsed. Tap an image to open the existing full-size viewer. The check covers both a matching tool call and an orphan result, retries, stable previews during live updates, and no duplicate images after expanding details. It mocks the browser WebSocket and captures phone and desktop views.
- **Reply streaming.** Run `npm run test:browser -- test/browser/streaming.spec.mjs --trace on`. It starts a real host and RPC child process with a simulated Pi producer using delta-only `message_update` records. Require successive partial replies and tool arguments while status remains `working`, before any final `message_end`; final text replaces the reconstruction without duplicates. Thinking text stays hidden. The test does not mock the browser WebSocket or call a model provider.
- **Live tool progress.** Activity stays inline between assistant updates. A running block shows its command or file and the last two non-empty output lines, updating while the tool is still running. Full input/output stays expandable. Between tool calls, the latest block retains one `Last:` command or file so quick reads remain noticeable even if their running event was skipped. Completed reads do not preview source contents; commands can retain two output lines. Previews clear when the agent settles or another activity block starts. Run `npm run test:browser -- test/browser/live-tool-progress.spec.mjs --trace on` for streamed output, parallel tools, restored message boundaries and narrow layouts. This check simulates the browser WebSocket.
- **Regression.** Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'conversation renders|tool summaries' --trace on` for the real local host paths. `test/browser/tool-activity.spec.mjs` simulates the browser WebSocket to check grouping boundaries, failure/running counts, and expansion/focus across streaming updates.

## Gotchas

- A screenshot of collapsed tools does not prove output can be opened. Keep the trace of opening and closing plus an expanded screenshot.
- Do not click the seeded Render documentation link during an offline/local-only proof.
- Stable `data-tool-id` values distinguish Beta's several tools better than positional selectors.
- Chromium with a phone viewport does not prove native iOS keyboard or Safari behavior.
