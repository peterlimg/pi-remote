# ChatGPT dictation

Select a live `openai-codex` model, then tap the microphone beside Send. Recording starts locally without opening a realtime conversation. The keyboard closes and the composer becomes a Cancel, waveform, and Stop bar. The waveform grows from the right, scrolls continuously, and follows microphone volume, not transcription progress.

Stop ends the recording and submits the complete clip for transcription. The returned text goes into the editable draft; Send remains separate. Empty results leave the draft unchanged without a warning. There is no fixed silence-drain delay, but upload and provider processing still take time.

## Account and transport

The computer needs a current ChatGPT sign-in saved by Codex in `CODEX_HOME/auth.json`, or `~/.codex/auth.json` by default. Pi Remote uses that account, which may differ from Pi's selected account. Expired credentials require a fresh Codex login; keychain-only credentials are not supported.

The browser records WebM/Opus or MP4 audio in memory. On Stop it sends the clip through Pi Remote's authenticated command channel to the host, which submits it to ChatGPT's subscription `/backend-api/transcribe` endpoint. Remote relay connections retain the existing sealed transport. Audio is not saved to disk by Pi Remote, and durable credentials never enter browser JavaScript.

This is the dedicated dictation route found in OpenAI's historical Codex source, not a request to the selected reasoning model. It never falls back to a Platform API key, another provider, or local speech recognition. Claude and API-key-only OpenAI models do not show the microphone. No realtime assistant response is generated or played.

## Limits and cancellation

Recording requires HTTPS or localhost, microphone permission, and MediaRecorder support for WebM or MP4. Clips are limited to two minutes and 2 MiB. The host limits transcription requests to 20 seconds; the browser also bounds the finishing phase.

Cancel, Escape, session/model changes, leaving the page, and disconnects stop recording or cancel a pending upload. Late results never overwrite a changed draft. Provider and microphone errors remain visible; an empty transcript is not an error.

## Verification

Run `npm run test:voice`. The isolated host/browser test uses real MediaRecorder encoding and synthetic microphone audio, with only the external transcription HTTP request simulated. It covers waveform motion, quiet audio and silence, recording cleanup, prompt-safe cancellation, full-clip upload, draft insertion, explicit Send, silent empty results, provider errors, invalid/oversized uploads, session/model isolation, disconnect cleanup, and compatibility during host upgrades.

To explicitly test the real subscription with a synthetic WAV speaking “The orange bicycle is parked beside the library.”, run `npm run test:voice -- --live-file /path/to/synthetic-speech.wav`. This uses the host's existing Codex login and makes two real transcription requests, one for speech and one for silence. It reports complete Stop-to-draft timing, not only the time after a provider event. No prompt is sent to the chat agent.

Physical iPhone recording and performance still need device verification. A successful OAuth request does not establish unlimited access, zero extra cost, or a stable public API contract. See [dictation finalization verification](research/dictation-finalization.md).
