import { EventEmitter } from 'node:events';
import { readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { discover, cleanMessage, isInside, readSession, readSessionImage } from './catalog.mjs';
import { initialState, applyEvent, summary } from './state.mjs';
import { acquireSessionLock, sessionKey, canonical } from './locks.mjs';
import { CommandJournal, requestKey, validateCommand, commandList, modelList } from './commands.mjs';
import { RpcWorker } from './rpc.mjs';
import { send } from './config.mjs';

function inside(file, dir) {
  const rel = relative(canonical(dir), canonical(file));
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

export class SessionService extends EventEmitter {
  constructor({ dir, roots, workerOptions = {}, allowResume = true }) {
    super(); this.dir = dir; this.roots = roots; this.workerOptions = workerOptions; this.allowResume = allowResume;
    this.live = new Map(); this.catalog = new Map(); this.warnings = []; this.pending = new Map();
    this.restoreIds = new Set(); this.restoreWarnings = [];
    this.journal = new CommandJournal(join(dir, 'commands'));
    this.scan();
    this.setMaxListeners(50);
    this.timer = setInterval(() => this.scan(), 15000); this.timer.unref();
  }
  scan() {
    const { sessions, warnings } = discover(this.roots);
    this.catalog = sessions; this.warnings = [...this.restoreWarnings, ...warnings].slice(0, 20);
    for (const [id, item] of this.live) {
      const saved = sessions.get(id);
      if (!item.socket && saved && saved.title !== item.state.title) {
        item.state.title = saved.title; item.state.revision++;
        this.emit('state', id);
      }
    }
    this.emit('list');
  }
  async restore() {
    try {
      const ids = JSON.parse(readFileSync(join(this.dir, 'resume-sessions.json'), 'utf8'));
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid session restore list');
      this.restoreIds = new Set(ids); this.restoreLoaded = true;
      await Promise.all([...this.restoreIds].map(async id => {
        try { await this.startWorker(id); }
        catch (error) { this.restoreWarnings.push(`Could not restore ${id}: ${error.message}`); }
      }));
    } catch (error) {
      if (error.code === 'ENOENT') this.restoreLoaded = true;
      else this.restoreWarnings.push('Could not read session restore list: ' + error.message);
    }
    this.scan();
  }
  list({ offset = 0, query = '' } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid session page');
    const requestOffset = offset;
    const { matches, total } = this.matches(query);
    query = query.trim().toLowerCase();
    offset = Math.min(offset, Math.max(0, Math.ceil(matches.length / 20) - 1) * 20);
    return { sessions: matches.slice(offset, offset + 20), total, matched: matches.length, offset, requestOffset, query,
      warnings: this.warnings, allowResume: this.allowResume };
  }
  // All sessions matching a search, in list order (the phone sorts the same way).
  matches(query = '') {
    if (typeof query !== 'string' || query.length > 500) throw new Error('Invalid session page');
    query = query.trim().toLowerCase();
    const all = new Map([...this.catalog].map(([id, state]) => [id, { ...summary(state), resumable: this.allowResume }]));
    for (const [id, item] of this.live) all.set(id, { ...summary(item.state), resumable: this.allowResume && !item.socket && !item.worker });
    const online = item => ['working', 'waiting', 'idle', 'starting'].includes(item.status);
    const matches = [...all.values()].filter(item => [item.title, item.cwd, item.preview].join(' ').toLowerCase().includes(query))
      .sort((a, b) => Number(online(b)) - Number(online(a)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { matches, total: all.size };
  }
  read(id) {
    if (this.live.has(id)) {
      const state = this.live.get(id).state;
      // Already-running terminals may still send the old text-only message format.
      if (!state.messages?.some(message => !message.images && message.text?.includes('[image]'))) return state;
      try {
        if (!isInside(state.file, this.roots)) return state;
        let saved = this.catalog.get(id);
        if (saved?.updatedAt !== statSync(state.file).mtimeMs) {
          saved = readSession(state.file); this.catalog.set(id, saved);
        }
        return { ...state, messages: state.messages.map(message => {
          if (message.images || !message.text?.includes('[image]')) return message;
          const original = saved.messages.find(item => item.id === message.id || (message.timestamp !== undefined &&
            item.timestamp === message.timestamp && item.role === message.role && item.toolCallId === message.toolCallId));
          return original?.images ? { ...message, text: original.text, images: original.images } : message;
        }) };
      } catch { return state; } // History may not have been flushed yet.
    }
    const saved = this.catalog.get(id);
    if (!saved) throw new Error('Session not found');
    if (!isInside(saved.file, this.roots)) throw new Error('Session is outside configured roots');
    return readSession(saved.file);
  }
  getImage(id, imageId) {
    const state = this.live.get(id)?.state || this.catalog.get(id);
    if (!state?.file || !isInside(state.file, this.roots)) throw new Error('Session not found in configured roots');
    return readSessionImage(state.file, imageId);
  }
  register(socket, state, owner) {
    if (!state || !state.file || typeof state.cwd !== 'string') throw new Error('Invalid session registration');
    if (sessionKey(state.file) !== state.id) throw new Error('Session ID does not match file');
    const disk = JSON.parse(readFileSync(join(this.dir, 'locks', state.id + '.json'), 'utf8'));
    if (disk.nonce !== owner?.nonce || disk.instanceId !== state.instanceId || disk.pid !== owner.pid) throw new Error('Session ownership mismatch');
    const current = this.live.get(state.id);
    if (current?.worker || (current?.socket && current.socket !== socket)) throw new Error('Session already connected');
    this.live.set(state.id, { state: { ...state }, socket, owner });
    socket.sessionId = state.id;
    this.changed(state.id);
  }
  snapshot(socket, state) {
    if (socket.sessionId !== state?.id) throw new Error('Wrong session snapshot');
    const item = this.live.get(state.id);
    if (item?.socket !== socket) throw new Error('Session owner changed');
    item.state = { ...state }; this.changed(state.id);
  }
  disconnected(socket) {
    const item = this.live.get(socket.sessionId);
    if (item?.socket !== socket) return;
    item.socket = undefined; item.state.status = 'disconnected'; this.changed(socket.sessionId);
    for (const [id, request] of this.pending) {
      if (request.socket === socket) { clearTimeout(request.timer); request.reject(new Error('Pi disconnected; delivery outcome may be unknown')); this.pending.delete(id); }
    }
  }
  result(socket, response) {
    const request = this.pending.get(response.id);
    if (!request || request.socket !== socket) return;
    clearTimeout(request.timer); this.pending.delete(response.id);
    if (response.ok) request.resolve(response.value); else request.reject(new Error(response.error || 'Pi rejected command'));
  }
  changed(id) { this.emit('state', id); this.emit('list'); }
  async command(id, requestId, input) {
    const command = validateCommand(input);
    return this.journal.execute(id, requestId, command, async () => {
      const result = await this.dispatch(id, requestId, command);
      if (command.type === 'setModel' || command.type === 'setThinkingLevel') {
        const item = this.live.get(id);
        if (item) {
          if (command.type === 'setModel') item.state.model = result.model;
          item.state.thinkingLevel = result.thinkingLevel;
          item.state.revision++; this.changed(id);
        }
      }
      return result;
    });
  }
  async getModels(id) {
    const result = await this.dispatch(id, randomUUID(), { type: 'getModels' });
    return { models: modelList(result.models), current: result.current };
  }
  async getCommands(id) {
    const result = await this.dispatch(id, randomUUID(), { type: 'getCommands' });
    return commandList(result.commands, true);
  }
  async dispatch(id, requestId, command) {
    const item = this.live.get(id);
    if (item?.worker) return item.worker.command(command);
    if (!item?.socket || item.socket.readyState !== 1) throw new Error('Session is not connected. Resume a saved session first.');
    if (command.images?.length && !item.state.supportsImages) throw new Error('Restart this Pi terminal to enable image uploads.');
    const responseId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(responseId); reject(new Error('Pi acknowledgement timed out; delivery may have occurred'));
      }, 30000);
      this.pending.set(responseId, { socket: item.socket, resolve, reject, timer });
      send(item.socket, { type: 'command', id: responseId, sessionId: id, requestId, command });
    });
  }
  trackWorker(id, item, discardEmpty = false) {
    const { worker, lock } = item;
    worker.on('event', event => {
      if (event.type === 'agent_start') item.agentActive = true;
      if (event.type === 'agent_end' || event.type === 'agent_settled') item.agentActive = false;
      if (event.type === 'extension_ui_request') {
        if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          item.state.dialog = event; item.state.status = 'waiting';
        }
      }
      applyEvent(item.state, event);
      if (item.state.dialog) item.state.status = 'waiting';
      this.changed(id);
    });
    worker.on('fault', error => { item.state.error = error.message; this.changed(id); });
    worker.once('exit', () => {
      lock.release(); item.worker = undefined; item.state.dialog = undefined;
      this.scan();
      if (discardEmpty && !this.catalog.has(id)) this.live.delete(id);
      else item.state.status = 'saved';
      this.changed(id);
    });
  }
  async newSession(id, requestId) {
    requestKey(requestId);
    return this.journal.execute(id, requestId, { type: 'new' }, async () => {
      if (this.stopping) throw new Error('Pi Remote is stopping');
      if (!this.live.get(id)?.socket && !this.live.get(id)?.worker) throw new Error('Session is not connected. Resume a saved session first.');
      const source = this.read(id);
      if (!this.roots.some(root => inside(source.file, root))) throw new Error('Session is outside configured roots');
      const sessionDir = dirname(source.file);
      const worker = new RpcWorker(undefined, source.cwd, { ...this.workerOptions, sessionDir });
      let lock;
      try {
        const info = await worker.request('get_state');
        if (typeof info?.sessionFile !== 'string' || typeof info.sessionId !== 'string') throw new Error('Pi did not provide a new session');
        const path = canonical(info.sessionFile);
        if (!inside(path, sessionDir)) throw new Error('New session is outside configured roots');
        const nextId = sessionKey(path);
        lock = acquireSessionLock(join(this.dir, 'locks'), nextId, { file: path, kind: 'rpc' });
        if (worker.process.pid) lock.setWorkerPid(worker.process.pid);
        const item = { worker, lock, state: initialState({ id: nextId, file: path, cwd: source.cwd, piSessionId: info.sessionId,
          model: info.model ? `${info.model.provider}/${info.model.id}` : undefined, thinkingLevel: info.thinkingLevel }) };
        item.state.status = 'idle'; this.live.set(nextId, item); this.changed(nextId);
        this.trackWorker(nextId, item, true);
        return { sessionId: nextId };
      } catch (e) { await worker.close(); lock?.release(); throw e; }
    });
  }
  async resume(id, requestId) {
    requestKey(requestId);
    return this.journal.execute(id, requestId, { type: 'resume' }, async () => {
      if (!this.allowResume) throw new Error('Saved-session resume is disabled locally. Start serve without --no-allow-resume to enable it.');
      return this.startWorker(id);
    });
  }
  async startWorker(id) {
    if (this.stopping) throw new Error('Pi Remote is stopping');
    const current = this.live.get(id);
    if (current?.socket || current?.worker) return { attached: true };
    const saved = this.catalog.get(id);
    if (!saved || !isInside(saved.file, this.roots)) throw new Error('Saved session not found in configured roots');
    const actual = readSession(saved.file);
    if (actual.id !== id || !statSync(actual.cwd).isDirectory()) throw new Error('Invalid saved session');
    const lock = acquireSessionLock(join(this.dir, 'locks'), id, { file: actual.file, kind: 'rpc' });
    let worker;
    try { worker = new RpcWorker(actual.file, actual.cwd, this.workerOptions); }
    catch (e) { lock.release(); throw e; }
    if (worker.process.pid) lock.setWorkerPid(worker.process.pid);
    const item = { worker, lock, state: initialState(actual, actual.messages) };
    item.state.status = 'starting'; this.live.set(id, item); this.changed(id);
    this.trackWorker(id, item);
    try {
      const rpcState = await worker.request('get_state');
      const history = await worker.request('get_messages');
      item.state.messages = (history?.messages || []).slice(-100).map((m, index) => cleanMessage(m, m.role + ':' + (m.timestamp ?? index) + ':' + (m.toolCallId || '')));
      item.state.model = rpcState?.model ? `${rpcState.model.provider}/${rpcState.model.id}` : undefined;
      item.state.thinkingLevel = rpcState?.thinkingLevel;
      item.agentActive = !!rpcState?.isStreaming;
      item.state.status = item.state.dialog ? 'waiting' : item.agentActive ? 'working' : 'idle';
      this.restoreIds.delete(id);
      this.changed(id); return { resumed: true };
    } catch (e) { await worker.close(); throw e; }
  }
  async answer(id, requestId, answer) {
    return this.journal.execute(id, requestId, { type: 'answer', answer }, async () => {
      const item = this.live.get(id), dialog = item?.state.dialog;
      if (!item?.worker || !dialog || answer?.dialogId !== dialog.id) throw new Error('Dialog is no longer active');
      const response = { type: 'extension_ui_response', id: dialog.id };
      if (answer.cancelled) response.cancelled = true;
      else if (dialog.method === 'confirm') {
        if (typeof answer.confirmed !== 'boolean') throw new Error('Expected confirmation');
        response.confirmed = answer.confirmed;
      } else {
        if (typeof answer.value !== 'string' || answer.value.length > 50000) throw new Error('Invalid answer');
        if (dialog.method === 'select' && !dialog.options.includes(answer.value)) throw new Error('Invalid option');
        response.value = answer.value;
      }
      item.worker.process.stdin.write(JSON.stringify(response) + '\n');
      item.state.dialog = undefined;
      item.state.status = item.agentActive ? 'working' : 'idle'; this.changed(id);
      return { accepted: true };
    });
  }
  async close() {
    if (this.stopping) return;
    clearInterval(this.timer);
    // Remember only host-owned workers. Terminal bridges reconnect themselves;
    // other saved sessions resume on demand from the phone.
    const ids = [...new Set([...this.restoreIds, ...[...this.live].filter(([, item]) => item.worker).map(([id]) => id)])];
    if (this.restoreLoaded || this.live.size) {
      const file = join(this.dir, 'resume-sessions.json');
      writeFileSync(file + '.tmp', JSON.stringify(ids), { mode: 0o600 });
      renameSync(file + '.tmp', file);
    }
    this.stopping = true;
    await Promise.all([...this.live.values()].filter(x => x.worker).map(x => x.worker.close()));
    for (const item of this.live.values()) if (item.socket) item.socket.close();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Service stopped')); }
    this.pending.clear();
  }
}
