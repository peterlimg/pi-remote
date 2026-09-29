# Commands

Typing `/` discovers the selected session's commands, templates, and skills. Users can complete a command by touch or keyboard and send it with arguments. `/new` opens a separate session; `/model` chooses a model for only the selected session.

## Sub-features

- `commands-discover`: list and filter commands for the selected session.
- `commands-complete`: complete by touch, arrows, Tab, or Enter.
- `commands-send`: preserve arguments and route a command to that session.
- `commands-new`: open a new session in the same project.
- `commands-model`: choose through `/model`, a direct model ID, or the model button.
- `commands-reasoning`: set the selected session's reasoning effort.

## How to get to it (user POV)

- Open a session and type `/` at the start of Message.
- Tap a suggestion; on desktop use arrows and Tab to complete, or Enter to run the selected command.
- Send `/new`, `/model`, or `/model provider/model-id`.
- Choose the current-model button in the composer or `Reasoning effort` when the session exposes them.

## Driving it with Playwright

Preconditions: authenticated baseline. Alpha exposes `/review`, Beta exposes `/deploy`; both expose `/summarize` and `/skill:debug`. Model and reasoning controls need a capable session and are not seeded in the baseline.

- **Discover.** Open Alpha; `await page.locator('#prompt').fill('/')`. Set `const menu = page.getByRole('listbox', { name: 'Pi commands' })`; require five options and `#prompt` attribute `aria-expanded="true"`.
- **Touch complete.** `await page.locator('#prompt').fill('/rvw'); await menu.getByRole('option', { name: /\/review/ }).tap()`. Require `#prompt` value `/review ` and the menu hidden. Completion must not emit a prompt command.
- **Arguments.** `await page.locator('#prompt').pressSequentially('src/app.js'); await page.getByRole('button', { name: 'Send message' }).click()`. Require transcript text `/review src/app.js` and a successful command result. This proves transport, not that a code review actually ran.
- **Per-session discovery.** Return to the list, open Beta, fill `/`, require the `/deploy` option visible and `/review` absent. Fill `/does-not-exist`; require `#command-help` to contain `No matching commands`. Fill `Explain /review`; require the menu hidden.
- **Keyboard.** Run `npm run test:browser -- test/browser/slash-commands.spec.mjs --grep 'arrows navigate' --trace on`. In its desktop context, ArrowDown selects `/summarize`, Tab completes it, and Enter runs the selected command. Escape closes suggestions without erasing the draft.
- **Unsupported menu.** Fill `/settings` and click Send. Require `#notice` to contain `only available in the Pi terminal` and the draft to remain `/settings`.
- **New session.** Run `npm run test:browser -- test/browser/slash-commands.spec.mjs --grep '/new creates' --trace on`. It clicks the `/new` option and Send, then requires `Untitled session` in the same project. The spec routes `/ws`; this is not proof of real worker creation. Do not send `/new` to the baseline to create a real worker under its fictional `/projects/...` directory.
- **Model entries.** Run `npm run test:browser -- test/browser/models.spec.mjs --trace on`. Its controlled model list exercises `/model`, direct IDs, `Switch model: first`, the `Search models` field, selection, and `Close model picker`. Require the chosen model on the selected session and no prompt command, while the other session remains unchanged. These are mocked browser-protocol checks; provider selection requires a separate real Pi proof.
- **Reasoning.** Run `npm run test:browser -- test/browser/reasoning.spec.mjs --trace on`. The handle is `page.getByRole('combobox', { name: 'Reasoning effort' })`. Require the acknowledged level, which can differ from the requested level because Pi applies the closest supported setting. Inspect the spec's mocked state before reporting scope.

## Gotchas

- Discovery updates when switching sessions; a late Alpha result must not replace Beta's menu.
- The baseline's generic agent accepts unknown operations without executing their real meaning. Never cite it as model-switch, new-session, or reasoning proof.
- A completed slash suggestion is still an unsent draft.
- Keyboard shortcuts need a desktop context, not merely a wider mobile viewport.
- These recipes do not verify extension dialog answers or command-specific effects such as deployment or review output.
