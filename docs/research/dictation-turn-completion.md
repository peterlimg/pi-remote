# Long dictation waits for a missing conversation-turn event

Checked 2026-11-16 UTC. Synthetic speech reproduced the long “Finishing transcription…” wait on the direct browser-to-OpenAI subscription route. The final words arrive promptly, but the final conversation-turn event does not reliably arrive. No reliable fast completion command was established. Production behavior was left unchanged.

## Reproduction

A 26.155-second synthetic recording contained three groups of instructions with two 1.4-second pauses. It ended with “The orange bicycle is parked beside the library.” The expected words were not included in the session instructions.

| Probe | Last words after audio ended | Final user turn |
| --- | --- | --- |
| Current instructions; stop outgoing track | 928 ms | None within 10 seconds |
| Current instructions; leave silent audio flowing | 747 ms | None within 10 seconds |
| Allow a brief acknowledgement; direct protocol probe | 735 ms | Arrived at 2,738 ms with the complete recording |
| Current instructions; actual composer | Not instrumented in this run | Six-second finishing assertion failed |
| Allow a brief acknowledgement; actual composer, first run | Not instrumented in this run | Six-second finishing assertion failed |
| Allow a brief acknowledgement; actual composer, second run | 899 ms | Six-second assertion failed; browser log contained no final event |

The actual composer logs rule out the UI overlooking a final event in the instrumented run. Leaving silence flowing did not fix the original case. The positive acknowledgement probe did not reproduce reliably in the application, so it does **not** establish reply suppression as the cause. The experimental instruction change was reverted rather than deployed.

These are individual observations with synthetic Web Audio in Chromium, not physical-phone benchmarks. Times reported by the event probe are relative to audio ending; the composer check starts immediately before clicking Stop.

## What the events establish

The browser accumulates `input_transcript.added` text but normally waits for a final user `turn.done`. The [Codex event parser](https://github.com/openai/codex/blob/b016cd18472588606c04af565528c4cd6746a41f/codex-rs/codex-api/src/endpoint/realtime_websocket/protocol_frameless_bidi.rs) distinguishes transcript additions from completed conversation turns. Neither that parser nor the inspected events establishes an end-of-recording acknowledgement.

A short-recording inspection found only `id`, `type`, and `text` in `input_transcript.added.item`. There was no completion flag or per-chunk audio timestamp. User turn objects contained `id`, `start_ms`, `end_ms`, `role`, and `transcript`, but the completed object was precisely the event missing in the long-recording failure.

The short probe did emit a final user turn at 1,912 ms after Stop. Short-clip success therefore does not prove that longer recordings reliably finalize.

## Commands and instruction changes checked

- `input_audio_buffer.commit` was rejected by this subscription protocol in the [earlier direct-browser investigation](phone-direct-dictation.md).
- `input_audio.pause` acknowledged the pause but did not promptly finalize recognition in that investigation.
- Sending `session.close` immediately previously cut off trailing words. It is a cleanup operation, not a proven safe transcription flush.
- `response.create` was rejected with `invalid_request_error`: **“response.create requires a session with Responses delegation.”** No delegation mode or billing path was changed to work around this.
- Replacing “Do not answer the user, speak…” with “When they finish speaking, acknowledge briefly” helped one isolated probe but failed twice in the actual composer. It was not retained.

The reason OpenAI keeps the conversation turn open is still unconfirmed. The evidence does not support blaming upload size, retranscribing the whole clip after Stop, a UI parsing bug, or reply-suppression instructions alone.

## Repeatable actual-composer check

Run the existing opt-in live E2E with a long synthetic fixture:

```sh
npm run test:voice -- --live-file /path/to/long.wav
```

The fixture must end with “The orange bicycle is parked beside the library.” It may contain earlier sentences. Generate the following at a natural speaking rate, with a 1.4-second pause between the first and second groups and between the second and third:

> Please note three changes for tomorrow. First, move the planning meeting to ten thirty in the morning and invite the design team. Second, check the blue folder for the revised shipping address before preparing the package. Keep the original receipt inside the envelope. Finally, confirm that the customer has received the updated schedule and remind them to bring their notebook. The orange bicycle is parked beside the library.

The probes used macOS Samantha at 180 words per minute and 24 kHz mono WAV. The live E2E uses real browser WebRTC and an isolated Pi Remote host with a simulated chat-agent bridge. Credentials remain host-side. It requires the speech draft to finish within six seconds without an unconfirmed-text warning. On failure, it prints the last 15 relevant synthetic transcript events and their timing relative to audio ending. The six-second target currently **fails** for this long fixture and preserves a regression signal for a future fix.

Previous verification missed this because the simulated provider emitted final turns by construction and the real-provider sample was only one short sentence. The default suite is still simulated upstream verification, not evidence that OpenAI always finalizes a recording.

The live check also verifies no transcript traffic to the host before Send, no chat-agent prompt, microphone cleanup, direct session-close acknowledgement, and silent timeout handling. Use synthetic audio only; diagnostic output includes its transcript.

## Possible next step, not implemented

The phone already has useful text while the composer is blocked waiting for the final event. Showing that text while finishing, with an explicit choice to accept unconfirmed text, could remove the forced wait without claiming all trailing words have arrived. That is a UX tradeoff, not a fix to OpenAI's completion protocol. Silently shortening the timeout could lose words and was not adopted.

Audio remains direct between browser and OpenAI. No Platform key, other-provider fallback, or host audio upload was used. Physical iPhone behavior, noisy speech, a reliable subscription-only flush contract, and billing/usage effects remain unverified.
