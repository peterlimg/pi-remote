import { stripVTControlCharacters } from 'node:util';
import { cleanMessage, textContent } from './catalog.mjs';
import { sessionTitle } from './session-title.mjs';

// Whether a run is active, kept off the wire. Terminal dialogs also open while idle.
const running = new WeakMap();
export function initialState(meta, messages = []) {
  return { ...meta, title: sessionTitle(meta.title, messages), status: 'idle', messages: messages.slice(-100), tools: [], revision: 0, updatedAt: Date.now() };
}
export function applyEvent(state, event) {
  if (event.type === 'extension_ui_request') {
    // Status refreshes are not conversation activity. pi-usage only labels
    // the status "codex fast" when fast routing is effective.
    if (event.method === 'setStatus' && event.statusKey === 'usage') {
      state.fastMode = /^codex fast(?:\s|$)/u.test(stripVTControlCharacters(event.statusText || ''));
      state.revision++;
    }
    return state;
  }
  state.updatedAt = Date.now(); state.revision++;
  if (event.type === 'model_select') {
    state.model = `${event.model.provider}/${event.model.id}`;
    state.fastMode = false;
  }
  if (event.type === 'thinking_level_select' || event.type === 'thinking_level_changed') state.thinkingLevel = event.level;
  if (event.type === 'agent_start') { running.set(state, true); state.status = 'working'; }
  if (event.type === 'agent_end' || event.type === 'agent_settled') { running.delete(state); state.status = 'idle'; }
  if (event.type === 'ui_prompt_start') state.status = 'waiting';
  if (event.type === 'ui_prompt_end') state.status = running.get(state) ? 'working' : 'idle';
  if (['message_start', 'message_update', 'message_end'].includes(event.type) && event.message) {
    const m = event.message;
    const key = m.role + ':' + (m.timestamp ?? 'current') + ':' + (m.toolCallId || '');
    const item = cleanMessage(m, key);
    let index = state.messages.findIndex(x => x.id === key);
    if (index < 0) {
      state.messages.push(item);
      if (state.messages.length > 100) { state.messages.shift(); state.historyTruncated = true; }
    } else state.messages[index] = item;
    state.title = sessionTitle(state.title, state.messages);
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
  const latest = messages.findLast(message => ['user', 'assistant'].includes(message.role) && message.text?.trim());
  return { ...meta, title: sessionTitle(meta.title, messages),
    preview: excerpt(latest?.text), previewRole: latest?.role };
}
