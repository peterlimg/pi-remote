import { EventEmitter } from 'node:events';
import { readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { discover, isInside, readSession, lastPromptTime } from './catalog.mjs';
import { summary } from './state.mjs';
import { unnamed } from '../web/protocol.js';
import { sessionKey, canonical } from './locks.mjs';
import { CommandJournal, requestKey, validateCommand, commandList, modelList } from './commands.mjs';
import { HistoryReader } from './history.mjs';
import { WorkerSession, BridgeSession } from './live-session.mjs';

function inside(file, dir) {
  const rel = relative(canonical(dir), canonical(file));
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function isHelperSession(state) {
  // Children can have readable names, but keep their generated run directory.
  return /[\\/][a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}[\\/]run-\d+[\\/]session\.jsonl$/i.test(state.file || '') ||
    /^subagent-.+-[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}(?:-\d+)?$/i.test(state.title || '');
}

export class SessionService extends EventEmitter {
  constructor({ dir, roots, workerOptions = {}, allowResume = true }) {
    super(); this.dir = dir; this.roots = roots; this.workerOptions = workerOptions; this.allowResume = allowResume;
    this.live = new Map(); this.catalog = new Map(); this.warnings = []; this.bridges = new WeakMap(); this.starting = new Set();
    this.restoreWarnings = []; this.restoring = new Set();
    this.journal = new CommandJournal(join(dir, 'commands'));
    this.historyReader = new HistoryReader();
    // Sessions started without a project each get a folder here; the phone hides these folders' names.
    mkdirSync(join(dir, 'projects'), { recursive: true, mode: 0o700 }); this.blankDir = canonical(join(dir, 'projects'));
    // Scratch sessions in system temp folders are not projects worth offering for a new session.
    this.tempDirs = [...new Set([tmpdir(), '/tmp'].map(canonical))];
    // Pinned sessions sort first for every phone; ids of deleted sessions just never match.
    try { this.pins = new Set(JSON.parse(readFileSync(join(dir, 'pinned-sessions.json'), 'utf8')).filter(id => typeof id === 'string')); }
    catch { this.pins = new Set(); }
    this.scan();
    this.setMaxListeners(50);
    this.timer = setInterval(() => this.scan(), 15000); this.timer.unref();
  }
  scan() {
    const previous = this.catalog, { sessions, warnings } = discover(this.roots);
    this.catalog = sessions; this.warnings = [...this.restoreWarnings, ...warnings].slice(0, 20);
    for (const [id, saved] of sessions) {
      if (!saved.historyPending || saved.lastPromptAt !== undefined) continue;
      // Large previews are incomplete; keep known metadata until full indexing completes.
      saved.lastPromptAt = previous.get(id)?.lastPromptAt ?? 0;
      saved.title = previous.get(id)?.title ?? saved.title;
      const liveTitle = this.live.get(id)?.state.title;
      this.historyReader.request('metadata', { file: saved.file }).then(value => {
        saved.lastPromptAt = value.lastPromptAt;
        if (!unnamed(value.title)) saved.title = value.title;
        if (this.catalog.get(id) !== saved) return;
        const item = this.live.get(id);
        if (item && !unnamed(saved.title) && (item.state.title === liveTitle || unnamed(item.state.title))) item.syncTitle(saved.title);
        this.emit('list');
      }, error => {
        if (this.stopping) return;
        this.warnings = [...this.warnings, 'Could not read session metadata: ' + error.message].slice(0, 20);
        this.emit('list');
      });
    }
    for (const [id, item] of this.live) {
      const saved = sessions.get(id);
      if (saved && !saved.historyPending) item.syncTitle(saved.title);
    }
    this.emit('list');
  }
  async restore() {
    try {
      const ids = JSON.parse(readFileSync(join(this.dir, 'resume-sessions.json'), 'utf8'));
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid session restore list');
      this.restoreLoaded = true; this.restoring = new Set(ids);
      // Cold Pi startups are expensive; do not launch the whole restore list at once.
      for (const id of this.restoring) {
        if (this.stopping) break;
        try { await this.startWorker(id); }
        catch (error) { this.restoreWarnings.push(`Could not restore ${id}: ${error.message}`); }
        finally { this.restoring.delete(id); }
      }
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
  // Helpers stay searchable; only the default browsing list hides them.
  matches(query = '', includeHelpers = false) {
    if (typeof query !== 'string' || query.length > 500) throw new Error('Invalid session page');
    query = query.trim().toLowerCase();
    const all = new Map([...this.catalog].map(([id, state]) => [id, { ...summary(state), resumable: this.allowResume, pinned: this.pins.has(id) }]));
    for (const [id, item] of this.live) all.set(id, { ...summary(item.state), resumable: this.allowResume && item.resumable, pinned: this.pins.has(id) });
    const visible = [...all.values()].filter(item => includeHelpers || query || !isHelperSession(this.live.get(item.id)?.state || this.catalog.get(item.id)));
    const matches = visible.filter(item => [item.title, item.cwd, item.preview].join(' ').toLowerCase().includes(query))
      .sort((a, b) => b.pinned - a.pinned || b.lastPromptAt - a.lastPromptAt || a.id.localeCompare(b.id));
    return { matches, total: visible.length };
  }
  pin(id, pinned) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || typeof pinned !== 'boolean') throw new Error('Invalid pin');
    if (pinned) this.pins.add(id); else this.pins.delete(id);
    const file = join(this.dir, 'pinned-sessions.json');
    writeFileSync(file + '.tmp', JSON.stringify([...this.pins]), { mode: 0o600 });
    renameSync(file + '.tmp', file);
    this.emit('list');
    return { pinned };
  }
  // Projects in most-recently-used order. Each names its newest session as the source for `new`.
  projects() {
    const projects = new Map();
    for (const item of this.matches('', true).matches) {
      if (projects.has(item.cwd) || this.tempDirs.some(dir => inside(item.cwd, dir))) continue;
      projects.set(item.cwd, { cwd: item.cwd, sessionId: item.id });
    }
    return [...projects.values()];
  }
  read(id) {
    const item = this.live.get(id);
    if (item) return item.read(() => {
      const { file } = item.state;
      if (!isInside(file, this.roots)) return undefined;
      let saved = this.catalog.get(id);
      if (saved?.updatedAt !== statSync(file).mtimeMs) {
        saved = readSession(file); this.catalog.set(id, saved);
      }
      return saved;
    });
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
      lastPromptAt: page.lastPromptAt, thinkingLevel: page.thinkingLevel, historyTruncated: page.older };
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
    const bridge = this.bridges.get(socket);
    if (current && !current.resumable && current !== bridge) throw new Error('Session already connected');
    const lastPromptAt = state.lastPromptAt ?? lastPromptTime(state.messages,
      current?.state.lastPromptAt ?? this.catalog.get(state.id)?.lastPromptAt ?? state.updatedAt);
    const item = bridge || new BridgeSession({ ...state, lastPromptAt }, socket, owner, id => this.changed(id));
    this.live.set(state.id, item); this.bridges.set(socket, item);
    socket.sessionId = state.id;
    item.snapshot({ ...state, lastPromptAt }, owner);
  }
  snapshot(socket, state) {
    if (socket.sessionId !== state?.id) throw new Error('Wrong session snapshot');
    const item = this.bridges.get(socket);
    if (!item || this.live.get(state.id) !== item) throw new Error('Session owner changed');
    item.snapshot(state);
  }
  disconnected(socket) {
    this.bridges.get(socket)?.disconnected(); this.bridges.delete(socket);
  }
  result(socket, response) { this.bridges.get(socket)?.result(response); }
  changed(id) { this.emit('state', id); this.emit('list'); }
  async command(id, requestId, input) {
    const command = validateCommand(input);
    return this.journal.execute(id, requestId, command, () => this.dispatch(id, requestId, command));
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
      item.update({ contextUsage: result.contextUsage });
    }
    return { ...result, model };
  }
  async dispatch(id, requestId, command) {
    if (this.stopping) throw new Error('Pi Remote is stopping');
    const item = this.live.get(id);
    if (!item) throw new Error('Session is not connected. Resume a saved session first.');
    return item.command(command, requestId);
  }
  get managedSessions() {
    return [...this.live.values()].map(item => item.managed).filter(Boolean);
  }
  get busyWorkers() {
    const busy = new Set(this.restoring);
    for (const item of this.managedSessions) if (!item.restartSafe) busy.add(item.id);
    return this.starting.size + busy.size;
  }
  workerSession(meta, options, discardEmpty = false) {
    return new WorkerSession(meta, {
      dir: this.dir, workerOptions: options, changed: id => this.changed(id), started: item => this.live.set(item.state.id, item),
      lifecycle: event => this.emit('lifecycle', event),
      exited: item => {
        const { id } = item.state;
        this.scan();
        if (discardEmpty && this.live.get(id) === item && !this.catalog.has(id)) this.live.delete(id);
      },
    });
  }
  async newSession(id, requestId) {
    requestKey(requestId);
    return this.journal.execute(id, requestId, { type: 'new' }, async () => {
      if (this.stopping) throw new Error('Pi Remote is stopping');
      const source = this.read(id);
      if (!this.roots.some(root => inside(source.file, root))) throw new Error('Session is outside configured roots');
      // A saved source starts a host-owned worker, the same as resuming it would.
      if (this.live.get(id)?.resumable ?? true) {
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
    const item = this.workerSession({ cwd }, { ...this.workerOptions, sessionDir }, true);
    this.starting.add(item);
    try {
      const info = await item.start(info => {
        if (this.stopping) throw new Error('Pi Remote is stopping');
        if (typeof info?.sessionFile !== 'string' || typeof info.sessionId !== 'string') throw new Error('Pi did not provide a new session');
        const file = canonical(info.sessionFile);
        if (!inside(file, sessionDir)) throw new Error('New session is outside configured roots');
        return { id: sessionKey(file), file, cwd, piSessionId: info.sessionId };
      });
      item.restore(info);
      return { sessionId: item.state.id };
    } catch (e) { await item.close(); throw e; }
    finally { this.starting.delete(item); }
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
    if (current && !current.resumable) return { attached: true };
    const saved = this.catalog.get(id);
    if (!saved || !isInside(saved.file, this.roots)) throw new Error('Saved session not found in configured roots');
    const actual = await this.view(id);
    if (this.stopping) throw new Error('Pi Remote is stopping');
    if (actual.id !== id || !statSync(actual.cwd).isDirectory()) throw new Error('Invalid saved session');
    const item = this.workerSession(actual, this.workerOptions);
    try {
      const rpcState = await item.start();
      // The saved branch already has image references; get_messages duplicates all base64 over RPC.
      let history = readSession(actual.file);
      if (history.historyPending) {
        const page = await this.history(id, {});
        history = { ...history, messages: page.messages, historyTruncated: page.older };
      }
      item.restore(rpcState, history);
      return { resumed: true };
    } catch (e) { await item.close(); throw e; }
  }
  async answer(id, requestId, answer) {
    return this.journal.execute(id, requestId, { type: 'answer', answer }, async () => {
      const item = this.live.get(id);
      if (!item) throw new Error('Dialog is no longer active');
      return item.answer(answer);
    });
  }
  async close() {
    if (this.stopping) return;
    clearInterval(this.timer);
    // Preserve live workers and unfinished restores, not historical failed attempts.
    // Terminal bridges reconnect themselves; saved sessions resume on demand.
    const ids = [...new Set([...this.restoring, ...this.managedSessions.map(item => item.id)])];
    if (this.restoreLoaded || this.live.size) {
      const file = join(this.dir, 'resume-sessions.json');
      writeFileSync(file + '.tmp', JSON.stringify(ids), { mode: 0o600 });
      renameSync(file + '.tmp', file);
    }
    this.stopping = true;
    await this.historyReader.close();
    const sessions = new Set([...this.live.values(), ...this.starting]);
    await Promise.all([...sessions].map(item => item.close()));
  }
}
