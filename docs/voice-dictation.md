# ChatGPT dictation

Select a live model under the `openai-codex` provider, then tap the microphone beside Send. While recording, the keyboard closes and the composer becomes a compact Cancel, waveform, and Stop bar. The waveform grows from the right and scrolls continuously. Its bars follow microphone volume on a decibel scale, with a short smoothing envelope for quiet speech and syllables. It shows volume, not transcription progress. Tap Stop to return to the editable draft; Send remains a separate action.

The computer must have a current ChatGPT sign-in saved by Codex in `CODEX_HOME/auth.json`, or `~/.codex/auth.json` by default. Pi Remote uses that account for speech, which may differ from the account signed into Pi. It never falls back to a Platform API key. If the saved token has expired, sign in to Codex again. Keychain-only Codex credentials are not supported by this adapter.

Audio streams directly from the browser to OpenAI over WebRTC. The host retains the OAuth credential and brokers the connection and transcript over Pi Remote's authenticated command channel. This uses the `gpt-live-1-codex` speech route, not the selected reasoning model. Assistant replies and tool requests from that route are ignored and never run as agent commands. The underlying service can still generate reply audio; Pi Remote does not play it.

Recording requires HTTPS or localhost, microphone permission, and a browser with WebRTC. It stops after two minutes. Cancel, Escape, changing sessions/models, leaving the page, or losing the host connection stops capture. Cancellation discards the pending insertion and preserves the original draft. A provider interruption retains recognized text when the original draft is still selected and unchanged. Stop allows 1.8 seconds for audio already in flight, then returns confirmed text without another quiet-period wait. It waits up to eight seconds if the final transcript is still missing; unconfirmed text is marked for review.

Claude and API-key-only OpenAI models do not show this control. No local speech engine, paid fallback, wake word, automatic Send, or spoken assistant reply is included.

## Verification

Run `npm run test:voice`. It starts an isolated real host and drives the mobile browser UI with simulated provider HTTP/WebSocket responses and simulated WebRTC signaling. A synthetic Web Audio stream stands in for the microphone. It covers the recording layout, waveform response to sound and silence, audio cleanup, draft insertion and explicit Send, cancellation, draft/session isolation, startup cancellation, safe errors, partial transcript recovery, server-side provider validation, and disconnect cleanup. The test prints its retained trace/screenshot directory. It does not use credentials or make paid provider calls.

For a physical phone check, select an `openai-codex` session, dictate a short phrase, stop, edit the text and send it. Repeat with Cancel and a session switch, and confirm Safari's microphone indicator turns off. Verify the app never speaks the provider's reply. Browser automation is not proof of iPhone hardware behavior.

The service is an internal subscription integration and can change. A successful subscription login is not proof of unlimited access or zero extra cost; account quota/billing remain provider-controlled. See the [live subscription probe](research/subscription-voice-verification.md) for the original evidence and limits.
