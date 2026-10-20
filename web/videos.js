export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const VIDEO_CHUNK_BYTES = 256 * 1024;
export const VIDEO_LIMIT = 'Attach up to 4 images or videos. Images: 2 MB total. Videos: 200 MB each.';

export function isVideo(file) {
  return /^video\/[a-z0-9.+-]+$/i.test(file.type) ||
    (!file.type && /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name));
}

const VIDEO_HEADERS = {
  user: 'Attached video files (originals on this computer):\n',
  assistant: 'Generated video files (on this computer):\n'
};
export function videoMessage(text, paths, role = 'user') {
  if (!Object.hasOwn(VIDEO_HEADERS, role)) throw new Error('Invalid video message role');
  return paths.length ? [text, VIDEO_HEADERS[role] + paths.map(path => JSON.stringify(path)).join('\n')]
    .filter(Boolean).join('\n\n') : text;
}

export function splitVideoMessage(text = '', role = 'user') {
  const unchanged = { text, paths: [] };
  if (!Object.hasOwn(VIDEO_HEADERS, role)) return unchanged;
  const header = VIDEO_HEADERS[role], index = text.lastIndexOf(header);
  if (index < 0 || (index > 0 && !text.slice(0, index).endsWith('\n\n'))) return unchanged;
  try {
    const paths = text.slice(index + header.length).trimEnd().split('\n').map(line => JSON.parse(line));
    if (!paths.length || paths.length > 4 || paths.some(path => typeof path !== 'string' ||
      !/^\/[^\r\n]*\/videos\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-zA-Z0-9._-]{1,180}$/.test(path))) return unchanged;
    return { text: text.slice(0, index).trimEnd(), paths };
  } catch { return unchanged; }
}

const VIDEO_CACHE_BYTES = 400 * 1024 * 1024;

// Storage restrictions or a full disk must never prevent playback.
export class VideoCache {
  constructor(scope) { this.scope = scope; this.queue = Promise.resolve(); this.closed = false; }
  async cacheName() {
    if (!this.name) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.scope));
      this.name = 'pi-remote-videos-v1-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return this.name;
  }
  url(id) { return location.origin + '/_pi/video-cache/' + encodeURIComponent(id); }
  run(action) {
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      const name = await this.cacheName();
      if (!this.closed) return action(await caches.open(name));
    }).catch(() => {});
    return this.queue;
  }
  get(id, info) {
    if (typeof info.revision !== 'string' || !info.revision) return Promise.resolve();
    return this.run(async cache => {
      const url = this.url(id), response = await cache.match(url);
      if (!response) return;
      if (response.headers.get('X-Pi-Remote-Revision') === info.revision) {
        const file = await response.blob();
        if (file.size === info.size && file.type === info.mimeType) return file;
      }
      await cache.delete(url);
    });
  }
  put(id, info, file) {
    if (typeof info.revision !== 'string' || !info.revision || file.size !== info.size || file.size > MAX_VIDEO_BYTES) return Promise.resolve();
    return this.run(async cache => {
      const url = this.url(id);
      await cache.delete(url);
      await cache.put(url, new Response(file, { headers: {
        'Content-Length': String(file.size), 'X-Pi-Remote-Revision': info.revision
      } }));
      const entries = [];
      let total = 0;
      for (const request of await cache.keys()) {
        const response = await cache.match(request), size = Number(response?.headers.get('Content-Length'));
        if (!Number.isSafeInteger(size) || size <= 0) { await cache.delete(request); continue; }
        entries.push([request, size]); total += size;
      }
      for (const [request, size] of entries) {
        if (total <= VIDEO_CACHE_BYTES) break;
        await cache.delete(request); total -= size;
      }
    });
  }
  clear() {
    this.closed = true;
    this.queue = this.queue.then(async () => { await caches.delete(await this.cacheName()); }).catch(() => {});
    return this.queue;
  }
}
