import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RpcWorker } from '../src/rpc.mjs';
import { until } from './helpers.mjs';

test('image-heavy completion keeps the worker alive and individual images intact', async t => {
  const worker = new RpcWorker('unused.jsonl', process.cwd(), { bin: process.execPath,
    prefix: [fileURLToPath(new URL('./fixtures/large-rpc.mjs', import.meta.url))] });
  t.after(() => worker.close());
  const events = [], faults = [];
  worker.on('event', event => events.push(event));
  worker.on('fault', error => faults.push(error));
  await worker.request('prompt', { message: 'images' });
  await until(() => faults.length || events.some(event => event.type === 'agent_settled'));
  assert.deepEqual(faults, []);
  assert.equal(events.filter(event => event.type === 'message_end').length, 3);
  for (const event of events.filter(event => event.type === 'message_end')) assert.equal(event.message.content[1].data.length, 3 * 1024 * 1024);
  assert.deepEqual(events.find(event => event.type === 'agent_end'), { type: 'agent_end', willRetry: false });
  assert.equal(events.find(event => event.type === 'turn_end').toolResults, undefined);
  await worker.request('get_state');
  assert.equal(worker.closed, undefined);
});

for (const [command, reason] of [['malformed', /Parser/], ['oversized', /RPC record too large/]]) {
  test(`worker preserves the ${command} failure after exit`, async t => {
    const worker = new RpcWorker('unused.jsonl', process.cwd(), { bin: process.execPath,
      prefix: [fileURLToPath(new URL('./fixtures/large-rpc.mjs', import.meta.url))] });
    t.after(() => worker.close());
    const faults = [];
    worker.on('fault', error => faults.push(error));
    await assert.rejects(worker.request(command), reason);
    await worker.exited;
    assert.equal(faults.length, 1);
    assert.match(faults[0].message, reason);
    assert.doesNotMatch(faults[0].message, /Pi worker exited/);
    assert.equal(worker.pending.size, 0);
  });
}

test('interactive commands acknowledge dispatch without a completion deadline and still report RPC errors', async t => {
  const worker = new RpcWorker('unused.jsonl', process.cwd(), { bin: process.execPath,
    prefix: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] });
  t.after(() => worker.close());
  let dialog, fault;
  worker.on('event', event => { if (event.type === 'extension_ui_request') dialog = event; });
  worker.on('fault', error => { fault = error; });
  assert.deepEqual(await worker.command({ type: 'prompt', text: '/usage' }), { accepted: true });
  await until(() => dialog);
  assert.equal(worker.pending.size, 1, 'completion is still tracked while the panel is open');
  assert.equal([...worker.pending.values()][0].timer, undefined, 'reading a dialog must not time out delivery');
  worker.process.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: dialog.id, cancelled: true }) + '\n');
  await until(() => worker.pending.size === 0);
  assert.equal(fault, undefined);
  await assert.rejects(worker.request('unknown'), /Unknown fake command/);
  await worker.request('unknown', {}, { background: true });
  await until(() => fault);
  assert.match(fault.message, /Unknown fake command/);
  assert.equal(worker.pending.size, 0);
  await worker.close();
  await assert.rejects(worker.request('prompt', { message: '/usage' }, { background: true }), /closed/);
});
