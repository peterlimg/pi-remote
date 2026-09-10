#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, dataDir } from '../src/config.mjs';
import { startHost } from '../src/host.mjs';
import { startRelay } from '../src/relay.mjs';
import { unlockDead, sessionKey } from '../src/locks.mjs';

const [command = 'serve', ...args] = process.argv.slice(2);
try {
  if (command === 'serve') {
    const config = loadConfig();
    const host = await startHost({ config, allowResume: args.includes('--allow-resume') });
    console.log('Pi Remote: http://127.0.0.1:' + config.port);
    console.log('Run "node bin/pi-remote.mjs pair" for your phone login link.');
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (closing) return; closing = true; await host.close(); process.exit(0);
    });
  } else if (command === 'pair') {
    const config = loadConfig();
    const url = new URL(process.env.PI_REMOTE_PUBLIC_URL || 'http://127.0.0.1:' + config.port);
    url.hash = 'token=' + config.clientToken;
    console.log(url.href);
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
    const config = loadConfig();
    const response = await fetch('http://127.0.0.1:' + config.port + '/health');
    console.log(response.ok ? 'Service reachable' : 'Service returned ' + response.status);
  } else {
    throw new Error('Commands: serve [--allow-resume], pair, relay-env, relay, unlock <session-file | service>, status');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
