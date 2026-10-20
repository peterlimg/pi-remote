import qr from 'qrcode-terminal';
import { randomInt } from 'node:crypto';
import { publicOrigin, equalSecret, parseObject, send } from './config.mjs';
import { e2eKey } from './e2e.mjs';
import { pairingHello } from '../web/pairing.js';

// One host-wide budget also covers relay clients. Issuing a new code never resets it.
export function createPairing(config) {
  let current;
  const attempts = [];
  const valid = state => state && current === state && Date.now() < state.expiresAt;
  return {
    issue() {
      current = { code: String(randomInt(1000000)).padStart(6, '0'), expiresAt: Date.now() + 60000 };
      return { ...current };
    },
    attach(socket) {
      const fail = (error = 'Login expired, pair again') => { send(socket, { type: 'pair-error', error }); socket.close(1000); };
      const now = Date.now();
      while (attempts.length && attempts[0] <= now - 60000) attempts.shift();
      if (attempts.length >= 5) { fail('Too many attempts. Wait a minute, then pair again.'); return; }
      attempts.push(now);
      const state = current;
      if (!valid(state)) { fail(); return; }
      let session, stage = 'hello';
      const timer = setTimeout(() => fail(), Math.min(10000, state.expiresAt - now));
      socket.once('close', () => clearTimeout(timer));
      socket.on('message', async raw => {
        try {
          if (raw.length > 2048 || !valid(state)) { fail(); return; }
          const packet = parseObject(raw);
          if (stage === 'hello' && packet.type === 'pair') {
            stage = 'busy';
            const hello = await pairingHello(state.code);
            session = await hello.session(packet.publicKey, 'host');
            if (socket.readyState !== 1) return;
            if (!valid(state)) { fail(); return; }
            stage = 'confirm'; send(socket, { type: 'pair', publicKey: hello.publicKey });
          } else if (stage === 'confirm' && packet.type === 'confirm' && equalSecret(packet.proof, session.proof)) {
            // Consume before any async work, so simultaneous confirmations cannot reuse it.
            stage = 'done'; current = undefined; clearTimeout(timer);
            const credentials = await session.seal({ token: config.clientToken, key: e2eKey(config) });
            send(socket, { type: 'paired', ...credentials }); socket.close(1000);
          } else fail();
        } catch { fail(); }
      });
    }
  };
}

export async function requestPairingCode(config) {
  const response = await fetch('http://127.0.0.1:' + config.port + '/_pi/pair', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.bridgeToken }, signal: AbortSignal.timeout(10000), redirect: 'error'
  });
  if (!response.ok) throw new Error('Could not create a pairing code. Check that Pi Remote is running and up to date.');
  return response.json();
}

export function pairingUrl(config, publicUrl = config.publicUrl || 'http://127.0.0.1:' + config.port) {
  const url = new URL(publicOrigin(publicUrl));
  url.hash = 'token=' + config.clientToken + '&key=' + e2eKey(config);
  return url.href;
}

export function mobileUrl(publicUrl) {
  const url = new URL(publicOrigin(publicUrl));
  return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function pairingQr(url) {
  let output;
  qr.generate(url, { small: true }, value => { output = value; });
  const lines = output.trimEnd().split('\n');
  lines[0] = '█'.repeat(lines[0].length);
  // Four light modules of quiet zone, with fixed colors on both terminal themes.
  const border = '█'.repeat(lines[0].length + 6);
  return [border, border, ...lines.map(line => '███' + line + '███'), border, border]
    .map(line => '\x1b[38;2;255;255;255m\x1b[48;2;0;0;0m' + line + '\x1b[0m');
}

export function pairingLines(url, code, width, height, pairing) {
  width = Math.max(1, width);
  const wrap = text => text.match(new RegExp('.{1,' + width + '}', 'g')) || [''];
  const lines = ['Pi Remote', 'Scan with your phone camera to log in.',
    'Private link: controls all exposed sessions.', '',
    ...(pairing ? ['Pairing code: ' + pairing.code, 'Single use, expires in 60 seconds. Reopen /pi-remote for a new code.', 'Enter it in Pi Remote at ' + new URL(url).origin, ''] : []), ...wrap(url), '',
    'Enter / Esc closes this screen. Service stays on.', '/pi-remote stop turns remote access off.'];
  const qrWidth = code[0].replace(/\x1b\[[0-9;]*m/g, '').length;
  const text = lines.flatMap(wrap);
  if (width < qrWidth || height < text.length + code.length + 1) {
    return [...wrap('Enlarge the terminal to show the QR, or open the private link.'), '', ...text];
  }
  return [...text.slice(0, 4), ...code, '', ...text.slice(4)];
}
