import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, devices } from '@playwright/test';
import { VoiceSession } from '../src/voice.mjs';

const [, , flag, file, expectedPrefix, onlyMode] = process.argv;
const modes = ['cold', 'warm', 'idle-expiry'];
if (flag !== '--live-file' || !file || !expectedPrefix || process.argv.length > 6 || onlyMode && !modes.includes(onlyMode)) {
  throw new Error('Usage: node test/voice-preconnect-e2e.mjs --live-file synthetic-speech.wav "Expected opening words" [cold|warm|idle-expiry]');
}
const audio64 = (await readFile(file)).toString('base64');
const worklet = await readFile(new URL('../web/voice-buffer.js', import.meta.url));
const evidence = await mkdtemp(join(tmpdir(), 'pi-voice-preconnect-'));
console.log(`Evidence: ${evidence}`);
const results = [], hostErrors = [], failures = [];
const voice = new VoiceSession({ emit: event => hostErrors.push(event.error) });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/voice-buffer.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/voice-buffer.js' ? worklet : '<button id="prepare">Prepare connection</button><button id="record">Record synthetic speech</button><pre id="transcript"></pre>');
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  for (const mode of onlyMode ? [onlyMode] : modes) {
    const page = await context.newPage();
    let authorizationMs, idle;
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(audio64 => {
        const peer = new RTCPeerConnection();
        let channel;
        const state = window.probe = { peer, turns: new Map(), partial: '', errors: [], eventCounts: {}, microphoneRequests: 0, idleTranscriptEvents: 0 };
        navigator.mediaDevices.getUserMedia = async () => { state.microphoneRequests++; throw new Error('This probe must never request a microphone'); };
        state.text = () => [...state.turns.values(), state.partial].filter(Boolean).join(' ').trim();
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === 'connected') {
            state.connectedAt = performance.now(); state.buffer?.port.postMessage('play');
          }
        };
        const receive = ({ data }) => {
          const event = JSON.parse(data);
          state.eventCounts[event.type] = (state.eventCounts[event.type] || 0) + 1;
          if (event.type === 'session.closed') { state.closeAcknowledged = true; return; }
          if (event.type === 'error') { state.errors.push(event.error?.code || event.code || 'provider-error'); return; }
          if (state.startedAt === undefined) {
            if (event.type === 'input_transcript.added') state.idleTranscriptEvents++;
            return;
          }
          if (event.type === 'input_transcript.added' && typeof event.item?.text === 'string') state.partial += event.item.text;
          else if (event.type === 'turn.done' && event.turn?.role === 'user' && typeof event.turn.transcript === 'string') {
            state.turns.set(event.turn.id, event.turn.transcript); state.partial = '';
          } else return;
          if (state.text()) state.firstTextAt ??= performance.now();
          if (/the orange bicycle is parked beside the library[.!]?$/i.test(state.text())) state.completeAt ??= performance.now();
          document.getElementById('transcript').textContent = state.text();
        };
        document.getElementById('prepare').onclick = async () => {
          document.getElementById('prepare').disabled = true;
          try {
            const audio = state.audio = new AudioContext();
            await audio.resume();
            const output = state.output = audio.createMediaStreamDestination();
            const silence = state.silence = audio.createConstantSource();
            silence.offset.value = 0; silence.connect(output); silence.start();
            state.sender = peer.addTrack(output.stream.getAudioTracks()[0], output.stream);
            channel = state.channel = peer.createDataChannel('oai-events');
            channel.onmessage = receive;
            state.prepared = true;
          } catch (error) { state.errors.push(error.message); }
        };
        document.getElementById('record').onclick = async () => {
          document.getElementById('record').disabled = true;
          try {
            const { audio, output } = state;
            await audio.audioWorklet.addModule('/voice-buffer.js');
            const source = state.source = audio.createBufferSource();
            source.buffer = await audio.decodeAudioData(Uint8Array.from(atob(audio64), c => c.charCodeAt(0)).buffer);
            state.durationMs = Math.round(source.buffer.duration * 1000);
            const buffer = state.buffer = new AudioWorkletNode(audio, 'voice-buffer', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
            buffer.connect(output); source.connect(buffer);
            buffer.port.onmessage = ({ data }) => {
              if (data === 'drained') state.drainedAt = performance.now();
              if (data === 'overflow') state.errors.push('buffer-overflow');
            };
            buffer.onprocessorerror = () => state.errors.push('processor-error');
            if (peer.connectionState === 'connected') buffer.port.postMessage('play');
            source.onended = () => { state.stoppedAt = performance.now(); buffer.port.postMessage('stop'); };
            state.startedAt = performance.now(); source.start();
          } catch (error) { state.errors.push(error.message); }
        };
        state.idle = async () => {
          const stats = await peer.getStats();
          return {
            microphoneRequests: state.microphoneRequests,
            audioContextCreated: !!state.audio,
            attachedAudioTracks: peer.getSenders().filter(s => s.track?.kind === 'audio').length,
            speechSourceCreated: !!state.source,
            idleTranscriptEvents: state.idleTranscriptEvents,
            totalAudioEnergy: [...stats.values()].find(s => s.type === 'media-source' && s.kind === 'audio')?.totalAudioEnergy,
            audioBytesSent: [...stats.values()].filter(s => s.type === 'outbound-rtp' && s.kind === 'audio').reduce((sum, s) => sum + (s.bytesSent || 0), 0)
          };
        };
        state.close = async () => {
          clearTimeout(state.expiry);
          try { state.source?.stop(); } catch {}
          try { state.silence?.stop(); } catch {}
          if (state.buffer) { state.buffer.port.postMessage('dispose'); state.buffer.disconnect(); state.buffer.port.close(); }
          state.output?.stream.getTracks().forEach(track => track.stop());
          if (channel?.readyState === 'open') {
            channel.send(JSON.stringify({ type: 'session.close' }));
            const deadline = performance.now() + 1000;
            while (!state.closeAcknowledged && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
          }
          peer.close();
          if (state.audio && state.audio.state !== 'closed') await state.audio.close();
          return { closeAcknowledged: !!state.closeAcknowledged, peerClosed: peer.connectionState === 'closed', audioClosed: !state.audio || state.audio.state === 'closed' };
        };
      }, audio64);
      const record = async () => {
        await page.getByRole('button', { name: 'Record synthetic speech' }).click();
        await page.waitForFunction(() => window.probe.startedAt !== undefined || window.probe.errors.length, null, { timeout: 10000 });
        assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
      };
      await page.getByRole('button', { name: 'Prepare connection' }).click();
      await page.waitForFunction(() => window.probe.prepared || window.probe.errors.length, null, { timeout: 10000 });
      assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
      if (mode === 'cold') await record();
      const offer = await page.evaluate(async () => {
        const peer = window.probe.peer, offer = await peer.createOffer();
        await peer.setLocalDescription(offer); return offer.sdp;
      });
      const started = performance.now();
      const { sdp } = await voice.start({ id: randomUUID(), sessionId: 'isolated-preconnect-probe', model: 'openai-codex/gpt-5.4', format: 'webrtc-direct', sdp: offer });
      authorizationMs = Math.round(performance.now() - started);
      await page.evaluate(sdp => window.probe.peer.setRemoteDescription({ type: 'answer', sdp }), sdp);
      await page.waitForFunction(() => window.probe.channel.readyState === 'open', null, { timeout: 10000 });
      if (mode !== 'cold') {
        if (mode === 'idle-expiry') {
          await page.evaluate(() => {
            const state = window.probe;
            state.expiry = setTimeout(async () => {
              state.idleBeforeExpiry = await state.idle();
              state.expiryCleanup = await state.close();
            }, 5000);
          });
          await page.waitForFunction(() => window.probe.expiryCleanup, null, { timeout: 8000 });
        } else await page.waitForTimeout(5000);
        idle = await page.evaluate(() => window.probe.idleBeforeExpiry || window.probe.idle());
        const { audioBytesSent, ...idleState } = idle;
        assert.deepEqual(idleState, { microphoneRequests: 0, audioContextCreated: true, attachedAudioTracks: 1, speechSourceCreated: false, idleTranscriptEvents: 0, totalAudioEnergy: 0 });
        assert.ok(audioBytesSent > 0, 'The preconnection should carry generated silence, not microphone audio');
        if (mode === 'warm') await record();
      }
      if (mode !== 'idle-expiry') {
        const durationMs = await page.evaluate(() => window.probe.durationMs);
        await page.waitForFunction(() => window.probe.stoppedAt !== undefined && window.probe.drainedAt !== undefined && window.probe.completeAt !== undefined, null, { timeout: durationMs + 10000 });
        const text = await page.locator('#transcript').textContent();
        assert.ok(text.toLowerCase().startsWith(expectedPrefix.toLowerCase()), `Opening words missing: ${text}`);
        assert.match(text, /the orange bicycle is parked beside the library[.!]?$/i);
        if (mode === 'warm') {
          assert.ok(await page.evaluate(() => window.probe.connectedAt < window.probe.startedAt));
          assert.ok(await page.evaluate(() => window.probe.drainedAt - window.probe.stoppedAt < 200), 'A warm connection must not retain a startup audio backlog');
        }
      }
      assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
    } catch (error) {
      failures.push({ mode, message: error.message });
    } finally {
      const timing = await page.evaluate(async () => {
        const s = window.probe;
        if (!s) return {};
        const stats = await s.sender.getStats().catch(() => new Map());
        return {
          audioState: s.audio?.state,
          direction: s.peer.getTransceivers()[0].currentDirection,
          eventCounts: s.eventCounts,
          audioStats: [...stats.values()].filter(v => ['outbound-rtp', 'media-source'].includes(v.type)).map(v => ({ type: v.type, kind: v.kind, bytesSent: v.bytesSent, packetsSent: v.packetsSent, totalAudioEnergy: v.totalAudioEnergy, totalSamplesDuration: v.totalSamplesDuration })),
          durationMs: s.durationMs,
          captureToMediaMs: s.startedAt === undefined ? null : Math.max(0, Math.round(s.connectedAt - s.startedAt)),
          speechToFirstTextMs: s.firstTextAt === undefined ? null : Math.round(s.firstTextAt - s.startedAt),
          stopToBufferDrainedMs: s.drainedAt === undefined ? null : Math.round(s.drainedAt - s.stoppedAt),
          stopToCompleteTextMs: s.completeAt === undefined ? null : Math.round(s.completeAt - s.stoppedAt),
          microphoneRequests: s.microphoneRequests, text: s.text(), errors: s.errors
        };
      }).catch(() => ({}));
      const cleanup = await page.evaluate(() => window.probe?.close()).catch(() => ({ closeAcknowledged: false }));
      voice.cancel(); await page.close();
      results.push({ mode, authorizationMs, idle, ...timing, cleanup, failure: failures.find(f => f.mode === mode)?.message });
      await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(results.at(-1)));
    }
    assert.equal(voice.active, undefined);
    assert.equal(results.at(-1).microphoneRequests, 0);
    assert.deepEqual(results.at(-1).cleanup, { closeAcknowledged: true, peerClosed: true, audioClosed: true });
  }
  assert.deepEqual(hostErrors, []);
  assert.deepEqual(failures, []);
  console.log(`PASS: ${results.map(result => result.mode).join(', ')}. Evidence: ${evidence}`);
} finally {
  voice.cancel(); await browser?.close(); await new Promise(resolve => server.close(resolve));
}
