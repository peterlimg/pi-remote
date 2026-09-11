import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { join } from 'node:path';
import { loadConfig, dataDir, parseObject, equalSecret, send, originAllowed, protectSocket } from './config.mjs';
import { acquireLock } from './locks.mjs';
import { SessionService } from './service.mjs';
import { rootsFromEnv } from './catalog.mjs';
import { attachClient } from './client-channel.mjs';
import { serveStatic } from './http.mjs';
import { connectRelay } from './relay.mjs';

export async function startHost(options = {}) {
  const dir = options.dir || dataDir(), config = options.config || loadConfig(dir);
  const port = options.port ?? config.port;
  const lock = acquireLock(join(dir, 'locks'), 'service', { kind: 'service' });
  const service = new SessionService({ dir, roots: options.roots || rootsFromEnv(), allowResume: !!options.allowResume, workerOptions: options.workerOptions });
  const http = createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const origins = new Set(['http://127.0.0.1:' + port, 'http://localhost:' + port]);
  if (options.publicUrl || process.env.PI_REMOTE_PUBLIC_URL) origins.add(new URL(options.publicUrl || process.env.PI_REMOTE_PUBLIC_URL).origin);
  http.on('upgrade', (req, socket, head) => {
    const bridge = req.url === '/bridge';
    if ((!bridge && req.url !== '/ws') || (!bridge && !originAllowed(req.headers.origin, [...origins])) || (bridge && req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const timer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
      ws.on('error', () => {});
      ws.once('close', () => clearTimeout(timer));
      ws.once('message', raw => {
        clearTimeout(timer);
        try {
          const auth = parseObject(raw);
          if (auth.type !== 'auth' || !equalSecret(auth.token, bridge ? config.bridgeToken : config.clientToken)) throw new Error('Authentication failed');
          if (!bridge) { attachClient(ws, service); return; }
          protectSocket(ws);
          ws.on('message', raw => {
            try {
              const packet = parseObject(raw);
              if (packet.type === 'register') service.register(ws, packet.state, packet.owner);
              else if (packet.type === 'snapshot') service.snapshot(ws, packet.state);
              else if (packet.type === 'result') service.result(ws, packet);
              else throw new Error('Unsupported bridge message');
            } catch (e) { send(ws, { type: 'notice', error: e.message }); ws.close(1008, e.message.slice(0, 100)); }
          });
          ws.once('close', () => service.disconnected(ws));
          send(ws, { type: 'ready' });
        } catch { ws.close(1008, 'Authentication failed'); }
      });
    });
  });
  let disconnectRelay;
  try {
    await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve); });
    const actualPort = http.address().port;
    origins.add('http://127.0.0.1:' + actualPort); origins.add('http://localhost:' + actualPort);
    if (options.relayUrl || process.env.PI_REMOTE_RELAY_URL) disconnectRelay = connectRelay(service, options.relayUrl || process.env.PI_REMOTE_RELAY_URL, config.relayToken);
  } catch (e) {
    await service.close(); lock.release(); http.close(); throw e;
  }
  return { http, service, async close() {
    disconnectRelay?.(); await service.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close(); await new Promise(resolve => http.close(resolve)); lock.release();
  }};
}
