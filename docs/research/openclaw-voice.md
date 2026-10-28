# How OpenClaw implements voice

Checked 2026-10-28 UTC. Source snapshot: [`fd0403b40c980de2ab8fe8d20b3d49f06a488596`](https://github.com/openclaw/openclaw/commit/fd0403b40c980de2ab8fe8d20b3d49f06a488596), committed 2026-10-28T15:38:56Z. Findings below come from fetched first-party documentation and pinned implementation, not a running OpenClaw installation or this user's account.

## Main finding

OpenClaw separates speech recognition, agent execution, and speech output. It also implements a ChatGPT/Codex OAuth voice route, so our earlier suggestion that subscription voice can only be used inside the official apps was too absolute.

There are two distinct OpenAI findings:

- **Realtime voice:** OpenClaw exposes `gpt-live-1-codex`, prefers its own ChatGPT/Codex subscription profile, and brokers WebRTC through the Gateway. This is implemented source behavior, not a promise that every account is entitled or that usage has no additional charge. [Talk docs][talk], [model routing][models], [auth policy][voice-policy].
- **File transcription:** its OpenAI media plugin accepts API-key or compatible OAuth/token profiles and sends multipart audio to `/v1/audio/transcriptions`. OpenClaw explicitly documents OAuth transcription as account-dependent; an API key is not mandatory merely to configure a transcription model. No request or billing result was verified here. [Audio docs][audio], [batch auth][batch], [HTTP adapter][compatible].

We did not establish an equivalent Claude-subscription speech endpoint. Native recognition or an independently configured speech provider can still feed a Claude text agent. The selected reasoning model and the speech credential are separate choices.

## Voice is several different paths

| Surface | Recognition and agent flow | Important boundary |
| --- | --- | --- |
| Native macOS/iOS/Android Talk | Device microphone → OS recognition → Gateway chat → Talk TTS | Apple Speech may use network services; Android depends on its speech service. Native app behavior is not Safari support. [talk] |
| Voice Wake | Native recognition → wake command → active/routed session | A command input path, not proof of always-on browser voice. [wake] |
| Browser dictation | Microphone → Gateway file or streaming transcription → editable draft | No spoken assistant response or automatic message send is required. [webchat] |
| Uploaded voice note | Attachment → Gateway media understanding → provider/local command → agent | Recognition and spoken replies are configured separately. [audio] |
| Browser split Talk | Utterance → Gateway STT → current agent → TTS | Capture pauses during reply generation/playback. [webchat] |
| Realtime GPT-Live Talk | Microphone/WebRTC → voice provider, with Gateway-owned agent consultation/control | Separate realtime session/auth machinery; it is more than a file transcriber. [talk] |

A native Talk loop is broadly:

```text
Device speech recognition → recognized text → configured Gateway agent
    → complete reply → configured TTS → listen again
```

The iOS implementation uses `SFSpeechRecognizer` and `SFSpeechAudioBufferRecognitionRequest`, including partial results and dictation task hints. This does not grant a browser access to Apple's native speech framework. Native silence detection, interruption, foreground ownership, and audio-route handling are client-specific. [iOS source][ios-talk], [Talk docs][talk].

## Browser composer behavior worth copying

OpenClaw's Control UI dictation is the closest match to Pi Remote's request:

1. Start capture from the microphone action.
2. Use Gateway-owned file transcription when explicit audio models/commands are configured, or the configured streaming transcription path.
3. On stop, stop capture immediately but wait for final transcription before inserting the result.
4. Insert editable text. Cancellation, draft changes, and another voice action prevent stale insertion. A failure preserves text already received. [WebChat docs][webchat].

The transcription session uses `mode: "transcription"`, `transport: "gateway-relay"`, and `brain: "none"`. It is not a two-way assistant voice call. The relay owns partial/final events, connection cleanup, duration bounds, and final-transcript draining. [Relay][transcription-relay].

For explicit file models, its adapter buffers bounded browser audio, converts G.711 mu-law frames to an 8 kHz PCM WAV, calls the ordinary `transcribeAudioFile` owner after capture, and removes its temporary directory in `finally`. It checks cancellation/current ownership before publishing. This particular audio format is an implementation choice, not a requirement Pi Remote should copy. The existing phone format and recognition quality still need evaluation. [File adapter][file-transcription].

## ChatGPT/Codex subscription voice, traced through source

### 1. Model and account selection

OpenClaw distinguishes `gpt-live-1`, the public Platform-key model, from `gpt-live-1-codex`, its subscription route. If browser/relay Talk has no explicit model, configured Platform auth selects the public route; subscription auth without Platform auth selects the Codex route. For an explicitly selected Codex model, subscription auth is preferred, with Platform-key fallback when no subscription auth resolves. Do not equate that fallback with a guarantee of no API billing. [Model IDs][models], [provider factory][voice-factory], [auth order][voice-policy].

`resolveOpenAIChatGptSubscriptionAuth` resolves OpenClaw-managed OAuth first, then a token profile carrying the expected account claim. It requires an account ID and uses `includeExternalCliAuth: false`; production selection is not a general scrape of arbitrary CLI credentials. [Auth implementation][voice-auth].

### 2. Gateway keeps the durable credential

The browser-session broker stores the selected auth on the Gateway and gives the client a random, single-use offer token expiring after 60 seconds. The client posts its audio-only WebRTC offer to `/plugins/openai/realtime/calls`; the Gateway consumes the offer token and performs the upstream exchange. Session lifetime and cancellation/retirement are separately bounded. The browser does not receive the durable OAuth access token. [Broker][broker], [offer validation][offer-validation].

For GPT-Live plus OAuth, the wire implementation selects the ChatGPT Codex realtime backend and its JSON session/SDP contract. Platform-key calls use different public endpoint contracts. The internal Codex route is third-party integration evidence, not a newly established stable public API entitlement or vendor policy approval. [Wire implementation][wire].

### 3. Similar-looking OpenAI paths have different rules

- **Public `gpt-live-1`:** Platform key required by the inspected call implementation. **`gpt-live-1-codex`:** subscription-first through the broker/Gateway WebRTC path. [Wire][wire], [policy][voice-policy].
- **GA realtime browser voice:** the provider factory also has a separate Platform-first, OAuth-broker fallback branch when no Platform credential is configured. This does not imply identical support in native clients, Gateway relay, or transcription-only providers. [Factory][voice-factory], [Talk docs][talk].
- **Standalone OpenAI realtime transcription:** the inspected plugin selects `api_key` profiles/environment keys and connects to the public transcription WebSocket. Its default is `gpt-4o-transcribe`. Do not infer OAuth support in that plugin from OAuth support in realtime voice. [STT provider][streaming-stt].
- **Sign in with ChatGPT token-sharing grant:** OpenClaw's model-auth policy explicitly rejects capability/media operations for this distinct grant. An OAuth-shaped credential alone is not enough; the auth flow and authorized operation matter. [Model auth policy][model-auth].

The Talk docs mark some device verification pending, including subscription-authenticated Android live audio and GPT-Live iOS device checks. Source support should not be reported as physical-phone proof. [talk]

## File transcription with OAuth is separate again

The OpenAI media provider registers `transcribeAudioWithContext`, allowing the plugin to own credential selection. That implementation:

- Resolves capability `audio-transcription` with an explicit profile when selected. An authored provider API key takes precedence over ambient OAuth unless the profile/auth mode says otherwise.
- Can select OAuth/token auth when appropriate credentials are absent, or when explicitly configured. Failed credentials are not treated as permission to silently switch credential classes.
- Allows OAuth only for recognized native endpoints without custom headers/request overrides. Custom endpoint overrides need an API-key profile.
- Normalizes official text-provider bases to `https://api.openai.com/v1` for batch audio, then posts a multipart request containing the model, optional language/prompt, and audio to `/audio/transcriptions`.
- Defaults to `gpt-4o-transcribe`; `gpt-4o-mini-transcribe` is a documented configurable alternative. API-key execution has a key-rotation path; OAuth execution uses its selected bearer. [Registration][media-provider], [auth][batch], [base URLs][base], [defaults][defaults], [HTTP adapter][compatible].

Crucially, the code **attempting** this request does not establish service acceptance for this account. OpenClaw's own docs say access, quota, and billing are account-specific. An eligible browser voice session also does not prove the same bearer is accepted by the file-transcription endpoint. These need separate authorized checks. [audio]

For browser file dictation, `resolveTalkFileTranscriptionConfig` requires explicit audio model entries and enabled audio. A configured realtime voice model alone is not evidence that this file-dictation path is ready. [File configuration][file-transcription].

## Local recognition and speech output

Inbound audio auto-selection considers an audio-capable reply model and configured provider authentication before local CLIs. A cloud key can therefore win even when a local recognizer is installed. The documented local choices include whisper.cpp `whisper-cli`, `sherpa-onnx-offline`, Apple Silicon `parakeet-mlx`, and Python `whisper`; explicit command entries bypass auto-selection. Acceleration observations influence ordering. Local auto-detection remains process-per-request, not a managed resident server. [audio]

Speech output is another independent setting. OpenClaw documents hosted TTS, native system fallbacks with client-specific rules, local MLX/CLI options, and a no-key Microsoft/Edge online service. No-key Edge TTS is not offline or a ChatGPT/Claude subscription benefit. Browser Read aloud uses Gateway TTS, not browser speech synthesis. A composer-input-only feature needs none of this reply-audio machinery. [Talk][talk], [WebChat][webchat], [TTS quickstart][tts].

## What this changes for Pi Remote

**Recommendation, not implemented behavior:** keep microphone input → editable draft → explicit Send, independent of the selected Claude/GPT reasoning model. OpenClaw shows that an optional ChatGPT/Codex-authenticated speech adapter is worth investigating; a separately purchased speech API key is not an architectural prerequisite.

The next small proof should distinguish file transcription from realtime voice, use an explicitly selected eligible profile, and verify the actual response and account usage with user consent. Do not promise free/unlimited transcription, silently fall back to a configured paid key, export durable tokens to the phone, or assume a successful Talk session validates every speech endpoint.

For this composer request, do not port the entire wake-word, TTS, agent-consult, realtime media, or provider-fallback system. Start with the smallest verified transcription path. Keep host-local STT or phone keyboard dictation as a separately chosen alternative, not a silent credential/billing fallback.

## Verification boundaries

- Direct documentation/source inspection succeeded in this pass. This is stronger than the earlier DNS-blocked model survey, but still not a runtime/account result.
- Upstream includes opt-in live voice tests gated by `OPENCLAW_LIVE_TEST=1` and `OPENCLAW_LIVE_GPT_LIVE=1`, including an OAuth WebRTC broker probe. Test source is not a recorded passing result for this user; none was run. [Live tests][live-tests].
- No OpenClaw installation, recording, inference, model download, credential access, paid speech call, or physical-device test was performed. No Pi Remote feature code was changed.
- Exact subscription eligibility, quota/billing, provider permission for this third-party use, and iPhone browser behavior remain unverified. These are not answered by an OAuth profile merely existing.

## Sources

All repository links below are pinned to the inspected snapshot; the live documentation used for discovery was `docs.openclaw.ai/nodes/{talk,audio,voicewake}`.

[talk]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/docs/nodes/talk.md
[webchat]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/docs/web/webchat.md
[wake]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/docs/nodes/voicewake.md
[audio]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/docs/nodes/audio.md
[ios-talk]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/apps/ios/Sources/Voice/TalkModeManager.swift
[models]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver.ts
[voice-factory]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-voice-provider-factory.ts
[voice-policy]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-voice-session-policy.ts
[voice-auth]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-auth.ts
[broker]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver-session.ts
[offer-validation]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-sdp-offer.ts
[wire]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver-wire.ts
[streaming-stt]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-transcription-provider-factory.ts
[model-auth]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/model-auth-policy.ts
[media-provider]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/media-understanding-provider.ts
[batch]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/audio-transcription.ts
[base]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/base-url.ts
[defaults]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/default-models.ts
[compatible]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/src/media-understanding/openai-compatible-audio.ts
[file-transcription]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/src/gateway/talk/file-transcription.ts
[transcription-relay]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/src/gateway/talk/transcription-relay.ts
[tts]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/docs/tools/tts/quickstart.md
[live-tests]: https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver.live.test.ts
