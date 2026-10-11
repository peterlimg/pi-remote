import { diffState } from '../web/protocol.js';
import { randomUUID } from 'node:crypto';
import { validateImages, MAX_IMAGES, MAX_IMAGE_BYTES } from '../web/images.js';
import { parseObject, send, protectSocket } from './config.mjs';

// Scrolling phones keep the top `limit` rows. They get only rows that changed since the
// last send, so a live update costs one row however far the list was scrolled.
export function sessionWindow(service) {
  let view;
  const changes = () => {
    const { matches, total } = service.matches(view.query);
    const rows = matches.slice(0, view.limit), changed = [];
    for (const row of rows) {
      const json = JSON.stringify(row);
      if (view.sent.get(row.id) !== json) { view.sent.set(row.id, json); changed.push(row); }
    }
    const keep = new Set(rows.map(row => row.id)), removed = [...view.sent.keys()].filter(id => !keep.has(id));
    for (const id of removed) view.sent.delete(id);
    const meta = { total, matched: matches.length, limit: view.limit, query: view.query, warnings: service.warnings, allowResume: service.allowResume };
    const unchanged = !changed.length && !removed.length && JSON.stringify(meta) === view.meta;
    view.meta = JSON.stringify(meta);
    return { changes: changed, removed, ...meta, unchanged };
  };
  return {
    get active() { return view !== undefined; },
    request({ limit, query = '' }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || typeof query !== 'string' || query.length > 500) throw new Error('Invalid session page');
      const reset = view?.query !== query;
      if (reset) view = { query, sent: new Map() };
      view.limit = limit;
      const { unchanged, ...value } = changes();
      return { reset, ...value };
    },
    // Undefined when the phone already has everything.
    update() { const { unchanged, ...value } = changes(); return unchanged ? undefined : value; }
  };
}

export function attachClient(socket, service) {
  let selected, previous;
  let version = 0, listOptions = {};
  const list = options => {
    const page = service.list(options);
    listOptions = { offset: page.offset, query: page.query };
    return page;
  };
  const scroll = sessionWindow(service);
  let busy = 0, closed = false, listTimer, stateTimer;
  // Images staged before send live only as long as this socket; the phone falls back to inline data.
  const uploads = new Map();
  let uploadBytes = 0;
  const onList = () => {
    if (!listTimer) listTimer = setTimeout(() => {
      listTimer = undefined;
      if (closed) return;
      if (!scroll.active) { send(socket, { type: 'sessions', ...list(listOptions) }); return; }
      const update = scroll.update();
      if (update) send(socket, { type: 'sessions', ...update });
    }, 150);
  };
  const onState = id => {
    if (selected === id && !stateTimer) stateTimer = setTimeout(() => {
      stateTimer = undefined;
      if (closed || !selected) return;
      try {
        const state = service.read(selected);
        if (previous) send(socket, { type: 'patch', sessionId: selected, version: ++version, patch: diffState(previous, state) });
        else send(socket, { type: 'snapshot', sessionId: selected, version: ++version, state });
        previous = structuredClone(state);
      }
      catch (e) { send(socket, { type: 'notice', error: e.message }); }
    }, 100);
  };
  service.on('list', onList); service.on('state', onState);
  protectSocket(socket);
  send(socket, { type: 'ready', supportsImages: true, supportsCommandResults: true, supportsUploads: true }); send(socket, { type: 'sessions', ...list(listOptions) });
  socket.on('message', async raw => {
    let message;
    try {
      message = parseObject(raw);
      if (busy >= 8) throw new Error('Too many outstanding requests');
      busy++;
      try {
        let value;
        if (message.op === 'ping') value = { pong: true };
        else if (message.op === 'list') value = message.limit === undefined ? list(message) : scroll.request(message);
        else if (message.op === 'watch') {
          const state = service.read(message.sessionId);
          selected = message.sessionId; version = 0; previous = structuredClone(state);
          send(socket, { type: 'snapshot', sessionId: selected, version, state }); value = { watching: selected };
        } else if (message.op === 'image') {
          value = service.getImage(message.sessionId, message.imageId);
        } else if (message.op === 'upload') {
          const [image] = validateImages([message.image]);
          // ponytail: removed drafts stay staged until the socket closes; the cap bounds that leak.
          if (uploads.size >= MAX_IMAGES * 2 || uploadBytes + image.data.length > MAX_IMAGE_BYTES * 3) throw new Error('Too many staged images');
          const uploadId = randomUUID();
          uploads.set(uploadId, image); uploadBytes += image.data.length;
          value = { uploadId };
        } else if (message.op === 'models') {
          value = await service.getModels(message.sessionId);
        } else if (message.op === 'commands') {
          value = await service.getCommands(message.sessionId);
        } else if (message.op === 'commandResult') {
          value = await service.journal.result(message.sessionId, message.requestId);
        } else if (message.op === 'command') {
          const images = message.command?.images?.map?.(image => {
            if (typeof image?.uploadId !== 'string') return image;
            const staged = uploads.get(image.uploadId);
            if (!staged) throw new Error('Image upload expired. Attach it again.');
            return staged;
          });
          value = await service.command(message.sessionId, message.id, images ? { ...message.command, images } : message.command);
          for (const image of message.command?.images || []) {
            const staged = uploads.get(image?.uploadId);
            if (staged) { uploads.delete(image.uploadId); uploadBytes -= staged.data.length; }
          }
        } else if (message.op === 'new') {
          value = await service.newSession(message.sessionId, message.id);
        } else if (message.op === 'resume') {
          value = await service.resume(message.sessionId, message.id);
        } else if (message.op === 'answer') {
          value = await service.answer(message.sessionId, message.id, message.answer);
        } else throw new Error('Unsupported operation');
        send(socket, { type: 'response', id: message.id, ok: true, value });
      } finally { busy--; }
    } catch (e) { send(socket, { type: 'response', id: message?.id, ok: false, error: e.message }); }
  });
  socket.once('close', () => {
    closed = true; clearTimeout(listTimer); clearTimeout(stateTimer);
    service.off('list', onList); service.off('state', onState);
  });
}
