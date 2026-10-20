import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { startHost } from '../src/host.mjs';
import { startRelay, connectRelay } from '../src/relay.mjs';
import { loadConfig } from '../src/config.mjs';
import { createPairing } from '../src/pairing.mjs';
import { pairingHello } from '../web/pairing.js';
import { e2eKey } from '../src/e2e.mjs';
import { socket, until } from './helpers.mjs';

async function pair(url, origin, code) {
  const hello = await pairingHello(code), ws = new WebSocket(url, { origin });
  let session;
  return new Promise((resolve, reject) => {
    const finish = (error, result) => { clearTimeout(timer); ws.close(); error ? reject(new Error(error)) : resolve(result); };
    const timer = setTimeout(() => finish('Pairing timed out'), 10000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'pair', publicKey: hello.publicKey })));
    ws.on('error', error => finish(error.message));
    ws.on('message', async raw => {
      try {
        const packet = JSON.parse(raw.toString());
        if (packet.type === 'pair-error') finish(packet.error);
        else if (packet.type === 'pair') {
          session = await hello.session(packet.publicKey);
          ws.send(JSON.stringify({ type: 'confirm', proof: session.proof }));
        } else if (packet.type === 'paired') finish(null, await session.open(packet));
      } catch (error) { finish(error.message); }
    });
  });
}

async function hostFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-pair-'));
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [], relayUrl: '' });
  config.port = host.http.address().port;
  const origin = 'http://127.0.0.1:' + config.port;
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, config, host, origin };
}

test('the CLI issues a host-owned code alongside the QR, without exposing the control endpoint to browsers', async t => {
  const { dir, config, origin } = await hostFixture(t);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  const { stdout } = await promisify(execFile)(process.execPath, ['bin/pi-remote.mjs', 'pair'], {
    env: { ...process.env, PI_REMOTE_HOME: dir, PI_REMOTE_PORT: String(config.port), PI_REMOTE_PUBLIC_URL: origin, PI_REMOTE_RELAY_URL: '' }
  });
  assert.match(stdout, /single use, expires in 60 seconds/);
  assert.match(stdout, /#token=.*&key=/);
  const code = stdout.match(/Pairing code: (\d{6})/)[1];
  const headers = { Authorization: 'Bearer ' + config.bridgeToken };
  const forbidden = await fetch(origin + '/_pi/pair', { method: 'POST', headers: { ...headers, Origin: origin } });
  assert.equal(forbidden.status, 403);
  assert.equal((await fetch(origin + '/_pi/pair', { headers })).status, 405);
  const credentials = await pair(origin.replace('http:', 'ws:') + '/pair', origin, code);
  assert.deepEqual(credentials, { token: config.clientToken, key: e2eKey(config) });
  const client = await socket(origin.replace('http:', 'ws:') + '/ws', credentials.token, origin, credentials.key);
  t.after(() => client.ws.terminate());
  assert.deepEqual((await client.request('ping')).value, { pong: true });
});

test('a real relay carries pairing without learning the code or key, and rejects guesses and reuse', async t => {
  const { config, host } = await hostFixture(t);
  const origin = 'https://relay.example';
  const pairing = createPairing(config);
  const relay = await startRelay({ hostToken: config.relayToken, clientToken: config.clientToken, publicUrl: origin, port: 0 });
  const target = 'ws://127.0.0.1:' + relay.http.address().port;
  const disconnect = connectRelay(host.service, target, config.relayToken, { key: e2eKey(config), pairing, allowInsecure: true });
  let client;
  t.after(async () => { client?.ws.terminate(); disconnect(); await relay.close(); });
  await until(() => disconnect.connected());
  const frames = [], send = WebSocket.prototype.send;
  t.mock.method(WebSocket.prototype, 'send', function (data, ...args) {
    frames.push(data.toString()); return send.call(this, data, ...args);
  });
  const { code } = pairing.issue();
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  await assert.rejects(pair(target + '/pair', origin, wrong), /Login expired, pair again/);
  const credentials = await pair(target + '/pair', origin, code);
  assert.deepEqual(credentials, { token: config.clientToken, key: e2eKey(config) });
  await assert.rejects(pair(target + '/pair', origin, code), /Login expired, pair again/);
  client = await socket(target + '/ws', credentials.token, origin, credentials.key);
  assert.deepEqual((await client.request('ping')).value, { pong: true });
  assert.match((await client.request('pairingCode')).value.code, /^\d{6}$/);
  assert.ok(frames.every(frame => !frame.includes(credentials.key)));
  assert.ok(frames.every(frame => !frame.includes('"code":')));
  const packetTypes = frames.flatMap(frame => { try { return [JSON.parse(frame).type]; } catch { return []; } });
  assert.ok(packetTypes.includes('pair') && packetTypes.includes('confirm') && packetTypes.includes('paired'));
});
