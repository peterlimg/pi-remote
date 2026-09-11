import { mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const dataDir = () => process.env.PI_REMOTE_HOME || join(homedir(), '.pi', 'remote');
export function secret() { return randomBytes(32).toString('base64url'); }
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function ensureDir(dir) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
export function loadConfig(dir = dataDir()) {
  ensureDir(dir);
  const file = join(dir, 'config.json');
  try {
    const fd = openSync(file, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ bridgeToken: secret(), clientToken: secret(), relayToken: secret(), port: 8787 }, null, 2)); }
    finally { closeSync(fd); }
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  chmodSync(file, 0o600);
  const config = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['bridgeToken', 'clientToken', 'relayToken']) {
    if (typeof config[key] !== 'string' || config[key].length < 32) throw new Error('Invalid ' + key + ' in ' + file);
  }
  config.port = Number(process.env.PI_REMOTE_PORT || config.port);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid port');
  return config;
}
export function originAllowed(origin, allowed) {
  return typeof origin === 'string' && allowed.includes(origin);
}
export function parseObject(raw) {
  const value = JSON.parse(raw.toString());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value;
}
export function send(ws, value) {
  if (ws.readyState !== 1) return false;
  if (ws.bufferedAmount > 8 * 1024 * 1024) { ws.close(1013, 'Slow connection; reconnect'); return false; }
  ws.send(JSON.stringify(value));
  return true;
}
export function protectSocket(ws) {
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const timer = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    if (ws.readyState === 1) ws.ping();
  }, 20000);
  timer.unref();
  ws.once('close', () => clearInterval(timer));
}
