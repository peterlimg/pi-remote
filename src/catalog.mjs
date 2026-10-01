import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
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
  return { id: key, role: message.role, text: raw.slice(0, 24000), toolCalls,
    ...(images.size ? { images: [...images.values()] } : {}),
    truncated, toolName: message.toolName, toolCallId: message.toolCallId,
    isError: !!message.isError, timestamp: message.timestamp };
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
    if (entry.type !== 'message' || !Array.isArray(entry.message?.content)) continue;
    for (const part of entry.message.content) {
      if (part.type === 'image' && imageReference(part)?.id === imageId) return validateImages([part])[0];
    }
  }
  throw new Error('Image is no longer available in this session');
}
export function readSession(file) {
  const { info, entries, header, branch } = readBranch(file);
  const allMessages = branch.filter(x => x.type === 'message').map(x => cleanMessage(x.message, x.id));
  const modelEntry = branch.findLast(x => x.type === 'model_change' || (x.type === 'message' && x.message?.role === 'assistant' && x.message.provider && x.message.model));
  const model = modelEntry?.type === 'model_change' ? `${modelEntry.provider}/${modelEntry.modelId}` :
    modelEntry ? `${modelEntry.message.provider}/${modelEntry.message.model}` : undefined;
  const thinkingLevel = branch.findLast(x => x.type === 'thinking_level_change')?.thinkingLevel;
  const name = entries.filter(x => x.type === 'session_info' && x.name).at(-1)?.name;
  return { id: sessionKey(file), piSessionId: header.id, file: realpathSync(file), cwd: header.cwd,
    title: sessionTitle(name, allMessages), model, thinkingLevel,
    updatedAt: info.mtimeMs, status: 'saved', messages: allMessages.slice(-100),
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
