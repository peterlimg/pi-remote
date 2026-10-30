import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/todo.html', ['todo.html', 'text/html; charset=utf-8']],
  ['/todo.css', ['todo.css', 'text/css; charset=utf-8']],
  ['/todo.js', ['todo.js', 'text/javascript; charset=utf-8']],
  ['/sdk-guide.html', ['sdk-guide.html', 'text/html; charset=utf-8']],
  ['/sdk-guide.css', ['sdk-guide.css', 'text/css; charset=utf-8']],
  ['/sdk-guide.js', ['sdk-guide.js', 'text/javascript; charset=utf-8']],
  ['/sdk-guide-font.woff2', ['sdk-guide-font.woff2', 'font/woff2']],
  ['/sdk-guide-social.png', ['sdk-guide-social.png', 'image/png']],
  ['/sdk-guide-print.png', ['sdk-guide-print.png', 'image/png']],
  ['/session-changes-prototype.html', ['session-changes-prototype.html', 'text/html; charset=utf-8']],
  ['/session-changes-prototype.css', ['session-changes-prototype.css', 'text/css; charset=utf-8']],
  ['/session-changes-prototype.js', ['session-changes-prototype.js', 'text/javascript; charset=utf-8']],
  ['/session-switch-prototype.html', ['session-switch-prototype.html', 'text/html; charset=utf-8']],
  ['/session-switch-prototype.css', ['session-switch-prototype.css', 'text/css; charset=utf-8']],
  ['/session-switch-prototype.js', ['session-switch-prototype.js', 'text/javascript; charset=utf-8']],
  ['/nearby-sessions-prototype.html', ['nearby-sessions-prototype.html', 'text/html; charset=utf-8']],
  ['/nearby-sessions-prototype.css', ['nearby-sessions-prototype.css', 'text/css; charset=utf-8']],
  ['/nearby-sessions-prototype.js', ['nearby-sessions-prototype.js', 'text/javascript; charset=utf-8']],
  ['/session-icons-prototype.html', ['session-icons-prototype.html', 'text/html; charset=utf-8']],
  ['/protocol.js', ['protocol.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/images.js', ['images.js', 'text/javascript; charset=utf-8']],
  ['/videos.js', ['videos.js', 'text/javascript; charset=utf-8']],
  ['/e2e.js', ['e2e.js', 'text/javascript; charset=utf-8']],
  ['/pairing.js', ['pairing.js', 'text/javascript; charset=utf-8']],
  ['/qr.js', ['qr.js', 'text/javascript; charset=utf-8']],
  ['/jsqr.js', ['../node_modules/jsqr/dist/jsQR.js', 'text/javascript; charset=utf-8']],
  ['/markdown-it.mjs', ['../node_modules/markdown-it/dist/browser/markdown-it.esm.min.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  // iOS home screen ignores SVG icons and the manifest's icons; it reads only this PNG.
  ['/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']]
]);
// The fixed list is the only thing a relay can request from the computer.
export const assetPath = req => {
  const path = (req.url || '/').split('?')[0];
  return req.method === 'GET' && files.has(path) ? path : undefined;
};
export const readAsset = path => readFileSync(new URL('../web/' + files.get(path)[0], import.meta.url));
// A relay passes the body it got from the computer; otherwise serve this install's copy.
export function serveStatic(req, res, body) {
  const path = (req.url || '/').split('?')[0];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // The tunnel adds a slow round trip per request: revalidate (304) instead of re-downloading.
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; " + (path === '/sdk-guide.html' ? "font-src 'self'; " : "") + "connect-src 'self'; img-src 'self' blob:; media-src blob:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (path === '/health' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (!assetPath(req)) { res.writeHead(404); res.end('Not found'); return; }
  body ??= readAsset(path);
  const etag = 'W/"' + createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"';
  res.setHeader('ETag', etag); res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'Content-Type': files.get(path)[1], ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gzip ? gzipSync(body) : body);
}
