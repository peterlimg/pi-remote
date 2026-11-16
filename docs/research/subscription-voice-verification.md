# Subscription voice verification

**Follow-up, 2026-11-16:** [Dedicated ChatGPT dictation verification](dictation-finalization.md) found and tested a separate subscription file-transcription endpoint. It replaces the realtime route below for Pi Remote dictation. The Platform-endpoint failure here does not apply to that ChatGPT endpoint.

Checked 2026-11-15 UTC. This follows the [OpenClaw source investigation](openclaw-voice.md). The user authorized testing subscription-backed transcription for the selected chat provider. No composer feature was implemented.

## Result

**ChatGPT/Codex subscription voice returned a correct transcript through OpenClaw's WebRTC route. Claude browser-recording input remains unverified and blocked by the missing integration contract.**

This verifies a provider-specific speech model, `gpt-live-1-codex`, not audio input to whichever reasoning model is selected in Pi Remote. It does not prove a unified interface can use both subscriptions today.

| Probe | Observed result | What it establishes |
| --- | --- | --- |
| OpenAI file transcription, using Codex ChatGPT OAuth | HTTP 429, `insufficient_quota`, `credit_balance_exhausted` | This account did not get a transcript through the Platform file endpoint. OAuth selection in OpenClaw alone was not sufficient. |
| Official Codex 0.146.0 app-server, default realtime WebSocket route | `thread/realtime/error`: `realtime conversation requires API key auth` | That default route rejected subscription auth before audio submission. It does not rule out the separate WebRTC route. |
| OpenClaw subscription WebRTC handshake | HTTP 201 and accepted SDP answer | The subscription call endpoint accepted this account and configuration. No audio was sent in this first handshake probe. |
| OpenClaw subscription WebRTC with synthetic speech | HTTP 201, audio sent, user `turn.done` transcript returned | Successful live speech-to-text using the subscription OAuth credential, without an API-key fallback. |
| Claude Code 2.1.325 | Signed in with `claude.ai`; CLI interface and current docs inspected | The documented dictation feature requires local microphone capture. No supported recorded-file input was found or tested. |

## ChatGPT live proof

The synthetic input was generated locally with the installed macOS `say` voice Samantha and converted with installed ffmpeg to mono PCM WAV at 24 kHz. The expected text was not included in the service instructions.

Spoken fixture:

> The purple notebook contains forty two pages. Put it beside the green lamp.

Final user transcript:

> The purple notebook contains forty-two pages; put it beside the green lamp

The probe also received incremental `input_transcript.added` events. A key-phrase check for `purple notebook` and `green lamp` passed. The final transcript preserved both sentences and the number; punctuation changed. One synthetic English clip is not an accuracy benchmark.

The call and fixed observation interval took 15.7 seconds. That includes a deliberate 14-second wait after playback began and is **not** measured transcription latency.

### Request and transport

The probe followed the pinned OpenClaw [session builder and wire implementation][wire]:

- Credential source: existing Codex ChatGPT OAuth, read only on the host. No Platform API key was selected, and no alternate account/key fallback was used.
- Request destination: the [ChatGPT Codex realtime call endpoint](https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas).
- JSON request: `sdp` plus `session`, with model `gpt-live-1-codex`, voice `cove`, and client-owned delegation with `ack_filler: false`.
- Instructions asked for faithful transcription, no answers, and no tool execution. No agent consultation handler was connected.
- Auth headers included the bearer, ChatGPT account ID, `OpenAI-Alpha: quicksilver=v2`, and fresh random session/thread IDs.
- Chromium generated a real audio-only WebRTC offer. A Web Audio buffer source fed the synthetic WAV into a `MediaStreamDestination` track. No microphone permission or physical microphone capture was used.
- A host-owned sideband connected to OpenAI's `/v1/live/{callId}` WebSocket and collected transcript events. OAuth credentials never went into browser JavaScript.
- The probe closed the peer/audio context/browser, sent `session.close` on the sideband, and closed the socket. Server acknowledgement of final session retirement was not separately asserted.

Observed event types included `session.started`, `input_transcript.added`, `turn.created`, `turn.delta`, `turn.done`, and output audio/transcript events. This is a realtime voice conversation transport that exposes transcription, not a demonstrated transcription-only API. Output audio was not played to the host speakers. A production dictation adapter must handle or suppress unwanted response generation rather than relying only on instructions. [Event parser][events]

### File-transcription counterexample

A separate 173,414-byte synthetic WAV was posted as multipart `file` with model `gpt-4o-transcribe` to the [Platform transcription endpoint](https://api.openai.com/v1/audio/transcriptions), using the same Codex credential class. The response arrived in 783 ms:

```json
{
  "status": 429,
  "type": "insufficient_quota",
  "code": "credit_balance_exhausted"
}
```

The service message said no API credits remained and directed the account to Platform billing. No credits were added and no API-key retry was attempted. This is an account-specific negative result, not proof that all OAuth accounts fail there.

### Official Codex probe

The `codex` Node launcher failed because it expected the missing `codex-darwin-arm64` optional dependency. The already-installed x64 native executable ran successfully as version 0.146.0 and reported ChatGPT authentication. No installation was changed.

The official app-server was started with a temporary `CODEX_HOME`, a mode-0600 copy of the existing Codex auth file, no inherited API-key/auth-token environment variables, and an empty temporary working directory. Initialization enabled experimental methods. A thread was ephemeral, read-only, and denied approval requests. No agent turn was submitted.

The probe called `thread/realtime/start` with text output, WebSocket transport, no startup context, client-managed handoffs, and transcript-tail forwarding disabled. The default route emitted the API-key-required error before audio was sent. The server was stopped and the temporary auth copy removed. Installed generated schemas, not an assumed older protocol, defined the request shape. Current upstream [realtime types][codex-realtime] still label these methods experimental.

## Claude boundary

`claude auth status` confirmed a Claude.ai sign-in. No Claude token was extracted, copied, or sent to a private endpoint.

The current [voice dictation documentation][claude-voice] says:

- Audio is streamed to Anthropic for transcription and is not processed locally.
- A Claude.ai sign-in and a local microphone are required. SSH and cloud sessions are not supported.
- The CLI's `/voice` command and VS Code microphone UI own capture.
- Dictation does not consume Claude messages/tokens or count toward `/usage` limits.

The installed CLI help exposes text and stream-JSON input, but no audio-file transcription option. The project's installed `@anthropic-ai/sdk` 0.129.0 `ContentBlockParam` union in `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` has no audio-input block. This is evidence about the inspected interfaces, not a claim that Anthropic has no speech service internally.

Consequently, there was no supported file-input contract for a meaningful Claude live transcription probe. Feeding WAV bytes as text, inventing an unsupported content type, or letting an agent call another recognizer would not verify the requested behavior. Native microphone dictation itself was not exercised.

Anthropic's [credential-use rules][claude-legal] also distinguish running the unmodified, user-authenticated Claude Code binary from a third-party application collecting or intermediating subscription tokens. This pass did not reverse-engineer or call its private speech service.

## Implications for implementation

A consistent recording UI is feasible, but both provider adapters are not verified:

- **ChatGPT provider:** a short live transcription proof succeeded. An implementation still needs cancellable browser capture, bounded sessions, final-transcript draining, prevention of stale draft insertion, and deliberate handling of generated replies. The upstream route is an internal integration and may change.
- **Claude provider:** keep unsupported rather than silently using ChatGPT, local Whisper, or a paid API. A supported way to supply browser audio to Claude's subscription dictation must be found before claiming parity.
- **Exact selected model:** neither provider's native speech service should be described as the currently selected reasoning model. Routing by provider and routing audio to an exact model are different requirements.

No billing dashboard or post-request usage ledger was checked. Successful OAuth service acceptance and no API-key fallback do not prove zero cost or unlimited entitlement. No physical-phone recording, Safari transport, noise/language comparison, or sustained session was tested. Temporary synthetic recordings and the isolated auth copy were removed; no secrets or audio fixtures were committed.

## Sources

[wire]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver-wire.ts
[events]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver-events.ts
[codex-realtime]: https://github.com/openai/codex/blob/b016cd18472588606c04af565528c4cd6746a41f/codex-rs/app-server-protocol/src/protocol/v2/realtime.rs
[claude-voice]: https://code.claude.com/docs/en/voice-dictation
[claude-legal]: https://code.claude.com/docs/en/legal-and-compliance
