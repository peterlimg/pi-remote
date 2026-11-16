// Real host, browser, MediaRecorder and authenticated sockets; synthetic microphone and simulated provider HTTP.
// Opt in to the real subscription endpoint with --live-file /path/to/synthetic-speech.wav.
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
let host, browser, context, probe, mode = 'ok', releaseRequest, releaseAuth;
const agents = [], locks = [], uploads = [], commands = [], errors = [];
try {
  host = await startHost({ dir, config, port: 0, roots: [], relayUrl: '', publicUrl: 'http://127.0.0.1:8787' });
  if (!liveFile) host.service.voiceOptions = {
    readAuth: async () => {
      if (mode === 'auth-held') await new Promise(resolve => { releaseAuth = resolve; });
      return { token: 'private-test-token', account: 'private-test-account' };
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://chatgpt.com/backend-api/transcribe');
      assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer private-test-token');
      const file = options.body.get('file'); assert.ok(file.size > 12); assert.ok(['audio/mp4', 'audio/webm'].includes(file.type));
      uploads.push({ file, signal: options.signal });
      if (mode === 'held') await new Promise(resolve => { releaseRequest = resolve; });
      if (mode === 'quota') return new Response('private-test-token: provider error details', { status: 429 });
      if (mode === 'malformed') return new Response('{private-test-token:invalid}');
      if (mode === 'oversized') return Response.json({ text: 'x'.repeat(16001) });
      return Response.json({ text: mode === 'empty' ? '' : 'Purple notebook beside the lamp.' });
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
  await context.addInitScript(async audio64 => {
    if (!navigator.mediaDevices) return;
    window.voiceTracks = []; window.voiceContexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.voiceContexts.push(this); }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new NativeAudioContext(), destination = audio.createMediaStreamDestination();
      if (audio64) {
        const source = audio.createBufferSource();
        source.buffer = await audio.decodeAudioData(Uint8Array.from(atob(audio64), c => c.charCodeAt(0)).buffer);
        source.connect(destination);
        window.playVoiceSample = () => new Promise(resolve => { source.onended = resolve; source.start(); });
      } else {
        const oscillator = audio.createOscillator(), gain = window.voiceGain = audio.createGain();
        gain.gain.value = .15; oscillator.connect(gain); gain.connect(destination); oscillator.start();
      }
      await audio.resume();
      const stream = destination.stream;
      window.voiceTracks.push(...stream.getTracks()); return stream;
    };
  }, liveFile ? readFileSync(liveFile).toString('base64') : null);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const fresh = async () => {
    mode = 'ok'; await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click();
    await expect(page.locator('#voice-record')).toBeVisible();
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
  };
  const record = async () => {
    await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
    await expect(page.locator('#voice-label')).toHaveText('Recording · sent to OpenAI on Stop');
  };
  const stopped = async () => expect.poll(() => page.evaluate(() =>
    window.voiceTracks.every(track => track.readyState === 'ended') && window.voiceContexts.every(audio => audio.state === 'closed'))).toBe(true);
  const stop = () => page.getByRole('button', { name: 'Stop dictation' }).click();

  await fresh(); await page.locator('#prompt').fill('Keep this draft.'); await record();
  if (liveFile) {
    await page.evaluate(() => window.playVoiceSample());
    const started = performance.now(); await stop(); await stopped();
    await expect(page.locator('#voice-status')).toBeHidden({ timeout: 25000 });
    const text = await page.locator('#prompt').inputValue();
    assert.match(text, /Keep this draft\. The orange bicycle is parked beside the library\./i);
    console.log(JSON.stringify({ live: true, stopToDraftMs: Math.round(performance.now() - started), text, promptsSent: commands.length }));
    assert.equal(commands.length, 0);
    await fresh(); await page.locator('#prompt').fill('Silent draft'); await record(); await delay(500);
    const emptyStarted = performance.now(); await stop(); await stopped();
    await expect(page.locator('#voice-status')).toBeHidden({ timeout: 25000 });
    await expect(page.locator('#prompt')).toHaveValue('Silent draft'); await expect(page.locator('#notice')).toBeHidden();
    console.log(JSON.stringify({ live: true, silenceStopToDraftMs: Math.round(performance.now() - emptyStarted), promptsSent: commands.length }));
    assert.equal(commands.length, 0);
  } else {
    assert.equal(uploads.length, 0, 'No provider request or audio upload before Stop');
    await expect.poll(() => page.locator('#voice-waveform i').count()).toBeGreaterThan(0);
    assert.ok(await page.locator('#voice-waveform i').count() < 10, 'No prefilled dot line');
    const positions = await page.locator('#voice-waveform i').first().evaluate(async bar => {
      const x = []; for (let frame = 0; frame < 20; frame++) { await new Promise(requestAnimationFrame); x.push(bar.getBoundingClientRect().x); } return x;
    });
    assert.ok(positions.slice(1).filter((x, i) => x < positions[i] - .05).length >= 15, 'Continuous waveform motion');
    await expect(page.locator('#prompt')).toBeHidden(); await expect(page.locator('#prompt')).not.toBeFocused();
    await expect(page.locator('#send')).toBeHidden(); await expect(page.locator('#voice-record .voice-stop-icon')).toBeVisible();
    const levels = () => page.locator('#voice-waveform i').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.height)));
    await expect.poll(async () => Math.max(...await levels())).toBeGreaterThan(20);
    await page.evaluate(() => { window.voiceGain.gain.value = 0; });
    await expect.poll(async () => Math.max(...await levels())).toBe(3);
    await page.evaluate(() => { window.voiceGain.gain.value = .01; });
    await expect.poll(async () => Math.max(...await levels())).toBeGreaterThan(8);
    await page.screenshot({ path: join(evidence, 'recording-phone.png'), fullPage: true });
    const started = performance.now(); await stop(); await stopped();
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook beside the lamp.', { timeout: 1000 });
    console.log(`Stop to draft with simulated provider: ${Math.round(performance.now() - started)}ms`);
    assert.equal(uploads.length, 1); assert.equal(commands.length, 0);
    await page.getByRole('button', { name: 'Send message' }).click(); await until(() => commands.length === 1);
    assert.equal(commands[0].text, 'Keep this draft. Purple notebook beside the lamp.');

    await fresh(); mode = 'empty'; await page.locator('#prompt').fill('Keep unchanged'); await record(); await delay(300); await stop(); await stopped();
    await expect(page.locator('#voice-status')).toBeHidden({ timeout: 1000 });
    await expect(page.locator('#prompt')).toHaveValue('Keep unchanged'); await expect(page.locator('#notice')).toBeHidden();

    await fresh(); await page.locator('#prompt').fill('Original'); await record(); const beforeCancel = uploads.length;
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); await stopped();
    await expect(page.locator('#prompt')).toHaveValue('Original'); assert.equal(uploads.length, beforeCancel);

    await fresh(); await record(); await page.keyboard.press('Escape'); await stopped();
    await expect(page.locator('#voice-record')).toBeFocused();

    await fresh(); mode = 'held'; await record(); await delay(300); await stop(); await until(() => releaseRequest);
    await page.getByRole('button', { name: 'Cancel dictation' }).click();
    await until(() => uploads.at(-1).signal.aborted); await page.locator('#prompt').fill('User edit wins');
    releaseRequest(); releaseRequest = undefined; await delay(200);
    await expect(page.locator('#prompt')).toHaveValue('User edit wins');

    await fresh(); mode = 'held'; await record(); await delay(300); await stop(); await until(() => releaseRequest);
    await page.locator('#prompt').evaluate(input => { input.value = 'Changed without cancelling'; });
    releaseRequest(); releaseRequest = undefined;
    await expect(page.locator('#voice-status')).toBeHidden(); await expect(page.locator('#prompt')).toHaveValue('Changed without cancelling');

    await fresh(); await record(); await page.getByRole('button', { name: 'Show sessions' }).click();
    await page.getByRole('button', { name: /Voice Beta/ }).click(); await stopped(); await expect(page.locator('#voice-record')).toBeHidden();

    await fresh(); mode = 'held'; await record(); await delay(300); await stop(); await until(() => releaseRequest);
    states[0].model = 'anthropic/claude-test'; states[0].revision++;
    agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
    await expect(page.locator('#voice-record')).toBeHidden(); await until(() => uploads.at(-1).signal.aborted);
    releaseRequest(); releaseRequest = undefined; await delay(200); await expect(page.locator('#prompt')).toHaveValue('');
    states[0].model = 'openai-codex/gpt-5.4'; states[0].revision++;
    agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));

    for (const failure of ['quota', 'malformed', 'oversized']) {
      await fresh(); mode = failure; await page.locator('#prompt').fill('Kept on error'); await record(); await delay(300); await stop(); await stopped();
      await expect(page.locator('#notice')).toContainText(failure === 'quota' ? 'quota' : failure === 'malformed' ? 'Could not transcribe' : 'invalid transcription');
      await expect(page.locator('#prompt')).toHaveValue('Kept on error');
      assert.ok(!(await page.locator('body').innerText()).includes('private-test'));
    }
    await fresh(); const beforeDenied = uploads.length;
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
    await expect(page.locator('#notice')).toContainText('Microphone access was denied'); await stopped(); assert.equal(uploads.length, beforeDenied);

    await fresh(); mode = 'auth-held'; await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click(); await until(() => releaseAuth);
    await page.getByRole('button', { name: 'Cancel dictation' }).click(); releaseAuth(); releaseAuth = undefined; mode = 'ok'; await stopped();
    await expect(page.locator('#notice')).toBeHidden();

    const valid = { type: uploads[0].file.type, data: Buffer.from(await uploads[0].file.arrayBuffer()).toString('base64') };
    for (const recording of [{ ...valid, type: 'text/plain' }, { ...valid, data: 'not base64!' }, { ...valid, data: Buffer.alloc(16).toString('base64') }, { ...valid, data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }]) {
      probe = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin);
      await probe.request('watch', { sessionId: states[0].id }); const voiceId = randomUUID();
      assert.equal((await probe.request('voiceStart', { sessionId: states[0].id, voiceId, format: 'recording' })).ok, true);
      const before = uploads.length;
      assert.equal((await probe.request('voiceFinish', { sessionId: states[0].id, voiceId, recording })).ok, false);
      assert.equal(uploads.length, before); probe.ws.close();
    }
    probe = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin);
    await probe.request('watch', { sessionId: states[1].id });
    assert.equal((await probe.request('voiceStart', { sessionId: states[1].id, voiceId: randomUUID(), format: 'recording' })).ok, false);
    await probe.request('watch', { sessionId: states[0].id }); const voiceId = randomUUID();
    assert.equal((await probe.request('voiceStart', { sessionId: states[0].id, voiceId, format: 'recording' })).ok, true);
    mode = 'held'; const pending = probe.request('voiceFinish', { sessionId: states[0].id, voiceId, recording: valid }).catch(() => {});
    await until(() => releaseRequest); probe.ws.close(); await until(() => uploads.at(-1).signal.aborted);
    releaseRequest(); releaseRequest = undefined; await pending;

    await fresh();
    assert.equal(await page.locator('#voice-record').evaluate(node => node.nextElementSibling.id), 'send');
    await page.locator('.session-info summary').click(); await expect(page.locator('.session-details')).toBeVisible(); await page.locator('.session-info summary').click();
    await page.locator('#prompt').fill('Keep while checking usage');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const ring = await page.locator('.conversation-actions #usage-meter').boundingBox(), menu = await page.locator('.session-info summary').boundingBox();
      assert.ok(Math.abs(ring.y - menu.y) < 2 && ring.x + ring.width <= menu.x && ring.width >= 44);
      await page.locator('#usage-meter').click(); await expect(page.locator('#settings-picker')).toContainText('32,000 / 100,000 tokens');
      const header = await page.locator('.conversation-header').boundingBox(), panel = await page.locator('#settings-picker').boundingBox();
      assert.ok(panel.y >= header.y + header.height && panel.y - header.y - header.height < 12);
      await page.keyboard.press('Escape'); await expect(page.locator('#settings-picker')).toBeHidden();
      await expect(page.locator('#prompt')).toHaveValue('Keep while checking usage');
      await page.screenshot({ path: join(evidence, 'ready-' + width + '.png'), fullPage: true });
    }
    // New static assets must not expose incompatible recording controls before the old host restarts.
    await page.routeWebSocket('**/ws', route => {
      const upstream = route.connectToServer();
      upstream.onMessage(raw => { const packet = JSON.parse(String(raw)); if (packet.type === 'ready') delete packet.voiceInput; route.send(JSON.stringify(packet)); });
    });
    await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click(); await expect(page.locator('#voice-record')).toBeHidden();
    await page.locator('#prompt').fill('Old host can still send'); await page.getByRole('button', { name: 'Send message' }).click();
    await until(() => commands.length === 2); assert.equal(commands[1].text, 'Old host can still send');
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${liveFile ? 'live subscription transcription and silence' : 'real recording, waveform, Stop-to-draft, silent empty results, explicit Send, cancellation, errors, validation, isolation and disconnect'}. Evidence: ${evidence}`);
} finally {
  releaseRequest?.(); releaseAuth?.(); probe?.ws.terminate();
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); agents.forEach(agent => agent.ws.terminate());
  await host?.close(); locks.forEach(lock => lock.release()); rmSync(dir, { recursive: true, force: true });
}
