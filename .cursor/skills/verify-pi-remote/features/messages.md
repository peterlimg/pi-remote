# Messages

Users send instructions to the selected session, retain separate drafts while switching sessions, attach images, and stop a running turn.

## Sub-features

- `messages-send`: send through the button and read the acknowledged message.
- `messages-drafts`: keep each session's unsent text separate.
- `messages-keyboard`: desktop Enter sends, Shift+Enter adds a line, Alt+Enter queues a follow-up.
- `messages-images`: preview, remove, and send attached images.
- `messages-abort`: request cancellation of a running turn.

## How to get to it (user POV)

- Select a conversation and type in `Message`; choose `Send message`.
- Switch sessions through the sidebar or `Show sessions`, then return to the draft.
- Use keyboard shortcuts in a desktop browser with a fine pointer.
- Choose `Attach images` in the composer, or `Abort turn` while the agent works.

## Driving it with Playwright

Preconditions: authenticated fresh fixture. Subscribe to browser WebSocket frames before navigating if command delivery is part of the proof. The Playwright trace also records network traffic.

- **Draft Alpha.** Open Project Alpha and `await page.locator('#prompt').fill('draft for alpha')`. Return using `Show sessions`, then open Project Beta. Require `#prompt` empty.
- **Send Beta.** `await page.locator('#prompt').fill('instruction for beta'); await page.getByRole('button', { name: 'Send message' }).click()`. Require `#transcript` to contain `instruction for beta` and `#prompt` empty. Reselect Beta after visiting Alpha to verify the host snapshot still contains the message.
- **Isolation.** Return to Alpha; require `await expect(page.locator('#prompt')).toHaveValue('draft for alpha')` and its transcript not to contain `instruction for beta`. Capture both views. Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'mobile navigation' --trace on` for this existing path.
- **Desktop keys.** Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'desktop Enter' --trace on`. It creates a non-touch desktop context, types `first line`, presses `Shift+Enter` and then `Enter`, and verifies a prompt command. `Alt+Enter` must emit `followUp`, not `prompt`.
- **Images.** For the existing bounded UI proof, run `npm run test:browser -- test/browser/images.spec.mjs --grep 'image picker previews' --trace on`. The user handles are `page.getByLabel('Attach images', { exact: true }).setInputFiles(...)` and `page.getByRole('button', { name: 'Remove image.png' })`. Use the spec's actual in-memory PNG, and require a decoded preview, preserved draft on rejection, and clearing only on acceptance. It mocks `/ws`; it does not prove a real agent received image bytes.
- **Abort.** On a fresh working Alpha with an empty composer, `await page.getByRole('button', { name: 'Abort turn' }).click()`. The fixture appends `aborted` and returns idle; require `#transcript` to contain that text and `#abort` hidden. Capture the outbound `abort` command. This proves command transport, not cancellation of model work.

## Gotchas

- An empty composer is an optimistic capture of the draft, not confirmation of delivery. Require the returned message and successful result, then read the conversation again.
- The simulated agents do not save sent messages to a Pi JSONL file. Do not claim persistence across host restart.
- The image fixture tests size/type limits and acknowledgement behavior. The baseline agent does not faithfully handle image payloads; do not use its generic success as upload proof.
- Abort does not promise queued messages are cancelled. A real cancellation proof needs an isolated live Pi agent.
- Only desktop fine-pointer contexts use Enter-to-send; mobile Enter adds a line.
