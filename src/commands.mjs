import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { ensureDir } from './config.mjs';

// Pi handles these in its interactive editor, not in sendUserMessage/RPC prompt.
const terminalCommands = new Set('login logout llama model thinking scoped-models settings resume new name session tree trust fork clone compact copy export import share reload hotkeys changelog quit'.split(' '));
export function commandList(commands, includeRemote = false) {
  if (!Array.isArray(commands)) throw new Error('Command discovery is unavailable. Update Pi and restart the terminal.');
  const list = commands.filter(command => typeof command.name === 'string' && !terminalCommands.has(command.name))
    .map(({ name, description, source }) => ({ name, description, source }));
  if (includeRemote) list.push(
    { name: 'new', description: 'Start a new session in this project', source: 'remote' },
    { name: 'model', description: 'Switch model for this session', source: 'remote' }
  );
  return list;
}
export function modelList(models) {
  if (!Array.isArray(models)) throw new Error('Model discovery is unavailable. Update Pi and restart the terminal.');
  return models.map(({ provider, id, name }) => ({ provider, id, name }));
}
export function validateCommand(command) {
  if (command?.type === 'setModel') {
    if (![command.provider, command.modelId].every(value => typeof value === 'string' && value.trim() && value.length <= 500 && !/\s/.test(value))) throw new Error('Expected a provider and model ID');
    return { type: 'setModel', provider: command.provider, modelId: command.modelId };
  }
  if (!command || !['prompt', 'steer', 'followUp', 'abort'].includes(command.type)) throw new Error('Unsupported command');
  if (command.type !== 'abort' && (typeof command.text !== 'string' || !command.text.trim() || command.text.length > 50000)) throw new Error('Prompt must contain 1–50000 characters');
  if (command.type !== 'abort') {
    const text = command.text.trim();
    if (text === '/') throw new Error('Choose a command from the menu.');
    if (text.startsWith('/') && terminalCommands.has(text.slice(1).split(/\s/, 1)[0])) {
      throw new Error(`${text.split(/\s/, 1)[0]} is only available in the Pi terminal, not through the remote prompt API.`);
    }
  }
  return command.type === 'abort' ? { type: 'abort' } : { type: command.type, text: command.text };
}
export function requestKey(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('Invalid request ID');
  return id;
}
// Persist intent before execution. An interrupted command remains "unknown"; never replay it automatically.
export class CommandJournal {
  constructor(dir) { this.dir = dir; this.pending = new Map(); ensureDir(dir); }
  async execute(sessionId, id, command, action) {
    requestKey(id);
    const key = createHash('sha256').update(sessionId + ':' + id).digest('hex');
    const file = join(this.dir, key + '.json');
    const fingerprint = JSON.stringify(command);
    let prior;
    try { prior = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error('Request ID was reused with different content');
      if (this.pending.has(key)) return this.pending.get(key);
      if (prior.result) return prior.result;
      throw new Error('Previous delivery outcome is unknown. Inspect the conversation before sending a new request.');
    }
    const fd = openSync(file, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ fingerprint, createdAt: Date.now() })); }
    finally { closeSync(fd); }
    const promise = (async () => {
      let result;
      try { result = { ok: true, value: await action() }; }
      catch (e) { result = { ok: false, error: e.message }; }
      const temp = file + '.tmp';
      writeFileSync(temp, JSON.stringify({ fingerprint, result, createdAt: Date.now() }), { mode: 0o600 });
      renameSync(temp, file);
      return result;
    })();
    this.pending.set(key, promise);
    try { return await promise; } finally { this.pending.delete(key); }
  }
}
