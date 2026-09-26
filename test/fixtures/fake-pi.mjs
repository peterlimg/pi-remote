import { JsonLines } from '../../src/rpc.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const dir = process.argv[process.argv.indexOf('--session-dir') + 1];
const fresh = process.argv.includes('--session-dir');
const sessionId = randomUUID(), sessionFile = fresh && join(dir, sessionId + '.jsonl');
const parser = new JsonLines(command => {
  if (command.type === 'extension_ui_response') {
    out({ type: 'message_end', message: { role: 'assistant', timestamp: 9, content: 'dialog answered' } });
    out({ type: 'agent_end' }); return;
  }
  let data;
  if (command.type === 'get_state') data = { isStreaming: false, ...(fresh ? { sessionId, sessionFile } : {}) };
  if (command.type === 'get_messages') data = { messages: fresh ? [] : [{ role: 'user', timestamp: 1, content: 'saved prompt' }] };
  if (command.type === 'get_commands') data = { commands: [{ name: 'review', description: 'Review changes', source: 'extension', path: '/private/review.ts' }] };
  if (command.message?.startsWith('/review') && command.type !== 'prompt') {
    out({ id: command.id, type: 'response', success: false, error: 'Extension commands require prompt' }); return;
  }
  if (!['get_state', 'get_messages', 'get_commands', 'prompt', 'steer', 'follow_up', 'clear_queue', 'abort'].includes(command.type)) {
    out({ id: command.id, type: 'response', success: false, error: 'Unknown fake command' }); return;
  }
  out({ id: command.id, type: 'response', success: true, data });
  if (['prompt', 'steer', 'follow_up'].includes(command.type)) {
    if (fresh) writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: sessionId, cwd: process.cwd() }) + '\n' +
      JSON.stringify({ type: 'message', id: randomUUID(), parentId: null, message: { role: 'user', content: command.message } }) + '\n' +
      JSON.stringify({ type: 'message', id: randomUUID(), parentId: null, message: { role: 'assistant', content: 'reply' } }) + '\n');
    out({ type: 'agent_start' });
    if (command.message === 'ask') out({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Proceed?' });
    else {
      out({ type: 'message_end', message: { role: 'assistant', timestamp: Date.now(), content: 'reply: ' + command.message } });
      out({ type: 'agent_end' });
    }
  }
});
process.stdin.on('data', data => parser.push(data));
