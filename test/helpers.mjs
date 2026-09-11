import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = fn(); if (result) return result; await delay(20); }
  throw new Error('Condition timed out');
}
export async function socket(url, token, origin) {
  const ws = new WebSocket(url, origin ? { origin } : {});
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', token }));
  return { ws, messages, async request(op, rest = {}) {
    const id = randomUUID(); ws.send(JSON.stringify({ op, id, ...rest }));
    return until(() => messages.find(x => x.type === 'response' && x.id === id));
  }};
}
