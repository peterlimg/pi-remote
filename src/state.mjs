import { cleanMessage, textContent } from './catalog.mjs';

export function initialState(meta, messages = []) {
  return { ...meta, status: 'idle', messages: messages.slice(-100), tools: [], revision: 0, updatedAt: Date.now() };
}
export function applyEvent(state, event) {
  state.updatedAt = Date.now(); state.revision++;
  if (event.type === 'agent_start') state.status = 'working';
  if (event.type === 'agent_end' || event.type === 'agent_settled') state.status = 'idle';
  if (event.type === 'ui_prompt_start') state.status = 'waiting';
  if (event.type === 'ui_prompt_end') state.status = 'working';
  if (['message_start', 'message_update', 'message_end'].includes(event.type) && event.message) {
    const m = event.message;
    const key = m.role + ':' + (m.timestamp ?? 'current') + ':' + (m.toolCallId || '');
    const item = cleanMessage(m, key);
    let index = state.messages.findIndex(x => x.id === key);
    if (index < 0) {
      state.messages.push(item);
      if (state.messages.length > 100) { state.messages.shift(); state.historyTruncated = true; }
    } else state.messages[index] = item;
  }
  if (event.type.startsWith('tool_execution_')) {
    const tool = { id: event.toolCallId, name: event.toolName, status: event.type === 'tool_execution_end' ? (event.isError ? 'error' : 'done') : 'working',
      text: textContent((event.result || event.partialResult)?.content).slice(0, 12000) };
    const index = state.tools.findIndex(x => x.id === tool.id);
    if (index < 0) state.tools.push(tool); else state.tools[index] = tool;
    state.tools = state.tools.slice(-20);
  }
  return state;
}
export function summary(state) {
  const { messages = [], tools, file, ...meta } = state;
  const excerpt = text => {
    const line = (text || '').replace(/\s+/g, ' ').trim();
    return line.length > 160 ? line.slice(0, 159) + '…' : line;
  };
  const request = messages.findLast(message => message.role === 'user' && message.text?.trim());
  const latest = messages.findLast(message => ['user', 'assistant'].includes(message.role) && message.text?.trim());
  const unnamed = !meta.title || meta.title === 'Untitled session' || meta.title.startsWith('Pi · ');
  return { ...meta, title: unnamed ? excerpt(request?.text) || meta.title || 'Untitled session' : meta.title,
    preview: excerpt(latest?.text), previewRole: latest?.role };
}
