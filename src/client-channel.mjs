import { diffState } from '../web/protocol.js';
import { parseObject, send, protectSocket } from './config.mjs';

export function attachClient(socket, service) {
  let selected, previous;
  let version = 0, listOptions = {};
  const list = options => {
    const page = service.list(options);
    listOptions = { offset: page.offset, query: page.query };
    return page;
  };
  let busy = 0, closed = false, listTimer, stateTimer;
  const onList = () => {
    if (!listTimer) listTimer = setTimeout(() => { listTimer = undefined; if (!closed) send(socket, { type: 'sessions', ...list(listOptions) }); }, 150);
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
  send(socket, { type: 'ready', supportsImages: true, supportsCommandResults: true }); send(socket, { type: 'sessions', ...list(listOptions) });
  socket.on('message', async raw => {
    let message;
    try {
      message = parseObject(raw);
      if (busy >= 8) throw new Error('Too many outstanding requests');
      busy++;
      try {
        let value;
        if (message.op === 'ping') value = { pong: true };
        else if (message.op === 'list') value = list(message);
        else if (message.op === 'watch') {
          const state = service.read(message.sessionId);
          selected = message.sessionId; version = 0; previous = structuredClone(state);
          send(socket, { type: 'snapshot', sessionId: selected, version, state }); value = { watching: selected };
        } else if (message.op === 'models') {
          value = await service.getModels(message.sessionId);
        } else if (message.op === 'commands') {
          value = await service.getCommands(message.sessionId);
        } else if (message.op === 'commandResult') {
          value = await service.journal.result(message.sessionId, message.requestId);
        } else if (message.op === 'command') {
          value = await service.command(message.sessionId, message.id, message.command);
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
