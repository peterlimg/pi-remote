# ChatGPT dictation

Select a live `openai-codex` model, then tap the microphone beside Send. Once connected, the phone streams microphone audio directly to OpenAI over WebRTC. Transcripts return directly to the phone's data channel. The Mac exchanges connection metadata using its Codex login; it does not upload audio or receive transcripts before Send.

```text
Phone ── connection offer ──→ Mac ── subscription authorization ──→ OpenAI
Phone ←──────────────────── connection answer ────────────────────────┘
Phone ═════════════════════ audio directly ═════════════════════→ OpenAI
Phone ←═══════════════════ transcript directly ═══════════════════════┘
Phone draft ── user taps Send ──→ Mac chat session
```

The keyboard closes while recording, and the composer becomes a Cancel, waveform, and Stop bar. The waveform grows from the right, scrolls continuously, and follows microphone volume, not transcription progress.

Stop ends microphone capture and immediately opens an editable draft with the text received so far. Trailing words keep arriving until you start editing or tap Send; either action freezes incoming updates. There is no extra confirmation button, and sending never happens automatically. Editing or sending early can miss the last words. Before you edit or send, Cancel discards the transcription and restores your original draft. Empty results preserve the draft silently. Assistant speech, assistant text, and tool requests from the voice service are ignored, never played or sent to the chat agent.

## Account and privacy

The Mac needs a current ChatGPT sign-in saved by Codex in `CODEX_HOME/auth.json`, or `~/.codex/auth.json` by default. Pi Remote uses that account, which may differ from Pi's selected account. Expired credentials require a fresh Codex login; keychain-only credentials are not supported. Durable credentials remain on the Mac.

This subscription route uses the separate `gpt-live-1-codex` speech/conversation model, not the selected reasoning model. OpenAI performs recognition in the cloud, not offline on the phone. Pi Remote does not persist recordings or send audio through its host or optional relay. There is no host transcript sideband or file-upload fallback. Claude and API-key-only OpenAI models do not show the microphone.

## Timing and cleanup

This route has no verified immediate transcription-flush command. The draft is editable and Send is available immediately after Stop. If you leave it untouched, the browser allows at least 1.8 seconds for in-flight speech, then ends updates when final user text arrives and no partial remains. Transcript events do not restart that wait. After eight seconds the connection closes; unconfirmed text remains editable with a warning. An empty result restores the original draft silently. Neither final confirmation nor this timeout blocks editing or Send. The [direct-browser probes](research/phone-direct-dictation.md) measured complete speech about 2.1–2.3 seconds after Stop, not guaranteed phone performance.

Capture requires HTTPS or localhost, WebRTC, and microphone permission. The browser stops capture after two minutes. Cancel, Escape, session/model changes, leaving the page, and host disconnects stop the microphone and close the browser connection. Editing, including the start of text composition, freezes incoming updates before they can overwrite your changes. Send freezes updates before clearing the composer, so late results cannot refill it or change your next draft. Untouched previews are not saved as session drafts until finalized; editing saves them locally. Connection/provider failures preserve recognized text with a warning.

The browser sends `session.close` directly and waits up to one second for acknowledgement before closing its peer. The host cancels pending signaling and expires its local reservation after 150 seconds; it does not open an audio/transcript sideband to force remote closure. Remote retirement cannot be confirmed if the browser disappears or setup is cancelled before a usable data channel exists.

## Verification

Run `npm run test:voice`. It drives the real isolated host and browser UI with synthetic microphone audio and simulated external SDP/WebRTC. It checks direct-channel transcripts, outgoing host-message shapes, absence of transcript traffic before Send, waveform behavior, immediately editable drafts, trailing words, freezing on edits and text composition, Send without a confirmation step, late-result isolation, silent empty results, cancellation restoring the original draft, session/model isolation, public errors, SDP bounds, disconnect cleanup, and compatibility during host upgrades. Preview screenshots cover 320px and 390px phones and a desktop viewport.

For real browser-to-OpenAI verification, explicitly run `npm run test:voice -- --live-file /path/to/synthetic-speech.wav`, using a short or long WAV ending with “The orange bicycle is parked beside the library.” This uses the host's existing Codex subscription login, opens two real WebRTC calls, and checks speech plus a silent timeout. It checks that the draft is editable immediately and the expected final words arrive within six seconds, then edits the draft to freeze incoming updates. It reports editable-draft and complete-text timings separately, records whether editing happened before confirmation, confirms close acknowledgements, and verifies that no transcript crosses the host command channel and no chat prompt is sent. Include a long recording: short samples alone did not expose the missing-final-event problem described in [turn-completion verification](research/dictation-turn-completion.md). This verifies editing without waiting for confirmation, not a fix for OpenAI's missing final-turn event.

Physical iPhone/Safari capture and performance still need device verification. OAuth success does not establish unlimited access, zero extra cost, or a stable public API contract.
