# Voice input for the composer

Source-checked 2026-10-20 UTC against first-party documentation, specifications, and upstream source. Repository integration was inspected at `953953b`. This is research and a proposed design, not an implemented feature or a device/performance test.

The [follow-up model survey](voice-models.md), checked 2026-10-25, broadens the candidate list beyond Whisper base/small. Its new model claims are provisional because direct original-source retrieval was blocked in that pass.

## Recommendation

Keep speech-to-text separate from the selected chat model and its subscription. Dictation produces a draft; sending that draft uses the existing text-message path.

```text
Phone microphone → foreground recording → encrypted Pi Remote connection
    → host transcription → editable composer draft → explicit Send → selected chat model
```

For this Apple Silicon installation, use the [follow-up model survey](voice-models.md) to choose native-arm64 evaluation candidates rather than preselecting Whisper `base`/`small`. Compare multilingual Whisper large-v3-turbo with Qwen3-ASR, and include Parakeet where the user's spoken languages are supported. These are candidates, not measured winners; reopen original model/runtime/license sources before installing. Make any model download explicit. Keep ordinary phone keyboard dictation available when no host engine is configured. A dedicated cloud transcription API is a reasonable alternative if avoiding a local model matters more than keeping audio on the host.

Do not build a speech backend for every chat provider, silently fall back to a paid service, or extract subscription tokens for private speech endpoints. One configured transcription backend can feed Claude, Codex, Gemini, or any text-capable model. An app-controlled microphone button should not depend solely on Web Speech recognition.

## What subscriptions actually cover

- **ChatGPT/Codex:** ChatGPT and OpenAI Platform have separate billing. Codex supports ChatGPT sign-in for subscription access, but its documentation directs general OpenAI API calls to Platform API keys. This does not imply that a ChatGPT login grants general speech-API access. [Billing][openai-billing], [Codex authentication][codex-auth].
- **Codex voice interfaces exist, but are not a stable generic dictation contract.** At upstream commit `014489466a1739c2c563cdfe57880c2c7c8680e3`, app-server marks `thread/realtime/start`, `appendAudio`, `appendSpeech`, transcript events, and related operations experimental. These are thread-scoped realtime conversation operations, not evidence of a stable, independent transcription API for every Pi provider. The app-server documentation also warns that its command and WebSocket transport are experimental and unsupported for production workloads. No authenticated voice call or subscription entitlement was tested. [Pinned protocol][codex-protocol], [realtime types][codex-realtime], [app-server docs][codex-app-server].
- **Claude Code includes native dictation.** `/voice` streams audio to Anthropic, requires a Claude.ai account and local microphone, is unavailable in SSH/cloud sessions, and does not consume Claude messages/tokens or `/usage` limits. That is a documented product feature, not a documented standalone transcription endpoint. The listed language support must not be generalized to all languages. [Voice dictation][claude-voice].
- **Do not turn Claude login credentials into our speech API.** Anthropic distinguishes native subscription use from developer API access and restricts third-party collection/intermediation of Claude.ai tokens. Its documentation permits an end user to sign into the unmodified Claude Code binary, including on a hosting platform; that exception is not permission to call private speech endpoints ourselves. [Authentication and credential use][claude-legal]. This research does not change the existing Claude provider integration.
- **Gemini:** its API has project API keys, rate tiers, and its own billing setup. Gemini can transcribe audio, while Google separately points developers to Cloud Speech-to-Text for dedicated real-time STT. Do not infer API entitlement from whichever Gemini app subscription a user has. [API billing][gemini-billing], [audio understanding][gemini-audio].

The distinction is product entitlement versus supported integration access. Native subscription voice features do exist. They do not establish one portable transcription API that Pi Remote should select based on the active chat model.

## Options and published costs

USD rates below were checked on the source date. Hourly OpenAI estimates are minute rates multiplied by 60, not measured bills. No provider accuracy or latency ranking was verified.

| Option | Extra account or cost | Fit and limit |
| --- | --- | --- |
| iPhone keyboard Dictation | No new speech account managed by Pi Remote | Lowest implementation effort. OS edits the text field; Pi Remote cannot own its recording lifecycle. [Apple][apple-dictation] |
| Browser Web Speech | No API key managed by Pi Remote | Recognition events and interim text, but service availability, local processing, and Home Screen behavior need runtime/device checks. [Spec][speech-spec], [WebKit IDL][webkit-idl] |
| Local whisper.cpp | Engine/model installation and host compute; no hosted speech bill | Portable CPU support plus Apple acceleration. Predictable ownership of audio handling, but local speed/quality is unmeasured. [Upstream][whisper-cpp] |
| Local WhisperKit | Apple-specific engine/model installation | Core ML-based alternative with an existing OpenAI Audio API-compatible local server. Its serving support may save integration work; no performance advantage was measured. [Upstream][whisperkit] |
| OpenAI `gpt-transcribe` | Separate API key; $0.0045/min, about $0.27/hour | Current file-transcription recommendation. Supports context, keyword/language hints, and code-switching. Audio leaves the host. [Guide][openai-stt], [model][openai-model], [pricing][openai-pricing] |
| OpenAI `gpt-4o-mini-transcribe` | Separate API key; estimated $0.003/min, about $0.18/hour | Lower published estimated cost; quality for this user's clips is untested. [Pricing][openai-pricing] |
| Groq `whisper-large-v3-turbo` | Separate API key; $0.04/hour, minimum 10 seconds billed per request | Multilingual hosted transcription. Full `whisper-large-v3` is $0.111/hour. Published benchmark figures are not phone-to-host latency estimates. [STT docs][groq-stt] |

Cloud privacy must be stated per endpoint. OpenAI says API data is not used for training unless opted in; its retention table lists no abuse-monitoring or application-state retention for `/v1/audio/transcriptions`. Groq says inference content is not retained by default, with reliability/abuse exceptions up to 30 days and configurable zero data retention. Neither is equivalent to audio never leaving the host. [OpenAI controls][openai-data], [Groq controls][groq-data].

## iPhone recording and recognition findings

### Keyboard dictation and Web Speech are different

Apple documents tapping the keyboard Dictate button with the insertion point in a text field. Pi Remote's normal textarea can receive those edits without an application recorder. This is an architectural expectation, not a physical-phone verification. Apple says settings indicate when Dictation remains on-device; do not promise all keyboard dictation is offline. [Guide][apple-dictation], [privacy][apple-privacy].

Safari 14.1 introduced speech recognition through Siri's speech engine. The fetched WebKit IDL exposes `webkitSpeechRecognition` in a secure context, but does not expose `processLocally`, `available`, or `install`. Assigning an unknown JavaScript property does not enforce local processing. The Web Speech specification allows local or remote recognition by default. [Safari announcement][safari-speech], [WebKit IDL][webkit-idl], [spec][speech-spec].

An older WebKit engineer comment says Home Screen speech recognition was unsupported at that time. It is historical evidence, not proof that every current iOS PWA fails. No current released-iOS guarantee for the needed standalone-PWA behavior was established. Constructor presence alone is insufficient; permission and recognition-service failures still need handling. [Historical bug][webkit-pwa], [implementation][webkit-speech].

### Record audio with runtime format negotiation

- `getUserMedia` requires a secure context and permission; document activity, visibility, and Permissions Policy participate in access. An app mic button should start from a user gesture and show explicit recording state. [Capture spec][capture-spec].
- Do not hardcode an old "Safari only records MP4" assumption. Safari 18.4 added WebM recording with Opus; older WebKit documentation describes MP4/AAC. Probe `MediaRecorder.isTypeSupported`, retain the actual recorder/blob MIME type, and handle construction/start failures. A successful capability check does not guarantee resources will be available. [Safari 18.4][safari-recorder], [initial recorder support][safari-recorder-old], [recording spec][recording-spec].
- A `timeslice` blob need not be independently playable, and timeslice timing is not exact. Collect the final data event and complete recording before file transcription. Do not assume each upload chunk is a standalone audio file. [Recording spec][recording-spec].
- WebKit recognition aborts on suspension; no first-party guarantee of uninterrupted locked-screen/background MediaRecorder capture was established. Use foreground short clips, handle stream mute/end and recorder errors, and stop all microphone tracks on completion/cancel. [WebKit implementation][webkit-speech]. Foreground-only operation is our proposed behavior, not a claim that every tab switch stops every browser.

## Host-local engines

whisper.cpp supports CPU-only inference, Intel/x86 AVX, and Apple Silicon acceleration through NEON, Accelerate, Metal, and optional Core ML. Its documented CLI expects 16-bit WAV and demonstrates conversion to 16 kHz mono PCM with ffmpeg. Relabeling MP4/WebM as WAV is not conversion. Core ML adds model preparation and first-run compilation. [Upstream README][whisper-cpp].

Upstream approximate resource figures are useful for download choices, not measured RSS or latency on this host:

| Model | Disk | Approximate memory |
| --- | --- | --- |
| tiny | 75 MiB | ~273 MB |
| base | 142 MiB | ~388 MB |
| small | 466 MiB | ~852 MB |
| medium | 1.5 GiB | ~2.1 GB |
| large | 2.9 GiB | ~3.9 GB |

Multilingual models are distinct from English-only `.en` variants. Upstream lists English and Chinese, but this does not establish mixed-language, accent, Cantonese, punctuation, or coding-term accuracy for this user. Model choice needs representative clips. Quantization reduces model storage/memory with hardware-dependent tradeoffs. [Whisper models/languages][whisper-models], [tokenizer][whisper-languages], [whisper.cpp][whisper-cpp].

WhisperKit is a credible Apple-specific alternative. The current Argmax OSS README lists macOS 14+ and Xcode 16+ for source integration, a Homebrew CLI, explicit/automatic model selection, and a local transcription/translation server with output streaming. The OSS server should not be confused with its separate Pro realtime WebSocket offering. Build/toolchain compatibility and the chosen release still need verification. [Argmax README][whisperkit].

Local inspection found Apple Silicon hardware, 24 GiB RAM, ffmpeg on PATH, and no `whisper-cli`/`whisper-server` on PATH. The current process is x86_64 under Rosetta, confirmed with `sysctl.proc_translated=1`; select native-arm64 inference binaries rather than treating `uname -m` as the hardware architecture. No model was installed or benchmarked.

## Pi Remote integration consequences

These are proposed constraints derived from the existing code, not implemented contracts:

- Reuse the authenticated encrypted client channel. [`src/e2e.mjs`](../../src/e2e.mjs) and [`web/e2e.js`](../../web/e2e.js) already encrypt phone/host messages; do not add an unencrypted audio upload endpoint. "Host-local" means inference on the computer, not the phone. Audio still crosses the network.
- [`src/host.mjs`](../../src/host.mjs) and [`src/relay.mjs`](../../src/relay.mjs) cap WebSocket frames at 6 MiB. JSON/base64/encryption add overhead. Bound raw audio size and duration before encoding, and chunk if needed. Existing 256 KiB video chunks are a transport pattern, not permission to store voice drafts as persistent video attachments. See [`src/client-channel.mjs`](../../src/client-channel.mjs), [`src/videos.mjs`](../../src/videos.mjs), and [`web/videos.js`](../../web/videos.js).
- The generic browser request helper has a 35-second acknowledgement timeout. Cold model loading/transcription may exceed it; measure before choosing a bounded request or cancellable job. A timeout must not cause automatic resubmission or a generic instruction to resend the chat prompt. See [`web/app.js`](../../web/app.js).
- Bind each recording/result to its original session and draft revision. Preserve typed text and attachments, never write a late result into another session, and never overwrite edits made during transcription. Session changes, sign-out, disconnect, cancel, and page hiding need an explicit recording/job policy. Return text into the draft, then reuse `sendMessage` only after the user presses Send.
- Validate actual media at the host boundary, not just a supplied MIME label. Enforce bytes/duration, decoding and inference deadlines, bounded concurrency, and cleanup on success/failure/cancel/disconnect. Keep raw audio temporary and out of conversation files/logs. No API keys or model-login tokens belong in browser code.
- Keep transcription literal. Do not add an LLM rewrite step, send repository contents as speech context, or turn recognized speech into a slash command automatically. A small explicit vocabulary hint can be evaluated later if supported by the chosen engine.

## Evidence still needed before shipping

1. On the actual iPhone, separately verify Safari-tab and Home Screen recording: first permission, denial/revocation, stop/cancel, lock/background interruption, MIME output, and final-blob delivery. WebKit source and old bug reports do not substitute for these checks.
2. Compare native-arm64 whisper.cpp `base`/`small`, with WhisperKit only if useful, on the same short clips. Include the user's spoken languages, filenames, acronyms, pauses, and background noise. Measure cold/warm total latency and memory while normal chat runs. Do not claim local is faster or more accurate before measuring.
3. When implemented, add focused browser E2E coverage for draft preservation, late results/session switching, cancellation, permission failures, and interrupted uploads. Synthetic microphone tests do not prove physical Safari works. No unit tests or full local suite are needed for this research-only change.
4. Call a cloud provider only with explicit consent to transmit the test audio and incur its API usage. Benchmark and compare actual short-clip billing rather than assuming hourly rates determine the bill.

Skipped for this research: installations, model downloads, audio recording, inference, paid requests, credential access, and feature implementation. The decision supported now is the architecture and the initial local candidate, not a proven engine/model winner.

## Sources

[apple-dictation]: https://support.apple.com/guide/iphone/dictate-text-iph2c0651d2/ios
[apple-privacy]: https://www.apple.com/legal/privacy/data/en/ask-siri-dictation/
[speech-spec]: https://webaudio.github.io/web-speech-api/
[safari-speech]: https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/
[webkit-idl]: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognition.idl
[webkit-speech]: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognition.cpp
[webkit-pwa]: https://bugs.webkit.org/show_bug.cgi?id=225298
[capture-spec]: https://w3c.github.io/mediacapture-main/#dom-mediadevices-getusermedia
[recording-spec]: https://w3c.github.io/mediacapture-record/
[safari-recorder]: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
[safari-recorder-old]: https://webkit.org/blog/11353/mediarecorder-api/
[whisper-cpp]: https://github.com/ggml-org/whisper.cpp
[whisper-models]: https://github.com/openai/whisper#available-models-and-languages
[whisper-languages]: https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
[whisperkit]: https://github.com/argmaxinc/argmax-oss-swift#local-server
[openai-billing]: https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform
[codex-auth]: https://developers.openai.com/codex/auth
[codex-app-server]: https://developers.openai.com/codex/app-server
[codex-protocol]: https://github.com/openai/codex/blob/014489466a1739c2c563cdfe57880c2c7c8680e3/codex-rs/app-server-protocol/src/protocol/common.rs
[codex-realtime]: https://github.com/openai/codex/blob/014489466a1739c2c563cdfe57880c2c7c8680e3/codex-rs/app-server-protocol/src/protocol/v2/realtime.rs
[claude-voice]: https://code.claude.com/docs/en/voice-dictation
[claude-legal]: https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use
[gemini-billing]: https://ai.google.dev/gemini-api/docs/billing
[gemini-audio]: https://ai.google.dev/gemini-api/docs/audio
[openai-stt]: https://developers.openai.com/api/docs/guides/speech-to-text
[openai-model]: https://developers.openai.com/api/docs/models/gpt-transcribe
[openai-pricing]: https://developers.openai.com/api/docs/pricing
[openai-data]: https://developers.openai.com/api/docs/guides/your-data
[groq-stt]: https://console.groq.com/docs/speech-to-text
[groq-data]: https://console.groq.com/docs/your-data
