import { JsonLines } from '../../src/rpc.mjs';
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const parser = new JsonLines(command => {
  if (command.type === 'extension_ui_response') {
    out({ type: 'message_end', message: { role: 'assistant', timestamp: 9, content: 'dialog answered' } });
    out({ type: 'agent_end' }); return;
  }
  let data;
  if (command.type === 'get_state') data = { isStreaming: false };
  if (command.type === 'get_messages') data = { messages: [{ role: 'user', timestamp: 1, content: 'saved prompt' }] };
  if (!['get_state', 'get_messages', 'prompt', 'steer', 'follow_up', 'clear_queue', 'abort'].includes(command.type)) {
    out({ id: command.id, type: 'response', success: false, error: 'Unknown fake command' }); return;
  }
  out({ id: command.id, type: 'response', success: true, data });
  if (['prompt', 'steer', 'follow_up'].includes(command.type)) {
    out({ type: 'agent_start' });
    if (command.message === 'ask') out({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Proceed?' });
    else {
      out({ type: 'message_end', message: { role: 'assistant', timestamp: Date.now(), content: 'reply: ' + command.message } });
      out({ type: 'agent_end' });
    }
  }
});
process.stdin.on('data', data => parser.push(data));
