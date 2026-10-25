# Sessions

The session list lets users find a task, see whether it is working or waiting, and switch conversations without stopping another session.

## Sub-features

- `sessions-select`: select from the mobile list or desktop sidebar.
- `sessions-sections`: Now, three compact pins, then Recent; View all opens a live, scrollable collection. Pins share Recent's typography and two-line title limit but hide previews. Session type icons sit beside the project label, separate from the status indicator.
- `sessions-search`: filter by task or project and recover from an empty result.
- `sessions-pin`: pin or unpin through Session details or a right swipe.
- `sessions-close`: swipe left and confirm to hide a session, Undo, or search and select it to reopen.
- `sessions-pages`: move through saved and online session pages.
- `sessions-resume`: resume a saved session when available.
- `sessions-title`: name the first request in the background with an available small model on the same provider, preserve manual names, and retain saved titles through scans, large-history indexing and host restarts.

## How to get to it (user POV)

- Connect to Pi Remote to see the session list.
- On mobile, choose `Show sessions` from a conversation to return to the list.
- On desktop, use the sidebar without leaving the conversation.
- Use `Search sessions` or scroll to load more recent conversations.
- Use `View all active sessions` or `View all pinned sessions` for the complete collection; `Close sessions` returns to the overview.
- Open a conversation, choose `Session details`, then `Pin session` or `Unpin session`. Right swipes remain a shortcut.
- Swipe a row left past the Close threshold and release, then choose `Close session` in the in-app confirmation. The dialog names the session and explains that history is kept and running work continues. `Cancel`, Escape or tapping outside the card keeps the session in the list. Swipe right still pins or unpins.
- Use `Undo` to restore the last closed session, or search for a closed conversation and select it to reopen. Feedback expires after eight seconds or when `Dismiss` is tapped. `Session details` also offers `Close session` with the same confirmation for keyboard and assistive-technology users.
- Closing syncs across devices and survives host restarts. It does not delete history, discard drafts, or stop running work.
- Open a saved conversation and choose `Resume session` when offered.

## Driving it with Playwright

Preconditions: authenticated baseline with two projects. Pagination and saved-session resume require more data than this baseline contains.

- **Select mobile.** `await page.getByRole('button', { name: /Project Alpha/ }).click()`; require `await expect(page.locator('#title')).toHaveText('Project Alpha')`. Choose `page.getByRole('button', { name: 'Show sessions' })`, then the `/Project Beta/` button; require the title to change to `Project Beta`.
- **Select desktop.** `await page.setViewportSize({ width: 1280, height: 900 })`; require `#sidebar` visible, choose Alpha directly, and require its title and conversation. Do not click the hidden mobile back button.
- **Search.** From the list, `await page.getByRole('searchbox', { name: 'Search sessions' }).fill('Alpha')`; require `#sessions .session` count 1 and Project Alpha visible. Fill `no such project`; require `#list-empty` to read `No matching sessions. Try another task or project.` Clear the input; require both projects again.
- **Sections.** Run `npm run test:browser -- test/browser/session-sections.spec.mjs` with the default trace mode. It uses a real isolated host, more than 20 pins, and simulated bridge agents. Require needs-input sessions first, at most three Now and three pinned rows, no duplicate pinned activity, and recent rows without downloading every pin. Open both collections, scroll for more pins, swipe to unpin, open a conversation, and reload. The spec also covers live activity changes, search, and phone/desktop layouts. It does not execute Pi or models.
- **Pin.** Run `npm run test:browser -- test/browser/session-pin.spec.mjs --trace on`. The real fixture host and simulated Pi bridge verify keyboard pinning through Session details, the row's pinned indicator, persistence on reload, unpinning, unchanged drafts and agent status, and no prompt commands. Reopen Session details to read the new action after each mutation.
- **Close.** Run `npm run test:browser -- test/browser/session-close.spec.mjs`, then repeat with `--browser=webkit`. It uses real hosts and a simulated bridge, with real touch input through Chromium CDP and synthetic touch events in WebKit. It drives the styled in-app dialog and rejects unexpected browser confirmations. Check the stationary card, bounded long titles, light/dark themes, Cancel, Escape and outside-tap dismissal. Touch opening focuses the dialog without a button focus ring; keyboard opening focuses Cancel and dismissal returns focus to the trigger. The first Search tap after Cancel must work within one second. No confirmation form or slide-in animation is used. Check short, vertical and canceled gestures, right-swipe pinning, confirmation and cancellation before any close request, cross-phone removal, page refill, Undo in the pinned collection, toast expiry and dismissal, persistence through scans/reload/host restart, search reopening, draft retention, the keyboard action, and failed-save feedback. It verifies unchanged history files and no commands sent to the running bridge. It does not prove physical Safari behavior or real Pi execution.
- **Pages.** Run `npm run test:browser -- test/browser/session-pages.spec.mjs test/browser/sessions.spec.mjs --trace on`. Scroll the last row into view, require 20 then 40 rows in the paged list, then search and clear. These specs route the browser WebSocket and cover the legacy list contract, not a real host.
- **Resume boundary.** The baseline has no saved resumable session. Report `sessions-resume` blocked here. A real proof needs a disposable saved Pi session, a working Pi installation, and a separate isolated host; click `page.getByRole('button', { name: 'Resume session' })`, then require an online session and an acknowledged prompt. Do not create a worker in the user's live host to fill this gap.

## Title generation and stability

Run `node test/pi-smoke.mjs` with the configured Pi installation. The real Pi extension uses a simulated provider to verify that naming starts before the first reply, uses only the first request without skill instructions, chooses a small model without switching the main model, isolates the naming conversation, persists the title, and leaves manual names unchanged after follow-ups. No external model calls are made. Older Pi versions without `modelRegistry.streamSimple` explicitly skip the title-generation check. If no small model is available on the current provider, naming uses the current model.

Run `npm run test:browser -- test/browser/session-title.spec.mjs`. It uses a real host, session file over 32 MiB, background history index, fresh host process and mobile browser, with Pi RPC replayed instead of model calls. The name is deliberately beyond the catalog's preview window. It checks that scans and restart/reconnect retain the header and list title without changing the session file. An explicit Pi rename must still take effect.

## Gotchas

- Commands mutate shared fixture state. Restart the fixture before checking initial working status or scan warnings.
- The two-project fixture cannot prove pagination just because page buttons exist.
- Read the selected conversation after navigation; a highlighted list item alone is insufficient.
- Search is server-backed and asynchronous. Wait for counts or text with `expect`, not a fixed sleep.
