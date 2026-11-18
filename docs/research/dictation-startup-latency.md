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

## Narrow change, superseded by the readiness fix

The initial change started buffered playback on WebRTC's `connected` event instead of waiting for the separate data channel. Keep the data-channel-ready fallback, cancellation, connection timeout, original-rate replay, and Send catch-up policy. This removes only the media-to-channel wait, about 0.1 seconds in the baseline. It does not make dictation instant.

The focused browser regression holds the simulated data channel closed after media connects and checks actual outgoing audio. The old implementation produced zero audio and failed after three seconds. The existing tests previously made media and data-channel readiness simultaneous, so they could not catch this delay.

### Validation

The focused regression passed after the change. The final long live run started playback in the same millisecond as media connection; the data channel opened 42–43 ms later. Both speech calls retained the opening instruction and final sentence. The ordinary-startup call reached first text in 3,480 ms, drained 2,312 ms after Stop, and sent in 4,896 ms. Authorization took 1,239 ms in that call, slower than the baseline. These few runs establish the removed wait, not a repeatable overall speedup. Evidence: `pi-voice-evidence-1kPsrk` and `pi-voice-evidence-Lyyf6t`.

`npm run test:voice`, the long live-file run, TypeScript, syntax, and diff checks passed. The full suite and physical iPhone behavior were not checked.

Removing most of the remaining startup backlog needs a separate design decision. Preconnecting before the microphone tap would open a subscription session while the user is not recording, with idle lifetime, quota, and cleanup implications. Accelerating playback would change speech timing; dropping queued audio would lose opening words. Neither behavior is enabled here. No language filter, provider change, UI change, or shorter Send timeout was introduced.

## Preconnection experiment

Preconnection is **not enabled in the phone UI**. The initial isolated protocol probe removed the startup audio backlog, but did not establish reliable transcription after an idle connection. The readiness follow-up below corrected a missing startup gate and obtained a successful warm transcript. Some cold controls also failed to return text, so these results do not identify preconnection as the sole cause.

The [opt-in probe](../../test/voice-preconnect-e2e.mjs) uses the production `VoiceSession` authorizer and audio worklet, a localhost browser fixture, and real subscription WebRTC. It does not load the Pi Remote composer, request a physical microphone, or send a chat prompt. The host authorizer exchanges only SDP; the speech fixture is injected into Chromium as synthetic input. Browser `getUserMedia` is blocked and counted. No credentials, SDP, or provider audio are written to evidence.

```sh
node test/voice-preconnect-e2e.mjs --live-file /tmp/pi-voice-finish-probe/speech.wav "The orange bicycle"
```

This opens up to three calls: cold speech, speech after five seconds connected, and five-second idle expiry. Append `cold`, `warm`, or `idle-expiry` to run only that case. The WAV must begin with the supplied words and end with "The orange bicycle is parked beside the library." The live comparison can fail; it is not part of the default test suite. It now waits for `session.started` before releasing speech and before starting the five-second warm idle period.

The final probe prepares an AudioContext and media destination under a button gesture, then supplies a constant zero-valued source before connecting. It creates the speech source and worklet only when recording begins. This keeps the idle RTP clock running without microphone input. A bare media destination sent no audio packets; a trackless connection also failed to establish reliable transcription. Both alternatives were discarded from the probe.

### Observations

In `pi-voice-preconnect-xtTU3i`:

| Measurement | Cold | Preconnected for five seconds |
| --- | ---: | ---: |
| Authorization | 978 ms | 814 ms |
| Capture to connected media | 1,155 ms | Already connected |
| First text after speech starts | 3,577 ms | No text before the 12.62-second wait expired |
| Stop to buffer drain | 1,120 ms | 5 ms |
| Complete final sentence | Received | Not received |
| Direct close acknowledged | Yes | Yes |

The warm call sent audio with nonzero measured energy after recording began. Before recording, it sent 8,816 bytes of encoded digital silence, with zero measured audio energy, no speech source, no microphone requests, and no transcript events. The missing transcript was therefore not simply an undrained startup buffer. Events included `session.context_window.approaching`, `session.usage.updated`, and `session.started`; their presence does not establish readiness for recognition. Their cause was not determined.

The earlier trackless trial in `pi-voice-preconnect-dr7XSZ` also drained in 5 ms without text. Its direct close was not acknowledged within one second. The browser peer and audio context were closed and the local reservation was released; remote retirement was not confirmed. Other initial cold trials also returned no text. These are not enough samples to estimate provider reliability or prove a latency gain.

The idle-expiry case did receive `session.closed` and closed its peer and audio context. Its first result incorrectly reported cleanup failure because the probe's finalizer attempted to close an already closed AudioContext. The probe now checks that state before closing again. This was a probe cleanup bug, not an application change. The focused `idle-expiry` rerun passed in `pi-voice-preconnect-nHNxrF`, with zero microphone requests, zero measured audio energy, a direct close acknowledgement, and closed browser resources. Syntax and diff checks passed; the failed speech comparison remains a failed result.

No long-speech speed claim follows from a short sample that fails recognition. Physical Safari behavior, background-tab expiry, reconnect races, and quota accounting remain unverified. An idle model session can consume subscription allowance even when its audio is generated silence. The next investigation focused on provider readiness rather than Send completion.

## Provider-readiness follow-up

The actual composer was tested from an isolated checkout of `fc8243a`, excluding concurrent UI work. Test-only instrumentation recorded WebRTC counters, audio energy, provider events, and composer state. A failed short recording had this order:

| Event | Browser clock |
| --- | ---: |
| Capture begins | 1,175 ms |
| Buffered speech starts playing | 4,665 ms |
| Data channel opens | 4,709 ms |
| `session.context_window.approaching` | 4,731 ms |
| OpenAI `session.started` | 9,779 ms |

The short sentence had already played before the session-start event arrived. WebRTC reported nonzero source audio energy and zero remote-reported packet loss. No transcript events arrived. This failure happened before Stop or Send, ruling out Send's completion heuristic as its cause. Transport counters do not prove that the recognizer consumed speech.

The browser now keeps capturing immediately but releases the buffer only after both channel-open and `session.started`. The existing ten-second connection deadline remains; no Send catch-up timer was shortened. Cancellation releases the buffer and ignores late readiness. This supersedes the earlier media-connected optimization.

The focused regression drives real outgoing browser audio with simulated delayed readiness. Before the fix, speech RMS was 0.1065 where silence was required. It also covers readiness before channel-open, readiness after queued Send, cancellation, and readiness timeout without submitting the original draft. Earlier tests made provider and transport readiness effectively simultaneous, so they did not catch this ordering bug.

In the first live candidate run, OpenAI started 4,431 ms after the channel opened. Playback then began immediately and the complete sentence arrived. A silent call and a Send call did not become ready within ten seconds; those were bounded startup failures, not successful recognition. Waiting for readiness does not guarantee that OpenAI will become available promptly.

Two isolated protocol checks then passed with the same speech file:

| Case | Media to provider ready | First text after speech starts | Stop to buffer drain |
| --- | ---: | ---: | ---: |
| Cold | 494 ms | 4,118 ms | 2,080 ms |
| Warm, five seconds after provider ready | 429 ms before recording | 1,374 ms | 5 ms |

Both preserved the supplied opening words and complete final sentence and received direct close acknowledgements. Evidence: `pi-voice-preconnect-cGxwPy` and `pi-voice-preconnect-CaFm1a`. The protocol probe allows twenty seconds to observe readiness; the production composer retains its existing ten-second deadline. These are individual observations, not a speed guarantee. The warm probe still accessed no microphone and sent only generated silence while idle. Preconnection remains an experiment; no automatic idle connection was added to the app.

### Verification limits

The delayed-readiness regression failed against the old implementation, and a live delayed-start recording returned the full sentence with the gate. Cold and warm protocol checks passed as recorded above. Final broader voice runs did not pass: one exceeded the 180-second runner limit, a live short-speech run exceeded 150 seconds, and subsequent simulated runs timed out in draft review and then microphone preparation. The host's load averages were roughly 40–70 during these attempts. A separate browser check took 3–10 seconds just to resume an AudioContext, before any provider signaling. This is a validation blocker, not evidence that the whole voice suite passed.

Test timing now follows the actual contract: synthetic transcript events wait for playback to start, and drain-relative deadlines are checked after the worklet reports drain. Product timers were not extended. Per-call diagnostics preserve the state at peer close so a provider-startup error cannot be mistaken for silent recognition merely because its notice later disappears. The live silence test now requires observed provider readiness.

With the host load back down, the focused suite passed (`pi-voice-evidence-pghg7g`). Live composer runs with the 2.62-second and 26.16-second WAVs both delivered the expected final sentence exactly once to the simulated agent, with no prompt before explicit Send. Tap-to-delivery was 4,027 ms and 3,958 ms respectively. Both silence controls reached provider readiness and sent nothing. Evidence: `pi-voice-evidence-qPbrOo` and `pi-voice-evidence-OR6UhF`. This verifies the readiness gate and delivery for these fixtures, not perfect transcription, a speed guarantee, or physical iPhone behavior.
