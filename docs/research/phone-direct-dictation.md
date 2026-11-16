# Phone-direct subscription dictation

Checked 2026-11-16 UTC. The requested flow is browser microphone → OpenAI using the ChatGPT subscription → editable browser draft → explicit Send of text to the Mac. Audio must not pass through the Mac host. The [file-transcription implementation](dictation-finalization.md) does not meet that transport requirement.

## Result

A direct WebRTC audio and transcript path works with the existing ChatGPT subscription. The Mac can authorize the connection by exchanging SDP without receiving audio or transcripts. In a live browser probe, final user text arrived over the browser's `oai-events` data channel with **no host-side transcript WebSocket**.

Fast finalization remains unresolved. The complete sentence arrived 2.05–2.27 seconds after stopping audio. The usual Realtime commit command was rejected; the subscription service's audio-pause command acknowledged the pause but did not promptly finalize transcription. Silence produced no empty-result event during six seconds of observation.

These findings do not justify switching production back to a delayed realtime flow while claiming the Stop issue is solved. No application behavior was changed in this investigation.

## Browser-direct evidence

[OpenClaw's browser transport](https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/ui/src/pages/chat/talk/webrtc.ts#L122-L155) adds the microphone track and creates `peer.createDataChannel("oai-events")`. Its [event handler](https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/ui/src/pages/chat/talk/webrtc.ts#L298-L320) handles `input_transcript.added` and final user `turn.done` directly in the browser.

The probe used that transport with the already verified [subscription SDP exchange](https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver-wire.ts). Only the SDP offer and answer crossed the authorization boundary. The durable Codex bearer and account header remained in the Node process. The browser received no account credential.

Input was the same trimmed 2.620-second synthetic sentence used in the earlier finalization experiment:

> The orange bicycle is parked beside the library.

| Probe | Offer response | Browser channel ready after request began | Complete user turn after Stop | Other observations |
| --- | --- | --- | --- | --- |
| Stop microphone only | HTTP 201 in 760 ms | 879 ms | 2,267 ms | Last word appeared as a partial at 863 ms |
| Stop + `input_audio_buffer.commit` | HTTP 201 in 918 ms | 1,098 ms | 2,053 ms | Commit rejected in 20 ms with `invalid_value`; completion was still automatic |
| Stop + `input_audio.pause` | HTTP 201 in 925 ms | 1,058 ms | 2,151 ms | `input_audio.paused` at 20 ms; last word at 824 ms |
| Half-second silence, then Stop | HTTP 201 in 797 ms | 921 ms | None within 6 seconds | Only `session.started` observed |

The rejected commit response listed `input_audio.pause`, `input_audio.resume`, and `session.close` among accepted message types. This is live protocol evidence, not a documented promise that pause flushes recognition. The subsequent pause probe showed that an acknowledgement is not final text.

All four sessions acknowledged `session.close` during cleanup. No assistant audio was played and no chat-agent prompt was submitted. The service still produced assistant output events after recognized speech, despite transcription-only instructions. This remains a conversation model, not the dedicated file-transcription model.

Each timing is one observation, not a percentile benchmark. These were Chromium tests with synthetic Web Audio on the development machine, not physical iPhone tests. The transport separates browser media from the Mac host's authorization process; it does not establish actual mobile network or Safari behavior.

### Repeatable probe procedure

1. Generate a synthetic spoken WAV and trim its trailing silence. Keep the expected words out of provider instructions.
2. In Chromium, connect a Web Audio buffer source to a media-stream destination, add its audio track to an `RTCPeerConnection`, and create the `oai-events` data channel before creating the SDP offer.
3. Use the existing Codex ChatGPT login only in the host process to exchange that offer through the subscription call endpoint documented above. Use `gpt-live-1-codex` with the existing Quicksilver session configuration. Give the browser only the SDP answer.
4. Do not open the host-side transcript socket. Wait for the browser data channel to open, then play the synthetic clip. At the source's end, stop the outgoing track and record a monotonic Stop timestamp.
5. Compare no command, `input_audio_buffer.commit`, and `input_audio.pause` in separate calls. Record event types, user transcript text, elapsed time, and public error codes only. Do not retain SDP, tokens, account identifiers, raw audio events, or assistant audio.
6. Observe for six seconds, then send `session.close`, confirm its acknowledgement, close the peer and AudioContext, and stop every media track. Repeat with silence without treating a lack of events as confirmed completion.

## Why the faster file route cannot simply move into this page

A credential-free preflight to the ChatGPT file-transcription endpoint used Pi Remote's opentunnel origin and requested `POST` with `authorization,chatgpt-account-id`. It returned HTTP 400 with **no `Access-Control-Allow-Origin`**. It listed methods and echoed requested headers, but those do not authorize the origin. This blocks the tested direct browser-fetch configuration. It is not proof that every possible subscription integration is impossible.

The known subscription file contract requires the ordinary Codex bearer. No verified short-lived, transcription-scoped credential or signed upload/result URL was found in the sources inspected. Sending that bearer to browser JavaScript, disabling browser origin protection, using `no-cors`, or hiding a Mac audio proxy would not satisfy the requirement.

OpenAI's [WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc) documents a public ephemeral-token flow, but explicitly requires a standard Platform API key to mint the client secret. Its GPT-Live server-mediated SDP example also requires a project API key. Neither establishes ChatGPT subscription entitlement. The [Codex authentication guide](https://developers.openai.com/codex/auth) distinguishes ChatGPT subscription access from API-key usage-based access. No Platform token minting or API-key fallback was attempted.

## Remaining decision and verification gaps

The verified candidate can keep audio and transcript traffic directly between the phone browser and OpenAI, while the Mac performs only authorization and lifecycle control. It cannot yet promise prompt, authoritative text or a confirmed empty result immediately after Stop. Switching to it would require accepting that latency tradeoff or establishing a different finalization contract first.

No supported phone-native ChatGPT-to-third-party-browser text-return integration was established. The attempted Help Center dictation and billing pages returned HTTP 403, so their contents were not used as fresh evidence. A parallel investigation worker had only local-file tools and could not independently research public sources.

Physical iPhone capture, long/noisy/multilingual speech, mobile timing, billing/usage accounting, and a fast subscription-only browser finalization contract remain unverified. No claim of unlimited access, zero additional cost, or a stable public third-party API follows from these successful calls.
