import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { equalSecret, parseObject, send, protectSocket, originAllowed } from './config.mjs';
import { serveStatic, assetPath, readAsset } from './http.mjs';
import { attachClient } from './client-channel.mjs';
import { acceptSealed } from './e2e.mjs';

// Sealed frames are base64 of JSON that may already carry base64 images; leave headroom.
const MAX_RELAY_PAYLOAD = 6 * 1024 * 1024;
// Bump when deployed relays must be updated: computers then ask their users to redeploy.
// Version 2: the relay serves the phone app from the connected computer.
export const RELAY_PROTOCOL = 2;

export async function startRelay({ hostToken, clientToken, publicUrl, port = 8788, bind = '127.0.0.1' }) {
  if (!hostToken || hostToken.length < 32 || !clientToken || clientToken.length < 32 || hostToken === clientToken) throw new Error('Relay requires two distinct secrets of at least 32 characters');
  if (!publicUrl) throw new Error('PI_REMOTE_PUBLIC_URL is required');
  const origin = new URL(publicUrl).origin;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RELAY_PAYLOAD });
  let host;
  const clients = new Map(), arrivals = new EventEmitter().setMaxListeners(0);
  // The phone app comes from the computer, so UI changes ship with `pi update` instead of a
  // relay redeploy. Each file is fetched once per computer connection, so public requests
  // cannot make the computer resend it; older computers and offline ones get this relay's copy.
  const hostAsset = async path => {
    // A waking relay usually sees the computer reconnect within a couple of seconds.
    if (!host) await once(arrivals, 'host', { signal: AbortSignal.timeout(5000) }).catch(() => {});
    const current = host;
    if (!current?.assets) return;
    if (!current.assets.has(path)) {
      const asset = new Promise(resolve => {
        const id = randomUUID();
        const done = body => { clearTimeout(timer); current.pending.delete(id); resolve(typeof body === 'string' ? Buffer.from(body, 'base64') : undefined); };
        const timer = setTimeout(done, 10000);
        current.pending.set(id, done);
        send(current, { type: 'asset', id, path });
      });
      current.assets.set(path, asset);
      asset.then(body => { if (!body) current.assets.delete(path); }); // Retry failures on the next request.
    }
    return current.assets.get(path);
  };
  const http = createServer(async (req, res) => {
    const path = assetPath(req);
    serveStatic(req, res, path && await hostAsset(path));
  });
  http.on('upgrade', (req, socket, head) => {
    if (!['/host', '/ws'].includes(req.url || '') || (req.url === '/ws' && !originAllowed(req.headers.origin, [origin]))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const isHost = req.url === '/host';
      const timer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
      protectSocket(ws);
      ws.once('message', raw => {
        clearTimeout(timer);
        let auth;
        try { auth = parseObject(raw); } catch { ws.close(1008, 'Invalid authentication'); return; }
        if (auth.type !== 'auth' || !equalSecret(auth.token, isHost ? hostToken : clientToken)) {
          ws.close(1008, 'Authentication failed'); return;
        }
        if (isHost) {
          // A restarted computer replaces a connection whose close the relay has not seen yet;
          // otherwise it would wait for the heartbeat (up to 40 s) to drop the stale one.
          if (host) {
            const stale = host; host = undefined;
            for (const client of clients.values()) client.close(1012, 'Computer reconnected');
            clients.clear(); stale.terminate();
          }
          host = ws; send(ws, { type: 'ready', version: RELAY_PROTOCOL });
          if (auth.version >= 2) { ws.assets = new Map(); ws.pending = new Map(); }
          arrivals.emit('host');
          ws.on('message', raw => {
            try {
              const packet = parseObject(raw);
              if (packet.type === 'asset' && typeof packet.id === 'string') ws.pending?.get(packet.id)?.(packet.body);
              else if (packet.type === 'data' && typeof packet.data === 'string') {
                const client = clients.get(packet.id);
                if (client?.readyState === 1) {
                  if (client.bufferedAmount > 8 * 1024 * 1024) client.close(1013, 'Slow connection');
                  else client.send(packet.data);
                }
              } else if (packet.type === 'close') clients.get(packet.id)?.close(1012, 'Computer closed channel');
            } catch { ws.close(1008, 'Invalid relay packet'); }
          });
          ws.once('close', () => {
            for (const done of ws.pending?.values() || []) done();
            if (host !== ws) return;
            host = undefined; for (const client of clients.values()) client.close(1012, 'Computer disconnected'); clients.clear();
          });
        } else {
          if (!host || host.readyState !== 1) { send(ws, { type: 'notice', error: 'Computer is offline' }); ws.close(1013, 'Computer offline'); return; }
          if (clients.size >= 16) { ws.close(1013, 'Too many clients'); return; }
          const id = randomUUID(); clients.set(id, ws); send(host, { type: 'open', id });
          ws.on('message', raw => send(host || {}, { type: 'data', id, data: raw.toString() }));
          ws.once('close', () => { clients.delete(id); if (host) send(host, { type: 'close', id }); });
        }
      });
      ws.once('close', () => clearTimeout(timer));
      ws.on('error', () => {});
    });
  });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, bind, resolve); });
  return { http, async close() { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(resolve => http.close(resolve)); } };
}

class VirtualSocket extends EventEmitter {
  constructor(host, id) { super(); this.host = host; this.id = id; this.readyState = 1; }
  get bufferedAmount() { return this.host.bufferedAmount; }
  send(data) { send(this.host, { type: 'data', id: this.id, data }); }
  ping() { this.emit('pong'); } // underlying authenticated WebSocket owns heartbeat
  terminate() { this.close(); }
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3; send(this.host, { type: 'close', id: this.id }); this.emit('close');
  }
}
export function connectRelay(service, url, token, { key, allowInsecure = false } = {}) {
  if (!key) throw new Error('Relay channels require an encryption key');
  const target = new URL(url);
  if (target.protocol !== 'wss:' && !(allowInsecure && target.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) throw new Error('Relay URL must use wss:// (loopback ws:// only in tests)');
  target.pathname = '/host'; target.search = ''; target.hash = '';
  let stopped = false, connected = false, outdated = false, socket, timer;
  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(target, { maxPayload: MAX_RELAY_PAYLOAD }); socket = ws;
    const virtual = new Map();
    const readyTimer = setTimeout(() => ws.terminate(), 20000);
    protectSocket(ws);
    ws.on('open', () => send(ws, { type: 'auth', token, version: RELAY_PROTOCOL }));
    ws.on('message', raw => {
      if (stopped || socket !== ws) return;
      try {
        const packet = parseObject(raw);
        if (packet.type === 'ready') { clearTimeout(readyTimer); connected = true; outdated = !(packet.version >= RELAY_PROTOCOL); }
        else if (packet.type === 'asset' && typeof packet.id === 'string') {
          let body;
          try { body = readAsset(packet.path).toString('base64'); } catch { /* Not a phone app file. */ }
          send(ws, { type: 'asset', id: packet.id, body });
        }
        else if (packet.type === 'open' && typeof packet.id === 'string') {
          if (virtual.has(packet.id) || virtual.size >= 16) throw new Error('Too many channels');
          const client = new VirtualSocket(ws, packet.id); virtual.set(packet.id, client);
          client.once('close', () => virtual.delete(packet.id));
          acceptSealed(client, key, sealed => attachClient(sealed, service));
        } else if (packet.type === 'data' && typeof packet.data === 'string') virtual.get(packet.id)?.emit('message', packet.data);
        else if (packet.type === 'close') virtual.get(packet.id)?.close();
      } catch { ws.close(1008, 'Invalid relay message'); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(readyTimer);
      connected = false;
      for (const client of virtual.values()) client.close();
      if (!stopped) timer = setTimeout(connect, 2000);
    });
  };
  connect();
  const disconnect = () => {
    stopped = true; connected = false; clearTimeout(timer);
    // A close frame tells the relay at once; a bare TCP reset may never cross its proxy,
    // and the relay would keep routing phones to this dead connection until its heartbeat.
    const ws = socket;
    if (ws?.readyState === 1) { ws.close(1001, 'Computer stopping'); setTimeout(() => ws.terminate(), 1000).unref(); }
    else ws?.terminate();
  };
  disconnect.connected = () => connected;
  disconnect.outdated = () => connected && outdated;
  return disconnect;
}
