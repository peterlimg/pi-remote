import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createECDH, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign } from 'node:crypto';

// Web Push (RFC 8291 payloads, RFC 8292 VAPID) with node:crypto. Payloads are end-to-end
// encrypted for the phone's browser; the push service sees only size and timing.
const b64 = buffer => Buffer.from(buffer).toString('base64url');
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const MAX_SUBSCRIPTIONS = 5;

export function encrypt(payload, { p256dh, auth }, { ecdh, salt = randomBytes(16) } = {}) {
  const uaPublic = Buffer.from(p256dh, 'base64url'), secret = Buffer.from(auth, 'base64url');
  if (!ecdh) { ecdh = createECDH('prime256v1'); ecdh.generateKeys(); }
  const asPublic = ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(uaPublic), secret,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

export class Push {
  constructor(dir, { allowEndpoint = url => url.protocol === 'https:' && PUSH_HOSTS.test(url.hostname) } = {}) {
    this.path = join(dir, 'push.json'); this.allowEndpoint = allowEndpoint;
    try { this.record = JSON.parse(readFileSync(this.path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      this.record = { version: 1, privateKey: privateKey.export({ format: 'jwk' }), subscriptions: [] };
      this.save();
    }
    const { x, y } = this.record.privateKey;
    this.publicKey = b64(Buffer.concat([Buffer.from([4]), Buffer.from(x, 'base64url'), Buffer.from(y, 'base64url')]));
    this.key = createPrivateKey({ key: this.record.privateKey, format: 'jwk' });
  }
  save() {
    const temp = this.path + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temp, JSON.stringify(this.record), { flag: 'wx', mode: 0o600 }); renameSync(temp, this.path); }
    finally { rmSync(temp, { force: true }); }
  }
  // The phone is authenticated, but the endpoint still decides where this host sends requests.
  subscribe(subscription) {
    let url;
    try { url = new URL(subscription?.endpoint); } catch { throw new Error('Invalid push subscription'); }
    const { p256dh, auth } = subscription.keys || {};
    if (!this.allowEndpoint(url) || subscription.endpoint.length > 2000 || typeof p256dh !== 'string' || Buffer.from(p256dh, 'base64url').length !== 65 ||
      typeof auth !== 'string' || Buffer.from(auth, 'base64url').length !== 16) throw new Error('Invalid push subscription');
    const others = this.record.subscriptions.filter(item => item.endpoint !== subscription.endpoint);
    this.record.subscriptions = [...others, { endpoint: subscription.endpoint, keys: { p256dh, auth }, at: Date.now() }].slice(-MAX_SUBSCRIPTIONS);
    this.save();
    return { subscribed: true };
  }
  unsubscribe(endpoint) {
    this.record.subscriptions = this.record.subscriptions.filter(item => item.endpoint !== endpoint);
    this.save();
    return { subscribed: false };
  }
  vapid(endpoint) {
    const audience = new URL(endpoint).origin, exp = Math.floor(Date.now() / 1000) + 12 * 3600;
    const unsigned = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64(JSON.stringify({ aud: audience, exp, sub: 'https://github.com/peterlimg/pi-remote' }));
    return `vapid t=${unsigned}.${b64(sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' }))}, k=${this.publicKey}`;
  }
  // At most once: failures are logged, never retried, so a lost push cannot repeat later.
  async send(message) {
    const payload = JSON.stringify(message);
    await Promise.all(this.record.subscriptions.map(async subscription => {
      try {
        const response = await fetch(subscription.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high',
            Authorization: this.vapid(subscription.endpoint) }, body: encrypt(payload, subscription.keys) });
        if ([404, 410].includes(response.status)) this.unsubscribe(subscription.endpoint);
        else if (!response.ok) console.error('Push delivery failed:', response.status);
      } catch (error) { console.error('Push delivery failed:', error.message); }
    }));
  }
}
