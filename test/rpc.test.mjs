import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RpcWorker } from '../src/rpc.mjs';
import { until } from './helpers.mjs';

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
