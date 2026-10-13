import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoUploads } from '../src/videos.mjs';
import { MAX_VIDEO_BYTES, VIDEO_CHUNK_BYTES, videoMessage } from '../web/videos.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-videos-'));
  const uploads = new VideoUploads(dir);
  t.after(() => { uploads.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, uploads };
}
const file = { name: 'screen recording.mov', type: 'video/quicktime', size: 6 };
const chunk = (uploadId, offset, text) => ({ uploadId, offset, data: Buffer.from(text).toString('base64') });

test('original video bytes are private, retained for commands and never embedded as images', t => {
  const { uploads } = setup(t);
  const { uploadId } = uploads.start(file);
  uploads.chunk(chunk(uploadId, 0, 'abc'));
  assert.throws(() => uploads.finish(uploadId), /incomplete/);
  uploads.chunk(chunk(uploadId, 3, 'def'));
  const { path } = uploads.finish(uploadId);
  assert.equal(readFileSync(path).toString(), 'abcdef');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const command = { type: 'prompt', text: 'Inspect this', videos: [uploadId] };
  assert.deepEqual(uploads.command(command), { type: 'prompt', text: videoMessage('Inspect this', [path]) });
  assert.deepEqual(uploads.command(command), { type: 'prompt', text: videoMessage('Inspect this', [path]) });
  uploads.discard(uploadId); uploads.close();
  assert.equal(readFileSync(path).toString(), 'abcdef', 'sent files survive draft removal and disconnect');
});

test('video upload validation bounds disk use and rejects forged references, offsets and slash commands', t => {
  const { uploads } = setup(t);
  for (const metadata of [
    { ...file, name: '../escape.mov' }, { ...file, name: 'bad\n.mov' }, { ...file, type: 'text/plain' },
    { ...file, size: 0 }, { ...file, size: MAX_VIDEO_BYTES + 1 }, { ...file, size: 1.5 }
  ]) assert.throws(() => uploads.start(metadata));
  assert.equal(MAX_VIDEO_BYTES, 200 * 1024 * 1024);
  const atLimit = uploads.start({ ...file, size: MAX_VIDEO_BYTES });
  uploads.discard(atLimit.uploadId);
  const { uploadId } = uploads.start({ ...file, type: '' }); // iOS may omit the MIME type.
  for (const packet of [chunk(uploadId, 1, 'a'), chunk(uploadId, 0, 'toolong'),
    { uploadId, offset: 0, data: '!!!!' }, { uploadId, offset: 0, data: 'YQ=' },
    chunk(uploadId, 0, 'x'.repeat(VIDEO_CHUNK_BYTES + 1)), chunk('forged', 0, 'a')]) {
    assert.throws(() => uploads.chunk(packet));
  }
  assert.throws(() => uploads.command({ type: 'prompt', text: '', videos: [uploadId] }), /incomplete/);
  uploads.chunk(chunk(uploadId, 0, 'abcdef')); uploads.finish(uploadId);
  assert.throws(() => uploads.chunk(chunk(uploadId, 6, 'x')));
  for (const command of [
    { type: 'prompt', text: '/review', videos: [uploadId] },
    { type: 'abort', videos: [uploadId] },
    { type: 'prompt', text: '', videos: ['forged'] },
    { type: 'prompt', text: '', videos: 'not-an-array' },
    { type: 'prompt', text: '', videos: [uploadId, uploadId] },
    { type: 'prompt', text: '', videos: [uploadId], images: Array(4).fill({}) }
  ]) assert.throws(() => uploads.command(command));
  for (let i = 0; i < 3; i++) uploads.start(file);
  assert.throws(() => uploads.start(file), /Too many/);
});

test('discard and disconnect remove unsent videos, including partial uploads', t => {
  const { dir, uploads } = setup(t);
  const { uploadId } = uploads.start(file);
  uploads.chunk(chunk(uploadId, 0, 'abcdef'));
  const { path } = uploads.finish(uploadId);
  uploads.discard(uploadId);
  assert.throws(() => readFileSync(path), /ENOENT/);
  uploads.start(file); uploads.close(); uploads.close();
  assert.deepEqual(readdirSync(join(dir, 'videos')), []);
});
