// External SDK replay only. Pi, the SDK adapter, MCP, task tools and host are real.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import install, { localLogin } from './node_modules/pi-claude-sdk/index.ts';

const root = process.env.PI_COORDINATOR_FIXTURE_ROOT;
if (!root || JSON.parse(readFileSync(join(root, '.coordinator-fixture.json'), 'utf8')).version !== 1) throw new Error('An owned SDK coordinator fixture is required.');
const auditFile = join(root, 'sdk-peer.jsonl');
const records = () => existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const record = value => appendFileSync(auditFile, JSON.stringify({ ...value, pid: process.pid, role: process.env.PI_REMOTE_COORDINATOR_ROLE || 'session' }) + '\n');
const wrap = event => ({ type: 'stream_event', parent_tool_use_id: null, event });
async function* assistant(model, blocks, reason = 'end_turn') {
  yield { type: 'assistant', uuid: randomUUID(), parent_tool_use_id: null, message: { role: 'assistant', content: [] } };
  yield wrap({ type: 'message_start', message: { id: randomUUID(), model, usage: { input_tokens: 10, output_tokens: 5 } } });
  for (const [index, block] of blocks.entries()) {
    yield wrap({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    yield wrap({ type: 'content_block_delta', index, delta: block.type === 'tool_use'
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    yield wrap({ type: 'content_block_stop', index });
  }
  yield wrap({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 5 } });
  yield wrap({ type: 'message_stop' });
}
function replay(args) {
  const session = args.options.resume || args.options.sessionId || randomUUID();
  const client = new Client({ name: 'coordinator-sdk-replay', version: '1' });
  let memory = records().findLast(row => row.kind === 'complete' && row.session === session)?.memory;
  let inputTokens = 0, outputTokens = 0;
  const stream = (async function* () {
    const server = args.options.mcpServers?.pi;
    if (server) {
      const [left, right] = InMemoryTransport.createLinkedPair();
      await server.instance.connect(left); await client.connect(right);
    }
    const names = server ? (await client.listTools()).tools.map(tool => tool.name) : [];
    assert.deepEqual(args.options.tools, []);
    assert.deepEqual(Object.keys(args.options.env).filter(name => name.startsWith('PI_REMOTE_') && !['PI_REMOTE_WORKER', 'PI_REMOTE_COORDINATOR_ROLE'].includes(name)), []);
    assert.deepEqual(args.options.settingSources, []);
    assert.equal(args.options.strictMcpConfig, true);
    record({ kind: 'query', session, names, resumed: !!args.options.resume });
    for await (const input of args.prompt) {
      const text = input.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      memory ||= text.match(/SDK_WORKER_MARKER_[a-f0-9]+/)?.[0];
      const mode = [...text.matchAll(/SDK_VERIFY_(READ|REMEMBER|WRITE|WAIT)/g)].at(-1)?.[1];
      yield { type: 'system', subtype: 'init', session_id: session, tools: names.map(name => 'mcp__pi__' + name), apiKeySource: 'none' };
      const tool = async function* (name, arguments_) {
        assert(names.includes(name), 'Replay tried an undeclared tool: ' + name);
        assert.equal((await args.options.canUseTool('mcp__pi__' + name, arguments_, {})).behavior, 'allow');
        assert.equal((await args.options.canUseTool('Bash', {}, {})).behavior, 'deny');
        const id = 'toolu_' + randomUUID();
        const pending = client.callTool({ name, arguments: arguments_, _meta: { 'claudecode/toolUseId': id } });
        void pending.catch(() => {});
        record({ kind: 'call', session, name, arguments: arguments_ });
        yield* assistant(args.options.model, [{ type: 'tool_use', id, name: 'mcp__pi__' + name, input: arguments_ }], 'tool_use');
        const result = await pending;
        const body = result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '';
        memory ||= body.match(/SDK_WORKER_MARKER_[a-f0-9]+/)?.[0];
        record({ kind: 'tool-result', session, name, isError: result.isError === true });
        yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: result.isError === true, content: body }] } };
      };
      if (!names.length) {
        record({ kind: 'wrap-up', session });
      } else if (mode === 'WAIT') {
        record({ kind: 'holding', session });
        await delay(120000, undefined, { signal: args.options.abortController.signal });
      } else if (mode === 'REMEMBER') {
        assert(memory, 'Remembered value must come from accepted SDK/Pi history.');
        yield* tool('task_report', { kind: 'result', text: 'Remembered ' + memory });
      } else if (mode === 'WRITE') {
        yield* tool('bash', { command: "node -e 'if(Object.keys(process.env).some(k=>k.startsWith(\"PI_REMOTE_\")))throw Error(\"private environment\");require(\"node:fs\").appendFileSync(\"sdk-counter.txt\",\"once\\n\")'" });
        yield* tool('write', { path: 'sdk-worker-note.txt', content: 'SDK coding worker verified.\n' });
        const batch = [
          { id: 'toolu_' + randomUUID(), name: 'task_report', input: { kind: 'result', text: 'Wrote the counter once and added the SDK worker note.' } },
          { id: 'toolu_' + randomUUID(), name: 'write', input: { path: 'sdk-after-report.txt', content: 'This must be blocked.\n' } }
        ];
        const pending = batch.map(call => client.callTool({ name: call.name, arguments: call.input, _meta: { 'claudecode/toolUseId': call.id } }));
        for (const promise of pending) void promise.catch(() => {});
        yield* assistant(args.options.model, batch.map(call => ({ type: 'tool_use', ...call, name: 'mcp__pi__' + call.name })), 'tool_use');
        await Promise.all(pending);
      } else {
        assert.equal(mode, 'READ');
        yield* tool('read', { path: 'secret.txt' });
        yield* tool('read', { path: '../outside.txt' });
        yield* tool('read', { path: 'escape.txt' });
        assert(memory, 'The real Pi read must supply the fixture marker.');
        yield* tool('task_report', { kind: 'question', text: 'Ready for the follow-up instruction.' });
      }
      yield* assistant(args.options.model, [{ type: 'text', text: 'Report saved.' }]);
      inputTokens += 10; outputTokens += 5;
      record({ kind: 'complete', session, memory });
      yield { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn',
        modelUsage: { [args.options.model]: { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
        total_cost_usd: 0, user_message_uuids: [input.uuid] };
    }
  })();
  return Object.assign(stream, {
    close() { args.options.abortController.abort(); void client.close(); },
    async setModel() {}, async setMaxThinkingTokens() {}, async applyFlagSettings() {}
  });
}
export default function (pi) {
  localLogin.resolve = async () => ({ auth: {}, source: 'owned external SDK replay' });
  install(pi, replay);
}
