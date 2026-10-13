import { JsonLines } from '../../src/rpc.mjs';

const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const parser = new JsonLines(command => {
  if (command.type === 'malformed') {
    process.stdout.write('{"type":"agent_end","messages":[{"content":"broken"},]}\n');
    return;
  }
  if (command.type === 'oversized') {
    out({ type: 'message_end', message: { role: 'assistant', content: 'x'.repeat(9 * 1024 * 1024) } });
    return;
  }
  out({ id: command.id, type: 'response', success: true });
  if (command.type !== 'prompt') return;
  out({ type: 'agent_start' });
  const messages = Array.from({ length: 3 }, (_, i) => ({ role: 'toolResult', toolName: 'read', toolCallId: String(i), timestamp: i,
    content: [{ type: 'text', text: 'preview ' + i }, { type: 'image', mimeType: 'image/png', data: 'a'.repeat(3 * 1024 * 1024) }] }));
  for (const message of messages) out({ type: 'message_end', message });
  // Reordered keys ensure projection does not depend on Pi's serialization order.
  out({ toolResults: messages, type: 'turn_end', message: { role: 'assistant', content: [] } });
  out({ messages, type: 'agent_end', willRetry: false });
  out({ type: 'agent_settled', aborted: false });
});
process.stdin.on('data', data => parser.push(data));
