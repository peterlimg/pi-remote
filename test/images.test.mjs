import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand } from '../src/commands.mjs';
import { MAX_IMAGE_BYTES } from '../web/images.js';
import { RpcWorker } from '../src/rpc.mjs';

const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
test('image commands allow image-only input and enforce format, count and total size', () => {
  const command = { type: 'prompt', text: '', images: [image] };
  assert.deepEqual(validateCommand(command), command);
  assert.deepEqual(validateCommand({ ...command, images: [{ ...image, name: 'discard' }] }), command);
  assert.deepEqual(validateCommand({ type: 'prompt', text: 'hello', images: [] }), { type: 'prompt', text: 'hello' });
  for (const images of [null, {}, [null], Array(5).fill(image), [{ ...image, mimeType: 'image/svg+xml' }],
    [{ ...image, type: 'text' }], ...['', '%%%%', 'abc', 'a=b=', 'abcd====', 42].map(data => [{ ...image, data }])]) {
    assert.throws(() => validateCommand({ ...command, images }), /Attach up to/);
  }
  const full = { ...image, data: Buffer.alloc(MAX_IMAGE_BYTES).toString('base64') };
  assert.equal(validateCommand({ ...command, images: [full] }).images[0].data, full.data);
  assert.throws(() => validateCommand({ ...command, images: [full, image] }), /2 MB/);
  assert.throws(() => validateCommand({ ...command, text: '/new' }), /slash command/);
  assert.throws(() => validateCommand({ ...command, images: [] }), /Enter a message/);
  assert.throws(() => validateCommand({ ...command, text: 'x'.repeat(50001) }), /50000/);
});

test('RPC forwards image content for prompt, steering and follow-up', async () => {
  const calls = [], worker = { request: async (type, data) => calls.push({ type, ...data }) };
  for (const type of ['prompt', 'steer', 'followUp']) {
    await RpcWorker.prototype.command.call(worker, { type, text: '', images: [image] });
  }
  assert.deepEqual(calls, [
    { type: 'prompt', message: '', images: [image], streamingBehavior: 'steer' },
    { type: 'steer', message: '', images: [image] },
    { type: 'follow_up', message: '', images: [image] }
  ]);
});
