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
let host, browser, context, probe, mode = 'ok', releaseRequest, releaseAuth;
const agents = [], locks = [], offers = [], commands = [], errors = [], hostFrames = [];
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
      if (liveFile) return fetch(url, options);
      assert.equal(options.headers.Authorization, 'Bearer private-test-token');
      if (mode === 'held') await new Promise(resolve => { releaseRequest = resolve; });
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
    const state = { id, file, instanceId, title, model, cwd: dir, status: 'idle', contextUsage: { tokens: 32000, contextWindow: 100000, percent: 32 }, messages: [{ id: 'hello', role: 'user', text: 'Voice test' }], tools: [], revision: 0, updatedAt: Date.now() };
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
    const NativeAudioContext = window.AudioContext, NativePeer = window.RTCPeerConnection;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.voiceContexts.push(this); }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new NativeAudioContext(), destination = audio.createMediaStreamDestination();
      if (audio64) {
        const source = audio.createBufferSource();
        source.buffer = await audio.decodeAudioData(Uint8Array.from(atob(audio64), c => c.charCodeAt(0)).buffer);
        source.connect(destination);
        window.playVoiceSample = () => new Promise(resolve => { source.onended = () => { window.voiceAudioEndedAt = performance.now(); resolve(); }; source.start(); });
      } else {
        const oscillator = audio.createOscillator(), gain = window.voiceGain = audio.createGain();
        gain.gain.value = .15; oscillator.connect(gain); gain.connect(destination); oscillator.start();
      }
      await audio.resume(); window.voiceTracks.push(...destination.stream.getTracks()); return destination.stream;
    };
    if (audio64) {
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) { super(...args); window.voicePeers.push(this); }
        createDataChannel(...args) {
          const channel = super.createDataChannel(...args);
          channel.addEventListener('message', event => { try {
            const packet = JSON.parse(event.data);
            if (packet.type === 'session.closed') window.voiceClosed++;
            if (['input_transcript.added', 'turn.done', 'error'].includes(packet.type)) window.voiceEvents.push({ at: performance.now(), type: packet.type, role: packet.turn?.role, id: packet.turn?.id, text: packet.type === 'input_transcript.added' ? packet.item?.text : packet.turn?.role === 'user' ? packet.turn.transcript : undefined });
          } catch {} });
          return channel;
        }
      };
    } else window.RTCPeerConnection = class {
      connectionState = 'new';
      constructor() { window.voicePeers.push(this); }
      addTrack() {}
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
        this.connectionState = 'connected';
        if (!window.voiceHoldConnection) { this.channel.readyState = 'open'; this.channel.onopen?.(); }
      }
      close() {
        if (this.connectionState === 'closed') return;
        this.connectionState = 'closed'; this.channel.readyState = 'closed'; this.channel.onclose?.(); this.onconnectionstatechange?.();
      }
    };
  }, { audio64: liveFile ? readFileSync(liveFile).toString('base64') : null, sdp });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', socket => socket.on('framesent', event => { try { hostFrames.push(JSON.parse(String(event.payload))); } catch {} }));
  const fresh = async () => {
    mode = 'ok'; await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click();
    await expect(page.locator('#voice-record')).toBeVisible(); await expect(page.locator('#app')).not.toHaveClass(/opening/);
  };
  const record = async () => {
    await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
    await expect(page.locator('#voice-label')).toHaveText('Listening · directly connected to OpenAI', { timeout: 20000 });
  };
  const stopped = async () => expect.poll(() => page.evaluate(() =>
    window.voiceTracks.every(track => track.readyState === 'ended') && window.voiceContexts.every(audio => audio.state === 'closed'))).toBe(true);
  const closed = async () => expect.poll(() => page.evaluate(() => window.voicePeers.every(peer => peer.connectionState === 'closed'))).toBe(true);
  const stop = () => page.getByRole('button', { name: 'Stop dictation' }).click();
  const packet = event => page.evaluate(event => window.voicePeers.at(-1).channel.onmessage?.({ data: JSON.stringify(event) }), event);
  const partial = text => packet({ type: 'input_transcript.added', item: { text } });
  const final = (text, id = 'turn-1') => packet({ type: 'turn.done', turn: { id, role: 'user', transcript: text } });
  const assertPrivate = () => {
    for (const frame of hostFrames.filter(frame => frame.op?.startsWith('voice'))) {
      assert.ok(['voiceStart', 'voiceCancel'].includes(frame.op));
      assert.deepEqual(Object.keys(frame).sort(), (frame.op === 'voiceStart' ? ['id', 'op', 'sessionId', 'voiceId', 'format', 'sdp'] : ['id', 'op', 'sessionId', 'voiceId']).sort());
    }
  };

  await fresh(); await page.locator('#prompt').fill('Keep this draft.'); await record();
  if (liveFile) {
    await page.evaluate(() => window.playVoiceSample());
    const started = performance.now(); await stop(); await stopped();
    try { await expect(page.locator('#voice-status')).toBeHidden({ timeout: 6000 }); }
    catch (error) {
      console.log(JSON.stringify({ liveDiagnostics: await page.evaluate(() => window.voiceEvents.slice(-15).map(({ at, ...event }) => ({ ...event, afterAudioEndMs: Math.round(at - window.voiceAudioEndedAt) }))) }));
      throw error;
    }
    await expect(page.locator('#notice')).toBeHidden();
    const text = await page.locator('#prompt').inputValue();
    assert.match(text, /^Keep this draft\.[\s\S]*The orange bicycle is parked beside the library[.!]?$/i);
    console.log(JSON.stringify({ live: true, stopToDraftMs: Math.round(performance.now() - started), text, promptsSent: commands.length }));
    assert.equal(commands.length, 0); assert.ok(!JSON.stringify(hostFrames).includes('orange bicycle'));
    await closed(); assert.equal(await page.evaluate(() => window.voiceClosed), 1);
    await fresh(); await page.locator('#prompt').fill('Silent draft'); await record(); await delay(500);
    const emptyStarted = performance.now(); await stop(); await stopped();
    await expect(page.locator('#voice-status')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#prompt')).toHaveValue('Silent draft'); await expect(page.locator('#notice')).toBeHidden();
    console.log(JSON.stringify({ live: true, silenceStopToDraftMs: Math.round(performance.now() - emptyStarted), promptsSent: commands.length }));
    await closed(); assert.equal(await page.evaluate(() => window.voiceClosed), 1); assert.equal(commands.length, 0);
  } else {
    assert.equal(offers.length, 1); await partial('Purple notebook');
    await packet({ type: 'turn.done', turn: { id: 'assistant-1', role: 'assistant', transcript: 'Do not insert this' } });
    await packet({ type: 'delegation.created', item: { type: 'delegation', target: 'client' } });
    await expect.poll(() => page.locator('#voice-waveform i').count()).toBeGreaterThan(0);
    assert.ok(await page.locator('#voice-waveform i').count() < 12, 'No prefilled dot line');
    const positions = await page.locator('#voice-waveform i').first().evaluate(async bar => {
      const x = []; for (let frame = 0; frame < 20; frame++) { await new Promise(requestAnimationFrame); x.push(bar.getBoundingClientRect().x); } return x;
    });
    assert.ok(positions.slice(1).filter((x, i) => x < positions[i] - .05).length >= 15, 'Continuous waveform motion');
    await expect(page.locator('#prompt')).toBeHidden(); await expect(page.locator('#prompt')).not.toBeFocused(); await expect(page.locator('#send')).toBeHidden();
    const levels = () => page.locator('#voice-waveform i').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.height)));
    await expect.poll(async () => Math.max(...await levels())).toBeGreaterThan(20);
    await page.evaluate(() => { window.voiceGain.gain.value = 0; }); await expect.poll(async () => Math.max(...await levels())).toBe(3);
    await page.evaluate(() => { window.voiceGain.gain.value = .01; }); await expect.poll(async () => Math.max(...await levels())).toBeGreaterThan(8);
    await page.screenshot({ path: join(evidence, 'recording-phone.png'), fullPage: true });
    await stop(); await stopped(); await delay(1900); const receivedAt = performance.now(); await final('Purple notebook beside the lamp.');
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook beside the lamp.', { timeout: 1000 });
    console.log(`Final provider event to draft after drain: ${Math.round(performance.now() - receivedAt)}ms`);
    await closed(); assert.equal(commands.length, 0); assert.ok(!JSON.stringify(hostFrames).includes('Purple notebook'));
    await page.getByRole('button', { name: 'Send message' }).click(); await until(() => commands.length === 1);
    assert.equal(commands[0].text, 'Keep this draft. Purple notebook beside the lamp.');

    await fresh(); await page.locator('#prompt').fill('Keep unchanged'); await record(); await stop(); await stopped();
    await expect(page.locator('#voice-status')).toBeHidden({ timeout: 10000 }); await closed();
    await expect(page.locator('#prompt')).toHaveValue('Keep unchanged'); await expect(page.locator('#notice')).toBeHidden();

    await fresh(); await record(); await final('First sentence.'); await stop(); await partial('Trailing');
    await final('First sentence.'); await delay(1900); await expect(page.locator('#voice-status')).toBeVisible();
    await final('Trailing words preserved.', 'turn-2');
    await expect(page.locator('#prompt')).toHaveValue('First sentence. Trailing words preserved.', { timeout: 1000 }); await closed();

    await fresh(); await record(); await partial('Unconfirmed words'); await stop();
    await expect(page.locator('#prompt')).toHaveValue('Unconfirmed words', { timeout: 10000 });
    await expect(page.locator('#notice')).toContainText('before confirmation'); await closed();

    await fresh(); await page.locator('#prompt').fill('Original'); await record(); await partial('Discard me');
    await page.evaluate(() => { window.voiceSkipClose = true; });
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await stopped(); await closed();
    await expect(page.locator('#prompt')).toHaveValue('Original');
    await fresh(); await record(); await page.keyboard.press('Escape'); await stopped(); await closed(); await expect(page.locator('#voice-record')).toBeFocused();

    await fresh(); await record(); await stop();
    await page.evaluate(() => { const receive = window.voicePeers.at(-1).channel.onmessage; setTimeout(() => receive({ data: JSON.stringify({ type: 'turn.done', turn: { id: 'late', role: 'user', transcript: 'Late result' } }) }), 300); });
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await page.locator('#prompt').fill('User edit wins'); await delay(400);
    await expect(page.locator('#prompt')).toHaveValue('User edit wins'); await closed();

    await fresh(); await record(); await stop(); await page.locator('#prompt').evaluate(input => { input.value = 'Changed without cancelling'; });
    await final('Late result'); await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('Changed without cancelling');

    await fresh(); await record(); await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: /Voice Beta/ }).click(); await stopped(); await closed(); await expect(page.locator('#voice-record')).toBeHidden();

    await fresh(); await record(); await stop(); states[0].model = 'anthropic/claude-test'; states[0].revision++;
    agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
    await expect(page.locator('#voice-record')).toBeHidden(); await stopped(); await closed(); await expect(page.locator('#prompt')).toHaveValue('');
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
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await until(() => offers.at(-1).signal.aborted);
    releaseRequest(); releaseRequest = undefined; await stopped(); await closed(); await expect(page.locator('#notice')).toBeHidden();
    await fresh(); mode = 'auth-held'; await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click(); await until(() => releaseAuth);
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); releaseAuth(); releaseAuth = undefined; mode = 'ok'; await stopped(); await closed();
    await fresh(); await page.evaluate(() => { window.voiceHoldConnection = true; }); await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
    await expect.poll(() => page.evaluate(() => window.voicePeers.at(-1)?.connectionState)).toBe('connected');
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await stopped(); await closed(); await expect(page.locator('#notice')).toBeHidden();

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
    await page.routeWebSocket('**/ws', route => {
      const upstream = route.connectToServer();
      upstream.onMessage(raw => { const packet = JSON.parse(String(raw)); if (packet.type === 'ready') packet.voiceInput = 'recording'; route.send(JSON.stringify(packet)); });
    });
    await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click(); await expect(page.locator('#voice-record')).toBeHidden();
    await page.locator('#prompt').fill('Old host can still send'); await page.getByRole('button', { name: 'Send message' }).click();
    await until(() => commands.length === 2); assert.equal(commands[1].text, 'Old host can still send');
  }
  assertPrivate(); assert.deepEqual(errors, []);
  console.log(`PASS: ${liveFile ? 'live browser-direct speech and silent timeout, no host transcript traffic' : 'browser-direct protocol, waveform, draft, Send, cancellation, errors, validation and disconnect'}. Evidence: ${evidence}`);
} finally {
  releaseRequest?.(); releaseAuth?.(); probe?.ws.terminate();
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); agents.forEach(agent => agent.ws.terminate()); await host?.close(); locks.forEach(lock => lock.release()); rmSync(dir, { recursive: true, force: true });
}
