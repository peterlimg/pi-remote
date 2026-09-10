import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { sessionKey } from './locks.mjs';

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
export function cleanMessage(message, key) {
  const raw = textContent(message.content);
  return { id: key, role: message.role, text: raw.slice(0, 24000),
    truncated: raw.length > 24000, toolName: message.toolName,
    isError: !!message.isError, timestamp: message.timestamp };
}
export function readSession(file) {
  const info = statSync(file);
  if (info.size > 32 * 1024 * 1024) throw new Error('Session exceeds the 32 MiB browsing limit');
  const lines = readFileSync(file, 'utf8').split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { entries.push(JSON.parse(lines[i])); }
    catch { if (i !== lines.length - 1) throw new Error('Invalid session JSONL'); }
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
  const allMessages = branch.filter(x => x.type === 'message').map(x => cleanMessage(x.message, x.id));
  const name = entries.filter(x => x.type === 'session_info' && x.name).at(-1)?.name;
  return { id: sessionKey(file), piSessionId: header.id, file: realpathSync(file), cwd: header.cwd,
    title: name || allMessages.find(x => x.role === 'user')?.text.slice(0, 80) || 'Untitled session',
    updatedAt: info.mtimeMs, status: 'saved', messages: allMessages.slice(-100),
    historyTruncated: allMessages.length > 100 };
}
export function discover(roots) {
  const sessions = new Map(), warnings = [];
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
        try { if (isInside(file, roots)) { const session = readSession(file); sessions.set(session.id, session); } }
        catch (e) { warnings.push(entry.name + ': ' + e.message); }
      }
    }
  }
  roots.forEach(root => walk(root));
  if (count >= 5000) warnings.push('Session scan capped at 5000 files');
  return { sessions, warnings };
}
