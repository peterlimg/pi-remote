import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialState, applyEvent, refreshStatus, restoreActivity } from './state.mjs';
import { lastPromptTime } from './catalog.mjs';
import { sessionTitle } from './session-title.mjs';
import { acquireSessionLock } from './locks.mjs';
import { RpcWorker } from './rpc.mjs';
import { send } from './config.mjs';
import { createSessionLifecycle } from './session-lifecycle.mjs';

class LiveSession {
  constructor(state, changed) { this.state = state; this.onChange = changed; }
  notify() { refreshStatus(this.state, this); if (this.state.id) this.onChange(this.state.id); }
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
  constructor(meta, { dir, workerOptions, changed, started, lifecycle, exited }) {
    super(initialState(meta, meta.messages), changed);
    this.lifecycle = createSessionLifecycle(); this.onLifecycle = lifecycle; this.onExit = exited; this.onStart = started;
    this.lockDir = join(dir, 'locks'); this.workerOptions = workerOptions;
  }
  async start(identify) {
    const open = () => {
      this.worker = new RpcWorker(this.state.file, this.state.cwd, this.workerOptions);
      this.track();
    };
    try {
      let info;
      // Fresh workers choose their file at handshake; resumed files must be locked before spawning.
      if (!this.state.file) {
        open(); info = await this.inspect();
        Object.assign(this.state, identify(info));
      }
      this.lock = acquireSessionLock(this.lockDir, this.state.id, { file: this.state.file, kind: 'rpc' });
      if (!this.worker) open();
      if (this.worker.process.pid) this.lock.setWorkerPid(this.worker.process.pid);
      this.onStart(this); this.notify();
      return info ?? await this.inspect();
    } catch (error) { await this.close(); throw error; }
  }
  get resumable() { return !this.worker; }
  get managed() {
    if (!this.worker) return undefined;
    const snapshot = this.lifecycle.snapshot, requests = this.worker.pending.size;
    return { id: this.state.id, ...snapshot, requests, restartSafe: snapshot.restartSafe && !requests };
  }
  advance(event) {
    const before = this.lifecycle.snapshot, after = this.lifecycle.send(event);
    if (this.state.id && JSON.stringify(before) !== JSON.stringify(after)) {
      this.onLifecycle({ id: this.state.id, event: event.type, from: before.phase, to: after.phase,
        pendingTools: after.pendingTools, waitFor: after.waitFor, blocked: after.blocked, restartSafe: after.restartSafe });
    }
    return after;
  }
  track() {
    const { worker } = this;
    worker.on('event', event => {
      this.advance(event);
      if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) this.state.dialog = event;
      applyEvent(this.state, event);
      this.notify();
    });
    worker.on('fault', error => { this.state.error = error.message; this.notify(); });
    worker.once('exit', () => {
      this.advance({ type: 'worker_exit' });
      this.lock?.release(); this.worker = undefined; this.state.dialog = undefined; this.state.compacting = false;
      this.state.retrying = false; this.state.pendingReply = undefined;
      if (this.state.id) this.onExit(this);
      this.notify();
    });
  }
  inspect() { return this.worker.request('get_state'); }
  restoreState(info, history) {
    if (history) { this.state.messages = history.messages; this.state.historyTruncated = history.historyTruncated; }
    this.state.model = info?.model ? `${info.model.provider}/${info.model.id}` : undefined;
    this.state.modelName = info?.model?.name;
    this.state.thinkingLevel = info?.thinkingLevel;
    restoreActivity(this.state, info);
    this.advance({ type: 'restore', provider: info?.model?.provider, streaming: !!info?.isStreaming || !!info?.isCompacting });
    delete this.state.error;
  }
  restore(info, history) { this.restoreState(info, history); this.notify(); }
  async dispatch(command) {
    const worker = this.worker;
    if (this.handingOff) throw new Error('This session is moving to a Pi terminal. Try again shortly.');
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
    this.state.dialog = undefined; this.notify();
    return { accepted: true };
  }
  async handoff() {
    if (this.handingOff || !this.managed?.restartSafe) throw Object.assign(new Error('This session is still working or saving a checkpoint. Wait for it to finish, then /reload or resume it again.'), { code: 'EHANDOFF' });
    // Refuse new phone commands between the idle check and the worker's exit.
    this.handingOff = true;
    try { await this.close(); } finally { this.handingOff = false; }
  }
  async close() { try { await this.worker?.close(); } finally { this.lock?.release(); } }
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
    // Already-running terminals can omit image references and custom-message metadata.
    const missing = message => !message.images && message.text?.includes('[image]') || message.role === 'custom' && !message.customType;
    if (!state.messages?.some(missing)) return state;
    try {
      const saved = readSaved();
      if (!saved) return state;
      return { ...state, messages: state.messages.map(message => {
        if (!missing(message)) return message;
        const original = saved.messages.find(item => item.id === message.id || (message.timestamp !== undefined &&
          item.timestamp === message.timestamp && item.role === message.role && item.toolCallId === message.toolCallId));
        if (original?.images && !message.images) message = { ...message, text: original.text, images: original.images };
        if (original?.customType && !message.customType) message = { ...message, customType: original.customType, activityLabel: original.activityLabel };
        return message;
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
    this.socket = undefined; this.notify();
    this.rejectPending(new Error('Pi disconnected; delivery outcome may be unknown'));
  }
  close() {
    this.socket?.close(); this.rejectPending(new Error('Service stopped'));
  }
}
