import { readdirSync, readFileSync, statSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateImages, MAX_IMAGES } from '../web/images.js';
import { sessionKey } from './locks.mjs';
import { sessionTitle } from './session-title.mjs';

export function rootsFromEnv() {
  return (process.env.PI_REMOTE_SESSION_DIRS || join(homedir(), '.pi', 'agent', 'sessions'))
    .split(process.platform === 'win32' ? ';' : ':').filter(Boolean).map(root => resolve(root));
}
export function isInside(file, roots) {
  const target = realpathSync(file);
  return roots.some(root => {
    let base;
    try { base = realpathSync(root); } catch { return false; }
    return target.startsWith(base + sep);
  });
}
export function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (part.type === 'text') return part.text || '';
    if (part.type === 'toolCall') return 'Tool: ' + part.name + '\n' + JSON.stringify(part.arguments, null, 2);
    if (part.type === 'image') return '[image]';
    return '';
  }).filter(Boolean).join('\n');
}
function imageReference(part) {
  try {
    validateImages([part]);
    return { id: createHash('sha256').update(part.mimeType).update(part.data).digest('hex'), mimeType: part.mimeType };
  } catch { return undefined; }
}
// Extensions post `display: false` custom messages for the model only; Pi's terminal hides them too.
export const shown = message => message.role !== 'custom' || !!message.display;
// Pi stores prompts extensions send as plain user messages; Pi Remote's extension records their text.
export const EXTENSION_INPUT = 'pi-remote-extension-input';
export const lastPromptTime = (messages = [], fallback = 0) => messages.findLast(message =>
  message.role === 'user' && message.source !== 'extension' && Number.isFinite(message.timestamp))?.timestamp ?? fallback;
export function takeText(pending, text) {
  const index = pending.indexOf(text);
  if (index >= 0) pending.splice(index, 1);
  return index >= 0;
}
export function noteTaskTiming(message, task) {
  if (message.role === 'user') {
    if (task.finished) { task.startedAt = undefined; task.lastReply = undefined; task.finished = false; }
    task.startedAt ??= message.timestamp;
    return;
  }
  if (message.role !== 'assistant') return;
  if (task.finished && task.lastReply?.id !== message.id) {
    delete task.lastReply.taskDurationMs; task.finished = false;
  }
  task.startedAt = message.taskStartedAt ?? task.startedAt ?? message.timestamp;
  message.taskStartedAt = task.startedAt; task.lastReply = message;
  if (!['stop', 'length', 'error', 'aborted'].includes(message.stopReason)) return;
  task.finished = true;
  if (Number.isFinite(task.startedAt) && Number.isFinite(message.timestamp) && Number.isFinite(message.durationMs)) {
    message.taskDurationMs = Math.max(0, message.timestamp + message.durationMs - task.startedAt);
  }
}
export function omittedMessages(entries) {
  return new Map(entries.filter(entry => entry.type === 'context_edit').map(entry => [entry.targetId, entry.replacement === null]));
}
export function branchMessages(branch, key) {
  const pending = [], task = {}, omitted = omittedMessages(branch);
  return branch.flatMap(entry => {
    if (entry.type === 'custom' && entry.customType === EXTENSION_INPUT) pending.push(entry.data?.text);
    const message = entry.type === 'custom_message' ? { role: 'custom', content: entry.content, display: entry.display,
      customType: entry.customType, details: entry.details, timestamp: Date.parse(entry.timestamp) } : entry.type === 'message' ? entry.message : undefined;
    if (!message || !shown(message)) return [];
    const item = cleanMessage(message, key({ ...entry, message }));
    if (item.role === 'assistant' && item.stopReason === 'error' && omitted.get(entry.id)) item.retryAttempt = true;
    if (item.role === 'user' && takeText(pending, item.text)) item.source = 'extension';
    noteTaskTiming(item, task);
    return [item];
  });
}
const subagentLabels = new Map([
  ['subagent-supervisor-unanswered', 'Subagent guidance unanswered'],
  ['subagent-supervisor-blocked', 'Subagent guidance blocked'],
  ['subagent-completion-unanswered', 'Subagent results awaiting review'],
  ['subagent-completion-unhandled', 'Subagent results need attention'],
  ['subagent-wait-subscription', 'Subagent wait finished'],
  ['subagent-workflow-result-write-failed', 'Subagent result could not be saved'],
  ['subagent_watchdog_warning', 'Subagent review warning'],
  ['subagent_watchdog_clarification', 'Subagent review needs clarification']
]);
// Only a bounded label crosses the wire; extension details can contain large result payloads.
function subagentLabel({ role, customType, details }) {
  if (role !== 'custom' || typeof customType !== 'string' || !/^subagent[-_]/.test(customType)) return;
  if (customType.startsWith('subagent-slash-')) return;
  const agent = typeof details?.agent === 'string' && details.agent.trim() ? details.agent.trim().slice(0, 120) : 'Subagent';
  if (customType === 'subagent_supervisor_request') return agent + (details?.reason === 'progress_update' ? ' sent a progress update'
    : details?.reason === 'interview_request' ? ' requested structured guidance' : ' requested guidance');
  if (customType === 'subagent-notify') {
    const runs = details?.runs;
    if (Array.isArray(runs) && runs.length > 1) return `${runs.length} subagent results${runs.some(run => ['failed', 'paused', 'stopped'].includes(run?.status)) ? ' need attention' : ''}`;
    const run = Array.isArray(runs) ? runs[0] : undefined;
    return typeof run?.agent === 'string' && ['completed', 'failed', 'paused', 'stopped'].includes(run.status)
      ? run.agent.slice(0, 120) + ' ' + run.status : 'Subagent result';
  }
  if (customType === 'subagent-incremental-child-notify') return 'Subagent workflow ' +
    (['completed', 'failed', 'paused', 'stopped'].includes(details?.outcome) ? details.outcome : 'update');
  if (customType === 'subagent_steering_notice') return 'Subagent guidance ' +
    (['failed', 'partial', 'recovered'].includes(details?.state) ? details.state : 'update');
  if (customType === 'subagent_control_notice') {
    const event = details?.event, name = typeof event?.agent === 'string' ? event.agent.slice(0, 120) : agent;
    return name + (event?.type === 'needs_attention' ? ' needs attention' : ' status update');
  }
  return subagentLabels.get(customType) || 'Subagent update';
}
export function cleanMessage(message, key) {
  const content = Array.isArray(message.content) ? message.content : undefined;
  const images = new Map();
  for (const [index, part] of (content || []).entries()) {
    if (part.type !== 'image' || images.size >= MAX_IMAGES) continue;
    const reference = imageReference(part);
    if (reference) images.set(index, reference);
  }
  const raw = textContent(content ? content.filter((part, index) => part.type !== 'toolCall' && !images.has(index)) : message.content);
  const calls = content?.filter(part => part.type === 'toolCall') || [];
  let budget = Math.max(0, 24000 - raw.length), truncated = raw.length > 24000 || calls.length > 20;
  const toolCalls = calls.slice(0, 20).map(call => {
    const args = JSON.stringify(call.arguments, null, 2) || '';
    const text = args.slice(0, budget); budget -= text.length;
    truncated ||= text.length < args.length;
    return { id: call.id, name: call.name, text };
  });
  const activityLabel = subagentLabel(message);
  // Pi's footer reports the latest assistant prompt's cache hit rate.
  const usage = message.role === 'assistant' ? message.usage : undefined, prompt = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
  const cacheHit = prompt > 0 ? usage.cacheRead / prompt * 100 : undefined;
  return { id: key, role: message.role, text: raw.slice(0, 24000), toolCalls,
    ...(Number.isFinite(cacheHit) ? { cacheHit } : {}),
    ...(message.role === 'custom' && typeof message.customType === 'string' ? { customType: message.customType.slice(0, 120) } : {}),
    ...(activityLabel ? { activityLabel } : {}),
    ...(images.size ? { images: [...images.values()] } : {}),
    truncated, toolName: message.toolName, toolCallId: message.toolCallId,
    isError: !!message.isError, timestamp: message.timestamp, stopReason: message.stopReason,
    durationMs: Number.isFinite(message.durationMs) && message.durationMs >= 0 ? message.durationMs : undefined };
}
// Same totals as Pi's get_session_stats, for terminal sessions that only expose entries.
export function usageTotals(entries) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const entry of entries) {
    const usage = entry.type === 'message' ? entry.message.usage : entry.usage;
    if (!usage || !['usage', 'message', 'branch_summary', 'compaction'].includes(entry.type) || entry.type === 'message' && !['assistant', 'toolResult'].includes(entry.message.role)) continue;
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) totals[key] += usage[key] || 0;
    totals.cost += usage.cost?.total || 0;
  }
  return totals;
}
function readBranch(file) {
  const info = statSync(file);
  if (info.size > 32 * 1024 * 1024) throw new Error('Session exceeds the 32 MiB browsing limit');
  const lines = readFileSync(file, 'utf8').split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { entries.push(JSON.parse(lines[i])); }
    catch { if (i !== lines.length - 1) throw new Error('Invalid session JSONL'); }
    // Session roots can also contain subagent transcripts and other JSONL formats.
    if (entries.length === 1 && entries[0]?.type !== 'session') {
      throw Object.assign(new Error('Not a Pi session'), { code: 'NOT_PI_SESSION' });
    }
  }
  const header = entries[0];
  if (header?.type !== 'session' || !header.cwd || !header.id) throw new Error('Not a Pi session');
  const nodes = new Map(entries.filter(x => x.id && x.type !== 'session').map(x => [x.id, x]));
  let leaf = entries.filter(x => x.type !== 'session' && x.id).at(-1);
  const branch = [], visited = new Set();
  while (leaf) {
    if (visited.has(leaf.id)) throw new Error('Session has a parent cycle');
    visited.add(leaf.id); branch.push(leaf); leaf = nodes.get(leaf.parentId);
  }
  branch.reverse();
  return { info, entries, header, branch };
}
export function readSessionImage(file, imageId) {
  if (typeof imageId !== 'string' || !/^[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid image ID');
  const { branch } = readBranch(file);
  for (const entry of branch) {
    const content = entry.type === 'custom_message' && entry.display ? entry.content : entry.type === 'message' && shown(entry.message) ? entry.message?.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'image' && imageReference(part)?.id === imageId) return validateImages([part])[0];
    }
  }
  throw new Error('Image is no longer available in this session');
}
export function readSession(file) {
  const info = statSync(file);
  if (info.size > 32 * 1024 * 1024) {
    // Discovery only needs a bounded preview. The selected session is indexed off-thread on demand.
    const handle = openSync(file, 'r'), buffer = Buffer.alloc(64 * 1024);
    let prefix;
    try { prefix = buffer.subarray(0, readSync(handle, buffer)).toString('utf8'); } finally { closeSync(handle); }
    const lines = prefix.split('\n'); lines.pop();
    let header;
    try { header = JSON.parse(lines[0]); } catch { throw new Error('Invalid session JSONL'); }
    if (header?.type !== 'session') throw Object.assign(new Error('Not a Pi session'), { code: 'NOT_PI_SESSION' });
    if (!header.cwd || !header.id) throw new Error('Not a Pi session');
    let name;
    for (const line of lines.slice(1)) {
      try { const entry = JSON.parse(line); if (entry.type === 'session_info' && entry.name) name = entry.name; } catch { break; }
    }
    return { id: sessionKey(file), piSessionId: header.id, file: realpathSync(file), cwd: header.cwd,
      title: sessionTitle(name), updatedAt: info.mtimeMs, status: 'saved', messages: [], historyTruncated: true, historyPending: true };
  }
  const { entries, header, branch } = readBranch(file);
  const allMessages = branchMessages(branch, x => x.id);
  const modelEntry = branch.findLast(x => x.type === 'model_change' || (x.type === 'message' && x.message?.role === 'assistant' && x.message.provider && x.message.model));
  const model = modelEntry?.type === 'model_change' ? `${modelEntry.provider}/${modelEntry.modelId}` :
    modelEntry ? `${modelEntry.message.provider}/${modelEntry.message.model}` : undefined;
  const thinkingLevel = branch.findLast(x => x.type === 'thinking_level_change')?.thinkingLevel;
  const name = entries.filter(x => x.type === 'session_info' && x.name).at(-1)?.name;
  return { id: sessionKey(file), piSessionId: header.id, file: realpathSync(file), cwd: header.cwd,
    title: sessionTitle(name, allMessages), model, thinkingLevel,
    updatedAt: info.mtimeMs, lastPromptAt: lastPromptTime(allMessages, Date.parse(header.timestamp) || info.birthtimeMs),
    status: 'saved', messages: allMessages.slice(-100),
    historyTruncated: allMessages.length > 100 };
}
// Parsed sessions keyed by file. Unchanged files (same size and mtime) are not reparsed:
// a full parse of a large history takes seconds and blocks the host on every scan.
const parsed = new Map();
export function discover(roots) {
  const sessions = new Map(), warnings = [], seen = new Set();
  let count = 0;
  function walk(dir, depth = 0) {
    if (depth > 6 || count >= 5000) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') warnings.push('Cannot read ' + dir); return; }
    for (const entry of entries) {
      if (count >= 5000) break;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        count++;
        if (!isInside(file, roots)) continue;
        seen.add(file);
        try {
          const { size, mtimeMs } = statSync(file), cached = parsed.get(file);
          let result = cached?.size === size && cached.mtimeMs === mtimeMs ? cached.result : undefined;
          if (!result) {
            try { result = { session: readSession(file) }; } catch (error) { result = { error }; }
            parsed.set(file, { size, mtimeMs, result });
          }
          if (result.error) throw result.error;
          sessions.set(result.session.id, result.session);
        } catch (e) { if (e.code !== 'NOT_PI_SESSION') warnings.push(entry.name + ': ' + e.message); }
      }
    }
  }
  roots.forEach(root => walk(root));
  for (const file of parsed.keys()) if (!seen.has(file)) parsed.delete(file);
  if (count >= 5000) warnings.push('Session scan capped at 5000 files');
  return { sessions, warnings };
}
