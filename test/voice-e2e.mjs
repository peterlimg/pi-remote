// Real host/UI with synthetic microphone audio; external SDP and browser WebRTC are simulated by default.
// --live-file opts into real browser-to-OpenAI WebRTC using the host's Codex subscription login.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../src/host.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until, delay } from './helpers.mjs';

const liveFile = process.argv[2] === '--live-file' ? process.argv[3] : undefined;
if (process.argv.length > 2 && !liveFile) throw new Error('Usage: node test/voice-e2e.mjs [--live-file synthetic-speech.wav]');
const dir = mkdtempSync(join(tmpdir(), 'pi-voice-e2e-')), evidence = mkdtempSync(join(tmpdir(), 'pi-voice-evidence-'));
const config = { port: 8787, clientToken: 'voice-test-client-only-1234567890123456', bridgeToken: 'voice-test-bridge-only-1234567890123456', relayToken: 'voice-test-relay-only-12345678901234567' };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
let host, browser, context, page, probe, mode = 'ok', releaseRequest, releaseAuth;
const agents = [], locks = [], offers = [], commands = [], errors = [], hostFrames = [];
const diagnostics = async () => {
  if (!liveFile || !page || page.isClosed()) return;
  const data = await page.evaluate(() => window.voicePeers?.length ? {
    timing: window.voiceTiming, events: window.voiceEvents, eventCounts: window.voiceEventCounts,
    transport: window.voiceTransport, closed: window.voiceClosed, outcome: window.voiceOutcome,
    phase: document.getElementById('composer')?.dataset.voice,
    text: document.getElementById('prompt')?.value,
    notice: document.getElementById('notice')?.hidden ? '' : document.getElementById('notice')?.textContent
  } : null);
  if (!data) return;
  writeFileSync(join(evidence, `call-${offers.length}.json`), JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ call: offers.length, promptsSent: commands.length, timing: data.timing,
    eventCounts: data.eventCounts, phase: data.phase, text: data.text, notice: data.notice, closed: data.closed, outcome: data.outcome }));
};
try {
  host = await startHost({ dir, config, port: 0, roots: [], relayUrl: '', publicUrl: 'http://127.0.0.1:8787' });
  host.service.voiceOptions = {
    ...(!liveFile ? { readAuth: async () => {
      if (mode === 'auth-held') await new Promise(resolve => { releaseAuth = resolve; });
      return { token: 'private-test-token', account: 'private-test-account' };
    } } : {}),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['sdp', 'session']);
      assert.equal(body.session.model, 'gpt-live-1-codex'); assert.ok(body.sdp.startsWith('v=0'));
      offers.push({ body, signal: options.signal });
      if (mode === 'held') await new Promise(resolve => { releaseRequest = resolve; });
      if (liveFile) {
        const started = performance.now(), response = await fetch(url, options);
        console.log(JSON.stringify({ live: true, authorizationMs: Math.round(performance.now() - started), status: response.status }));
        return response;
      }
      assert.equal(options.headers.Authorization, 'Bearer private-test-token');
      if (mode === 'quota') return new Response('private-test-token: provider error details', { status: 429 });
      if (mode === 'malformed') return new Response('private-test-token: invalid SDP');
      if (mode === 'oversized') return new Response(sdp + 'x'.repeat(256 * 1024));
      return new Response(sdp, { status: 201 });
    }
  };
  const origin = `http://127.0.0.1:${host.http.address().port}`, states = [];
  for (const [title, model] of [['Voice Alpha', 'openai-codex/gpt-5.4'], ['Voice Beta', 'claude-sdk/claude-sonnet-5-5']]) {
    const file = join(dir, title + '.jsonl'); writeFileSync(file, '');
    const id = sessionKey(file), instanceId = randomUUID(), lock = acquireLock(join(dir, 'locks'), id, { file, instanceId }); locks.push(lock);
    const agent = await socket(origin.replace('http:', 'ws:') + '/bridge', config.bridgeToken); agents.push(agent);
    const state = { id, file, instanceId, title, model, cwd: dir, status: 'idle', fastMode: true, contextUsage: { tokens: 32000, contextWindow: 100000, percent: 32 }, messages: [{ id: 'hello', role: 'user', text: 'Voice test' }], tools: [], revision: 0, updatedAt: Date.now() };
    states.push(state); agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString()); if (packet.type !== 'command') return;
      if (packet.command.type === 'prompt') commands.push(packet.command);
      const value = packet.command.type === 'getCommands' ? { commands: [] } : packet.command.type === 'getUsage'
        ? { model: state.model, contextUsage: state.contextUsage } : { accepted: true };
      agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value }));
    });
  }
  await until(() => host.service.live.size === 2);
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  context = await browser.newContext({ ...devices['iPhone 13'], permissions: ['microphone'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.addInitScript(({ audio64, sdp }) => {
    if (!navigator.mediaDevices) return;
    window.voiceTracks = []; window.voiceContexts = []; window.voicePeers = []; window.voiceSent = []; window.voiceClosed = 0; window.voiceEvents = [];
    window.voiceTiming = {}; window.voiceEventCounts = {}; window.voiceTransport = [];
    const NativeAudioContext = window.AudioContext, NativePeer = window.RTCPeerConnection, NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(...args) {
        super(...args);
        window.voiceTiming.capture = performance.now();
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = message => {
          if (message === 'play') window.voiceTiming.play ??= performance.now();
          if (message === 'stop') window.voiceTiming.stop = performance.now();
          if (message === 'dispose') window.voiceTiming.dispose = performance.now();
          return post(message);
        };
        this.port.addEventListener('message', ({ data }) => {
          if (data === 'drained') window.voiceTiming.drained = performance.now();
        });
      }
    };
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.voiceContexts.push(this); }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new NativeAudioContext(), destination = audio.createMediaStreamDestination();
      if (audio64) {
        const source = audio.createBufferSource();
        source.buffer = await audio.decodeAudioData(Uint8Array.from(atob(audio64), c => c.charCodeAt(0)).buffer);
        source.connect(destination);
        window.playVoiceSample = () => new Promise(resolve => { source.onended = () => { window.voiceAudioEndedAt = performance.now(); resolve(); }; window.voiceTiming.speech = performance.now(); source.start(); });
      } else {
        const oscillator = audio.createOscillator(), gain = window.voiceGain = audio.createGain();
        gain.gain.value = .15; oscillator.connect(gain); gain.connect(destination); oscillator.start();
      }
      await audio.resume(); window.voiceTracks.push(...destination.stream.getTracks()); return destination.stream;
    };
    if (audio64) {
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) {
          super(...args); window.voicePeers.push(this);
          this.statsTimer = setInterval(async () => {
            try {
              const stats = await this.getStats();
              window.voiceTransport.push({ at: performance.now(), stats: [...stats.values()]
                .filter(s => ['outbound-rtp', 'remote-inbound-rtp', 'media-source'].includes(s.type))
                .map(s => ({ type: s.type, kind: s.kind, bytesSent: s.bytesSent, packetsSent: s.packetsSent,
                  packetsLost: s.packetsLost, roundTripTime: s.roundTripTime,
                  totalAudioEnergy: s.totalAudioEnergy, totalSamplesDuration: s.totalSamplesDuration })) });
            } catch {}
          }, 500);
          this.addEventListener('connectionstatechange', () => {
            if (this.connectionState === 'connected') window.voiceTiming.mediaConnected = performance.now();
          });
        }
        close() {
          window.voiceOutcome = { at: performance.now(), phase: document.getElementById('composer')?.dataset.voice,
            notice: document.getElementById('notice')?.hidden ? '' : document.getElementById('notice')?.textContent };
          clearInterval(this.statsTimer); super.close();
        }
        async createOffer(...args) {
          window.voiceTiming.offer = performance.now();
          return super.createOffer(...args);
        }
        async setRemoteDescription(...args) {
          window.voiceTiming.answer = performance.now();
          return super.setRemoteDescription(...args);
        }
        createDataChannel(...args) {
          const channel = super.createDataChannel(...args);
          channel.addEventListener('open', () => { window.voiceTiming.connected = performance.now(); });
          channel.addEventListener('message', event => { try {
            const packet = JSON.parse(event.data);
            window.voiceEventCounts[packet.type] = (window.voiceEventCounts[packet.type] || 0) + 1;
            if (packet.type === 'session.started') window.voiceTiming.providerReady ??= performance.now();
            if (['session.started', 'session.context_window.approaching', 'session.usage.updated'].includes(packet.type)) {
              window.voiceEvents.push({ at: performance.now(), type: packet.type,
                detail: JSON.parse(JSON.stringify(packet, (key, value) => typeof value === 'string' ? undefined : value)) });
            }
            if (packet.type === 'input_transcript.added' && packet.item?.text?.trim() && !window.voiceTiming.firstText) {
              window.voiceTiming.firstText = performance.now();
              setTimeout(() => {
                window.voiceTiming.firstPreview = document.getElementById('prompt').value;
                window.voiceTiming.preview = performance.now();
              }, 0);
            }
            if (packet.type === 'session.closed') window.voiceClosed++;
            if (['input_transcript.added', 'turn.done', 'error'].includes(packet.type)) window.voiceEvents.push({ at: performance.now(), type: packet.type, role: packet.turn?.role, id: packet.turn?.id, text: packet.type === 'input_transcript.added' ? packet.item?.text : packet.turn?.role === 'user' ? packet.turn.transcript : undefined });
          } catch {} });
          return channel;
        }
      };
    } else window.RTCPeerConnection = class {
      connectionState = 'new';
      constructor() { window.voicePeers.push(this); }
      addTrack(track, stream) { this.outbound = stream; }
      createDataChannel(label) {
        if (label !== 'oai-events') throw new Error('Wrong channel');
        return this.channel = { readyState: 'connecting', send(raw) {
          const packet = JSON.parse(raw); window.voiceSent.push(packet);
          if (packet.type !== 'session.close') throw new Error('Unexpected control event');
          if (!window.voiceSkipClose) setTimeout(() => { this.onmessage?.({ data: '{"type":"session.closed"}' }); }, 0);
        } };
      }
      async createOffer() { return { type: 'offer', sdp }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = 'connected'; this.onconnectionstatechange?.();
        if (!window.voiceHoldConnection) { this.channel.readyState = 'open'; this.channel.onopen?.(); }
        if (!window.voiceHoldReady) this.channel.onmessage?.({ data: '{"type":"session.started"}' });
      }
      close() {
        if (this.connectionState === 'closed') return;
        this.connectionState = 'closed'; this.channel.readyState = 'closed'; this.channel.onclose?.(); this.onconnectionstatechange?.();
      }
    };
    window.monitorVoiceOutput = async () => {
      const audio = new NativeAudioContext(), analyser = audio.createAnalyser();
      audio.createMediaStreamSource(window.voicePeers.at(-1).outbound).connect(analyser);
      await audio.resume();
      window.voiceOutputLevel = () => {
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      };
      window.stopVoiceMonitor = () => audio.close();
    };
  }, { audio64: liveFile ? readFileSync(liveFile).toString('base64') : null, sdp });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', socket => socket.on('framesent', event => { try { hostFrames.push(JSON.parse(String(event.payload))); } catch {} }));
  const fresh = async () => {
    await diagnostics();
    mode = 'ok'; await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click();
    await expect(page.locator('#voice-record')).toBeVisible(); await expect(page.locator('#app')).not.toHaveClass(/opening/);
  };
  const record = async () => {
    await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
    await expect(page.locator('#voice-label')).toHaveText('Listening', { timeout: 20000 });
  };
  const stopped = async () => expect.poll(() => page.evaluate(() =>
    window.voiceTracks.every(track => track.readyState === 'ended'))).toBe(true);
  const closed = async () => expect.poll(() => page.evaluate(() => window.voicePeers.every(peer => peer.connectionState === 'closed') && window.voiceContexts.every(audio => audio.state !== 'running')), { timeout: 15000 }).toBe(true);
  const stop = () => page.getByRole('button', { name: 'Stop dictation' }).click();
  const packet = event => page.evaluate(event => window.voicePeers.at(-1).channel.onmessage?.({ data: JSON.stringify(event) }), event);
  const playbackStarted = () => page.waitForFunction(() => window.voiceTiming.play !== undefined, null, { timeout: 15000 });
  const drained = () => page.waitForFunction(() => window.voiceTiming.drained !== undefined, null, { timeout: 15000 });
  const partial = async text => { await playbackStarted(); return packet({ type: 'input_transcript.added', item: { text } }); };
  const final = async (text, id = 'turn-1') => { await playbackStarted(); return packet({ type: 'turn.done', turn: { id, role: 'user', transcript: text } }); };
  const timing = () => page.evaluate(() => {
    const t = window.voiceTiming;
    return {
      captureToConnectionMs: Math.round(t.connected - t.capture),
      captureToPlaybackMs: Math.round(t.play - t.capture),
      offerToAnswerMs: Math.round(t.answer - t.offer),
      answerToMediaMs: Math.round(t.mediaConnected - t.answer),
      mediaToChannelMs: Math.round(t.connected - t.mediaConnected),
      mediaToPlaybackMs: Math.round(t.play - t.mediaConnected),
      channelToProviderReadyMs: Math.round(t.providerReady - t.connected),
      providerReadyToPlaybackMs: Math.round(t.play - t.providerReady),
      transcriptToPreviewMs: Math.round(t.preview - t.firstText),
      speechToFirstTextMs: Math.round(t.firstText - t.speech),
      stopToBufferDrainedMs: Math.round(t.drained - t.stop),
      firstPreview: t.firstPreview
    };
  });
  const assertPrivate = () => {
    for (const frame of hostFrames.filter(frame => frame.op?.startsWith('voice'))) {
      assert.ok(['voiceStart', 'voiceCancel'].includes(frame.op));
      assert.deepEqual(Object.keys(frame).sort(), (frame.op === 'voiceStart' ? ['id', 'op', 'sessionId', 'voiceId', 'format', 'sdp'] : ['id', 'op', 'sessionId', 'voiceId']).sort());
    }
  };

  await fresh(); await expect(page.locator('#voice-accept')).toHaveCount(0);
  await expect(page.locator('#fast-mode')).toBeVisible(); await expect(page.locator('#commands')).toBeVisible();
  await page.locator('#prompt').fill('Keep this draft.');
  await page.locator('#prompt').evaluate(input => { window.voicePromptBlurs = 0; input.addEventListener('blur', () => window.voicePromptBlurs++); });
  if (liveFile) mode = 'held';
  else await page.evaluate(() => { window.voiceHoldConnection = true; window.voiceHoldReady = true; });
  await record();
  if (liveFile) {
    await until(() => releaseRequest);
    const playback = page.evaluate(() => window.playVoiceSample());
    await delay(1500); releaseRequest(); releaseRequest = undefined;
    await playback;
    await playbackStarted();
    assert.ok(await page.evaluate(() => window.voiceTiming.play >= window.voiceTiming.providerReady), 'Speech must wait for provider readiness');
    assert.ok(await page.evaluate(() => window.voiceTransport.filter(t => t.at < window.voiceTiming.providerReady).every(t => t.stats.every(s => !s.totalAudioEnergy))), 'No speech energy before provider readiness');
    await expect(page.locator('#prompt')).not.toHaveValue('Keep this draft.', { timeout: 6000 });
    await expect(page.locator('#composer')).toHaveAttribute('data-voice', 'recording');
    await expect(page.locator('#prompt')).toBeFocused();
    await page.screenshot({ path: join(evidence, 'live-recording-phone.png'), fullPage: true });
    const started = performance.now(); await stop(); await stopped();
    await expect(page.locator('#prompt')).toBeVisible({ timeout: 1000 });
    await expect(page.locator('#prompt')).toBeFocused();
    await expect(page.locator('#prompt')).toBeEditable(); await expect(page.locator('#send')).toBeEnabled();
    const stopToEditableDraftMs = Math.round(performance.now() - started);
    assert.equal(await page.evaluate(() => window.voicePromptBlurs), 0);
    const recognitionTimeout = await page.evaluate(() => Math.ceil(window.voiceTiming.play - window.voiceTiming.capture) + 6000);
    try { await expect(page.locator('#prompt')).toHaveValue(/^Keep this draft\.[\s\S]*The orange bicycle is parked beside the library[.!]?$/i, { timeout: recognitionTimeout }); }
    catch (error) {
      console.log(JSON.stringify({ liveDiagnostics: await page.evaluate(() => window.voiceEvents.slice(-15).map(({ at, ...event }) => ({ ...event, afterAudioEndMs: Math.round(at - window.voiceAudioEndedAt) }))) }));
      throw error;
    }
    const stopToCompletePreviewMs = Math.round(performance.now() - started);
    await page.screenshot({ path: join(evidence, 'live-preview-phone.png'), fullPage: true });
    const editedWhileFinishing = await page.locator('#composer').getAttribute('data-voice') === 'finishing';
    await page.locator('#prompt').focus(); await page.keyboard.insertText(' ');
    await expect(page.locator('#voice-status')).toBeHidden();
    await expect(page.locator('#notice')).toBeHidden();
    const text = (await page.locator('#prompt').inputValue()).trim();
    assert.match(text, /^Keep this draft\.[\s\S]*The orange bicycle is parked beside the library[.!]?$/i);
    console.log(JSON.stringify({ live: true, ...await timing(), stopToEditableDraftMs, stopToCompletePreviewMs, editedWhileFinishing, text, promptsSent: commands.length }));
    assert.equal(commands.length, 0); assert.ok(!JSON.stringify(hostFrames).includes('orange bicycle'));
    await closed(); assert.equal(await page.evaluate(() => window.voiceClosed), 1);
    await fresh(); await page.locator('#prompt').fill('Silent draft'); await record(); await delay(500);
    const emptyStarted = performance.now(); await stop(); await stopped();
    await expect(page.locator('#voice-status')).toBeHidden();
    await expect(page.locator('#composer')).not.toHaveAttribute('data-voice', /.+/, { timeout: 20000 });
    await expect(page.locator('#prompt')).toHaveValue('Silent draft'); await expect(page.locator('#notice')).toBeHidden();
    console.log(JSON.stringify({ live: true, silenceCleanupMs: Math.round(performance.now() - emptyStarted), promptsSent: commands.length }));
    await closed(); assert.equal(await page.evaluate(() => window.voiceClosed), 1); assert.equal(commands.length, 0);
    assert.ok(await page.evaluate(() => window.voiceTiming.providerReady !== undefined), 'Silence must reach provider readiness, not pass after a startup failure');
    await fresh(); await record(); await page.evaluate(() => window.playVoiceSample());
    const sendStarted = performance.now(); await page.getByRole('button', { name: 'Send message' }).click();
    await until(() => commands.length === 1, 15000);
    assert.match(commands[0].text, /The orange bicycle is parked beside the library[.!]?$/i);
    await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#model')).toBeVisible();
    await expect(page.locator('#prompt')).toHaveValue('');
    console.log(JSON.stringify({ live: true, ...await timing(), catchupSendMs: Math.round(performance.now() - sendStarted), text: commands[0].text, promptsToSimulatedAgent: commands.length }));
    await closed(); assert.equal(await page.evaluate(() => window.voiceClosed), 1);
    assert.equal(commands.length, 1, 'Exactly one prompt after closing the voice connection');
  } else {
    await until(() => offers.length === 1);
    assert.ok(await page.locator('#voice-waveform i').count() < 12, 'No prefilled dot line');
    await page.evaluate(() => window.monitorVoiceOutput()); await delay(150);
    await expect.poll(() => page.evaluate(() => window.voiceOutputLevel()), { timeout: 1000, message: 'Connected transport must not release speech before provider readiness' }).toBeLessThan(.001);
    await packet({ type: 'session.started' });
    assert.ok(await page.evaluate(() => window.voiceOutputLevel()) < .001, 'Provider readiness alone must not bypass the channel wait');
    await page.evaluate(() => {
      const channel = window.voicePeers.at(-1).channel;
      channel.readyState = 'open'; channel.onopen();
    });
    await expect.poll(() => page.evaluate(() => window.voiceOutputLevel())).toBeGreaterThan(.03);
    await page.evaluate(() => window.stopVoiceMonitor());
    await partial('Purple notebook');
    await packet({ type: 'turn.done', turn: { id: 'assistant-1', role: 'assistant', transcript: 'Do not insert this' } });
    await packet({ type: 'delegation.created', item: { type: 'delegation', target: 'client' } });
    await expect.poll(() => page.locator('#voice-waveform i').count()).toBeGreaterThan(0);
    const positions = await page.locator('#voice-waveform i').first().evaluate(async bar => {
      const x = []; for (let frame = 0; frame < 20; frame++) { await new Promise(requestAnimationFrame); x.push(bar.getBoundingClientRect().x); } return x;
    });
    assert.ok(positions.slice(1).filter((x, i) => x < positions[i] - .05).length >= 15, 'Continuous waveform motion');
    await expect(page.locator('#prompt')).toBeVisible(); await expect(page.locator('#prompt')).toBeFocused(); await expect(page.locator('#send')).toBeVisible();
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook');
    await expect(page.locator('#composer')).toHaveAttribute('data-voice', 'recording');
    await expect(page.locator('#send')).toBeEnabled(); await expect(page.locator('#model')).toBeHidden();
    assert.equal(await page.locator('#voice-status').evaluate(node => node.parentElement.className), 'composer-toolbar');
    const levels = () => page.locator('#voice-waveform i').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.height)));
    await expect.poll(async () => Math.max(...await levels())).toBeGreaterThan(20);
    const waveformShape = () => page.locator('#voice-waveform').evaluate(node => {
      const left = node.getBoundingClientRect().left;
      return [...node.children].map(bar => ({ x: bar.getBoundingClientRect().left - left, height: parseFloat(bar.style.height), opacity: parseFloat(bar.style.opacity) }));
    });
    await expect.poll(async () => {
      const shape = await waveformShape();
      return {
        fullHeight: shape.some(bar => bar.x > 48 && bar.height > 20),
        taper: shape.some(bar => bar.x > 12 && bar.x < 30 && bar.height > 3 && bar.height < 20),
        dot: shape.some(bar => bar.x >= 0 && bar.x <= 6 && bar.height < 3.01 && bar.opacity < 1),
        unclipped: shape.filter(bar => bar.x < 0).every(bar => bar.opacity === 0),
      };
    }).toEqual({ fullHeight: true, taper: true, dot: true, unclipped: true });
    await page.locator('#voice-waveform').screenshot({ path: join(evidence, 'waveform-taper.png') });
    await page.evaluate(() => { window.voiceGain.gain.value = 0; }); await expect.poll(async () => Math.max(...await levels())).toBe(3);
    await page.evaluate(() => { window.voiceGain.gain.value = .01; }); await expect.poll(async () => Math.max(...await levels())).toBeGreaterThan(8);
    for (const [width, colorScheme] of [[320, 'light'], [390, 'dark'], [1280, 'light']]) {
      await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme });
      const field = await page.locator('#prompt').boundingBox(), toolbar = await page.locator('.composer-toolbar').boundingBox();
      assert.ok(field.y + field.height <= toolbar.y + 1, 'Live text stays above the recording toolbar');
      for (const id of ['prompt', 'voice-cancel', 'voice-waveform', 'voice-record', 'send']) {
        const box = await page.locator('#' + id).boundingBox();
        assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width, `${id} fits while recording at ${width}px`);
        if (['voice-cancel', 'voice-record', 'send'].includes(id)) assert.ok(box.width >= 44 && box.height >= 44);
      }
      await page.screenshot({ path: join(evidence, `recording-${width}-${colorScheme}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' });
    await stop(); await stopped();
    await expect(page.locator('#prompt')).toBeVisible(); await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook');
    await expect(page.locator('#prompt')).toBeFocused(); await expect(page.locator('#model')).toBeVisible();
    await expect(page.locator('#fast-mode')).toBeVisible(); await expect(page.locator('#commands')).toBeVisible();
    assert.equal(await page.evaluate(() => window.voicePromptBlurs), 0);
    await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#voice-label')).toBeEmpty();
    await expect(page.locator('#prompt')).toBeEditable(); await expect(page.locator('#send')).toBeEnabled();
    assert.equal(commands.length, 0);
    await partial(' beside the lamp'); await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook beside the lamp');
    await delay(1900); const receivedAt = performance.now(); await final('Purple notebook beside the lamp.');
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook beside the lamp.', { timeout: 1000 });
    await expect(page.locator('#prompt')).toBeFocused();
    await expect(page.locator('#prompt')).toBeEditable();
    console.log(`Final provider event to draft after drain: ${Math.round(performance.now() - receivedAt)}ms`);
    await closed(); assert.equal(commands.length, 0); assert.ok(!JSON.stringify(hostFrames).includes('Purple notebook'));
    await page.getByRole('button', { name: 'Send message' }).click(); await until(() => commands.length === 1);
    assert.equal(commands[0].text, 'Keep this draft. Purple notebook beside the lamp.');

    await fresh(); await page.locator('#prompt').fill('Keep unchanged'); await record();
    await page.getByRole('button', { name: 'Send message' }).click(); await stopped();
    await expect(page.locator('#prompt')).toBeVisible(); await expect(page.locator('#prompt')).toBeFocused();
    await drained();
    await expect(page.locator('#composer')).not.toHaveAttribute('data-voice', /.+/, { timeout: 10000 }); await closed();
    await expect(page.locator('#prompt')).toHaveValue('Keep unchanged'); await expect(page.locator('#notice')).toBeHidden(); assert.equal(commands.length, 1);

    await fresh(); await record(); await final('First sentence.'); await stop(); await partial('Trailing');
    await final('First sentence.'); await delay(1900);
    await expect(page.locator('#composer')).toHaveAttribute('data-voice', 'finishing'); await expect(page.locator('#voice-status')).toBeHidden();
    await final('Trailing words preserved.', 'turn-2');
    await expect(page.locator('#prompt')).toHaveValue('First sentence. Trailing words preserved.', { timeout: 1000 }); await closed();

    await fresh(); await record(); await partial('Unconfirmed words'); await stop();
    await expect(page.locator('#prompt')).toHaveValue('Unconfirmed words', { timeout: 1000 });
    await drained();
    await expect(page.locator('#composer')).toHaveAttribute('data-voice', 'review', { timeout: 10000 }); await closed();
    await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#voice-label')).toBeEmpty(); await expect(page.locator('#notice')).toBeHidden();
    await expect(page.locator('#send')).toBeEnabled(); await expect(page.locator('#prompt')).toBeEditable();
    await expect(page.locator('#prompt')).not.toBeFocused();
    await page.locator('#prompt').click(); await expect(page.locator('#prompt')).toBeFocused();
    await page.locator('#prompt').fill('Reviewed words');
    await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('Reviewed words');
    assert.equal(await page.evaluate(() => window.voiceSent.filter(event => event.type === 'session.close').length), 1);

    await fresh(); await page.locator('#prompt').fill('Before after');
    await page.locator('#prompt').evaluate(input => input.setSelectionRange(6, 6));
    await record(); await partial('Early preview'); await stop();
    await expect(page.locator('#prompt')).toHaveValue('Before Early preview after', { timeout: 1000 });
    await page.locator('#prompt').evaluate(input => input.setSelectionRange(0, 6));
    await partial(' only'); await expect(page.locator('#prompt')).toHaveValue('Before Early preview only after');
    assert.deepEqual(await page.locator('#prompt').evaluate(input => [input.selectionStart, input.selectionEnd]), [0, 6]);
    await page.locator('#prompt').evaluate(input => input.setSelectionRange(25, 25));
    await expect(page.locator('#send')).toBeEnabled(); assert.equal(commands.length, 1);
    for (const [width, colorScheme] of [[320, 'light'], [390, 'dark'], [1280, 'light']]) {
      await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme });
      await expect(page.locator('#voice-status')).toBeHidden();
      for (const id of ['prompt', 'model', 'voice-record', 'send']) {
        const box = await page.locator('#' + id).boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${id} fits at ${width}px`);
        if (['voice-record', 'send'].includes(id)) assert.ok(box.width >= 44 && box.height >= 44);
      }
      await page.screenshot({ path: join(evidence, `preview-${width}-${colorScheme}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#prompt').evaluate(input => {
      window.lateVoiceEvent = window.voicePeers.at(-1).channel.onmessage;
      input.addEventListener('beforeinput', () => window.lateVoiceEvent({ data: JSON.stringify({ type: 'input_transcript.added', item: { text: 'Racing replacement' } }) }), { once: true });
    });
    await expect(page.locator('#prompt')).toBeEditable(); await expect(page.locator('#send')).toBeEnabled();
    assert.equal(await page.locator('#prompt').evaluate(input => input.selectionStart), 'Before Early preview only'.length);
    await page.locator('#prompt').focus(); await page.keyboard.insertText(' corrected');
    await expect(page.locator('#voice-status')).toBeHidden();
    await page.evaluate(() => window.lateVoiceEvent({ data: JSON.stringify({ type: 'turn.done', turn: { id: 'late', role: 'user', transcript: 'Late replacement' } }) }));
    await expect(page.locator('#prompt')).toHaveValue('Before Early preview only corrected after'); await stopped(); await closed();
    assert.equal(commands.length, 1); assert.ok(!JSON.stringify(hostFrames).includes('Early preview only'));
    await page.getByRole('button', { name: 'Show sessions' }).click(); await page.getByRole('button', { name: /Voice Beta/ }).click();
    await page.getByRole('button', { name: 'Show sessions' }).click(); await page.getByRole('button', { name: /Voice Alpha/ }).click();
    await expect(page.locator('#prompt')).toHaveValue('Before Early preview only corrected after');

    await fresh(); await record(); await partial('Compose safely'); await stop();
    await page.locator('#prompt').evaluate(input => {
      const receive = window.voicePeers.at(-1).channel.onmessage;
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      receive({ data: JSON.stringify({ type: 'input_transcript.added', item: { text: 'Must not interrupt composition' } }) });
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('Compose safely'); await closed();

    await fresh(); mode = 'held';
    await page.evaluate(() => { window.voiceHoldReady = true; });
    states[0].status = 'working'; states[0].revision++;
    agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
    await expect(page.locator('#status')).toHaveText('working');
    await record(); await until(() => releaseRequest);
    await expect(page.locator('#model')).toBeHidden();
    await page.evaluate(() => window.monitorVoiceOutput());
    await expect.poll(() => page.evaluate(() => window.voiceOutputLevel())).toBeLessThan(.001);
    await delay(400); await page.evaluate(() => { window.voiceGain.gain.value = 0; });
    await page.evaluate(() => { window.lateVoiceEvent = window.voicePeers.at(-1).channel.onmessage; });
    await page.getByRole('button', { name: 'Send message' }).click(); await stopped();
    await expect(page.locator('#prompt')).toBeVisible(); await expect(page.locator('#prompt')).not.toBeFocused();
    await expect(page.locator('#model')).toBeHidden(); await expect(page.locator('#send')).toBeDisabled();
    assert.equal(commands.length, 1);
    releaseRequest(); releaseRequest = undefined;
    await expect.poll(() => page.evaluate(() => window.voicePeers.at(-1).channel.readyState)).toBe('open');
    await delay(150);
    assert.ok(await page.evaluate(() => window.voiceOutputLevel()) < .001, 'Queued Send must retain opening audio until the provider starts');
    await packet({ type: 'session.started' });
    await expect.poll(() => page.evaluate(() => window.voiceOutputLevel())).toBeGreaterThan(.03);
    await page.evaluate(() => window.stopVoiceMonitor());
    await final('Send before final'); await until(() => commands.length === 2, 15000);
    assert.equal(commands[1].text, 'Send before final');
    states[0].status = 'idle'; states[0].revision++; agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
    await page.locator('#prompt').fill('Next draft');
    await page.evaluate(() => window.lateVoiceEvent({ data: JSON.stringify({ type: 'turn.done', turn: { id: 'late-send', role: 'user', transcript: 'Do not restore sent text' } }) }));
    await expect(page.locator('#prompt')).toHaveValue('Next draft'); await stopped(); await closed();
    assert.equal(commands.length, 2);

    await fresh(); await page.locator('#prompt').click(); await record();
    await page.evaluate(() => { window.lateVoiceEvent = window.voicePeers.at(-1).channel.onmessage; });
    await page.keyboard.insertText('Typed before the first transcript');
    await stopped(); await closed(); await expect(page.locator('#prompt')).toBeFocused();
    await page.evaluate(() => window.lateVoiceEvent({ data: JSON.stringify({ type: 'input_transcript.added', item: { text: 'Late words' } }) }));
    await expect(page.locator('#prompt')).toHaveValue('Typed before the first transcript');

    await fresh(); await page.locator('#prompt').fill('Prefix'); await record();
    await page.getByRole('button', { name: 'Send message' }).click(); await partial('Queued words');
    const pendingBubble = page.locator('.message.user').filter({ hasText: 'Transcribing…' });
    await expect(pendingBubble.locator('.message-text')).toHaveText('Prefix Queued words');
    await expect(page.locator('#prompt')).toHaveValue(''); await expect(page.locator('#prompt')).toBeFocused();
    await page.keyboard.insertText('Next draft');
    await partial(' trailing'); await expect(pendingBubble.locator('.message-text')).toHaveText('Prefix Queued words trailing');
    await page.evaluate(() => { window.lateVoiceEvent = window.voicePeers.at(-1).channel.onmessage; });
    await stop(); await stopped(); await closed();
    await page.evaluate(() => window.lateVoiceEvent({ data: JSON.stringify({ type: 'turn.done', turn: { id: 'edited-send', role: 'user', transcript: 'Must not send' } }) }));
    await expect(page.locator('#prompt')).toHaveValue('Next draft');
    await expect(page.locator('.message.user').filter({ hasText: 'Not sent' })).toContainText('Prefix Queued words trailing'); assert.equal(commands.length, 2);
    await expect(page.locator('#fast-mode')).toBeVisible(); await expect(page.locator('#commands')).toBeVisible();

    await fresh(); await record(); await page.getByRole('button', { name: 'Send message' }).click();
    await partial('Keep queued draft'); await stop();
    await expect(page.locator('#prompt')).toHaveValue('Keep queued draft'); await expect(page.locator('#prompt')).not.toBeFocused();
    await expect(page.locator('#model')).toBeVisible(); await closed();
    assert.equal(commands.length, 2);

    await fresh(); await page.locator('#prompt').fill('Original'); await record(); await partial('Discard me');
    await page.evaluate(() => { window.voiceSkipClose = true; });
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await stopped(); await closed();
    await expect(page.locator('#prompt')).toHaveValue('Original');
    await fresh(); await page.locator('#voice-record').focus(); await record(); await page.keyboard.press('Escape'); await stopped(); await closed(); await expect(page.locator('#voice-record')).toBeFocused();

    await fresh(); await page.locator('#prompt').fill('Original draft'); await record(); await partial('Discard preview'); await stop();
    await expect(page.locator('#prompt')).toHaveValue('Original draft Discard preview');
    await page.evaluate(() => { const receive = window.voicePeers.at(-1).channel.onmessage; setTimeout(() => receive({ data: JSON.stringify({ type: 'turn.done', turn: { id: 'late', role: 'user', transcript: 'Late result' } }) }), 300); });
    await page.keyboard.press('Escape');
    await expect(page.locator('#prompt')).toHaveValue('Original draft'); await expect(page.locator('#prompt')).toBeEditable();
    await page.locator('#prompt').fill('User edit wins'); await delay(400);
    await expect(page.locator('#prompt')).toHaveValue('User edit wins'); await closed();

    await fresh(); await record(); await stop(); await page.locator('#prompt').evaluate(input => { input.value = 'Changed without cancelling'; });
    await final('Late result'); await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('Changed without cancelling');

    await fresh(); await page.locator('#prompt').fill('Session draft'); await record(); await partial('Discard session preview'); await stop();
    await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: /Voice Beta/ }).click(); await stopped(); await closed(); await expect(page.locator('#voice-record')).toBeHidden();
    await page.getByRole('button', { name: 'Show sessions' }).click(); await page.getByRole('button', { name: /Voice Alpha/ }).click();
    await expect(page.locator('#prompt')).toHaveValue('Session draft'); await expect(page.locator('#prompt')).toBeEditable();

    await fresh(); await page.locator('#prompt').fill('Model draft'); await record(); await partial('Discard model preview'); await stop(); states[0].model = 'anthropic/claude-test'; states[0].revision++;
    agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
    await expect(page.locator('#voice-record')).toBeHidden(); await stopped(); await closed(); await expect(page.locator('#prompt')).toHaveValue('Model draft');
    states[0].model = 'openai-codex/gpt-5.4'; states[0].revision++; agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));

    for (const failure of ['quota', 'malformed', 'oversized']) {
      await fresh(); mode = failure; await page.locator('#prompt').fill('Kept on error');
      await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click(); await expect(page.locator('#notice')).toContainText(failure === 'quota' ? 'quota' : 'invalid voice connection');
      await stopped(); await closed(); await expect(page.locator('#prompt')).toHaveValue('Kept on error'); assert.ok(!(await page.locator('body').innerText()).includes('private-test'));
    }
    await fresh(); await record(); await partial('Recovered words'); await packet({ type: 'error', error: { message: 'private-test-token' } });
    await expect(page.locator('#prompt')).toHaveValue('Recovered words'); await expect(page.locator('#notice')).toContainText('interrupted'); await stopped(); await closed();
    assert.ok(!(await page.locator('body').innerText()).includes('private-test'));

    await fresh(); const beforeDenied = offers.length;
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click(); await expect(page.locator('#notice')).toContainText('Microphone access was denied'); await stopped(); assert.equal(offers.length, beforeDenied);

    await fresh(); mode = 'held'; await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click(); await until(() => releaseRequest);
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await until(() => offers.at(-1).signal.aborted);
    releaseRequest(); releaseRequest = undefined; await stopped(); await closed(); await expect(page.locator('#notice')).toBeHidden();
    await fresh(); mode = 'auth-held'; await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click(); await until(() => releaseAuth);
    await stop(); await expect(page.locator('#model')).toBeVisible(); await expect(page.locator('#prompt')).toBeEditable();
    await page.locator('#prompt').fill('Changed before connecting'); releaseAuth(); releaseAuth = undefined; mode = 'ok'; await stopped(); await closed();
    await expect(page.locator('#prompt')).toHaveValue('Changed before connecting'); assert.equal(commands.length, 2);
    for (const hold of ['voiceHoldConnection', 'voiceHoldReady']) {
      await fresh(); await page.evaluate(hold => { window[hold] = true; }, hold); await record();
      await expect.poll(() => page.evaluate(() => window.voicePeers.at(-1)?.connectionState)).toBe('connected');
      await page.evaluate(() => { window.lateVoiceEvent = window.voicePeers.at(-1).channel.onmessage; });
      await page.getByRole('button', { name: 'Cancel dictation' }).click(); await stopped(); await closed();
      await page.evaluate(() => window.lateVoiceEvent({ data: '{"type":"session.started"}' }));
      await expect(page.locator('#notice')).toBeHidden();
    }
    await fresh(); await page.locator('#prompt').fill('Keep startup draft');
    await page.evaluate(() => { window.voiceHoldReady = true; }); await record();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#notice')).toContainText('Voice connection timed out', { timeout: 15000 });
    await expect(page.locator('#prompt')).toHaveValue('Keep startup draft');
    await stopped(); await closed(); assert.equal(commands.length, 2);

    for (const invalid of [sdp.replace('m=application', 'm=video'), sdp.replace('m=audio', 'm=video'), 'v=0\r\n', sdp + 'x'.repeat(128 * 1024)]) {
      probe = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin); await probe.request('watch', { sessionId: states[0].id });
      const before = offers.length;
      assert.equal((await probe.request('voiceStart', { sessionId: states[0].id, voiceId: randomUUID(), format: 'webrtc-direct', sdp: invalid })).ok, false);
      assert.equal(offers.length, before); probe.ws.close();
    }
    probe = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin);
    await probe.request('watch', { sessionId: states[1].id });
    assert.equal((await probe.request('voiceStart', { sessionId: states[1].id, voiceId: randomUUID(), format: 'webrtc-direct', sdp })).ok, false);
    await probe.request('watch', { sessionId: states[0].id });
    assert.equal((await probe.request('voiceFinish', { sessionId: states[0].id, voiceId: randomUUID(), recording: { type: 'audio/webm', data: 'AAAA' } })).ok, false);
    mode = 'held'; const pending = probe.request('voiceStart', { sessionId: states[0].id, voiceId: randomUUID(), format: 'webrtc-direct', sdp }).catch(() => {});
    await until(() => releaseRequest); probe.ws.close(); await until(() => offers.at(-1).signal.aborted); releaseRequest(); releaseRequest = undefined; await pending;

    await fresh(); assert.equal(await page.locator('#voice-record').evaluate(node => node.nextElementSibling.id), 'send');
    await page.locator('#prompt').fill('Keep while checking usage');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const ring = await page.locator('.conversation-actions #usage-meter').boundingBox(), menu = await page.locator('.session-info summary').boundingBox();
      assert.ok(Math.abs(ring.y - menu.y) < 2 && ring.x + ring.width <= menu.x && ring.width >= 44);
      await page.locator('#usage-meter').click(); await expect(page.locator('#settings-picker')).toContainText('32,000 / 100,000 tokens');
      const header = await page.locator('.conversation-header').boundingBox(), panel = await page.locator('#settings-picker').boundingBox();
      assert.ok(panel.y >= header.y + header.height && panel.y - header.y - header.height < 12);
      await page.keyboard.press('Escape'); await expect(page.locator('#settings-picker')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('Keep while checking usage');
      await page.screenshot({ path: join(evidence, 'ready-' + width + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [stopFirst, count] of [[true, 3], [false, 4]]) {
      await fresh(); await page.locator('#prompt').fill('Original draft'); await record(); await partial('Ready words');
      if (stopFirst) {
        await stop(); await drained(); await delay(2100); await partial(' and delayed ending'); await delay(1100);
      }
      await expect(page.locator('#composer')).toHaveAttribute('data-voice', stopFirst ? 'finishing' : 'recording');
      await page.evaluate(() => { window.lateVoiceEvent = window.voicePeers.at(-1).channel.onmessage; });
      const sendAt = performance.now();
      await page.getByRole('button', { name: 'Send message' }).click(); await stopped();
      if (!stopFirst) {
        await expect(page.locator('#composer')).toHaveAttribute('data-voice', 'sending');
        const bubble = page.locator('.message.user').filter({ hasText: 'Transcribing…' });
        await expect(bubble.locator('.message-text')).toHaveText('Original draft Ready words');
        await expect(page.locator('#prompt')).toHaveValue('');
        console.log(`Send to visible pending bubble: ${Math.round(performance.now() - sendAt)}ms`);
        await page.locator('#prompt').fill('Next draft');
        await page.screenshot({ path: join(evidence, 'pending-dictation-phone.png') });
        await drained(); await delay(2100); assert.equal(commands.length, count - 1);
        await partial(' and delayed ending');
        await expect(bubble.locator('.message-text')).toHaveText('Original draft Ready words and delayed ending');
        await delay(700); assert.equal(commands.length, count - 1);
      }
      await until(() => commands.length === count, stopFirst ? 2000 : 5000);
      console.log(`${stopFirst ? 'Stopped' : 'Recording'} draft catch-up Send to simulated agent: ${Math.round(performance.now() - sendAt)}ms`);
      assert.equal(commands[count - 1].text, 'Original draft Ready words and delayed ending');
      await expect(page.locator('#composer')).not.toHaveAttribute('data-voice', /.+/);
      await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue(stopFirst ? '' : 'Next draft');
      await expect(page.locator('.message.user').filter({ hasText: 'Original draft Ready words' })).toHaveCount(1);
      await page.locator('#prompt').fill('Next draft');
      await page.evaluate(() => {
        window.lateVoiceEvent({ data: JSON.stringify({ type: 'input_transcript.added', item: { text: 'Late partial' } }) });
        window.lateVoiceEvent({ data: JSON.stringify({ type: 'turn.done', turn: { id: 'late-send', role: 'user', transcript: 'Late final' } }) });
      });
      await stopped(); await closed(); await expect(page.locator('#prompt')).toHaveValue('Next draft'); assert.equal(commands.length, count);
    }

    for (const progressing of [false, true]) {
      await fresh(); await page.locator('#prompt').fill('Kept draft'); await record(); await partial('Unfinished words');
      await page.getByRole('button', { name: 'Send message' }).click();
      if (progressing) await page.evaluate(() => {
        const receive = window.voicePeers.at(-1).channel.onmessage;
        window.voiceChatter = setInterval(() => receive({ data: JSON.stringify({ type: 'input_transcript.added', item: { text: ' more' } }) }), 500);
      });
      await drained();
      await page.locator('#prompt').fill('Separate draft');
      const unsent = page.locator('.message.user').filter({ hasText: 'Not sent' });
      await expect(unsent).toContainText('Kept draft Unfinished words', { timeout: 12000 });
      await page.evaluate(() => clearInterval(window.voiceChatter));
      await expect(page.locator('#notice')).toContainText('Check the draft before sending');
      await unsent.getByRole('button', { name: 'Edit draft' }).click();
      await expect(page.locator('#prompt')).toHaveValue('Separate draft');
      await page.locator('#prompt').fill(''); await unsent.getByRole('button', { name: 'Edit draft' }).click();
      await expect(page.locator('#prompt')).toHaveValue(/^Kept draft Unfinished words/); await expect(unsent).toHaveCount(0);
      await stopped(); await closed(); assert.equal(commands.length, 4);
    }

    await page.routeWebSocket('**/ws', route => {
      const upstream = route.connectToServer();
      upstream.onMessage(raw => { const packet = JSON.parse(String(raw)); if (packet.type === 'ready') packet.voiceInput = 'webrtc-direct'; route.send(JSON.stringify(packet)); });
    });
    await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click(); await expect(page.locator('#voice-record')).toBeHidden();
    await page.locator('#prompt').fill('Old host can still send'); await page.getByRole('button', { name: 'Send message' }).click();
    await until(() => commands.length === 5); assert.equal(commands[4].text, 'Old host can still send');
  }
  assertPrivate(); assert.deepEqual(errors, []);
  console.log(`PASS: ${liveFile ? 'live buffered speech, silent timeout and catch-up Send, no host transcript traffic before Send' : 'browser-direct protocol, waveform, draft, Send, cancellation, errors, validation and disconnect'}. Evidence: ${evidence}`);
} finally {
  await diagnostics().catch(() => {});
  if (liveFile && page && !page.isClosed()) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForFunction(() => window.voicePeers?.every(peer => peer.connectionState === 'closed'), null, { timeout: 2000 }).catch(() => {});
    const cleanup = await page.evaluate(() => ({ acknowledged: window.voiceClosed, peersClosed: window.voicePeers?.every(peer => peer.connectionState === 'closed') })).catch(() => ({}));
    writeFileSync(join(evidence, 'cleanup.json'), JSON.stringify(cleanup));
  }
  releaseRequest?.(); releaseAuth?.(); probe?.ws.terminate();
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); agents.forEach(agent => agent.ws.terminate()); await host?.close(); locks.forEach(lock => lock.release()); rmSync(dir, { recursive: true, force: true });
}
