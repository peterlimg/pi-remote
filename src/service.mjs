import { EventEmitter } from 'node:events';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { discover, cleanMessage, isInside, readSession } from './catalog.mjs';
import { initialState, applyEvent, summary } from './state.mjs';
import { acquireLock, sessionKey, canonical } from './locks.mjs';
import { CommandJournal, requestKey, validateCommand, commandList, modelList } from './commands.mjs';
import { RpcWorker } from './rpc.mjs';
import { send } from './config.mjs';

function inside(file, dir) {
  const rel = relative(canonical(dir), canonical(file));
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

export class SessionService extends EventEmitter {
  constructor({ dir, roots, workerOptions = {}, allowResume = false }) {
    super(); this.dir = dir; this.roots = roots; this.workerOptions = workerOptions; this.allowResume = allowResume;
    this.live = new Map(); this.catalog = new Map(); this.warnings = []; this.pending = new Map();
    this.journal = new CommandJournal(join(dir, 'commands'));
    this.scan();
    this.setMaxListeners(50);
    this.timer = setInterval(() => this.scan(), 15000); this.timer.unref();
  }
  scan() {
    const { sessions, warnings } = discover(this.roots);
    this.catalog = sessions; this.warnings = warnings.slice(0, 20);
    for (const [id, item] of this.live) {
      const saved = sessions.get(id);
      if (!item.socket && saved && saved.title !== item.state.title) {
        item.state.title = saved.title; item.state.revision++;
        this.emit('state', id);
      }
    }
    this.emit('list');
  }
  list() {
    const all = new Map([...this.catalog].map(([id, state]) => [id, { ...summary(state), resumable: this.allowResume }]));
    for (const [id, item] of this.live) all.set(id, { ...summary(item.state), resumable: this.allowResume && !item.socket && !item.worker });
    return { sessions: [...all.values()].sort((a, b) => b.updatedAt - a.updatedAt), warnings: this.warnings, allowResume: this.allowResume };
  }
  read(id) {
    if (this.live.has(id)) return this.live.get(id).state;
    const saved = this.catalog.get(id);
    if (!saved) throw new Error('Session not found');
    if (!isInside(saved.file, this.roots)) throw new Error('Session is outside configured roots');
    return readSession(saved.file);
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
      if (command.type === 'setModel') {
        const item = this.live.get(id);
        if (item) {
          item.state.model = result.model; item.state.thinkingLevel = result.thinkingLevel;
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
      if (event.type === 'extension_ui_request') {
        if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          item.state.dialog = event; item.state.status = 'waiting';
        }
      } else applyEvent(item.state, event);
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
        lock = acquireLock(join(this.dir, 'locks'), nextId, { file: path, kind: 'rpc' });
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
      if (!this.allowResume) throw new Error('Enable saved-session resume locally with serve --allow-resume');
      const current = this.live.get(id);
      if (current?.socket || current?.worker) return { attached: true };
      const saved = this.catalog.get(id);
      if (!saved || !isInside(saved.file, this.roots)) throw new Error('Saved session not found in configured roots');
      const actual = readSession(saved.file);
      if (actual.id !== id || !statSync(actual.cwd).isDirectory()) throw new Error('Invalid saved session');
      const lock = acquireLock(join(this.dir, 'locks'), id, { file: actual.file, kind: 'rpc' });
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
        item.state.status = rpcState?.isStreaming ? 'working' : 'idle';
        this.changed(id); return { resumed: true };
      } catch (e) { await worker.close(); throw e; }
    });
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
      item.state.dialog = undefined; item.state.status = 'working'; this.changed(id);
      return { accepted: true };
    });
  }
  async close() {
    clearInterval(this.timer);
    await Promise.all([...this.live.values()].filter(x => x.worker).map(x => x.worker.close()));
    for (const item of this.live.values()) if (item.socket) item.socket.close();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Service stopped')); }
    this.pending.clear();
  }
}
