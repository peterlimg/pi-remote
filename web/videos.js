export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const VIDEO_CHUNK_BYTES = 256 * 1024;
export const VIDEO_LIMIT = 'Attach up to 4 images or videos. Images: 2 MB total. Videos: 200 MB each.';

export function isVideo(file) {
  return /^video\/[a-z0-9.+-]+$/i.test(file.type) ||
    (!file.type && /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name));
}

export function videoMessage(text, paths) {
  return paths.length ? [text, 'Attached video files (originals on this computer):\n' + paths.map(path => JSON.stringify(path)).join('\n')]
    .filter(Boolean).join('\n\n') : text;
}
