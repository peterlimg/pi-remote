import { diffState } from '../web/protocol.js';
import { parseObject, send, protectSocket } from './config.mjs';

export function attachClient(socket, service) {
  let selected, previous;
  let version = 0;
  let busy = 0, closed = false, listTimer, stateTimer;
  const onList = () => {
    if (!listTimer) listTimer = setTimeout(() => { listTimer = undefined; if (!closed) send(socket, { type: 'sessions', ...service.list() }); }, 150);
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
  send(socket, { type: 'ready' }); send(socket, { type: 'sessions', ...service.list() });
  socket.on('message', async raw => {
    let message;
    try {
      message = parseObject(raw);
      if (busy >= 8) throw new Error('Too many outstanding requests');
      busy++;
      try {
        let value;
        if (message.op === 'list') value = service.list();
        else if (message.op === 'watch') {
          const state = service.read(message.sessionId);
          selected = message.sessionId; version = 0; previous = structuredClone(state);
          send(socket, { type: 'snapshot', sessionId: selected, version, state }); value = { watching: selected };
        } else if (message.op === 'commands') {
          value = await service.getCommands(message.sessionId);
        } else if (message.op === 'command') {
          value = await service.command(message.sessionId, message.id, message.command);
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
