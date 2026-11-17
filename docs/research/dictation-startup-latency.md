# Dictation startup latency

## Scope

Measured the browser-direct subscription path at `b5ce82f` using the real isolated host, Chromium's iPhone viewport, synthetic WAV input, and real OpenAI WebRTC. Explicit Send goes to a simulated agent. These are not physical iPhone or real-agent response timings. No audio or transcript went through the host before Send.

The existing voice test now timestamps capture, SDP exchange, the media connection, data-channel opening, playback, first transcript, the following preview update, and buffer drain. Authorization timing excludes the test's deliberate signaling hold. Preview timing reads the textarea on the next event-loop task, not the physical screen's paint time.

```sh
npm run test:voice -- --live-file /tmp/pi-voice-finish-probe/long.wav
npm run test:voice -- --live-file /tmp/pi-voice-finish-probe/speech.wav
```

Both samples end with "The orange bicycle is parked beside the library." The long sample lasts 26.16 seconds. The first call holds signaling for 1.5 seconds while the sample starts. The third call measures recording followed by Send without that deliberate hold.

## Baseline

| Measurement | Long sample, ordinary startup | Short sample, ordinary startup |
| --- | ---: | ---: |
| OpenAI authorization | 771 ms | 792 ms |
| Capture to data-channel open | 1,905 ms | 1,991 ms |
| Answer to media connection | Not instrumented | 1,084 ms |
| Media connection to data channel | Not instrumented | 108 ms |
| Speech start to first text | 3,821 ms | 2,963 ms |
| Transcript arrival to preview read | Not measured correctly in this run | 1 ms |
| Stop to buffered audio drained | 1,908 ms | 1,987 ms |
| Send to simulated agent | 4,471 ms | 4,564 ms |

Evidence directories are `pi-voice-evidence-2fr2Ji` and `pi-voice-evidence-N1JBtQ` under the system temporary directory. The first instrumentation version read the preview in a microtask that ran before the production message handler; that field is not evidence of rendering delay. The later test reads it on the next task.

The startup backlog survives the entire recording. The [worklet](../../web/voice-buffer.js) consumes one sample for every output sample while the microphone adds samples at the same rate. With the deliberately held long call, capture-to-connection was 3,637 ms and Stop-to-drain was 3,633 ms. The UI updates promptly once text arrives. These measurements do not separate OpenAI processing from audio transport and speech-content effects.

## Rejected experiment

Waited up to 250 ms for ICE gathering and sent `peer.localDescription.sdp` instead of the original offer. This did not reduce connection time. In the ordinary long call, answer-to-media remained 1,085 ms, capture-to-channel was 2,124 ms, and Stop-to-drain was 2,122 ms. The extra gathering wait increased startup time. The production experiment and its test were removed. Evidence: `pi-voice-evidence-2WNVYe`.

A direct-channel protocol probe also reconfirmed that `input_audio_buffer.commit` is rejected. Its accepted-message list contained pause/resume and session control, but no PCM append command. This is not a documented way to burst buffered audio ahead of the realtime media clock. See [the direct-channel investigation](phone-direct-dictation.md) for the endpoint and authentication contract.

## Narrow change

Start buffered playback on WebRTC's `connected` event instead of waiting for the separate data channel. Keep the data-channel-ready fallback, cancellation, connection timeout, original-rate replay, and Send catch-up policy. This removes only the media-to-channel wait, about 0.1 seconds in the baseline. It does not make dictation instant.

The focused browser regression holds the simulated data channel closed after media connects and checks actual outgoing audio. The old implementation produced zero audio and failed after three seconds. The existing tests previously made media and data-channel readiness simultaneous, so they could not catch this delay.

### Validation

The focused regression passed after the change. The final long live run started playback in the same millisecond as media connection; the data channel opened 42–43 ms later. Both speech calls retained the opening instruction and final sentence. The ordinary-startup call reached first text in 3,480 ms, drained 2,312 ms after Stop, and sent in 4,896 ms. Authorization took 1,239 ms in that call, slower than the baseline. These few runs establish the removed wait, not a repeatable overall speedup. Evidence: `pi-voice-evidence-1kPsrk` and `pi-voice-evidence-Lyyf6t`.

`npm run test:voice`, the long live-file run, TypeScript, syntax, and diff checks passed. The full suite and physical iPhone behavior were not checked.

Removing most of the remaining startup backlog needs a separate design decision. Preconnecting before the microphone tap would open a subscription session while the user is not recording, with idle lifetime, quota, and cleanup implications. Accelerating playback would change speech timing; dropping queued audio would lose opening words. Neither behavior is enabled here. No language filter, provider change, UI change, or shorter Send timeout was introduced.
