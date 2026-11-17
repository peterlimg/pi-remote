# English dictation language controls

The reported failure contained Japanese inside an English dictated message: “Composeを使ったフラッシュにあって、 fast mode and command slash buttons are all missing”. The original audio was not retained, so the exact recognition failure cannot be replayed.

## Subscription endpoint probes

The existing browser-direct subscription session supplied general transcription instructions, without a language hint. The inspected [OpenClaw session builder](https://github.com/openclaw/openclaw/blob/fd0403b40c980de2ab8fe8d20b3d49f06a488596/extensions/openai/realtime-quicksilver-wire.ts) exposes instructions and output voice, but does not establish a transcription-language field for this route.

A live signaling probe added `session.audio.input.transcription.language: 'en'`, without changing the model, account, endpoint, or output voice:

| Configuration | HTTP response | Browser data channel |
| --- | --- | --- |
| English transcription field, attempt 1 | 201, 760 ms | Did not open within 15 seconds |
| Existing configuration, control | 201, 758 ms | Open at 895 ms; direct close acknowledged |
| English transcription field, attempt 2 | 201, 801 ms | Did not open within 15 seconds |

HTTP acceptance did not establish a usable connection or an applied language setting. The field was not retained. These observations do not establish the provider's internal failure cause.

## English-instruction experiment

A live composer run requested English dictation without translation. Synthetic speech about composer controls was recognized in English in both Stop and Send flows, but “stereocilia composed of actin filaments” was still misrecognized in one result as “Stereo Cilia Compose Devactin Filaments”. No Japanese appeared in this sample. This does not establish that instructions control recognition language, and the instruction change was reverted rather than presented as a verified fix.

A proposed browser script filter was also removed: rejecting Japanese output would not explain or correct the recognizer's language choice. No filtering or translation was shipped.

## Buffered versus unbuffered control

With the original instructions restored, the same synthetic WAV was sent through both the direct unbuffered probe and the actual buffered composer. Both produced the complete English sentence, including “stereocilia composed of actin filaments”. The composer's queued Send also produced the correct words. No Japanese appeared in these three recognition results.

The buffered composer deliberately held signaling while speech began. Its draft was editable 59 ms after Stop, complete text arrived at 4,884 ms, and queued Send completed at 9,867 ms. The unbuffered probe received the last word 891 ms after audio ended. These timings include different startup buffering and finalization behavior, so they are not a model-latency comparison. Composer evidence: `pi-voice-evidence-B02wIU` in the system temporary directory.

The available evidence does not reproduce the reported language switch or establish a faulty buffer. The original voice was not retained. Synthetic Chromium verification cannot establish recognition accuracy for the user's voice or physical iPhone microphone. The intended spoken wording and a repeatable phone recording are still needed; an English-only instruction or script filter is not a verified fix.
