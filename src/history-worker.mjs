import { parentPort } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { branchMessages, cleanMessage, shown, textContent, takeText, noteTaskTiming, lastPromptTime, omittedMessages, EXTENSION_INPUT } from './catalog.mjs';
import { messageKey, sessionTitle, unnamed } from '../web/protocol.js';
import { splitVideoMessage } from '../web/videos.js';
import { validateImages } from '../web/images.js';

const indexes = new Map();
const hash = text => createHash('sha256').update(text || '').digest('hex');
function addEntry(index, entry, offset, length) {
  if (!index.header) {
    if (entry.type !== 'session' || !entry.cwd || !entry.id) throw new Error('Not a Pi session');
    index.header = entry; return;
  }
  if (!entry.id || entry.type === 'session') return;
  const message = entry.type === 'custom_message' ? { role: 'custom', display: entry.display, content: entry.content, timestamp: Date.parse(entry.timestamp) }
    : entry.type === 'message' ? entry.message : undefined;
  const node = { id: entry.id, parentId: entry.parentId, type: entry.type, offset, length,
    ...(entry.type === 'context_edit' ? { targetId: entry.targetId, replacement: entry.replacement === null ? null : false } : {}),
    ...(message && shown(message) ? { role: message.role, timestamp: message.timestamp, toolCallId: message.toolCallId,
      stopReason: message.stopReason, durationMs: message.durationMs,
      hasImages: Array.isArray(message.content) && message.content.some(part => part.type === 'image'),
      userHash: message.role === 'user' ? hash(textContent(message.content).slice(0, 24000)) : undefined } : {}),
    inputHash: entry.type === 'custom' && entry.customType === EXTENSION_INPUT && typeof entry.data?.text === 'string' ? hash(entry.data.text) : undefined,
    model: entry.type === 'model_change' ? `${entry.provider}/${entry.modelId}` : message?.role === 'assistant' && message.provider && message.model ? `${message.provider}/${message.model}` : undefined,
    thinkingLevel: entry.thinkingLevel };
  index.nodes.set(node.id, node); index.leaf = node.id;
  if (node.role) index.aliases.set(messageKey(node), node.id);
  if (entry.type === 'session_info' && entry.name) index.name = entry.name;
}
async function getIndex(file) {
  const info = await stat(file);
  let index = indexes.get(file);
  if (index && index.size === info.size && index.mtimeMs === info.mtimeMs && index.ino === info.ino) return index;
  if (!index || index.ino !== info.ino || info.size <= index.size) index = { nodes: new Map(), aliases: new Map(), offset: 0 };
  indexes.delete(file); indexes.set(file, index);
  // Only compact offsets/metadata are cached, never the full message bodies or base64 images.
  while (indexes.size > 4) indexes.delete(indexes.keys().next().value);
  index.branch = undefined;
  let offset = index.offset, segments = [];
  const parse = (buffer, complete) => {
    if (!buffer.toString('utf8').trim()) return;
    let entry;
    try { entry = JSON.parse(buffer.toString('utf8')); }
    catch { if (complete) throw new Error('Invalid session JSONL'); return; }
    addEntry(index, entry, offset, buffer.length);
  };
  try {
    if (info.size > offset) for await (const chunk of createReadStream(file, { start: offset, end: info.size - 1, highWaterMark: 256 * 1024 })) {
      let start = 0, end;
      while ((end = chunk.indexOf(10, start)) >= 0) {
        const tail = chunk.subarray(start, end);
        const line = segments.length ? Buffer.concat([...segments, tail]) : tail;
        parse(line, true); offset += line.length + 1; index.offset = offset;
        segments = []; start = end + 1;
      }
      if (start < chunk.length) segments.push(chunk.subarray(start));
    }
    // Pi can be in the middle of appending a record. Retry that tail on the next read.
    if (segments.length) parse(Buffer.concat(segments), false);
    if (!index.header) throw new Error('Not a Pi session');
    Object.assign(index, { size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs, ino: info.ino });
    return index;
  } catch (error) { indexes.delete(file); throw error; }
}
const resolveId = (index, id) => index.nodes.has(id) ? id : index.aliases.get(id);
function getBranch(index, tips) {
  const tip = tips?.map(id => resolveId(index, id)).find(Boolean) || index.leaf;
  if (index.branch?.tip === tip) return index.branch;
  const entries = [], visited = new Set();
  for (let node = index.nodes.get(tip); node; node = index.nodes.get(node.parentId)) {
    if (visited.has(node.id)) throw new Error('Session has a parent cycle');
    visited.add(node.id); entries.push(node);
  }
  entries.reverse();
  const rows = [], positions = new Map(), pending = [], task = {}, omitted = omittedMessages(entries);
  for (const entry of entries) {
    if (entry.inputHash) pending.push(entry.inputHash);
    if (!entry.role) continue;
    const row = { ...entry };
    if (row.role === 'assistant' && row.stopReason === 'error' && omitted.get(row.id)) row.retryAttempt = true;
    if (row.role === 'user' && takeText(pending, row.userHash)) row.source = 'extension';
    noteTaskTiming(row, task);
    positions.set(row.id, rows.length); rows.push(row);
  }
  return index.branch = { tip, entries, rows, positions, ids: visited,
    model: entries.findLast(entry => entry.model)?.model,
    thinkingLevel: entries.findLast(entry => entry.thinkingLevel)?.thinkingLevel };
}
async function readEntry(handle, node) {
  const buffer = Buffer.alloc(node.length);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, node.offset + offset);
    if (!bytesRead) throw new Error('Session changed while reading. Return to latest messages.');
    offset += bytesRead;
  }
  return JSON.parse(buffer.toString('utf8'));
}
async function readMessage(handle, row) {
  const entry = await readEntry(handle, row);
  const [message] = branchMessages([entry], item => item.id);
  return { ...message, liveId: messageKey(row), source: row.source,
    taskStartedAt: row.taskStartedAt, taskDurationMs: row.taskDurationMs, ...(row.retryAttempt ? { retryAttempt: true } : {}) };
}
async function run({ op, file, before, after, tips, expectedTip, imageId, messageId, path }) {
  const index = await getIndex(file), branch = getBranch(index, tips);
  const lastPromptAt = lastPromptTime(branch.rows, Date.parse(index.header.timestamp) || index.birthtimeMs);
  if (expectedTip && !branch.ids.has(expectedTip)) throw new Error('Conversation changed. Return to latest messages.');
  const handle = await open(file, 'r');
  try {
    if (op === 'metadata' || op === 'page') {
      if (!branch.title) {
        const firstUser = unnamed(index.name) ? branch.rows.find(row => row.role === 'user') : undefined;
        branch.title = sessionTitle(index.name, firstUser ? [await readMessage(handle, firstUser)] : []);
      }
      if (op === 'metadata') return { title: branch.title, lastPromptAt };
    }
    if (op === 'image') {
      if (typeof imageId !== 'string' || !/^[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid image ID');
      for (const row of branch.rows) {
        if (!row.hasImages) continue;
        const entry = await readEntry(handle, row);
        for (const part of entry.type === 'custom_message' ? entry.content : entry.message.content) {
          if (part.type === 'image' && cleanMessage({ content: [part] }, '').images?.[0]?.id === imageId) return validateImages([part])[0];
        }
      }
      throw new Error('Image is no longer available in this session');
    }
    if (op === 'video') {
      const position = branch.positions.get(resolveId(index, messageId));
      if (position === undefined) return false;
      const message = await readMessage(handle, branch.rows[position]);
      return ['user', 'assistant'].includes(message.role) && splitVideoMessage(message.text, message.role).paths.includes(path);
    }
    if (op !== 'page') throw new Error('Unsupported history operation');
    const cursor = before ?? after;
    const position = cursor === undefined ? undefined : branch.positions.get(resolveId(index, cursor));
    if (cursor !== undefined && position === undefined) throw new Error('Conversation changed. Return to latest messages.');
    const { rows } = branch;
    const backwards = after === undefined;
    let start = backwards ? Math.max(0, (position ?? rows.length) - 100) : position + 1;
    let end = backwards ? position ?? rows.length : Math.min(rows.length, start + 100);
    const messages = []; let bytes = 0;
    // Page by entry ID, not time: parallel tools can share timestamps or finish out of order.
    for (let i = backwards ? end - 1 : start; backwards ? i >= start : i < end; i += backwards ? -1 : 1) {
      const message = await readMessage(handle, rows[i]), size = Buffer.byteLength(JSON.stringify(message));
      if (messages.length && bytes + size > 512 * 1024) {
        if (backwards) start = i + 1; else end = i;
        break;
      }
      bytes += size;
      if (backwards) messages.unshift(message); else messages.push(message);
    }
    return { messages, older: start > 0, newer: end < rows.length, tip: branch.tip, title: branch.title,
      model: branch.model, thinkingLevel: branch.thinkingLevel, lastPromptAt };
  } finally { await handle.close(); }
}
// One append-aware index mutation at a time, even when multiple phones ask for history.
let queue = Promise.resolve();
parentPort.on('message', request => {
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id: request.id, value: await run(request) }); }
    catch (error) { parentPort.postMessage({ id: request.id, error: error.message }); }
  });
});
