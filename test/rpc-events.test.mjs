import test from 'node:test';
import assert from 'node:assert/strict';
import { RpcEvents } from '../src/rpc-events.mjs';

const feed = (parser, text, size = 65536) => {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += size) parser.push(bytes.subarray(offset, offset + size));
};

test('RPC projection validates large aggregates with bounded retained data and keeps metadata', () => {
  const events = [], parser = new RpcEvents(event => events.push(event), 1024);
  feed(parser, '{"messages":[{"content":[{"type":"image","data":"');
  const chunk = Buffer.alloc(65536, 'a');
  for (let i = 0; i < 640; i++) {
    parser.push(chunk); // 40 MiB, without constructing a 40 MiB fixture or result.
    assert.ok(parser.buffer.length < 1024);
  }
  feed(parser, '"}]}],"willRetry":true,"type":"agent_end"}\r\n', 1);
  feed(parser, '{"toolResults":[],"type":"turn_end","message":{"content":"hé😀\\n\u2028\u2029"}}\n', 1);
  feed(parser, '{"id":"reply","type":"response","success":true,"data":{"messages":["keep nested history"]}}\n\n', 2);
  parser.end();
  assert.deepEqual(events, [
    { type: 'agent_end', willRetry: true },
    { type: 'turn_end', message: { content: 'hé😀\n\u2028\u2029' } },
    { id: 'reply', type: 'response', success: true, data: { messages: ['keep nested history'] } }
  ]);
});

test('RPC projection rejects malformed skipped JSON, unknown aggregates, missing LF and oversized retained data', () => {
  for (const text of [
    '{"type":"agent_end","messages":[1,]}\n',
    '{"type":"agent_end","messages":["\\q"]}\n',
    '{"type":"agent_end","messages":[{"bad":true false}]}\n',
    '{"type":"agent_end","messages":[0]} garbage\n',
    '{"type":"response","messages":[1]}\n',
    '{"type":"agent_end",\n"messages":[]}\n',
    'null\n'
  ]) {
    const events = [], parser = new RpcEvents(event => events.push(event));
    assert.throws(() => feed(parser, text, 1), undefined, text);
    assert.deepEqual(events, []);
  }
  const incomplete = new RpcEvents(() => assert.fail('unterminated record emitted'));
  feed(incomplete, '{"type":"agent_end","messages":[]}');
  assert.throws(() => incomplete.end(), /Incomplete/);
  assert.throws(() => feed(new RpcEvents(() => {}, 64), JSON.stringify({ type: 'message_end', message: 'x'.repeat(65) }) + '\n'), /too large/);
  assert.throws(() => feed(new RpcEvents(() => {}), '{"type":"agent_end","messages":' + '['.repeat(130)), /nesting/);
  assert.throws(() => feed(new RpcEvents(() => {}), '{"type":"agent_end","messages":[{"' + 'x'.repeat(65537)), /key too large/);
});
