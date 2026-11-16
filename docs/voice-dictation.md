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

Stop ends microphone capture and immediately shows the text received so far. This preview is read-only while trailing words arrive. Tap **Use text** to stop waiting and unlock editing; accepting early can miss the last words. Send stays disabled until you accept or final text arrives, and never runs automatically. Cancel discards the preview and restores your original draft. Empty results preserve the draft silently. Assistant speech, assistant text, and tool requests from the voice service are ignored, never played or sent to the chat agent.

## Account and privacy

The Mac needs a current ChatGPT sign-in saved by Codex in `CODEX_HOME/auth.json`, or `~/.codex/auth.json` by default. Pi Remote uses that account, which may differ from Pi's selected account. Expired credentials require a fresh Codex login; keychain-only credentials are not supported. Durable credentials remain on the Mac.

This subscription route uses the separate `gpt-live-1-codex` speech/conversation model, not the selected reasoning model. OpenAI performs recognition in the cloud, not offline on the phone. Pi Remote does not persist recordings or send audio through its host or optional relay. There is no host transcript sideband or file-upload fallback. Claude and API-key-only OpenAI models do not show the microphone.

## Timing and cleanup

This route has no verified immediate transcription-flush command. While showing the preview, the browser allows at least 1.8 seconds after Stop for in-flight speech, then unlocks the draft automatically when final user text arrives and no partial remains. Transcript events do not restart that wait. Use text bypasses the wait explicitly, not by treating partial text as confirmed. After eight seconds the connection closes; unconfirmed text remains in the preview with a warning and still requires Use text. An empty result restores the original draft silently. Silent clips can therefore take the full eight seconds unless cancelled or the existing draft is accepted. The [direct-browser probes](research/phone-direct-dictation.md) measured complete speech about 2.1–2.3 seconds after Stop, not guaranteed phone performance.

Capture requires HTTPS or localhost, WebRTC, and microphone permission. The browser stops capture after two minutes. Cancel, Escape, session/model changes, leaving the page, and host disconnects stop the microphone and close the browser connection. Accepting freezes the preview so later results cannot overwrite your edits. Previews are not saved as session drafts until accepted or finalized. Connection/provider failures preserve recognized text for explicit acceptance with a warning.

The browser sends `session.close` directly and waits up to one second for acknowledgement before closing its peer. The host cancels pending signaling and expires its local reservation after 150 seconds; it does not open an audio/transcript sideband to force remote closure. Remote retirement cannot be confirmed if the browser disappears or setup is cancelled before a usable data channel exists.

## Verification

Run `npm run test:voice`. It drives the real isolated host and browser UI with synthetic microphone audio and simulated external SDP/WebRTC. It checks direct-channel transcripts, outgoing host-message shapes, absence of transcript traffic before Send, waveform behavior, immediate previews, trailing words, explicit acceptance before editing or sending unconfirmed text, late-result isolation, silent empty results, cancellation restoring the original draft, session/model isolation, public errors, SDP bounds, disconnect cleanup, and compatibility during host upgrades. Preview screenshots cover 320px and 390px phones and a desktop viewport.

For real browser-to-OpenAI verification, explicitly run `npm run test:voice -- --live-file /path/to/synthetic-speech.wav`, using a short or long WAV ending with “The orange bicycle is parked beside the library.” This uses the host's existing Codex subscription login, opens two real WebRTC calls, and checks speech plus a silent timeout. It checks that the preview appears immediately and the expected final words arrive within six seconds, then taps Use text if final confirmation is still pending. It reports preview, complete-text, and editable-draft timings separately, records whether acceptance was needed, confirms close acknowledgements, and verifies that no transcript crosses the host command channel and no chat prompt is sent. Include a long recording: short samples alone did not expose the missing-final-event problem described in [turn-completion verification](research/dictation-turn-completion.md). This verifies the explicit-acceptance path, not a fix for OpenAI's missing final-turn event.

Physical iPhone/Safari capture and performance still need device verification. OAuth success does not establish unlimited access, zero extra cost, or a stable public API contract.
