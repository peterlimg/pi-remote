import { JsonLines } from '../../src/rpc.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const dir = process.argv[process.argv.indexOf('--session-dir') + 1];
const fresh = process.argv.includes('--session-dir');
const sessionId = randomUUID(), sessionFile = fresh && join(dir, sessionId + '.jsonl');
// Like Pi, create a new session's folder at startup and its file on the first prompt.
if (fresh) mkdirSync(dir, { recursive: true });
const models = [{ provider: 'test', id: 'first', name: 'First', headers: { private: 'secret' } }, { provider: 'test', id: 'org/second', name: 'Second' }];
let model = models[0], thinkingLevel = 'medium', usageId = 0, usageCommand, fastMode = false, waitingTimestamp;
let contextUsage = { tokens: 64000, contextWindow: 200000, percent: 32 };
const showUsage = () => out({ type: 'extension_ui_request', id: `usage-${++usageId}`, method: 'select',
  title: `Provider usage\n${model === models[0] ? '5-hour limit: [████░] 75% left (resets in 2h)\n' : ''}Weekly limit: [████░] ${100 - usageId}% left (resets tomorrow)`, options: ['Refresh current usage', 'Close'] });
const parser = new JsonLines(command => {
  if (command.type === 'extension_ui_response') {
    if (command.id.startsWith('usage-')) {
      if (command.value === 'Refresh current usage') showUsage();
      else if (usageCommand) {
        out({ id: usageCommand.id, type: 'response', success: true });
        usageCommand = undefined;
      }
      return; // An extension command can finish without running an agent turn.
    }
    out({ type: 'message_end', message: { role: 'assistant', timestamp: 9, content: 'dialog answered' } });
    out({ type: 'agent_end' }); return;
  }
  let data;
  if (command.type === 'get_state' && process.argv.includes('--startup-events')) {
    out({ type: 'model_select', model });
    out({ type: 'thinking_level_changed', level: thinkingLevel });
    out({ type: 'agent_settled' });
    if (process.argv.includes('--fail-startup')) {
      out({ id: command.id, type: 'response', success: false, error: 'Replay startup failure' });
      return;
    }
  }
  if (command.type === 'get_state') data = { isStreaming: false, model, thinkingLevel, ...(fresh ? { sessionId, sessionFile } : {}) };
  if (command.type === 'get_available_models') data = { models };
  if (command.type === 'get_session_stats') data = { contextUsage, tokens: { total: 9000000 } };
  if (command.type === 'set_model') {
    const next = models.find(model => model.provider === command.provider && model.id === command.modelId);
    if (!next) { out({ id: command.id, type: 'response', success: false, error: 'Model not found' }); return; }
    model = next; data = model;
  }
  if (command.type === 'set_thinking_level') thinkingLevel = command.level === 'max' ? 'high' : command.level;
  if (command.type === 'get_commands') data = { commands: [{ name: 'review', description: 'Review changes', source: 'extension', path: '/private/review.ts' },
    ...['usage', 'usage-settled', 'usage-working', 'fast'].map(name => ({ name, source: 'extension' }))] };
  if (command.message?.startsWith('/review') && command.type !== 'prompt') {
    out({ id: command.id, type: 'response', success: false, error: 'Extension commands require prompt' }); return;
  }
  if (!['get_state', 'get_commands', 'get_session_stats', 'get_available_models', 'set_model', 'set_thinking_level', 'prompt', 'steer', 'follow_up', 'clear_queue', 'abort'].includes(command.type)) {
    out({ id: command.id, type: 'response', success: false, error: 'Unknown fake command' }); return;
  }
  // Pi acknowledges extension commands only after their handler returns.
  if (command.message?.startsWith('/usage')) usageCommand = command;
  else out({ id: command.id, type: 'response', success: true, data });
  if (command.type === 'abort' && waitingTimestamp) {
    out({ type: 'message_end', message: { role: 'assistant', timestamp: waitingTimestamp, content: [], stopReason: 'aborted' } });
    out({ type: 'agent_end' }); waitingTimestamp = undefined;
  }
  if (['prompt', 'steer', 'follow_up'].includes(command.type)) {
    if (fresh) writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: sessionId, cwd: process.cwd() }) + '\n' +
      JSON.stringify({ type: 'message', id: randomUUID(), parentId: null, message: { role: 'user', content: command.message } }) + '\n' +
      JSON.stringify({ type: 'message', id: randomUUID(), parentId: null, message: { role: 'assistant', content: 'reply' } }) + '\n');
    if (command.message === '/fast') {
      fastMode = !fastMode;
      out({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'usage', statusText: fastMode ? 'codex fast 80%' : 'codex 80%' });
      return;
    }
    if (command.message.startsWith('/usage')) {
      if (command.message !== '/usage') out({ type: 'agent_start' });
      showUsage();
      if (command.message === '/usage-settled') out({ type: 'agent_end' });
      return;
    }
    if (command.message === 'compact context') contextUsage = { tokens: null, contextWindow: 200000, percent: null };
    out({ type: 'agent_start' });
    if (command.message === 'hold compaction') {
      out({ type: 'agent_end' });
      out({ type: 'compaction_start', reason: 'threshold' });
      const timer = setInterval(() => {
        const file = join(process.cwd(), 'compaction-result.json');
        if (!existsSync(file)) return;
        clearInterval(timer);
        const result = JSON.parse(readFileSync(file, 'utf8'));
        out({ type: 'compaction_end', reason: 'threshold', ...result });
        out({ type: result.willRetry ? 'agent_start' : 'agent_settled' });
      }, 25);
      return;
    }
    if (command.message === 'stream response') {
      const timestamp = Date.now();
      const update = assistantMessageEvent => out({ type: 'message_update', assistantMessageEvent });
      out({ type: 'message_end', message: { role: 'user', timestamp: timestamp - 1, content: command.message } });
      out({ type: 'message_start', message: { role: 'assistant', timestamp, content: [], stopReason: 'pending' } });
      update({ type: 'thinking_start', contentIndex: 0 });
      update({ type: 'thinking_delta', contentIndex: 0, delta: 'Private reasoning must not appear.' });
      update({ type: 'text_start', contentIndex: 1 });
      update({ type: 'text_delta', contentIndex: 1, delta: 'Reading' });
      setTimeout(() => update({ type: 'text_delta', contentIndex: 1, delta: ' the source.' }), 1000);
      setTimeout(() => {
        update({ type: 'text_end', contentIndex: 1, content: 'Read the source.' });
        update({ type: 'toolcall_start', contentIndex: 2, id: 'stream-read', toolName: 'read' });
        update({ type: 'toolcall_delta', contentIndex: 2, delta: '{"path":"web/' });
      }, 2000);
      setTimeout(() => {
        update({ type: 'toolcall_delta', contentIndex: 2, delta: 'app.js"}' });
        update({ type: 'toolcall_end', contentIndex: 2, toolCall: { type: 'toolCall', id: 'stream-read', name: 'read', arguments: { path: 'web/app.js' } } });
        update({ type: 'text_start', contentIndex: 3 });
        update({ type: 'text_delta', contentIndex: 3, delta: 'Checking the result.' });
      }, 3000);
      setTimeout(() => {
        out({ type: 'message_end', message: { role: 'assistant', timestamp, content: [
          { type: 'text', text: 'Read the source.' },
          { type: 'toolCall', id: 'stream-read', name: 'read', arguments: { path: 'web/app.js' } },
          { type: 'text', text: 'Checked the result.' }
        ], stopReason: 'toolUse', durationMs: 4000 } });
        out({ type: 'tool_execution_start', toolCallId: 'stream-read', toolName: 'read', args: { path: 'web/app.js' } });
        out({ type: 'tool_execution_end', toolCallId: 'stream-read', toolName: 'read', result: { content: [{ type: 'text', text: 'Source read.' }] }, durationMs: 37 });
        out({ type: 'message_end', message: { role: 'toolResult', toolCallId: 'stream-read', toolName: 'read', timestamp: Date.now(), content: 'Source read.', durationMs: 37 } });
        out({ type: 'message_end', message: { role: 'assistant', timestamp: Date.now() + 1, content: 'Done.', stopReason: 'stop', durationMs: 1 } });
        out({ type: 'agent_end' });
      }, 4000);
      return;
    }
    if (command.message === 'wait for model') {
      waitingTimestamp = Date.now();
      out({ type: 'message_end', message: { role: 'user', timestamp: waitingTimestamp - 1, content: command.message } });
      out({ type: 'message_start', message: { role: 'assistant', timestamp: waitingTimestamp, content: [], stopReason: 'pending' } });
      out({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
      out({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Private reasoning must not appear.' } });
      return;
    }
    if (['provider error', 'partial provider error'].includes(command.message)) {
      const timestamp = Date.now();
      out({ type: 'message_end', message: { role: 'user', timestamp, content: command.message } });
      out({ type: 'message_end', message: { role: 'assistant', timestamp: timestamp + 1,
        content: command.message.startsWith('partial') ? [{ type: 'text', text: 'Partial reply.' }] : [],
        stopReason: 'error', errorMessage: 'WebSocket error', durationMs: 93343 } });
      out({ type: 'agent_end' });
      return;
    }
    if (command.message === 'ask') out({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Proceed?' });
    else {
      out({ type: 'message_end', message: { role: 'user', timestamp: Date.now(), content: command.message } });
      out({ type: 'message_end', message: { role: 'assistant', timestamp: Date.now(), content: 'reply: ' + command.message } });
      out({ type: 'agent_end' });
    }
  }
});
process.stdin.on('data', data => parser.push(data));
