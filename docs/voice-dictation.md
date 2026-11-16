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

Stop ends microphone capture and waits for final user text. The text goes into the editable draft; Send remains separate. Empty results preserve the draft silently. Assistant speech, assistant text, and tool requests from the voice service are ignored, never played or sent to the chat agent.

## Account and privacy

The Mac needs a current ChatGPT sign-in saved by Codex in `CODEX_HOME/auth.json`, or `~/.codex/auth.json` by default. Pi Remote uses that account, which may differ from Pi's selected account. Expired credentials require a fresh Codex login; keychain-only credentials are not supported. Durable credentials remain on the Mac.

This subscription route uses the separate `gpt-live-1-codex` speech/conversation model, not the selected reasoning model. OpenAI performs recognition in the cloud, not offline on the phone. Pi Remote does not persist recordings or send audio through its host or optional relay. There is no host transcript sideband or file-upload fallback. Claude and API-key-only OpenAI models do not show the microphone.

## Timing and cleanup

This route has no verified immediate transcription-flush command. The browser allows at least 1.8 seconds after Stop for in-flight speech, then uses final user text when no partial remains. Transcript events do not restart that wait. After eight seconds it keeps any unconfirmed text with a review warning; an empty result stays silent. Silent clips can therefore take the full eight seconds. The [direct-browser probes](research/phone-direct-dictation.md) measured complete speech about 2.1–2.3 seconds after Stop, not guaranteed phone performance.

Capture requires HTTPS or localhost, WebRTC, and microphone permission. The browser stops capture after two minutes. Cancel, Escape, session/model changes, leaving the page, and host disconnects stop the microphone and close the browser connection. Late results never overwrite a changed draft. Connection/provider failures preserve recognized text with a warning.

The browser sends `session.close` directly and waits up to one second for acknowledgement before closing its peer. The host cancels pending signaling and expires its local reservation after 150 seconds; it does not open an audio/transcript sideband to force remote closure. Remote retirement cannot be confirmed if the browser disappears or setup is cancelled before a usable data channel exists.

## Verification

Run `npm run test:voice`. It drives the real isolated host and browser UI with synthetic microphone audio and simulated external SDP/WebRTC. It checks direct-channel transcripts, outgoing host-message shapes, absence of transcript traffic before Send, waveform behavior, silent empty results, trailing words, duplicate finals, unconfirmed text, cancellation, error sanitization, SDP bounds, provider isolation, disconnect cleanup, and compatibility during host upgrades.

For real browser-to-OpenAI verification, explicitly run `npm run test:voice -- --live-file /path/to/synthetic-speech.wav`, using a short or long WAV ending with “The orange bicycle is parked beside the library.” This uses the host's existing Codex subscription login, opens two real WebRTC calls, and checks speech plus a silent timeout. It requires the speech draft to finish within six seconds without an unconfirmed-text warning, reports complete Stop-to-draft timing, confirms close acknowledgements, and verifies that no transcript crosses the host command channel and no chat prompt is sent. Include a long recording: short samples alone did not expose the missing-final-event problem described in [turn-completion verification](research/dictation-turn-completion.md). The six-second target currently reproduces that long-recording failure; it is not a claim that it has been fixed.

Physical iPhone/Safari capture and performance still need device verification. OAuth success does not establish unlimited access, zero extra cost, or a stable public API contract.
