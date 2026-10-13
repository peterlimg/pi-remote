export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const VIDEO_CHUNK_BYTES = 256 * 1024;
export const VIDEO_LIMIT = 'Attach up to 4 images or videos. Images: 2 MB total. Videos: 200 MB each.';

export function isVideo(file) {
  return /^video\/[a-z0-9.+-]+$/i.test(file.type) ||
    (!file.type && /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name));
}

const VIDEO_HEADER = 'Attached video files (originals on this computer):\n';
export function videoMessage(text, paths) {
  return paths.length ? [text, VIDEO_HEADER + paths.map(path => JSON.stringify(path)).join('\n')]
    .filter(Boolean).join('\n\n') : text;
}

export function splitVideoMessage(text = '') {
  const unchanged = { text, paths: [] }, index = text.lastIndexOf(VIDEO_HEADER);
  if (index < 0 || (index > 0 && !text.slice(0, index).endsWith('\n\n'))) return unchanged;
  try {
    const paths = text.slice(index + VIDEO_HEADER.length).trimEnd().split('\n').map(line => JSON.parse(line));
    if (!paths.length || paths.length > 4 || paths.some(path => typeof path !== 'string' ||
      !/^\/[^\r\n]*\/videos\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-zA-Z0-9._-]{1,180}$/.test(path))) return unchanged;
    return { text: text.slice(0, index).trimEnd(), paths };
  } catch { return unchanged; }
}
