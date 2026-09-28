import { JsonLines } from '../../src/rpc.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const dir = process.argv[process.argv.indexOf('--session-dir') + 1];
const fresh = process.argv.includes('--session-dir');
const sessionId = randomUUID(), sessionFile = fresh && join(dir, sessionId + '.jsonl');
const models = [{ provider: 'test', id: 'first', name: 'First', headers: { private: 'secret' } }, { provider: 'test', id: 'org/second', name: 'Second' }];
let model = models[0], thinkingLevel = 'medium', usageId = 0, usageCommand;
const showUsage = () => out({ type: 'extension_ui_request', id: `usage-${++usageId}`, method: 'select', title: 'Provider usage', options: ['Refresh current usage', 'Close'] });
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
  if (command.type === 'get_state') data = { isStreaming: false, model, thinkingLevel, ...(fresh ? { sessionId, sessionFile } : {}) };
  if (command.type === 'get_available_models') data = { models };
  if (command.type === 'set_model') {
    const next = models.find(model => model.provider === command.provider && model.id === command.modelId);
    if (!next) { out({ id: command.id, type: 'response', success: false, error: 'Model not found' }); return; }
    model = next; data = model;
  }
  if (command.type === 'set_thinking_level') thinkingLevel = command.level === 'max' ? 'high' : command.level;
  if (command.type === 'get_messages') data = { messages: fresh ? [] : [{ role: 'user', timestamp: 1, content: 'saved prompt' }] };
  if (command.type === 'get_commands') data = { commands: [{ name: 'review', description: 'Review changes', source: 'extension', path: '/private/review.ts' },
    ...['usage', 'usage-settled', 'usage-working'].map(name => ({ name, source: 'extension' }))] };
  if (command.message?.startsWith('/review') && command.type !== 'prompt') {
    out({ id: command.id, type: 'response', success: false, error: 'Extension commands require prompt' }); return;
  }
  if (!['get_state', 'get_messages', 'get_commands', 'get_available_models', 'set_model', 'set_thinking_level', 'prompt', 'steer', 'follow_up', 'clear_queue', 'abort'].includes(command.type)) {
    out({ id: command.id, type: 'response', success: false, error: 'Unknown fake command' }); return;
  }
  // Pi acknowledges extension commands only after their handler returns.
  if (command.message?.startsWith('/usage')) usageCommand = command;
  else out({ id: command.id, type: 'response', success: true, data });
  if (['prompt', 'steer', 'follow_up'].includes(command.type)) {
    if (fresh) writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: sessionId, cwd: process.cwd() }) + '\n' +
      JSON.stringify({ type: 'message', id: randomUUID(), parentId: null, message: { role: 'user', content: command.message } }) + '\n' +
      JSON.stringify({ type: 'message', id: randomUUID(), parentId: null, message: { role: 'assistant', content: 'reply' } }) + '\n');
    if (command.message.startsWith('/usage')) {
      if (command.message !== '/usage') out({ type: 'agent_start' });
      showUsage();
      if (command.message === '/usage-settled') out({ type: 'agent_end' });
      return;
    }
    out({ type: 'agent_start' });
    if (command.message === 'ask') out({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Proceed?' });
    else {
      out({ type: 'message_end', message: { role: 'assistant', timestamp: Date.now(), content: 'reply: ' + command.message } });
      out({ type: 'agent_end' });
    }
  }
});
process.stdin.on('data', data => parser.push(data));
