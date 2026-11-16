# ChatGPT dictation without realtime turn-finalization waits

Verified 2026-11-16 UTC using synthetic speech and the existing host-side Codex ChatGPT login. No Platform API key, other-provider fallback, or physical microphone was used.

## Why the realtime shortcut was wrong

The previous implementation opened a Quicksilver realtime conversation and waited for a final user turn after stopping the microphone. A trimmed 2.620-second recording of “The orange bicycle is parked beside the library.” produced its complete final transcript about 2.693 seconds after audio stopped. Sending `session.close` immediately returned faster but lost “beside the library.” Closing a conversation is not a verified transcription flush.

That shortcut was rejected. Shortening the timeout would trade latency for lost words, and changing the UI's finishing label would not fix it.

## Separate subscription dictation contract

OpenAI's historical Codex source at commit `bc0a5843df5c3afea0027ef61173aa089958be07` contains a dedicated recording-to-text path:

- [`normalize_chatgpt_base_url`](https://github.com/openai/codex/blob/bc0a5843df5c3afea0027ef61173aa089958be07/codex-rs/tui/src/voice.rs#L752-L787) adds `/backend-api` to the ChatGPT origin and resolves the saved login/account.
- [`transcribe_bytes`](https://github.com/openai/codex/blob/bc0a5843df5c3afea0027ef61173aa089958be07/codex-rs/tui/src/voice.rs#L788-L873) sends a multipart `file` to `/transcribe` with the ChatGPT bearer token and account header, then reads JSON `text`.
- The separate API-key branch uses the Platform audio endpoint and supplies `gpt-4o-mini-transcribe`. That model parameter is **not** sent by the ChatGPT branch; its backend model is not established by this source.

Pi Remote uses only the ChatGPT branch, with its own `pi-remote/0.1` user agent. This is a source-backed and live-tested endpoint, not a claim that OpenAI offers a stable public third-party dictation API or that ChatGPT's own UI necessarily uses the same implementation.

## Direct endpoint probes

The spoken sentence was generated with macOS `say`, converted to 24 kHz mono, and trimmed with ffmpeg. Each request used one whole clip, no transcript prompt, and the existing subscription credential. These are individual observations, not percentile benchmarks.

| Input | HTTP | Request-to-result | Result |
| --- | --- | --- | --- |
| WAV speech | 200 | 480 ms | Complete sentence, including “beside the library.” |
| MP4/AAC speech | 200 | 520 ms | Complete sentence |
| WebM/Opus speech | 200 | 543 ms | Complete sentence |
| Two seconds of MP4/AAC silence | 200 | 505 ms | Empty `text` |

WAV is the format shown in Codex's source. MP4 and WebM acceptance was established by these probes; Pi Remote uses those browser-native recording formats without transcoding on the host.

## Actual Pi Remote UI and host

The opt-in E2E path in `test/voice-e2e.mjs` ran the actual browser composer, real MediaRecorder, isolated local Pi Remote host, and real ChatGPT transcription endpoint. Chromium used an emulated iPhone viewport and a Web Audio source loaded from the synthetic WAV. The agent bridge was simulated and counted prompts.

| Action | Observed result |
| --- | --- |
| Stop immediately after the spoken clip | Editable draft restored in **832 ms**, containing `Keep this draft. The orange bicycle is parked beside the library.` |
| Stop a silent recording | Original draft restored in **846 ms**, with no warning |
| Both recordings | **Zero chat prompts** sent; microphone tracks stopped and metering contexts closed |

Unlike the previous post-final-event figures, these timings begin before clicking Stop and include recorder finalization, upload, provider response, and draft restoration. Browser test polling adds some measurement overhead. They exclude recording duration and do not measure a physical phone or tunnel latency.

The default focused E2E uses real browser recording with simulated provider HTTP. It asserts no external request before Stop, full-clip upload, final draft insertion without a fixed drain timer, silent empty results, explicit Send, cancellation and late-result protection, provider errors, upload bounds, disconnect cleanup, and old-host compatibility.

## Resulting flow and limits

```text
Mic tap → local recording + host login check
Stop → finish encoded clip → authenticated Pi Remote channel
     → host adds subscription credentials → ChatGPT transcription
     → final text → editable draft → user chooses Send
```

Audio now passes through the host in memory instead of direct browser-to-OpenAI WebRTC. Pi Remote does not persist recordings. The host validates format/base64/size, limits each clip to 2 MiB, aborts transcription requests after 20 seconds, and never forwards raw provider error bodies. The browser limits recording to two minutes. Cancellation does not guarantee that OpenAI has not already processed an uploaded clip, but late results cannot change the draft or send a prompt.

Physical iPhone/Safari encoding, mobile network timing, long/noisy/multilingual recordings, and account billing/usage ledgers remain unverified. OAuth success does not prove unlimited access, zero extra cost, or permanent endpoint availability. Claude browser dictation remains unavailable; no ChatGPT fallback is used for Claude-selected sessions.
