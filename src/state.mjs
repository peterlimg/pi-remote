import { statSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { cleanMessage, shown, textContent, takeText, noteTaskTiming, lastPromptTime, EXTENSION_INPUT } from './catalog.mjs';
import { sessionTitle } from './session-title.mjs';
import { taskText } from '../web/protocol.js';

// Whether a run is active, kept off the wire. Terminal dialogs also open while idle.
const running = new WeakMap();
const prompting = new WeakSet();
const tasks = new WeakMap();
// Presentation only; the lifecycle owns permission to restart a worker.
export function refreshStatus(state, session) {
  let status;
  if (session && !session.lifecycle) status = session.socket ? state.status : 'disconnected';
  else if (session && !session.worker) status = 'saved';
  else if (state.dialog || prompting.has(state)) status = 'waiting';
  else if (running.get(state) || state.compacting || state.pendingReply || state.retrying) status = 'working';
  else status = session?.lifecycle.snapshot.phase === 'starting' ? 'starting' : 'idle';
  state.status = status;
  return state;
}
export function restoreActivity(state, info) {
  // Live events can precede the startup snapshot.
  if (!running.has(state)) running.set(state, !!info?.isStreaming);
  state.compacting = !!info?.isCompacting;
}
// Prompts extensions sent whose user message has not arrived yet, also off the wire.
const extensionInputs = new WeakMap();
export function noteExtensionInput(state, text) {
  if (!extensionInputs.has(state)) extensionInputs.set(state, []);
  extensionInputs.get(state).push(text);
}
// Reconnecting is not activity: keep the session file's time so the phone's unread marks survive host restarts.
const lastWrite = file => { try { return statSync(file).mtimeMs; } catch { return Date.now(); } };
export function initialState(meta, messages = []) {
  const updatedAt = meta.file ? lastWrite(meta.file) : Date.now();
  const state = { ...meta, title: sessionTitle(meta.title, messages), messages: messages.slice(-100), tools: [], revision: 0,
    updatedAt, lastPromptAt: lastPromptTime(messages, meta.lastPromptAt ?? updatedAt) };
  const task = {}; tasks.set(state, task);
  for (const message of state.messages) noteTaskTiming(message, task);
  return refreshStatus(state);
}
export function applyEvent(state, event) {
  if (event.type === 'extension_ui_request') {
    // Status refreshes are not conversation activity. pi-usage only labels
    // the status "codex fast" when fast routing is effective.
    if (event.method === 'setStatus' && event.statusKey === 'usage') {
      state.fastMode = /^codex fast(?:\s|$)/u.test(stripVTControlCharacters(event.statusText || ''));
      state.revision++;
    }
    if (event.method === 'setStatus' && event.statusKey === EXTENSION_INPUT && event.statusText) noteExtensionInput(state, event.statusText);
    return refreshStatus(state);
  }
  state.revision++;
  // Startup and control notifications are not conversation activity.
  if (['agent_start', 'compaction_start', 'session_before_compact', 'compaction_end', 'session_compact', 'session_compact_failed'].includes(event.type) ||
    event.type.startsWith('tool_execution_') ||
    ['message_start', 'message_update', 'message_end'].includes(event.type) && event.message && shown(event.message)) state.updatedAt = Date.now();
  if (event.type === 'model_select') {
    state.model = `${event.model.provider}/${event.model.id}`; state.modelName = event.model.name;
    state.fastMode = false;
  }
  if (event.type === 'thinking_level_select' || event.type === 'thinking_level_changed') state.thinkingLevel = event.level;
  if (event.type === 'agent_start') running.set(state, true);
  if (event.type === 'auto_retry_start') {
    const failed = state.messages.findLast(message => message.role === 'assistant');
    if (failed?.stopReason === 'error') failed.retryAttempt = true;
    state.retrying = true; state.pendingReply = undefined;
  }
  if (event.type === 'auto_retry_end') state.retrying = false;
  if (event.type === 'agent_settled') { state.compacting = false; state.retrying = false; state.pendingReply = undefined; }
  if (event.type === 'agent_end' || event.type === 'agent_settled') running.set(state, false);
  if (['compaction_start', 'session_before_compact'].includes(event.type)) state.compacting = true;
  if (['compaction_end', 'session_compact', 'session_compact_failed'].includes(event.type)) state.compacting = false;
  if (event.type === 'ui_prompt_start') prompting.add(state);
  if (event.type === 'ui_prompt_end') prompting.delete(state);
  if (['message_start', 'message_update', 'message_end'].includes(event.type) && event.message && shown(event.message)) {
    const m = event.message;
    const key = m.role + ':' + (m.timestamp ?? 'current') + ':' + (m.toolCallId || '');
    if (m.role === 'user') { state.pendingReply = undefined; state.retrying = false; }
    if (m.role === 'assistant' && event.type === 'message_end') {
      state.pendingReply = m.stopReason === 'error' ? key : undefined;
      if (m.stopReason !== 'error') state.retrying = false;
    }
    const item = cleanMessage(m, key);
    if (!tasks.has(state)) tasks.set(state, {});
    noteTaskTiming(item, tasks.get(state));
    let index = state.messages.findIndex(x => x.id === key);
    if (index >= 0 ? state.messages[index].source : m.role === 'user' && takeText(extensionInputs.get(state) || [], item.text)) item.source = 'extension';
    // Background replies, tools and extension prompts must not move sessions in the list.
    if (item.role === 'user' && item.source !== 'extension') state.lastPromptAt = Number.isFinite(item.timestamp) ? item.timestamp : state.updatedAt;
    if (index < 0) {
      state.messages.push(item);
      if (state.messages.length > 100) { state.messages.shift(); state.historyTruncated = true; }
    } else state.messages[index] = item;
    state.title = sessionTitle(state.title, state.messages);
  }
  if (event.type.startsWith('tool_execution_')) {
    const tool = { id: event.toolCallId, name: event.toolName, status: event.type === 'tool_execution_end' ? (event.isError ? 'error' : 'done') : 'working',
      text: textContent((event.result || event.partialResult)?.content).slice(0, 12000), durationMs: event.durationMs };
    const index = state.tools.findIndex(x => x.id === tool.id);
    if (index < 0) state.tools.push(tool); else state.tools[index] = tool;
    state.tools = state.tools.slice(-20);
  }
  return refreshStatus(state);
}
export function summary(state) {
  const { messages = [], tools, file, ...meta } = state;
  const excerpt = text => {
    const line = (text || '')
      .replace(/```[^\n]*\n?/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/(\*\*|__|\*|_|~~|`)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/\s+/g, ' ').trim();
    return line.length > 160 ? line.slice(0, 159) + '…' : line;
  };
  const latest = messages.findLast(message => ['user', 'assistant'].includes(message.role) && message.text?.trim());
  return { ...meta, lastPromptAt: meta.lastPromptAt ?? lastPromptTime(messages, meta.updatedAt), title: sessionTitle(meta.title, messages),
    preview: excerpt(taskText(latest)), previewRole: latest?.role };
}
