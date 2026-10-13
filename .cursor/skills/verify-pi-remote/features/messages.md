# Messages

Users send instructions to the selected session, retain separate drafts while switching sessions, attach images or original video files, and stop a running turn.

## Sub-features

- `messages-send`: send through the button and read the acknowledged message.
- `messages-drafts`: keep each session's unsent text separate.
- `messages-keyboard`: desktop Enter sends, Shift+Enter adds a line, Alt+Enter queues a follow-up.
- `messages-images`: preview, remove, and send attached images.
- `messages-videos`: preview, remove, and upload original videos for the agent to inspect as local files.
- `messages-abort`: request cancellation of a running turn.

## How to get to it (user POV)

- Select a conversation and type in `Message`; choose `Send message`.
- Switch sessions through the sidebar or `Show sessions`, then return to the draft.
- Use keyboard shortcuts in a desktop browser with a fine pointer.
- Choose `Attach images and videos` in the composer, or `Abort turn` while the agent works.

## Driving it with Playwright

Preconditions: authenticated fresh fixture. Subscribe to browser WebSocket frames before navigating if command delivery is part of the proof. The Playwright trace also records network traffic.

- **Draft Alpha.** Open Project Alpha and `await page.locator('#prompt').fill('draft for alpha')`. Return using `Show sessions`, then open Project Beta. Require `#prompt` empty.
- **Send Beta.** `await page.locator('#prompt').fill('instruction for beta'); await page.getByRole('button', { name: 'Send message' }).click()`. Require `#transcript` to contain `instruction for beta` and `#prompt` empty. Reselect Beta after visiting Alpha to verify the host snapshot still contains the message.
- **Isolation.** Return to Alpha; require `await expect(page.locator('#prompt')).toHaveValue('draft for alpha')` and its transcript not to contain `instruction for beta`. Capture both views. Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'mobile navigation' --trace on` for this existing path.
- **Desktop keys.** Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'desktop Enter' --trace on`. It creates a non-touch desktop context, types `first line`, presses `Shift+Enter` and then `Enter`, and verifies a prompt command. `Alt+Enter` must emit `followUp`, not `prompt`.
- **Images.** For the existing bounded UI proof, run `npm run test:browser -- test/browser/images.spec.mjs --grep 'image picker previews' --trace on`. The user handles are `page.getByLabel('Attach images and videos', { exact: true }).setInputFiles(...)` and `page.getByRole('button', { name: 'Remove image.png' })`. Use the spec's actual in-memory PNG, and require a decoded preview, preserved draft on rejection, and clearing only on acceptance. It mocks `/ws`; it does not prove a real agent received image bytes.
- **Videos.** Run `npm run test:browser -- test/browser/videos.spec.mjs --trace on`. The first test uses the real host and simulated bridge: select the WebM fixture, check the decoded preview, remove it, reattach, switch sessions, send, and reload. It compares the stored bytes with the original, checks that the conversation hides the path, reloads, and plays the video from its thumbnail. It also checks that leaving the conversation releases the playback data. This thumbnail check requires `ffmpeg` on PATH. The second test mocks `/ws` for interrupted uploads, rejected commands, mixed image/video messages, and retry behavior. Capture `video-draft.png`, `video-sent.png`, the conversation snapshot and trace from the test output.
- **Abort.** On a fresh working Alpha with an empty composer, `await page.getByRole('button', { name: 'Abort turn' }).click()`. The fixture appends `aborted` and returns idle; require `#transcript` to contain that text and `#abort` hidden. Capture the outbound `abort` command. This proves command transport, not cancellation of model work.

## Gotchas

- An empty composer is an optimistic capture of the draft, not confirmation of delivery. Require the returned message and successful result, then read the conversation again.
- The simulated agents do not save sent messages to a Pi JSONL file. Do not claim persistence across host restart.
- The image fixture tests size/type limits and acknowledgement behavior. The baseline agent does not faithfully handle image payloads; do not use its generic success as upload proof.
- Abort does not promise queued messages are cancelled. A real cancellation proof needs an isolated live Pi agent.
- Videos are limited to 200 MB each, with four total attachments. Images retain their 2 MB combined limit. Videos travel in bounded chunks over the authenticated socket, including through the encrypted relay. The agent receives local file paths, not inline video content. The conversation turns those attachment footers into previews, including older uploads. Thumbnails use `ffmpeg` when installed; without it the play button still works. Playback downloads the original in chunks on tap, over the same authenticated and encrypted connection. Videos that the browser cannot decode offer an original-file download. Video uploads show a large progress ring that fills as the computer acknowledges each chunk, without visible percentage text. Screen readers receive the progress value.
- Unsent video drafts are deleted on removal or socket closure. Sent videos remain in the host data directory's `videos/` folder so conversation paths survive restarts. They consume disk space until manually removed; a host crash can also leave unfinished uploads there.
- Only desktop fine-pointer contexts use Enter-to-send; mobile Enter adds a line.
