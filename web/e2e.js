// Browser counterpart of src/e2e.mjs: AES-256-GCM with per-channel HKDF keys.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const base64 = bytes => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const bytes = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
const urlBytes = text => bytes(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
const urlBase64 = value => base64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const iv = n => { const value = new Uint8Array(12); new DataView(value.buffer).setBigUint64(4, BigInt(n)); return value; };

export function validKey(key) {
  try { return /^[A-Za-z0-9_-]{43}$/.test(key) && urlBytes(key).length === 32; } catch { return false; }
}
export function hello() {
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  return { nonce, packet: { type: 'hello', nonce: urlBase64(nonce) } };
}
// Resolves to { seal, open }. Each returns a promise; calls complete in call order,
// matching the implicit counters on both ends.
export async function channel(key, clientNonce, hostNonceText) {
  const hostNonce = urlBytes(typeof hostNonceText === 'string' ? hostNonceText : '');
  if (hostNonce.length !== 16) throw new Error('Invalid encryption hello');
  const ikm = await crypto.subtle.importKey('raw', urlBytes(key), 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array([...clientNonce, ...hostNonce]);
  const derive = (info, use) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('pi-remote ' + info) },
    ikm, { name: 'AES-GCM', length: 256 }, false, [use]);
  const [sealKey, openKey] = await Promise.all([derive('c2h', 'encrypt'), derive('h2c', 'decrypt')]);
  let sent = 0, received = 0, sealing = Promise.resolve(), opening = Promise.resolve();
  return {
    seal(text) {
      const n = sent++;
      return sealing = sealing.then(() => crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv(n) }, sealKey, encoder.encode(text)))
        .then(data => base64(new Uint8Array(data)));
    },
    open(frame) {
      const n = received++;
      return opening = opening.then(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv(n) }, openKey, bytes(frame)))
        .then(data => decoder.decode(data));
    }
  };
}
