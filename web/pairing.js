// SPEKE-style PAKE over the RFC 3526 2048-bit safe-prime group. The code is never
// sent, and a recorded exchange cannot be used to check guesses offline.
const prime = BigInt('0x' +
  'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff');
const order = (prime - 1n) / 2n;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), byte => parseInt(byte, 16));
function power(base, exponent) {
  let result = 1n;
  for (; exponent; exponent >>= 1n, base = base * base % prime) if (exponent & 1n) result = result * base % prime;
  return result;
}

export async function pairingHello(code) {
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit pairing code from your computer.');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('pi-remote pairing v1\0' + code)));
  const generator = power(BigInt('0x' + hex(hash)), 2n);
  if (generator <= 1n) throw new Error('Invalid pairing code');
  const exponent = BigInt('0x' + hex(crypto.getRandomValues(new Uint8Array(32)))) + 1n;
  const publicKey = power(generator, exponent).toString(16).padStart(512, '0');
  return { publicKey, async session(peer, side = 'client') {
    if (typeof peer !== 'string' || !/^[0-9a-f]{512}$/.test(peer) || peer === publicKey) throw new Error('Invalid pairing exchange');
    const value = BigInt('0x' + peer);
    if (value <= 1n || value >= prime - 1n || power(value, order) !== 1n) throw new Error('Invalid pairing exchange');
    const transcript = encoder.encode('pi-remote pairing v1\0' + (side === 'client' ? publicKey + peer : peer + publicKey));
    const salt = await crypto.subtle.digest('SHA-256', transcript);
    const shared = unhex(power(value, exponent).toString(16).padStart(512, '0'));
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const derive = (info, algorithm, usages) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) }, material, algorithm, false, usages);
    const aes = await derive('pi-remote pairing credentials', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
    const mac = await derive('pi-remote pairing confirmation', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']);
    const proof = hex(new Uint8Array(await crypto.subtle.sign('HMAC', mac, encoder.encode('client confirmation'))));
    return { proof, async seal(credentials) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: transcript }, aes, encoder.encode(JSON.stringify(credentials)));
      return { iv: hex(iv), data: hex(new Uint8Array(data)) };
    }, async open(packet) {
      if (!/^[0-9a-f]{24}$/.test(packet.iv) || typeof packet.data !== 'string' || !/^(?:[0-9a-f]{2}){16,1024}$/.test(packet.data)) throw new Error('Invalid pairing response');
      const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(packet.iv), additionalData: transcript }, aes, unhex(packet.data));
      return JSON.parse(decoder.decode(data));
    } };
  } };
}

export async function pairWithCode(code) {
  const hello = await pairingHello(code);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/pair');
    let session, stage = 'hello', done = false;
    const finish = (error, credentials) => {
      if (done) return;
      done = true; clearTimeout(timer); ws.close();
      if (error) reject(new Error(error)); else resolve(credentials);
    };
    const timer = setTimeout(() => finish('Your computer is offline'), 15000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'pair', publicKey: hello.publicKey })));
    ws.addEventListener('message', async event => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'pair-error') { finish(packet.error); return; }
        if (packet.type === 'notice' && packet.error === 'Computer is offline') { finish('Your computer is offline'); return; }
        if (packet.type === 'pair' && stage === 'hello') {
          stage = 'confirm'; session = await hello.session(packet.publicKey);
          if (!done) ws.send(JSON.stringify({ type: 'confirm', proof: session.proof }));
        } else if (packet.type === 'paired' && stage === 'confirm' && session) {
          stage = 'done'; finish(null, await session.open(packet));
        } else finish('Login expired, pair again');
      } catch { finish('Login expired, pair again'); }
    });
    ws.addEventListener('error', () => finish('Your computer is offline'));
    ws.addEventListener('close', () => { if (stage !== 'done') finish('Your computer is offline'); });
  });
}
