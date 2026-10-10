# Sessions

The session list lets users find a task, see whether it is working or waiting, and switch conversations without stopping another session.

## Sub-features

- `sessions-select`: select from the mobile list or desktop sidebar.
- `sessions-search`: filter by task or project and recover from an empty result.
- `sessions-pages`: move through saved and online session pages.
- `sessions-resume`: resume a saved session when available.

## How to get to it (user POV)

- Connect to Pi Remote to see the session list.
- On mobile, choose `Show sessions` from a conversation to return to the list.
- On desktop, use the sidebar without leaving the conversation.
- Use `Search sessions`, `Previous session page`, or `Next session page`.
- Open a saved conversation and choose `Resume session` when offered.

## Driving it with Playwright

Preconditions: authenticated baseline with two projects. Pagination and saved-session resume require more data than this baseline contains.

- **Select mobile.** `await page.getByRole('button', { name: /Project Alpha/ }).click()`; require `await expect(page.locator('#title')).toHaveText('Project Alpha')`. Choose `page.getByRole('button', { name: 'Show sessions' })`, then the `/Project Beta/` button; require the title to change to `Project Beta`.
- **Select desktop.** `await page.setViewportSize({ width: 1280, height: 900 })`; require `#sidebar` visible, choose Alpha directly, and require its title and conversation. Do not click the hidden mobile back button.
- **Search.** From the list, `await page.getByRole('searchbox', { name: 'Search sessions' }).fill('Alpha')`; require `#sessions .session` count 1 and Project Alpha visible. Fill `no such project`; require `#list-empty` to read `No matching sessions. Try another task or project.` Clear the input; require both projects again.
- **Pages.** Run `npm run test:browser -- test/browser/session-pages.spec.mjs test/browser/sessions.spec.mjs --trace on`. These provide larger lists. Verify `1–20 of 675`, choose `Next session page`, verify `21–40 of 675`, then search and clear. Inspect each spec's fixture before claiming host-backed pagination; `sessions.spec.mjs` routes the browser WebSocket.
- **Resume boundary.** The baseline has no saved resumable session. Report `sessions-resume` blocked here. A real proof needs a disposable saved Pi session, a working Pi installation, and a separate isolated host; click `page.getByRole('button', { name: 'Resume session' })`, then require an online session and an acknowledged prompt. Do not create a worker in the user's live host to fill this gap.

## Gotchas

- Commands mutate shared fixture state. Restart the fixture before checking initial working status or scan warnings.
- The two-project fixture cannot prove pagination just because page buttons exist.
- Read the selected conversation after navigation; a highlighted list item alone is insufficient.
- Search is server-backed and asynchronous. Wait for counts or text with `expect`, not a fixed sleep.
