#!/usr/bin/env node
// Recorded Pi RPC shapes, with deterministic gates instead of a model or paid SDK calls.
import { createInterface } from 'node:readline';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const file = process.argv[process.argv.indexOf('--session') + 1];
const root = process.env.PI_REMOTE_HOME;
const logFile = process.env.PI_LIFECYCLE_REPLAY_LOG;
const rows = () => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const header = rows()[0];
const models = [
  { provider: 'claude-sdk', id: 'replay', name: 'SDK lifecycle replay', api: 'claude-sdk', input: ['text'], reasoning: false },
  { provider: 'test', id: 'plain', name: 'Plain lifecycle replay', api: 'test', input: ['text'], reasoning: false },
];
let model = models.find(m => m.provider === rows().findLast(e => e.type === 'model_change')?.provider) ?? models[0];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
let active = false, permission;
let clock = Math.max(Date.now(), ...rows().map(e => e.message?.timestamp ?? 0));
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const log = value => appendFileSync(logFile, JSON.stringify(value) + '\n');
const append = entry => {
  const previous = rows().at(-1);
  appendFileSync(file, JSON.stringify({ ...entry, id: randomUUID().slice(0, 8), parentId: previous.type === 'session' ? null : previous.id,
    timestamp: new Date().toISOString() }) + '\n');
};
const message = message => {
  message.timestamp = ++clock;
  append({ type: 'message', message });
  send({ type: 'message_end', message });
};
const assistant = (content, stopReason = 'stop', errorMessage) => message({ role: 'assistant', provider: model.provider, model: model.id,
  api: model.api, usage, content, stopReason, ...(errorMessage ? { errorMessage } : {}) });
const wait = async name => {
  const deadline = Date.now() + 20000;
  while (!existsSync(join(root, name))) {
    if (Date.now() > deadline) throw new Error('Replay gate timed out: ' + name);
    await delay(20);
  }
};
const checkpoint = () => {
  if (model.provider !== 'claude-sdk') return;
  const messages = rows().filter(e => e.type === 'message' && e.message.role !== 'system').map(e => e.message);
  const prefix = messages.map(m => createHash('sha256').update(JSON.stringify({ role: m.role, content: m.content,
    ...m.role === 'toolResult' ? { id: m.toolCallId, name: m.toolName, isError: m.isError } : {} })).digest('hex'));
  append({ type: 'custom', customType: 'claude-sdk-checkpoint', data: { version: 1, sdkSessionId: header.id,
    sdkMessageId: randomUUID(), prefix, configuration: '0'.repeat(64), reported: usage } });
  send({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'claude-sdk-checkpoint', statusText: 'saved' });
};
const run = async text => {
  active = true;
  send({ type: 'agent_start' });
  message({ role: 'user', content: [{ type: 'text', text }] });
  const pending = new Set();
  for (const entry of rows()) {
    if (entry.message?.role === 'assistant') for (const block of entry.message.content) if (block.type === 'toolCall') pending.add(block.id);
    if (entry.message?.role === 'toolResult') pending.delete(entry.message.toolCallId);
  }
  if (pending.size || text === 'fail') {
    const error = pending.size ? 'Cannot recover: a tool result is unknown.' : 'Replay provider failure.';
    assistant([{ type: 'text', text: error }], 'error', error);
    send({ type: 'agent_end' });
    send({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'claude-sdk-checkpoint', statusText: 'unavailable' });
    active = false; send({ type: 'agent_settled' }); return;
  }
  const label = ['seed', 'pending', 'orphan'].includes(text) ? text : undefined;
  if (label) {
    const id = 'toolu_' + randomUUID();
    assistant([{ type: 'toolCall', id, name: 'probe', arguments: { label } }], 'toolUse');
    if (label === 'pending') {
      const answer = new Promise(resolve => { permission = resolve; });
      send({ type: 'extension_ui_request', id: 'permission', method: 'confirm', title: 'Allow replay probe?', message: 'Synthetic test only.' });
      if (!await answer) {
        message({ role: 'toolResult', toolCallId: id, toolName: 'probe', content: [{ type: 'text', text: 'DENIED' }], isError: true });
        assistant([{ type: 'text', text: 'DENIED' }]);
        send({ type: 'agent_end' }); checkpoint(); active = false; send({ type: 'agent_settled' }); return;
      }
    }
    send({ type: 'tool_execution_start', toolCallId: id, toolName: 'probe', args: { label } });
    log({ phase: 'execution', label, id });
    if (label === 'pending') await wait('tool-complete');
    if (label === 'orphan') await wait('orphan-complete');
    const content = [{ type: 'text', text: 'REPLAY_CODE_' + label }];
    send({ type: 'tool_execution_end', toolCallId: id, toolName: 'probe', result: { content }, isError: false });
    message({ role: 'toolResult', toolCallId: id, toolName: 'probe', content, isError: false });
  }
  const codes = rows().filter(e => e.message?.role === 'toolResult').flatMap(e => e.message.content).map(b => b.text).join(' ');
  assistant([{ type: 'text', text: codes || 'READY' }]);
  send({ type: 'agent_end' });
  if (label === 'pending') await wait('checkpoint-save');
  if (label === 'seed') {
    active = false; send({ type: 'agent_settled' });
    await delay(10); checkpoint();
  } else {
    checkpoint();
    if (label === 'pending') await wait('turn-settle');
    active = false; send({ type: 'agent_settled' });
  }
};
log({ phase: 'worker', pid: process.pid, conversationId: header.id });
createInterface({ input: process.stdin }).on('line', async line => {
  const command = JSON.parse(line);
  const reply = data => send({ type: 'response', id: command.id, command: command.type, success: true, data });
  if (command.type === 'extension_ui_response') { permission?.(command.confirmed); permission = undefined; }
  else if (command.type === 'get_state') reply({ sessionFile: file, sessionId: header.id, model, thinkingLevel: 'off', isStreaming: active });
  else if (command.type === 'get_available_models') reply({ models });
  else if (command.type === 'set_model') {
    const next = models.find(m => m.provider === command.provider && m.id === command.modelId);
    if (!next) { send({ type: 'response', id: command.id, success: false, error: 'Unknown replay model' }); return; }
    model = next;
    append({ type: 'model_change', provider: model.provider, modelId: model.id });
    send({ type: 'model_select', model }); reply(model);
  }
  else if (command.type === 'get_commands') reply({ commands: [] });
  else if (command.type === 'get_session_stats') reply({ cost: 0, tokens: {}, contextUsage: undefined });
  else if (command.type === 'prompt') {
    if (active || command.message === 'reject') send({ type: 'response', id: command.id, success: false, error: 'Replay request rejected' });
    else { reply({}); await run(command.message); }
  } else reply({});
});
process.on('SIGTERM', () => process.exit(0));
