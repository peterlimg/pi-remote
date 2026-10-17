import { EventEmitter } from 'node:events';
import { readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { discover, isInside, readSession } from './catalog.mjs';
import { initialState, applyEvent, summary } from './state.mjs';
import { sessionTitle } from './session-title.mjs';
import { acquireSessionLock, sessionKey, canonical } from './locks.mjs';
import { CommandJournal, requestKey, validateCommand, commandList, modelList } from './commands.mjs';
import { RpcWorker } from './rpc.mjs';
import { send } from './config.mjs';
import { HistoryReader } from './history.mjs';
import { createSessionLifecycle } from './session-lifecycle.mjs';

function inside(file, dir) {
  const rel = relative(canonical(dir), canonical(file));
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

export class SessionService extends EventEmitter {
  constructor({ dir, roots, workerOptions = {}, allowResume = true }) {
    super(); this.dir = dir; this.roots = roots; this.workerOptions = workerOptions; this.allowResume = allowResume;
    this.live = new Map(); this.catalog = new Map(); this.warnings = []; this.pending = new Map(); this.starting = new Set();
    this.restoreIds = new Set(); this.restoreWarnings = []; this.restoring = new Set();
    this.journal = new CommandJournal(join(dir, 'commands'));
    this.historyReader = new HistoryReader();
    // Sessions started without a project each get a folder here; the phone hides these folders' names.
    mkdirSync(join(dir, 'projects'), { recursive: true, mode: 0o700 }); this.blankDir = canonical(join(dir, 'projects'));
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
      this.restoreIds = new Set(ids); this.restoreLoaded = true; this.restoring = new Set(ids);
      await Promise.all([...this.restoreIds].map(async id => {
        try { await this.startWorker(id); }
        catch (error) { this.restoreWarnings.push(`Could not restore ${id}: ${error.message}`); }
        finally { this.restoring.delete(id); }
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
  // Projects in list order: running first, then most recently used. Each names its newest session as the source for `new`.
  projects() {
    const projects = new Map();
    for (const item of this.matches().matches) if (!projects.has(item.cwd)) projects.set(item.cwd, { cwd: item.cwd, sessionId: item.id });
    return [...projects.values()];
  }
  read(id) {
    if (this.live.has(id)) {
      const live = this.live.get(id).state;
      const state = { ...live, title: sessionTitle(live.title, live.messages) };
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
  async view(id) {
    const state = this.read(id);
    if (!state.historyPending) return state;
    const page = await this.history(id, {});
    const { historyPending, ...meta } = state;
    return { ...meta, messages: page.messages, title: page.title, model: page.model,
      thinkingLevel: page.thinkingLevel, historyTruncated: page.older };
  }
  historySource(id) {
    const state = this.live.get(id)?.state || this.catalog.get(id);
    if (!state?.file || !isInside(state.file, this.roots)) throw new Error('Session not found in configured roots');
    return { file: state.file, tips: this.live.has(id) ? [...state.messages].reverse().map(message => message.id) : undefined };
  }
  history(id, { before, after, expectedTip } = {}) {
    if (before !== undefined && after !== undefined || [before, after, expectedTip].some(cursor => cursor !== undefined &&
      (typeof cursor !== 'string' || !cursor || cursor.length > 512))) throw new Error('Invalid history cursor');
    return this.historyReader.request('page', { ...this.historySource(id), before, after, expectedTip });
  }
  getImage(id, imageId) {
    return this.historyReader.request('image', { ...this.historySource(id), imageId });
  }
  historyVideo(id, messageId, path) {
    if (typeof messageId !== 'string' || messageId.length > 512) return false;
    return this.historyReader.request('video', { ...this.historySource(id), messageId, path });
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
          if (command.type === 'setModel') { item.state.model = result.model; item.state.modelName = result.modelName; item.state.contextUsage = undefined; }
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
  async getUsage(id, includeProvider = false) {
    const item = this.live.get(id), model = item?.state.model;
    if (includeProvider && item?.state.dialog) throw new Error('Close the active dialog before checking usage.');
    const result = await this.dispatch(id, randomUUID(), { type: 'getUsage', includeProvider });
    if (this.live.get(id) === item && item.state.model === model) {
      item.state.contextUsage = result.contextUsage;
      item.state.revision++; this.changed(id);
    }
    return { ...result, model };
  }
  async dispatch(id, requestId, command) {
    if (this.stopping) throw new Error('Pi Remote is stopping');
    const item = this.live.get(id);
    if (item?.worker) {
      if (['prompt', 'steer', 'followUp'].includes(command.type) && !command.text.trimStart().startsWith('/')) {
        this.advance(id, item, { type: 'request_started' });
      }
      try { return await item.worker.command(command); }
      catch (error) {
        try {
          const state = await item.worker.request('get_state');
          if (!state.isStreaming) this.advance(id, item, { type: 'request_rejected' });
        } catch { /* A worker exit owns the final lifecycle transition. */ }
        throw error;
      }
    }
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
  get managedSessions() {
    return [...this.live].filter(([, item]) => item.worker).map(([id, item]) => ({ id, ...item.lifecycle.snapshot,
      requests: item.worker.pending.size, restartSafe: item.lifecycle.snapshot.restartSafe && !item.worker.pending.size }));
  }
  get busyWorkers() {
    const busy = new Set(this.restoring);
    for (const [id, item] of this.live) if (item.worker && (!item.lifecycle.snapshot.restartSafe || item.worker.pending.size)) busy.add(id);
    return this.starting.size + busy.size;
  }
  advance(id, item, event) {
    const before = item.lifecycle.snapshot, after = item.lifecycle.send(event);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.emit('lifecycle', { id, event: event.type, from: before.phase, to: after.phase,
        pendingTools: after.pendingTools, waitFor: after.waitFor, blocked: after.blocked, restartSafe: after.restartSafe });
    }
    return after;
  }
  trackWorker(id, item, discardEmpty = false) {
    const { worker, lock } = item;
    worker.on('event', event => {
      this.advance(id, item, event);
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
      this.advance(id, item, { type: 'worker_exit' });
      lock.release(); item.worker = undefined; item.state.dialog = undefined; item.state.compacting = false;
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
      const source = this.read(id);
      if (!this.roots.some(root => inside(source.file, root))) throw new Error('Session is outside configured roots');
      // A saved source starts a host-owned worker, the same as resuming it would.
      if (!this.live.get(id)?.socket && !this.live.get(id)?.worker) {
        if (!this.allowResume) throw new Error('Saved-session resume is disabled locally. Start serve without --no-allow-resume to enable it.');
        if (!statSync(source.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Project directory no longer exists');
      }
      return this.startFresh(source.cwd, dirname(source.file));
    });
  }
  // A blank session: a fresh folder under the data dir, named by local time (`2026-10-11-1432`, then `-2`…).
  async newProject(requestId) {
    requestKey(requestId);
    return this.journal.execute('new-project', requestId, { type: 'newProject' }, async () => {
      if (this.stopping) throw new Error('Pi Remote is stopping');
      if (!this.allowResume) throw new Error('Saved-session resume is disabled locally. Start serve without --no-allow-resume to enable it.');
      if (!this.roots.length) throw new Error('No session directory is configured');
      const parent = this.blankDir, now = new Date(), pad = n => String(n).padStart(2, '0');
      const name = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      let cwd;
      for (let n = 1; !cwd; n++) {
        const candidate = join(parent, n === 1 ? name : `${name}-${n}`);
        try { mkdirSync(candidate); cwd = candidate; } catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      // Pi's own naming for a working directory's session folder.
      return this.startFresh(cwd, join(this.roots[0], '--' + cwd.replace(/^[\\/]/, '').replace(/[\\/:]/g, '-') + '--'));
    });
  }
  async startFresh(cwd, sessionDir) {
    if (this.stopping) throw new Error('Pi Remote is stopping');
    const worker = new RpcWorker(undefined, cwd, { ...this.workerOptions, sessionDir });
    const startup = { worker, lifecycle: createSessionLifecycle() };
    this.starting.add(startup);
    let lock;
    try {
      const info = await worker.request('get_state');
      if (this.stopping) throw new Error('Pi Remote is stopping');
      if (typeof info?.sessionFile !== 'string' || typeof info.sessionId !== 'string') throw new Error('Pi did not provide a new session');
      const path = canonical(info.sessionFile);
      if (!inside(path, sessionDir)) throw new Error('New session is outside configured roots');
      const nextId = sessionKey(path);
      lock = acquireSessionLock(join(this.dir, 'locks'), nextId, { file: path, kind: 'rpc' });
      if (worker.process.pid) lock.setWorkerPid(worker.process.pid);
      const item = { worker, lock, lifecycle: startup.lifecycle, state: initialState({ id: nextId, file: path, cwd, piSessionId: info.sessionId,
        model: info.model ? `${info.model.provider}/${info.model.id}` : undefined, modelName: info.model?.name, thinkingLevel: info.thinkingLevel,
        compacting: !!info.isCompacting }) };
      this.advance(nextId, item, { type: 'restore', provider: info.model?.provider, streaming: !!info.isStreaming || !!info.isCompacting });
      item.state.status = info.isStreaming || info.isCompacting ? 'working' : 'idle'; this.live.set(nextId, item); this.changed(nextId);
      this.trackWorker(nextId, item, true);
      return { sessionId: nextId };
    } catch (e) { await worker.close(); lock?.release(); throw e; }
    finally { this.starting.delete(startup); }
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
    const actual = await this.view(id);
    if (this.stopping) throw new Error('Pi Remote is stopping');
    if (actual.id !== id || !statSync(actual.cwd).isDirectory()) throw new Error('Invalid saved session');
    const lock = acquireSessionLock(join(this.dir, 'locks'), id, { file: actual.file, kind: 'rpc' });
    let worker;
    try { worker = new RpcWorker(actual.file, actual.cwd, this.workerOptions); }
    catch (e) { lock.release(); throw e; }
    if (worker.process.pid) lock.setWorkerPid(worker.process.pid);
    const item = { worker, lock, lifecycle: createSessionLifecycle(), state: initialState(actual, actual.messages) };
    item.state.status = 'starting'; this.live.set(id, item); this.changed(id);
    this.trackWorker(id, item);
    try {
      const rpcState = await worker.request('get_state');
      // The saved branch already has image references; get_messages duplicates all base64 over RPC.
      let history = readSession(actual.file);
      if (history.historyPending) {
        const page = await this.history(id, {});
        history = { ...history, messages: page.messages, historyTruncated: page.older };
      }
      item.state.messages = history.messages;
      item.state.historyTruncated = history.historyTruncated;
      item.state.model = rpcState?.model ? `${rpcState.model.provider}/${rpcState.model.id}` : undefined;
      item.state.modelName = rpcState?.model?.name;
      item.state.thinkingLevel = rpcState?.thinkingLevel;
      item.state.compacting = !!rpcState?.isCompacting;
      this.advance(id, item, { type: 'restore', provider: rpcState?.model?.provider, streaming: !!rpcState?.isStreaming || !!rpcState?.isCompacting });
      item.state.status = item.state.dialog ? 'waiting' : rpcState?.isStreaming || rpcState?.isCompacting ? 'working' : 'idle';
      delete item.state.error;
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
      this.advance(id, item, { type: 'input_closed' });
      item.worker.process.stdin.write(JSON.stringify(response) + '\n');
      item.state.dialog = undefined;
      item.state.status = item.lifecycle.snapshot.restartSafe ? 'idle' : 'working'; this.changed(id);
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
    await this.historyReader.close();
    const workers = new Set([...this.live.values(), ...this.starting].filter(item => item.worker).map(item => item.worker));
    await Promise.all([...workers].map(worker => worker.close()));
    for (const item of this.live.values()) if (item.socket) item.socket.close();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Service stopped')); }
    this.pending.clear();
  }
}
