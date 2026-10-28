# Speech-to-text models for Pi Remote

Checked: **2026-10-25 UTC**. Scope: local and hosted models for short spoken coding prompts → editable text; not TTS, conversation, or audio reasoning.
Previously inspected host: Apple M5 Pro, 24 GiB unified RAM; parent process runs x86_64 under Rosetta.
This supplements [voice-composer.md](voice-composer.md); it does not change its transport, draft-safety, or explicit-Send requirements.

## Summary

Do not restrict the local evaluation to Whisper `base`/`small`: **Qwen3-ASR 0.6B/1.7B, Parakeet-TDT 0.6B v3, and Whisper large-v3-turbo** are practical comparison candidates.
For English/Chinese, prioritize Qwen against multilingual Whisper; Parakeet v3 is European-language ASR, not a Chinese solution.
**Voxtral Mini 4B Realtime** is a conditional fourth candidate if live partial text becomes necessary; finished short clips do not require a streaming architecture.
All can feed ordinary editable text independently of the selected chat model/subscription. No model is a measured winner on this Mac.

## Evidence and confidence

**New findings are provisional.** Direct retrieval of model cards, source repositories, and hosted-provider documentation was blocked by a fake-IP DNS/SSRF restriction. Hosted search returned publisher-linked descriptions, but the original pages could not be inspected in this pass; structured source checks did not validate the claims. No security settings were bypassed.

Confidence is higher for model identity/basic scope than for exact current licenses, artifact sizes, conversion compatibility, pricing, or streaming implementation details. Reopen the actual model card, LICENSE, and runtime revision before adopting a model. This is neither license clearance nor an installation compatibility guarantee, and it is not an exhaustive census of every release.

The prior [composer research](voice-composer.md) directly inspected some Whisper/OpenAI/Groq documentation on October 20. Where those older facts are reused below, their earlier check date is retained rather than presented as a fresh direct check.

## Local-model comparison

Sizes mean parameters unless explicitly labeled download; **none is measured RAM**. Multilingual support does not establish within-sentence code switching.

| Model, not engine | Languages / English–Chinese | Inference and timing | Native-arm64 Mac route | Weights / license evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| **Qwen3-ASR 0.6B / 1.7B** [Q], [QP] | 30 major languages + 22 Chinese dialects reported; English and Chinese. Mixed English/Chinese quality not verified. | Offline + official streaming path; official Python code search identifies streaming as **vLLM-only**, without streaming timestamps. Separate ForcedAligner for alignment. | Community MLX Audio support/conversions; not Qwen's official accelerated Mac implementation. Start with completed clips. | 0.6B / 1.7B; Apache-2.0 reported. Community 0.6B 4-bit listing reports **708 MB download**, not RSS. [QC] | Primary multilingual challenger; compare small versus larger checkpoint. |
| **NVIDIA Parakeet-TDT-0.6B-v3** [P] | 25 European languages, including English; **not Chinese**. Automatic language detection reported. | Offline TDT ASR; token/word timestamps. Native streaming not established for this checkpoint; wrappers may chunk audio. | Third-party `parakeet-mlx` or MLX Audio; NVIDIA NeMo/CUDA is not a native Metal path. | 0.6B; CC-BY-4.0 reported. Community MLX listing **2.51 GB**, conversion-specific. [PC] | Strong English-first comparison, not a bilingual default. |
| **NVIDIA Canary-1B-v2 / Canary-Qwen-2.5B** [C], [CQ] | v2: 25 European languages, not Chinese. Canary-Qwen is a **separate English ASR model**, not Qwen3-ASR. | Encoder-decoder / speech-LLM transcription; streaming not established here. Translation is irrelevant to this task. | Official NeMo ecosystem; no sufficiently verified, ready native-arm64 accelerated route found in this pass. | 1B / 2.5B; CC-BY-4.0 reported; download/RAM unverified. | Deprioritize: no established Mac integration advantage. |
| **Mistral Voxtral Mini 4B Realtime 2602** [V] | 13 languages, including English and Chinese; within-utterance mixing unverified. | Streaming-specific model; configurable **240 ms–2.4 s transcription delay**, not measured end-to-end latency. Timestamp interface not verified. | Third-party MLX Audio and MLX-community 4-bit conversion. [M], [VC] | 4B; Apache-2.0 reported; community 4-bit listing about **3.13 GB**, not resident memory. | Conditional live-partials experiment, unnecessary complexity for stop→transcribe. |
| **Moonshine streaming / v2** [MO] | Language-specific models include English and Chinese; do not assume one multilingual checkpoint or mixed-language support. | Actual streaming model family, not merely a Whisper rolling-window demo. Native SDK handles live transcription; timing interface needs inspection. | First-party cross-platform Moonshine Voice SDK documents macOS; exact arm64 artifact/OS compatibility still needs verification. | Streaming Tiny **34M**, Medium **245M** reported; intermediate checkpoints omitted. Current LICENSE search says streaming weights MIT, with restrictive legacy non-streaming exceptions. [ML] | Attractive lightweight alternative, but language/checkpoint/license ambiguity prevents preferred shortlist placement. |
| **OpenAI Whisper large-v3 / large-v3-turbo** [W], [WT] | Broad multilingual ASR including English/Chinese; turbo card reports 99 languages. No verified coding/code-switch ranking. | Offline encoder-decoder; rolling/chunked partial output is **not native causal streaming**. Segment timestamps; word alignment depends on engine. | Native-arm64 whisper.cpp (Metal/Accelerate, optional Core ML), or Apple-specific WhisperKit. [WC], [WK] | 1.55B / 809M; MIT. ggml large-class FP16 weights roughly 2.9 GiB; turbo FP16 weight arithmetic roughly 1.5 GiB, not a verified download/RSS. | Mature reference; turbo adds a more relevant quality/speed comparison than only base/small. |

## Practical shortlist (researcher recommendation)

1. **Qwen3-ASR 0.6B, then 1.7B if useful:** test English, Mandarin and mixed prompts through native-arm64 MLX Audio.
   Reason: meaningful newer multilingual alternative with a plausible Apple GPU path; unknown: actual code-switching, context support in the port, quantization impact, cold start and peak memory.
   The official vLLM streaming claim does **not** prove streaming parity in an MLX conversion. Evaluate one-shot transcription first.
2. **Whisper large-v3-turbo via whisper.cpp:** maintain an established, non-Python baseline; compare full large-v3 only if turbo misses important words.
   Reason: mature Mac engine and broad language coverage; unknown: short-prompt hallucination/accuracy and real latency while chat workloads share memory.
   Keep `base`/`small` as low-resource controls, not a preselected winner. A larger model fitting 24 GiB is not proof that concurrent use is comfortable.
3. **Parakeet-TDT-0.6B-v3 via MLX:** evaluate if most dictation is English or another supported European language.
   Reason: different recognition architecture and timestamp output; unknown: local accuracy/latency and whether community chunking preserves words at boundaries.
   Exclude it as the sole engine if Chinese is required. Do not substitute English-only v2 and call that multilingual v3.
4. **Voxtral Mini 4B Realtime, only if partial text matters:** investigate its MLX path after completed-clip comparison.
   Reason: a genuine streaming-specific open-weight option with Chinese support; unknown: sustained native streaming correctness, timestamp exposure, memory and code switching.
   This is not a recommendation to build a voice agent or use the separate Voxtral audio-understanding models.

Moonshine is the reserve lightweight candidate, not obsolete: revisit if first-party SDK packaging and footprint matter more than a shared multilingual model.
Its changing legacy-versus-streaming licensing/language matrix needs exact checkpoint review before adoption; avoid assuming the repository code license covers every weight.

## Hosted-model comparison

These are alternatives to local inference, not additional integrations we need to build now. A single chosen speech backend can serve every chat model. New provider-feature descriptions below come from publisher-linked search results and need direct-page verification. Do not rank providers using their own incomparable WER datasets or advertised latency.

| Model family | Why compare it for dictation? | Boundary / evidence |
| --- | --- | --- |
| **OpenAI `gpt-transcribe`** [OA], [OP] | Dedicated file STT with prompt, keyword, and multiple-language hints. A useful cloud reference for coding terms and mixed-language clips. | Published rate $0.0045/min, about $0.27/audio hour. Directly checked October 20 and reconfirmed through search October 25. `gpt-4o-mini-transcribe` is a lower-cost control at an estimated $0.003/min. Separate API billing, not included chat-subscription usage. |
| **Groq-hosted Whisper large-v3-turbo** [G] | Hosted execution of a known multilingual model makes a useful operational comparison with local Whisper. | $0.04/audio hour and a 10-second minimum billed per request were directly checked October 20, not revalidated directly in this pass. This is a provider/runtime choice, not a new recognition architecture. |
| **Deepgram Nova-3 / Flux** [DG], [DK] | Nova-3 is general recorded/streaming STT with multilingual support and keyterm prompting. Search-returned docs include Mandarin in multilingual mode. | Flux is voice-agent-oriented with turn detection; its reported multilingual list does not include Chinese. Do not assume two products from one provider have identical languages. Exact SKU, language list, and price need reopening. |
| **ElevenLabs Scribe v2 / v2 Realtime** [EL], [EK] | Dedicated batch and live models with keyterm prompting, useful for a coding vocabulary comparison. | Batch and realtime keyterm limits differ. Advertised first-result latency is not final-draft latency. Plan, add-on pricing, language behavior, and retention need direct verification. |
| **AssemblyAI Universal-3.5 Pro** [AA] | Publisher search results describe native code switching and natural-language context prompts across 18 languages, including English and Mandarin. | A candidate for multilingual/context evaluation, not a demonstrated accuracy winner. Do not conflate the asynchronous model with a separate streaming service. |
| **Mistral Voxtral hosted family** [VX3], [VXM] | Publisher search results point to Voxtral 3 file/live models and a migration guide from Voxtral 2. | Reopen the current catalog before choosing an API model ID or price. Do not treat February's open-weight Voxtral Mini 4B Realtime checkpoint as proof of the latest hosted model's weights, license, or runtime. |

For an initial comparison, one cloud reference is enough, probably OpenAI `gpt-transcribe` because its context/language hints are documented in the earlier directly inspected guide. Add another only to answer a concrete language, quality, privacy, or cost question. Do not send test audio to any provider without consent and an explicitly configured API key.

## Models versus runtimes

- **whisper.cpp** is an inference engine for Whisper checkpoints, not a competing speech model. Metal, Accelerate and Core ML are distinct acceleration routes. [WC]
- **WhisperKit** is an Apple/Core ML runtime and serving toolkit; converted Core ML weights are not a new ASR model. Its output streaming does not change Whisper's architecture. [WK]
- **MLX Audio** is a third-party library built on Apple's MLX. Its STT support lists Qwen3-ASR, Parakeet and Voxtral Realtime. [M]
- **MLX-community weights / parakeet-mlx** are community conversions/ports, not model-vendor guarantees; verify exact revision, conversion provenance and inherited weight license. [QC], [PC], [PM]
- **ONNX / ONNX Runtime** describe model representation/runtime, not recognition quality. Moonshine's native runtime packaging needs separate arm64 verification. [MO]
- Use native-arm64 binaries/Python and compatible native dependencies even though Pi Remote's parent runs under Rosetta. Do not infer hardware architecture from that process.
- No CUDA throughput, vendor accuracy leaderboard, advertised streaming delay, or community demo was translated into M5 Pro performance. No ranking by invented local speed.

## Dictation-specific constraints

**Researcher inference:** ordinary ASR is not a parser for identifiers. `useEffect`, `src/host.mjs`, punctuation, casing, acronyms and homophones can be normalized incorrectly even when general prose is correct.
No inspected evidence establishes a coding-vocabulary or exact-identifier winner. Include spoken filenames, letters/digits, shell flags, package names, corrections and code-switches in later tests.
Some engines expose prompt/context/hotword mechanisms; this pass did not verify parity across these ports. Do not promise arbitrary identifier recovery or add an automatic LLM rewrite.
Keep the transcript editable and never execute or send it automatically; context should not silently upload repository contents.

Whisper's generative decoder can produce text unsupported by audio, particularly on silence/noise; no candidate is demonstrated hallucination-free here. [WT]
Use explicit start/stop, reject empty/invalid clips and evaluate a no-speech gate/VAD; VAD is not an accuracy guarantee and can cut quiet speech.
whisper.cpp has optional VAD with a separate model; confirm its exact supported version/configuration before integration. [WC]
For press-to-stop clips, VAD is **not intrinsically required** to know when recording ends; it is useful for silence rejection and trimming.
Streaming requires endpointing/finalization and distinction between provisional and final text, even if the model itself is streaming.

Timestamps are optional for an editable short draft; do not add an aligner by default.
Qwen3-ForcedAligner is a separate model (11-language alignment reported), not evidence that all ASR languages have timestamps or that alignment validates recognized words. [QP]
Parakeet timestamps and Whisper engine alignment can help diagnostics, but neither is needed merely to insert text.
Decode the phone's actual media to the runtime's required sample format; do not assume browser transport chunks are independently decodable audio frames.

## Contradictions and remaining evidence

- No verified head-to-head contradiction was resolved. Search descriptions of “streaming” differ: native streaming architecture, chunked recognition and streamed delivery are not interchangeable.
- Moonshine search evidence distinguishes current MIT streaming models from legacy non-streaming Mandarin/community-license weights; generic “Moonshine is MIT” is unsafe without the exact artifact. [ML]
- Basic supported-language lists are **not** evidence of mixed English/Chinese quality; no verified code-switching score or user-specific dialect result was obtained.
- Reopen original cards, LICENSE files and runtime source before selecting versions; direct-fetch/source-check failures prevent final factual/license attestation.
- Missing measurements: actual downloads for selected revisions, cold/warm end-to-end latency, peak unified memory with concurrent chat, arm64 installation, silence/quiet/noisy clips, quantization loss and identifier accuracy.
- No physical phone capture, model install/download, recording, inference, credential access, paid speech requests, feature implementation, or model tests were performed.

## Next step and comparison criteria

First confirm the user's spoken languages; Chinese is a conditional comparison case here, not a stated requirement. After original-source verification, run one focused, consented end-to-end comparison of Qwen3-ASR, Whisper turbo, and Parakeet where languages permit. One optional cloud reference is enough.

- Use the same short clips, including ordinary prose, spoken filenames/acronyms/flags, self-corrections, quiet speech, noise, and silence. Include code switching only if the user needs it. Do not commit private recordings.
- Score exact important terms as well as prose errors. English word-error rate and Chinese character-error rate are different measures; casing, punctuation, and identifier normalization should be reported separately rather than hidden in one aggregate score.
- Measure stop-to-editable-draft latency, upload/decode time, cold and warm inference, and peak unified memory while normal chat runs. For live output, separately measure first partial, stable/final text, and revisions; streamed tokens from a finished recording are not live microphone recognition.
- Record exact model/runtime/conversion revisions and quantization. A parameter count, weight download, GPU benchmark, or ability to fit in RAM does not establish usable Mac performance.
- For hosted tests, inspect actual billed duration/minimums, network delay, retention, and credential handling. No silent paid fallback. A subscription-backed speech adapter needs explicit compatible credential selection and service/account verification; the [October 28 OpenClaw research](openclaw-voice.md) identifies implemented OAuth paths without proving this user's entitlement.

Only add Voxtral/Moonshine to that experiment if partial-text UX or footprint is a real requirement. Preserve the prior note's encrypted transport, editable draft, and explicit-Send behavior. No benchmark or implementation is authorized by this research note itself.

## Sources kept / deprioritized

Primary publisher/model and runtime links are kept because they define model scope, licensing and actual integration boundaries; **all original-fetch validation remains blocked as described above**.
Secondary comparisons, leaderboards, unrelated fine-tunes and anecdotes were deprioritized: none establishes this host's short coding-dictation accuracy or speed.

[Q]: https://huggingface.co/Qwen/Qwen3-ASR-1.7B
[QP]: https://github.com/QwenLM/Qwen3-ASR
[QC]: https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-4bit
[P]: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
[PC]: https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3
[PM]: https://github.com/senstella/parakeet-mlx
[C]: https://huggingface.co/nvidia/canary-1b-v2
[CQ]: https://huggingface.co/nvidia/canary-qwen-2.5b
[V]: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602
[VC]: https://huggingface.co/mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit
[MO]: https://github.com/moonshine-ai/moonshine-v2
[ML]: https://github.com/moonshine-ai/moonshine/blob/main/LICENSE
[W]: https://github.com/openai/whisper
[WT]: https://huggingface.co/openai/whisper-large-v3-turbo
[WC]: https://github.com/ggml-org/whisper.cpp
[WK]: https://github.com/argmaxinc/argmax-oss-swift
[M]: https://github.com/Blaizzy/mlx-audio
[OA]: https://developers.openai.com/api/docs/guides/speech-to-text
[OP]: https://developers.openai.com/api/docs/pricing
[G]: https://console.groq.com/docs/speech-to-text
[DG]: https://developers.deepgram.com/docs/models-languages-overview
[DK]: https://developers.deepgram.com/docs/keyterm
[EL]: https://elevenlabs.io/docs/overview/models/
[EK]: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/keyterm-prompting
[AA]: https://www.assemblyai.com/blog/universal-3-5-pro-code-switching-contextual-prompting
[VX3]: https://docs.mistral.ai/studio/audio/overview
[VXM]: https://docs.mistral.ai/studio/audio/migrate-from-voxtral-2
