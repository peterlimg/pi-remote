import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeSync, closeSync, rmSync, realpathSync, fstatSync, readSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_IMAGES } from '../web/images.js';
import { isVideo, MAX_VIDEO_BYTES, VIDEO_CHUNK_BYTES, videoMessage, VIDEO_LIMIT } from '../web/videos.js';
import { validateCommand } from './commands.mjs';

const run = promisify(execFile);
const videoTypes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp' };

// Callers authorize the path against the watched conversation before reading any bytes.
export async function readVideo(dir, path, offset) {
  let fd;
  try {
    const root = resolve(dir, 'videos'), name = relative(root, path);
    if (!/^[a-f0-9-]{36}\/[a-zA-Z0-9._-]{1,180}$/.test(name) || realpathSync(path) !== join(realpathSync(root), name)) throw new Error();
    fd = openSync(path, 'r');
    const info = fstatSync(fd), size = info.size;
    if (!info.isFile() || size <= 0 || size > MAX_VIDEO_BYTES) throw new Error();
    if (offset !== undefined) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) throw new Error();
      const data = Buffer.alloc(Math.min(VIDEO_CHUNK_BYTES, size - offset));
      const length = readSync(fd, data, 0, data.length, offset);
      return { size, data: data.subarray(0, length).toString('base64') };
    }
    const mimeType = videoTypes[extname(path).toLowerCase()] || 'application/octet-stream';
    let poster;
    try {
      const { stdout } = await run('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1',
        '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi', '-i', path,
        '-vf', 'scale=360:360:force_original_aspect_ratio=decrease', '-frames:v', '1', '-threads', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'],
      { encoding: 'buffer', timeout: 10000, maxBuffer: 256 * 1024 });
      if (stdout.length) poster = { type: 'image', mimeType: 'image/jpeg', data: stdout.toString('base64') };
    } catch {} // Playback still works when ffmpeg or a thumbnail decoder is unavailable.
    return { size, mimeType, poster };
  } catch { throw new Error('Video is unavailable. It may have been removed from the computer.'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

// Each authenticated socket owns its drafts. Sent files stay on disk for the conversation.
export class VideoUploads {
  constructor(dir) { this.dir = dir; this.uploads = new Map(); this.closed = false; }
  start(file) {
    if (this.closed) throw new Error('Connection closed');
    if (!file || typeof file.name !== 'string' || !file.name.length || file.name.length > 180 ||
      /[/\\\x00-\x1f\x7f]/.test(file.name) || !isVideo(file) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_VIDEO_BYTES) throw new Error(VIDEO_LIMIT);
    if ([...this.uploads.values()].filter(upload => !upload.retained).length >= MAX_IMAGES) throw new Error('Too many staged videos. Remove a video first.');
    const uploadId = randomUUID(), dir = resolve(this.dir, 'videos', uploadId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_'));
    try {
      const fd = openSync(path, 'wx', 0o600);
      this.uploads.set(uploadId, { dir, path, fd, size: file.size, offset: 0, retained: false });
    } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
    return { uploadId };
  }
  get(uploadId) {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new Error('Video upload expired. Attach it again.');
    return upload;
  }
  chunk({ uploadId, offset, data }) {
    const upload = this.get(uploadId);
    if (upload.fd === undefined || offset !== upload.offset || typeof data !== 'string' || !data.length ||
      data.length > Math.ceil(VIDEO_CHUNK_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid video chunk');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > VIDEO_CHUNK_BYTES || upload.offset + bytes.length > upload.size) throw new Error('Video exceeds its declared size');
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(upload.fd, bytes, written, bytes.length - written);
      if (!count) throw new Error('Could not write video');
      written += count; upload.offset += count;
    }
    return { offset: upload.offset };
  }
  finish(uploadId) {
    const upload = this.get(uploadId);
    if (upload.offset !== upload.size) throw new Error('Video upload is incomplete');
    if (upload.fd !== undefined) { closeSync(upload.fd); upload.fd = undefined; }
    return { path: upload.path };
  }
  command(input) {
    if (input?.videos === undefined) return input;
    const { videos, ...command } = input;
    if (!Array.isArray(videos) || new Set(videos).size !== videos.length || videos.length + (command.images?.length || 0) > MAX_IMAGES ||
      !['prompt', 'steer', 'followUp'].includes(command.type) || typeof command.text !== 'string') throw new Error('Invalid video attachments');
    if (videos.length && command.text.trim().startsWith('/')) throw new Error('Send videos with a message, not a slash command.');
    const uploads = videos.map(id => this.get(id));
    if (uploads.some(upload => upload.fd !== undefined)) throw new Error('Video upload is incomplete');
    const result = validateCommand({ ...command, text: videoMessage(command.text, uploads.map(upload => upload.path)) });
    // Retain before dispatch: a lost acknowledgement must not delete an agent's input.
    for (const upload of uploads) upload.retained = true;
    return result;
  }
  discard(uploadId) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.retained) return;
    if (upload.fd !== undefined) closeSync(upload.fd);
    rmSync(upload.dir, { recursive: true, force: true });
    this.uploads.delete(uploadId);
  }
  close() {
    this.closed = true;
    for (const id of this.uploads.keys()) this.discard(id);
    this.uploads.clear();
  }
}
