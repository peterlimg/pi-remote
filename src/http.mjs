import { readFileSync } from 'node:fs';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/protocol.js', ['protocol.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/images.js', ['images.js', 'text/javascript; charset=utf-8']],
  ['/e2e.js', ['e2e.js', 'text/javascript; charset=utf-8']],
  ['/markdown-it.mjs', ['../node_modules/markdown-it/dist/browser/markdown-it.esm.min.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']]
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
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const path = (req.url || '/').split('?')[0];
  if (path === '/health' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (!assetPath(req)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': files.get(path)[1] });
  res.end(body ?? readAsset(path));
}
