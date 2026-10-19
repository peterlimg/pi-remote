import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialState, applyEvent } from './state.mjs';
import { lastPromptTime } from './catalog.mjs';
import { sessionTitle } from './session-title.mjs';
import { acquireSessionLock } from './locks.mjs';
import { RpcWorker } from './rpc.mjs';
import { send } from './config.mjs';
import { createSessionLifecycle } from './session-lifecycle.mjs';

class LiveSession {
  constructor(state, changed) { this.state = state; this.onChange = changed; }
  notify() { this.onChange(this.state.id); }
  update(patch) { Object.assign(this.state, patch); this.state.revision++; this.notify(); }
  read() { return { ...this.state, title: sessionTitle(this.state.title, this.state.messages) }; }
  syncTitle(title) { if (this.state.title !== title) this.update({ title }); }
  answer() { throw new Error('Dialog is no longer active'); }
  get managed() { return undefined; }
  async command(command, requestId) {
    const result = await this.dispatch(command, requestId);
    if (command.type === 'setModel' || command.type === 'setThinkingLevel') {
      this.update({ ...(command.type === 'setModel' ? { model: result.model, modelName: result.modelName, contextUsage: undefined } : {}),
        thinkingLevel: result.thinkingLevel });
    }
    return result;
  }
}

export class WorkerSession extends LiveSession {
  constructor(meta, { dir, workerOptions, changed, lifecycle, exited }) {
    super(initialState(meta, meta.messages), changed);
    this.lifecycle = createSessionLifecycle(); this.onLifecycle = lifecycle; this.onExit = exited;
    this.lockDir = join(dir, 'locks');
    if (meta.file) this.lock = acquireSessionLock(this.lockDir, meta.id, { file: meta.file, kind: 'rpc' });
    try { this.worker = new RpcWorker(meta.file, meta.cwd, workerOptions); }
    catch (error) { this.lock?.release(); throw error; }
    if (this.lock) {
      if (this.worker.process.pid) this.lock.setWorkerPid(this.worker.process.pid);
      this.state.status = 'starting'; this.track();
    }
  }
  get resumable() { return !this.worker; }
  get managed() {
    if (!this.worker) return undefined;
    const snapshot = this.lifecycle.snapshot, requests = this.worker.pending.size;
    return { id: this.state.id, ...snapshot, requests, restartSafe: snapshot.restartSafe && !requests };
  }
  advance(event) {
    const before = this.lifecycle.snapshot, after = this.lifecycle.send(event);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.onLifecycle({ id: this.state.id, event: event.type, from: before.phase, to: after.phase,
        pendingTools: after.pendingTools, waitFor: after.waitFor, blocked: after.blocked, restartSafe: after.restartSafe });
    }
    return after;
  }
  track() {
    const { worker, lock } = this;
    worker.on('event', event => {
      this.advance(event);
      if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) this.state.dialog = event;
      applyEvent(this.state, event);
      if (this.state.dialog) this.state.status = 'waiting';
      this.notify();
    });
    worker.on('fault', error => { this.state.error = error.message; this.notify(); });
    worker.once('exit', () => {
      this.advance({ type: 'worker_exit' });
      lock.release(); this.worker = undefined; this.state.dialog = undefined; this.state.compacting = false;
      this.onExit(this.state.id);
      this.state.status = 'saved'; this.notify();
    });
  }
  inspect() { return this.worker.request('get_state'); }
  attach(meta, info) {
    this.lock = acquireSessionLock(this.lockDir, meta.id, { file: meta.file, kind: 'rpc' });
    if (this.worker.process.pid) this.lock.setWorkerPid(this.worker.process.pid);
    this.state = initialState(meta);
    this.restoreState(info); this.track();
  }
  restoreState(info, history) {
    if (history) { this.state.messages = history.messages; this.state.historyTruncated = history.historyTruncated; }
    this.state.model = info?.model ? `${info.model.provider}/${info.model.id}` : undefined;
    this.state.modelName = info?.model?.name;
    this.state.thinkingLevel = info?.thinkingLevel;
    this.state.compacting = !!info?.isCompacting;
    this.advance({ type: 'restore', provider: info?.model?.provider, streaming: !!info?.isStreaming || !!info?.isCompacting });
    this.state.status = this.state.dialog ? 'waiting' : info?.isStreaming || info?.isCompacting ? 'working' : 'idle';
    delete this.state.error;
  }
  restore(info, history) { this.restoreState(info, history); this.notify(); }
  async dispatch(command) {
    const worker = this.worker;
    if (!worker) throw new Error('Session is not connected. Resume a saved session first.');
    if (['prompt', 'steer', 'followUp'].includes(command.type) && !command.text.trimStart().startsWith('/')) {
      this.advance({ type: 'request_started' });
    }
    try { return await worker.command(command); }
    catch (error) {
      try {
        const state = await worker.request('get_state');
        if (!state.isStreaming) this.advance({ type: 'request_rejected' });
      } catch { /* A worker exit owns the final lifecycle transition. */ }
      throw error;
    }
  }
  answer(answer) {
    const dialog = this.state.dialog;
    if (!this.worker || !dialog || answer?.dialogId !== dialog.id) throw new Error('Dialog is no longer active');
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
    this.advance({ type: 'input_closed' });
    this.worker.process.stdin.write(JSON.stringify(response) + '\n');
    this.state.dialog = undefined;
    this.state.status = this.lifecycle.snapshot.restartSafe ? 'idle' : 'working'; this.notify();
    return { accepted: true };
  }
  async close() { await this.worker?.close(); this.lock?.release(); }
}

export class BridgeSession extends LiveSession {
  constructor(state, socket, owner, changed) {
    super(state, changed); this.socket = socket; this.owner = owner; this.pending = new Map();
  }
  get resumable() { return !this.socket; }
  snapshot(state, owner = this.owner) {
    const lastPromptAt = state.lastPromptAt ?? lastPromptTime(state.messages, this.state.lastPromptAt);
    this.state = { ...state, lastPromptAt }; this.owner = owner; this.notify();
  }
  syncTitle(title) { if (!this.socket) super.syncTitle(title); }
  read(readSaved) {
    const state = super.read();
    // Already-running terminals may still send the old text-only message format.
    if (!state.messages?.some(message => !message.images && message.text?.includes('[image]'))) return state;
    try {
      const saved = readSaved();
      if (!saved) return state;
      return { ...state, messages: state.messages.map(message => {
        if (message.images || !message.text?.includes('[image]')) return message;
        const original = saved.messages.find(item => item.id === message.id || (message.timestamp !== undefined &&
          item.timestamp === message.timestamp && item.role === message.role && item.toolCallId === message.toolCallId));
        return original?.images ? { ...message, text: original.text, images: original.images } : message;
      }) };
    } catch { return state; } // History may not have been flushed yet.
  }
  dispatch(command, requestId) {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('Session is not connected. Resume a saved session first.');
    if (command.images?.length && !this.state.supportsImages) throw new Error('Restart this Pi terminal to enable image uploads.');
    const responseId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(responseId); reject(new Error('Pi acknowledgement timed out; delivery may have occurred'));
      }, 30000);
      this.pending.set(responseId, { resolve, reject, timer });
      send(this.socket, { type: 'command', id: responseId, sessionId: this.state.id, requestId, command });
    });
  }
  result(response) {
    const request = this.pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer); this.pending.delete(response.id);
    if (response.ok) request.resolve(response.value); else request.reject(new Error(response.error || 'Pi rejected command'));
  }
  rejectPending(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  disconnected() {
    if (!this.socket) return;
    this.socket = undefined; this.state.status = 'disconnected'; this.notify();
    this.rejectPending(new Error('Pi disconnected; delivery outcome may be unknown'));
  }
  close() {
    this.socket?.close(); this.rejectPending(new Error('Service stopped'));
  }
}
