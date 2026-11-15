// Real host, browser UI and authenticated sockets; only provider HTTP/WS and browser WebRTC are simulated.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium, devices, expect } from '@playwright/test';
import { startHost } from '../src/host.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until, delay } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pi-voice-e2e-'));
const evidence = mkdtempSync(join(tmpdir(), 'pi-voice-evidence-'));
const config = { port: 8787, clientToken: 'voice-test-client-only-1234567890123456', bridgeToken: 'voice-test-bridge-only-1234567890123456', relayToken: 'voice-test-relay-only-12345678901234567' };
let host, browser, context, probe; const agents = [], locks = [], providerSockets = [], uploads = [], commands = [], errors = [];
let mode = 'ok', releaseOffer;
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
class ProviderSocket extends EventEmitter {
  readyState = 0;
  constructor() { super(); providerSockets.push(this); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send(raw) { assert.equal(JSON.parse(raw).type, 'session.close'); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  packet(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
try {
  host = await startHost({ dir, config, port: 0, roots: [], relayUrl: '', publicUrl: 'http://127.0.0.1:8787' });
  host.service.voiceOptions = {
    readAuth: async () => ({ token: 'private-test-token', account: 'private-test-account' }),
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).hostname, 'chatgpt.com');
      assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer private-test-token');
      const body = JSON.parse(options.body); assert.equal(body.session.model, 'gpt-live-1-codex'); uploads.push(body);
      if (mode === 'held') await new Promise(resolve => { releaseOffer = resolve; });
      if (mode === 'quota') return new Response('private-test-token: provider error details', { status: 429 });
      return new Response(offer, { status: 201, headers: { 'openai-session-id': 'rtc_test' } });
    },
    createSocket: () => new ProviderSocket()
  };
  const origin = `http://127.0.0.1:${host.http.address().port}`;
  const states = [];
  for (const [title, model] of [['Voice Alpha', 'openai-codex/gpt-5.4'], ['Voice Beta', 'claude-sdk/claude-sonnet-5-5']]) {
    const file = join(dir, title + '.jsonl'); writeFileSync(file, '');
    const id = sessionKey(file), instanceId = randomUUID();
    const lock = acquireLock(join(dir, 'locks'), id, { file, instanceId }); locks.push(lock);
    const agent = await socket(origin.replace('http:', 'ws:') + '/bridge', config.bridgeToken); agents.push(agent);
    const state = { id, file, instanceId, title, model, cwd: dir, status: 'idle', messages: [{ id: 'hello', role: 'user', text: 'Voice test' }], tools: [], revision: 0, updatedAt: Date.now() };
    states.push(state); agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString()); if (packet.type !== 'command') return;
      if (packet.command.type === 'prompt') commands.push(packet.command);
      agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: packet.command.type === 'getCommands' ? { commands: [] } : { accepted: true } }));
    });
  }
  await until(() => host.service.live.size === 2);
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  context = await browser.newContext({ ...devices['iPhone 13'], permissions: ['microphone'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    window.voiceTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const stream = audio.createMediaStreamDestination().stream;
      window.voiceTracks.push(...stream.getTracks()); return stream;
    };
    window.RTCPeerConnection = class {
      connectionState = 'new';
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
      close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    };
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const fresh = async () => {
    mode = 'ok'; await page.goto('about:blank'); await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: /Voice Alpha/ }).click();
    await expect(page.locator('#voice-record')).toBeVisible();
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
  };
  const record = async () => {
    await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
    await expect(page.locator('#voice-label')).toHaveText('Listening · audio goes to OpenAI', { timeout: 10000 });
    return providerSockets.at(-1);
  };
  const stopped = async () => expect.poll(() => page.evaluate(() => window.voiceTracks.every(track => track.readyState === 'ended'))).toBe(true);

  await fresh();
  await page.locator('#prompt').fill('Keep this draft.');
  let provider = await record();
  provider.packet({ type: 'input_transcript.added', item: { text: 'Purple notebook' } });
  provider.packet({ type: 'output_transcript.added', item: { text: 'DO NOT INSERT ASSISTANT SPEECH' } });
  await expect(page.locator('#voice-preview')).toHaveText('Purple notebook');
  await expect(page.locator('#send')).toBeDisabled(); assert.equal(commands.length, 0);
  await page.screenshot({ path: join(evidence, 'recording-phone.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stop dictation' }).click(); await stopped();
  provider.packet({ type: 'turn.done', turn: { role: 'user', transcript: 'Purple notebook beside the lamp.' } });
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft. Purple notebook beside the lamp.');
  await expect(page.locator('#voice-status')).toBeHidden(); assert.equal(provider.readyState, 3); assert.equal(commands.length, 0);
  await page.getByRole('button', { name: 'Send message' }).click(); await until(() => commands.length === 1);
  assert.equal(commands[0].text, 'Keep this draft. Purple notebook beside the lamp.');

  await fresh(); await page.locator('#prompt').fill('Original'); provider = await record();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  provider.packet({ type: 'turn.done', turn: { role: 'user', transcript: 'Late words' } });
  await expect(page.locator('#prompt')).toHaveValue('Original'); await stopped(); assert.equal(provider.readyState, 3);

  await fresh(); provider = await record();
  await page.locator('#prompt').fill('User edit wins');
  await expect(page.locator('#voice-status')).toBeHidden(); await stopped();
  await until(() => provider.readyState === 3);
  provider.packet({ type: 'turn.done', turn: { role: 'user', transcript: 'Stale' } });
  await expect(page.locator('#prompt')).toHaveValue('User edit wins');

  await fresh(); provider = await record();
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await page.getByRole('button', { name: /Voice Beta/ }).click();
  await expect(page.locator('#voice-record')).toBeHidden(); await stopped();
  await until(() => provider.readyState === 3);

  await fresh(); provider = await record();
  provider.packet({ type: 'input_transcript.added', item: { text: 'Do not insert after model change' } });
  states[0].model = 'anthropic/claude-test'; states[0].revision++;
  agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
  await expect(page.locator('#voice-record')).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue(''); await stopped();
  assert.equal(provider.readyState, 3);
  states[0].model = 'openai-codex/gpt-5.4'; states[0].revision++;
  agents[0].ws.send(JSON.stringify({ type: 'snapshot', state: states[0] }));
  await until(() => host.service.read(states[0].id).model.startsWith('openai-codex/'));

  await fresh(); mode = 'quota'; await page.locator('#prompt').fill('Kept on error');
  await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
  await expect(page.locator('#notice')).toContainText('quota'); await stopped();
  await expect(page.locator('#prompt')).toHaveValue('Kept on error');
  assert.ok(!(await page.locator('body').innerText()).includes('private-test'));

  await fresh();
  const beforeDenied = uploads.length;
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
  await expect(page.locator('#notice')).toContainText('Microphone access was denied');
  assert.equal(uploads.length, beforeDenied);

  await fresh(); mode = 'held';
  await page.getByRole('button', { name: 'Dictate with ChatGPT' }).click();
  await until(() => releaseOffer); await page.getByRole('button', { name: 'Cancel dictation' }).click();
  const count = providerSockets.length; releaseOffer(); releaseOffer = undefined;
  await stopped(); await delay(100); assert.equal(providerSockets.length, count);

  await fresh(); provider = await record();
  provider.packet({ type: 'input_transcript.added', item: { text: 'Keep partial words' } });
  provider.emit('error', new Error('private-test-token should never leave host'));
  await expect(page.locator('#prompt')).toHaveValue('Keep partial words'); await stopped();
  await expect(page.locator('#notice')).toContainText('connection failed');

  await fresh(); provider = await record(); provider.packet(null);
  await expect(page.locator('#notice')).toContainText('invalid voice event');
  await stopped(); assert.equal(provider.readyState, 3);

  // The host must reject non-Codex sessions even when a client bypasses button visibility.
  probe = await socket(origin.replace('http:', 'ws:') + '/ws', config.clientToken, origin);
  await probe.request('watch', { sessionId: states[1].id });
  const before = uploads.length;
  const denied = await probe.request('voiceStart', { sessionId: states[1].id, voiceId: randomUUID(), sdp: offer });
  assert.equal(denied.ok, false); assert.equal(uploads.length, before);
  await probe.request('watch', { sessionId: states[0].id });
  const invalid = await probe.request('voiceStart', { sessionId: states[0].id, voiceId: randomUUID(), sdp: offer + 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' });
  assert.equal(invalid.ok, false); assert.equal(uploads.length, before);
  const started = await probe.request('voiceStart', { sessionId: states[0].id, voiceId: randomUUID(), sdp: offer });
  assert.equal(started.ok, true); provider = providerSockets.at(-1); probe.ws.close();
  await until(() => provider.readyState === 3);

  await fresh();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(evidence, 'ready-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(evidence, 'ready-desktop.png'), fullPage: true });
  writeFileSync(join(evidence, 'composer.aria.txt'), await page.locator('#composer').ariaSnapshot());
  assert.deepEqual(errors, []);
  console.log(`PASS: voice draft/send, cancellation, edits, session switch, quota, startup race, partial failure, provider gate and disconnect. Evidence: ${evidence}`);
} catch (error) {
  const page = context?.pages()[0];
  console.error('Voice proof failed:', { uploads: uploads.length, sockets: providerSockets.map(socket => socket.readyState), errors,
    notice: await page?.locator('#notice').textContent().catch(() => ''), evidence });
  throw error;
} finally {
  releaseOffer?.(); probe?.ws.terminate();
  if (context) await context.tracing.stop({ path: join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close(); agents.forEach(agent => agent.ws.terminate());
  await host?.close(); locks.forEach(lock => lock.release()); rmSync(dir, { recursive: true, force: true });
}
