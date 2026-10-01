import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { sealClient } from '../src/e2e.mjs';
export const testKey = 'k'.repeat(43);
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = fn(); if (result) return result; await delay(20); }
  throw new Error('Condition timed out');
}
export async function socket(url, token, origin, key) {
  const raw = new WebSocket(url, origin ? { origin } : {});
  const messages = [];
  raw.on('error', () => {});
  await new Promise((resolve, reject) => { raw.once('open', resolve); raw.once('error', reject); });
  raw.send(JSON.stringify({ type: 'auth', token, ...(key ? { e2e: true } : {}) }));
  let ws = raw;
  if (key) {
    // Plaintext relay notices before the hello are still recorded.
    const plain = data => { try { messages.push(JSON.parse(data.toString())); } catch {} };
    raw.on('message', plain);
    ws = await new Promise((resolve, reject) => {
      raw.once('close', () => reject(new Error('Closed before encryption started')));
      sealClient(raw, key, sealed => {
        raw.off('message', plain); messages.pop(); // drop the host hello
        sealed.on('message', data => messages.push(JSON.parse(data.toString()))); resolve(sealed);
      });
    });
  } else ws.on('message', data => messages.push(JSON.parse(data.toString())));
  return { ws, messages, async request(op, rest = {}) {
    const id = randomUUID(); ws.send(JSON.stringify({ op, id, ...rest }));
    return until(() => messages.find(x => x.type === 'response' && x.id === id));
  }};
}
