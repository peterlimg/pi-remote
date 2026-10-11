import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/protocol.js', ['protocol.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/images.js', ['images.js', 'text/javascript; charset=utf-8']],
  ['/e2e.js', ['e2e.js', 'text/javascript; charset=utf-8']],
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // The tunnel adds a slow round trip per request: revalidate (304) instead of re-downloading.
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const path = (req.url || '/').split('?')[0];
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
