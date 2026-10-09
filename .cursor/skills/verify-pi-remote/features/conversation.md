# Conversation

A conversation shows user and assistant messages, formatted replies, collapsible tool output, and project details without crowding the phone screen.

## Sub-features

- `conversation-markdown`: render formatting without executing embedded markup.
- `conversation-tool`: expand grouped activity, then open and close individual tool arguments and output.
- `conversation-project`: reveal the selected project's full directory.
- `conversation-bottom`: return to the latest message in a long thread.

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
- **Tool.** Require `.tool-activity > summary` to say `Read 1 file`. Set `const tool = page.locator('#transcript details.tool')`; require it hidden. Click the activity summary, then `await tool.locator('summary').click()` to reveal `Relay configuration output`; click again to hide it. Repeat with `await tool.locator('summary').focus(); await page.keyboard.press('Enter')` to prove keyboard entry separately.
- **Shell output.** Return via `Show sessions`, open Project Beta, and set `const shell = page.locator('[data-tool-id="run-checks"]')`. Require the last `.tool-activity > summary` to say `Ran 1 command, read 2 files` and the shell command to be hidden. Open that activity, then the shell's `summary`; require `.tool-output` to contain `check 1: passed`. This is seeded output, not evidence that npm tests ran.
- **Bottom button.** Run `npm run test:browser -- test/browser/scroll.spec.mjs --grep 'bottom button' --trace on`. It supplies the long thread missing from baseline. The handle is `page.getByRole('button', { name: 'Go to thread bottom' })`; require the latest message visible and following subsequent replies after choosing it. This spec simulates the browser WebSocket.
- **Regression.** Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'conversation renders|tool summaries' --trace on` for the real local host paths. `test/browser/tool-activity.spec.mjs` simulates the browser WebSocket to check grouping boundaries, failure/running counts, and expansion/focus across streaming updates.

## Gotchas

- A screenshot of collapsed tools does not prove output can be opened. Keep the trace of opening and closing plus an expanded screenshot.
- Do not click the seeded Render documentation link during an offline/local-only proof.
- Stable `data-tool-id` values distinguish Beta's several tools better than positional selectors.
- Chromium with a phone viewport does not prove native iOS keyboard or Safari behavior.
