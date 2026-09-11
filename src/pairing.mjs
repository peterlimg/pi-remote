import qr from 'qrcode-terminal';
import { publicOrigin } from './config.mjs';

export function pairingUrl(config, publicUrl = config.publicUrl || 'http://127.0.0.1:' + config.port) {
  const url = new URL(publicOrigin(publicUrl));
  url.hash = 'token=' + config.clientToken;
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

export function pairingLines(url, code, width, height) {
  width = Math.max(1, width);
  const wrap = text => text.match(new RegExp('.{1,' + width + '}', 'g')) || [''];
  const lines = ['Pi Remote', 'Scan with your phone camera to log in.',
    'Private link: controls all exposed sessions.', '', ...wrap(url), '',
    'Enter / Esc closes this screen. Service stays on.', '/pi-remote stop turns remote access off.'];
  const qrWidth = code[0].replace(/\x1b\[[0-9;]*m/g, '').length;
  const text = lines.flatMap(wrap);
  if (width < qrWidth || height < text.length + code.length + 1) {
    return [...wrap('Enlarge the terminal to show the QR, or open the private link.'), '', ...text];
  }
  return [...text.slice(0, 4), ...code, '', ...text.slice(4)];
}
