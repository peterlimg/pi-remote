# Messages

Users send instructions to the selected session, retain separate drafts while switching sessions, attach images or original video files, and stop a running turn.

## Sub-features

- `messages-send`: send through the button and read the acknowledged message.
- `messages-mid-turn`: show submissions immediately and forward ordinary prompts while Pi works.
- `messages-drafts`: keep each session's unsent text separate.
- `messages-keyboard`: desktop Enter and Alt+Enter send, Shift+Enter adds a line.
- `messages-images`: preview, remove, and send attached images.
- `messages-videos`: preview, remove, and upload original videos for the agent to inspect as local files.
- `messages-abort`: request cancellation of a running turn.
- `messages-compaction`: explain when Pi is summarizing earlier messages and new messages must wait.

## How to get to it (user POV)

- Select a conversation and type in `Message`; choose `Send message`, including while Pi works. The browser forwards a normal prompt without choosing a queue or steering mode.
- Switch sessions through the sidebar or `Show sessions`, then return to the draft.
- Use keyboard shortcuts in a desktop browser with a fine pointer.
- Choose `Attach images and videos` in the composer, or `Abort turn` while the agent works.

## Driving it with Playwright

Preconditions: authenticated fresh fixture. Subscribe to browser WebSocket frames before navigating if command delivery is part of the proof. The Playwright trace also records network traffic.

- **Draft Alpha.** Open Project Alpha and `await page.locator('#prompt').fill('draft for alpha')`. Return using `Show sessions`, then open Project Beta. Require `#prompt` empty.
- **Send Beta.** `await page.locator('#prompt').fill('instruction for beta'); await page.getByRole('button', { name: 'Send message' }).click()`. Require `#transcript` to contain `instruction for beta` and `#prompt` empty. Reselect Beta after visiting Alpha to verify the host snapshot still contains the message.
- **Isolation.** Return to Alpha; require `await expect(page.locator('#prompt')).toHaveValue('draft for alpha')` and its transcript not to contain `instruction for beta`. Capture both views. Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'mobile navigation' --trace on` for this existing path.
- **Mid-turn messages.** Run `npm run test:browser -- test/browser/mid-turn-messages.spec.mjs --trace on`. It withholds acknowledgement and conversation echoes separately, checks immediate text bubbles and ordinary prompt dispatch without queue/steer controls, switches sessions, then reconciles repeated identical messages without duplicates. It also checks rejected-message draft recovery, slash-command exclusion, idle sends, and mid-turn `Alt+Enter`. These checks mock `/ws`; they prove the browser contract, not when a real model consumes a prompt.
- **Desktop keys.** Run `npm run test:browser -- test/browser/mobile.spec.mjs --grep 'desktop Enter' --trace on`. It creates a non-touch desktop context, types `first line`, presses `Shift+Enter` and then `Enter`, and verifies a prompt command. `Alt+Enter` also emits `prompt`; it does not force a follow-up queue.
- **Images.** For the existing bounded UI proof, run `npm run test:browser -- test/browser/images.spec.mjs --grep 'image picker previews' --trace on`. The user handles are `page.getByLabel('Attach images and videos', { exact: true }).setInputFiles(...)` and `page.getByRole('button', { name: 'Remove image.png' })`. Use the spec's actual in-memory PNG, and require a decoded preview, preserved draft on rejection, and clearing only on acceptance. It mocks `/ws`; it does not prove a real agent received image bytes.
- **iPhone picker.** Start a new session, choose a project, wait for the composer, and tap `+` while the keyboard is open. Require the native picker on that first tap, without a keyboard-dismissal notice or a second tap. The composer temporarily moves up to reserve space for the native menu below it, with no overlap. The `+` target stays at the original touch; cancelling or choosing a file restores the composer and draft height. Repeat with a multiline draft, after cancelling, and with the keyboard closed. `npm run test:browser -- test/browser/images.spec.mjs --grep 'first tap' --trace on` checks the original tap coordinates, reserved space, draft preservation, and cancellation against a simulated keyboard viewport. It does not render UIKit's native menu; verify its bounds separately in an iOS simulator or on an iPhone.
- **Videos.** Run `npm run test:browser -- test/browser/videos.spec.mjs --trace on`. The first test uses the real host and simulated bridge: select the WebM fixture, check the decoded preview, remove it, reattach, switch sessions, send, and reload. It compares the stored bytes with the original, checks that the conversation hides the path, reloads, and plays the video from its thumbnail. It also checks that leaving the conversation releases player URLs. The generated-video test verifies replay after reloads and chat switches without another video-byte transfer, original-byte downloads from the cache, same-sized file revision invalidation, sign-out cleanup, and rejection of a removed source even when cached. Separate cases simulate blocked or full browser storage and require successful uncached playback. These thumbnail checks require `ffmpeg` on PATH. Other cases mock `/ws` for native saving, interrupted uploads, rejected commands, mixed image/video messages, and retry behavior. Capture `video-draft.png`, `video-sent.png`, the conversation snapshot and trace from the test output.
- **Compaction.** Run `npm run test:browser -- test/browser/compaction.spec.mjs --trace on`. It sends compaction events from a simulated Pi RPC child through the real host and browser socket. Require `Compacting conversation…`, the explanation that new messages wait, and a visible abort control. Reload during compaction, then check that the notice clears on retry, cancellation, and failure. It captures narrow-phone and desktop views; no live model summarization is invoked.
- **Abort.** On a fresh working Alpha with an empty composer, `await page.getByRole('button', { name: 'Abort turn' }).click()`. The fixture appends `aborted` and returns idle; require `#transcript` to contain that text and `#abort` hidden. Capture the outbound `abort` command. This proves command transport, not cancellation of model work.

## Gotchas

- An empty composer is an optimistic capture of the draft, not confirmation of delivery. `Sending…` means acknowledgement is pending and disappears after the host accepts the message. The bubble stays visible until the conversation echo replaces it, without implying a queue or steering decision. Require the returned message and successful result, then read the conversation again. Pending bubbles belong to this open tab and do not survive a page reload.
- The simulated agents do not save sent messages to a Pi JSONL file. Do not claim persistence across host restart.
- The image fixture tests size/type limits and acknowledgement behavior. The baseline agent does not faithfully handle image payloads; do not use its generic success as upload proof.
- Abort does not promise queued messages are cancelled. A real cancellation proof needs an isolated live Pi agent.
- Videos are limited to 200 MB each, with four total attachments. Images retain their 2 MB combined limit. Videos travel in bounded chunks over the authenticated socket, including through the encrypted relay. The agent receives local file paths, not inline video content. The conversation turns those attachment footers into previews, including older uploads. Thumbnails use `ffmpeg` when installed; the completed upload returns the same JPEG thumbnail for the composer, so Safari need not decode the local video to show it. Without `ffmpeg` the play button still works. Playback downloads the original in chunks on tap, over the same authenticated and encrypted connection. Videos that the browser cannot decode offer an original-file download. Video uploads show a large progress ring that fills as the computer acknowledges each chunk, without visible percentage text. Screen readers receive the progress value.
- Unsent video drafts are deleted on removal or socket closure. Sent videos remain in the host data directory's `videos/` folder so conversation paths survive restarts. They consume disk space until manually removed; a host crash can also leave unfinished uploads there.
- Only desktop fine-pointer contexts use Enter-to-send; mobile Enter adds a line.
