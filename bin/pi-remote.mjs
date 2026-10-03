#!/usr/bin/env node
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, dataDir } from '../src/config.mjs';
import { startHost } from '../src/host.mjs';
import { startRelay } from '../src/relay.mjs';
import { unlockDead, sessionKey } from '../src/locks.mjs';
import { pairingUrl, pairingQr, mobileUrl } from '../src/pairing.mjs';
import { ensureHost, stopHost, restartHost, hostStatus } from '../src/control.mjs';

const [command = 'serve', ...args] = process.argv.slice(2);
try {
  if (command === 'serve') {
    const config = loadConfig();
    const host = await startHost({ config, allowResume: !args.includes('--no-allow-resume') });
    console.log('Pi Remote: http://127.0.0.1:' + config.port);
    console.log('Use /pi-remote in Pi for your phone login QR.');
    let closing = false;
    const stop = async reason => {
      if (closing) return; closing = true;
      try { await host.close(reason); process.exit(0); }
      catch { process.exitCode = 1; } // close records the failure in host.log.
    };
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
    // `pi remove` and deleting ~/.pi/remote leave this process running, holding the port with a
    // token no install knows, so a reinstall cannot control or replace it. Exit once this install's
    // code or config is gone. Two misses in a row, so a config being written is not mistaken for one.
    const code = fileURLToPath(import.meta.url), configFile = join(dataDir(), 'config.json');
    let misses = 0;
    setInterval(() => {
      let ours = false;
      try { ours = existsSync(code) && JSON.parse(readFileSync(configFile, 'utf8')).bridgeToken === config.bridgeToken; } catch { /* Missing or mid-write. */ }
      misses = ours ? 0 : misses + 1;
      if (misses >= 2) void stop('install or config removed');
    }, 2000).unref();
    process.send?.({ type: 'ready', status: host.status() });
  } else if (command === 'start') {
    await ensureHost(); console.log('Pi Remote running. Use /pi-remote in Pi to log in.');
  } else if (command === 'stop') {
    console.log(await stopHost() ? 'Pi Remote stopped' : 'Pi Remote already stopped');
  } else if (command === 'restart') {
    await restartHost(); console.log('Pi Remote running. Use /pi-remote in Pi to log in.');
  } else if (command === 'pair') {
    const config = loadConfig();
    const running = await hostStatus(config);
    const publicUrl = running?.publicUrl || config.publicUrl;
    const url = pairingUrl(config, publicUrl);
    if (mobileUrl(publicUrl)) console.log(pairingQr(url).join('\n'));
    else console.log('Local-only link. Use /pi-remote setup in Pi to configure phone access.');
    console.log(url);
    console.log('This link grants access to all exposed sessions. Keep it private. Revoke by rotating clientToken and restarting the host/relay.');
  } else if (command === 'relay-env') {
    const config = loadConfig();
    console.log('PI_REMOTE_RELAY_HOST_TOKEN=' + config.relayToken);
    console.log('PI_REMOTE_RELAY_CLIENT_TOKEN=' + config.clientToken);
  } else if (command === 'relay') {
    const relay = await startRelay({
      hostToken: process.env.PI_REMOTE_RELAY_HOST_TOKEN,
      clientToken: process.env.PI_REMOTE_RELAY_CLIENT_TOKEN,
      publicUrl: process.env.PI_REMOTE_PUBLIC_URL,
      port: Number(process.env.PI_REMOTE_RELAY_PORT || 8788),
      bind: process.env.PI_REMOTE_RELAY_BIND || '127.0.0.1'
    });
    console.log('Pi Remote relay started');
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (closing) return; closing = true; await relay.close(); process.exit(0);
    });
  } else if (command === 'unlock') {
    if (!args[0]) throw new Error('Usage: pi-remote unlock <session-file | service>');
    const key = args[0] === 'service' ? 'service' : sessionKey(args[0]);
    unlockDead(join(dataDir(), 'locks'), key); console.log('Removed dead owner lock');
  } else if (command === 'status') {
    const status = await hostStatus();
    console.log(!status ? 'Pi Remote stopped' : status.closing ? 'Pi Remote stopping' :
      'Pi Remote running' + (status.relayUrl ? (status.relayConnected ? '; relay connected' + (status.relayOutdated ? ' but outdated; redeploy it' : '') : '; relay reconnecting') : ''));
  } else {
    throw new Error('Commands: start, stop, restart, serve [--no-allow-resume], pair, relay-env, relay, unlock <session-file | service>, status');
  }
} catch (error) {
  console.error(error.message);
  process.send?.({ type: 'error', error: error.message, code: error.code });
  if (process.connected) process.disconnect();
  process.exitCode = 1;
}
