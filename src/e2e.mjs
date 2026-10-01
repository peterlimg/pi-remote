import { createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseObject, send } from './config.mjs';

// Phone <-> host encryption, so the relay only forwards ciphertext. The relay sees
// clientToken but never bridgeToken, so it cannot derive this key. Rotating
// clientToken rotates the key. Browser counterpart: web/e2e.js.
export const e2eKey = config => createHmac('sha256', config.bridgeToken)
  .update('pi-remote e2e v1\0' + config.clientToken).digest('base64url');

const nonce = text => {
  const value = Buffer.from(typeof text === 'string' ? text : '', 'base64url');
  if (value.length !== 16) throw new Error('Invalid encryption hello');
  return value;
};
// Fresh nonces from both sides give each channel its own keys, so a counter IV
// never repeats and frames cannot be replayed into, or reflected within, a channel.
function channel(key, clientNonce, hostNonce, side) {
  const ikm = Buffer.from(key, 'base64url'), salt = Buffer.concat([clientNonce, hostNonce]);
  const derive = info => Buffer.from(hkdfSync('sha256', ikm, salt, 'pi-remote ' + info, 32));
  const [out, inn] = side === 'host' ? ['h2c', 'c2h'] : ['c2h', 'h2c'];
  const sealKey = derive(out), openKey = derive(inn);
  let sent = 0n, received = 0n;
  const iv = n => { const value = Buffer.alloc(12); value.writeBigUInt64BE(n, 4); return value; };
  return {
    seal(text) {
      const cipher = createCipheriv('aes-256-gcm', sealKey, iv(sent++));
      return Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    },
    open(frame) {
      const data = Buffer.from(frame, 'base64');
      if (data.length < 16) throw new Error('Invalid encrypted frame');
      const decipher = createDecipheriv('aes-256-gcm', openKey, iv(received++));
      decipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
    }
  };
}

class SealedSocket extends EventEmitter {
  constructor(inner, crypto) {
    super(); this.inner = inner; this.crypto = crypto;
    inner.on('message', raw => {
      let text;
      try { text = crypto.open(raw.toString()); } catch { inner.close(1008, 'Encryption failed'); return; }
      this.emit('message', text);
    });
    inner.on('pong', () => this.emit('pong'));
    inner.once('close', (...args) => this.emit('close', ...args));
  }
  get readyState() { return this.inner.readyState; }
  get bufferedAmount() { return this.inner.bufferedAmount; }
  send(text) { this.inner.send(this.crypto.seal(text)); }
  ping() { this.inner.ping(); }
  close(...args) { this.inner.close(...args); }
  terminate() { this.inner.terminate(); }
}

// Host side: the first message after authentication must be a hello.
export function acceptSealed(socket, key, onSocket) {
  const timer = setTimeout(() => socket.close(1008, 'Encryption required'), 5000);
  socket.once('close', () => clearTimeout(timer));
  socket.once('message', raw => {
    clearTimeout(timer);
    let hello;
    try { hello = parseObject(raw); } catch { /* Not a hello. */ }
    if (hello?.type !== 'hello') { socket.close(1008, 'Encryption required. Rescan the QR code.'); return; }
    let clientNonce;
    try { clientNonce = nonce(hello.nonce); } catch { socket.close(1008, 'Invalid encryption hello'); return; }
    const hostNonce = randomBytes(16);
    send(socket, { type: 'hello', nonce: hostNonce.toString('base64url') });
    onSocket(new SealedSocket(socket, channel(key, clientNonce, hostNonce, 'host')));
  });
}

// Client side, after sending auth. onSocket runs synchronously on the host hello so
// no sealed message that follows it in the same read can be missed.
export function sealClient(ws, key, onSocket) {
  const clientNonce = randomBytes(16);
  send(ws, { type: 'hello', nonce: clientNonce.toString('base64url') });
  const onMessage = raw => {
    let packet;
    try { packet = parseObject(raw); } catch { return; }
    if (packet.type !== 'hello') return; // relay notices arrive in plaintext
    ws.off('message', onMessage);
    try { onSocket(new SealedSocket(ws, channel(key, clientNonce, nonce(packet.nonce), 'client'))); }
    catch { ws.close(1008, 'Invalid encryption hello'); }
  };
  ws.on('message', onMessage);
}
