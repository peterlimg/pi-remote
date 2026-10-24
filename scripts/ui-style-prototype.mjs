// Throwaway UI preview: real browser assets and encryption, synthetic sessions, no Pi or filesystem mutations.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { serveStatic } from '../src/http.mjs';
import { acceptSealed } from '../src/e2e.mjs';
import { parseObject, send } from '../src/config.mjs';
import { sessionGroup, activityOrder } from '../web/protocol.js';
import { demoToken, demoKey, models, demoSessions } from '../web/ui-style-prototype-data.js';

const port = Number(process.env.PORT || 8861);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port');
const server = createServer((req, res) => {
  try { serveStatic(req, res); }
  catch { res.writeHead(500); res.end('Preview asset unavailable'); }
});
const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
sockets.on('connection', ws => {
  const timer = setTimeout(() => ws.close(1008, 'Preview authentication required'), 5000);
  ws.once('close', () => clearTimeout(timer));
  ws.once('message', raw => {
    clearTimeout(timer);
    let auth;
    try { auth = parseObject(raw); } catch { ws.close(1008, 'Invalid authentication'); return; }
    if (auth.type !== 'auth' || auth.token !== demoToken || auth.e2e !== true) {
      ws.close(1008, 'Invalid authentication'); return;
    }
    acceptSealed(ws, demoKey, attach);
  });
});
function attach(socket) {
  const sessions = demoSessions();
  let watched, version = 0, lastList = { section: 'overview', query: '', limit: 20 };
  const snapshot = state => send(socket, { type: 'snapshot', sessionId: state.id, version: ++version, state });
  function list(request = lastList) {
    lastList = request;
    const query = typeof request.query === 'string' ? request.query.toLowerCase().slice(0, 500) : '';
    const section = ['now', 'pinned'].includes(request.section) ? request.section : 'overview';
    const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(100, request.limit)) : 20;
    const matches = sessions.filter(item => (!item.closed || query) && [item.title, item.cwd, item.preview].join(' ').toLowerCase().includes(query));
    const groups = Object.fromEntries(['now', 'pinned', 'recent'].map(group => [group, matches.filter(item => sessionGroup(item) === group).length]));
    const rows = section !== 'overview' ? matches.filter(item => sessionGroup(item) === section).sort(activityOrder).slice(0, limit)
      : query ? matches.slice(0, limit) : ['now', 'pinned', 'recent'].flatMap(group => matches.filter(item => sessionGroup(item) === group).sort(activityOrder).slice(0, group === 'recent' ? limit : 3));
    return { sessions: rows, total: sessions.length, matched: section === 'overview' ? matches.length : groups[section], loaded: rows.length, query, section, groups };
  }
  const pushList = () => send(socket, { type: 'sessions', ...list() });
  send(socket, { type: 'ready', supportsSessionSections: true, supportsSessionClosing: true, supportsUsage: true });
  socket.on('message', raw => {
    let packet;
    try { packet = parseObject(raw); } catch { socket.close(1008, 'Invalid preview request'); return; }
    const reply = value => send(socket, { type: 'response', id: packet.id, ok: true, value });
    const fail = error => send(socket, { type: 'response', id: packet.id, ok: false, error });
    const state = sessions.find(item => item.id === packet.sessionId);
    if (packet.op === 'ping') reply({});
    else if (packet.op === 'list') reply(list(packet));
    else if (packet.op === 'projects') reply([...new Map(sessions.map(item => [item.cwd, { cwd: item.cwd, sessionId: item.id }])).values()]);
    else if (packet.op === 'new' || packet.op === 'newProject') {
      const created = { ...demoSessions()[0], id: 'sample-' + sessions.length, title: 'New sample session', status: 'idle',
        cwd: state?.cwd || '/sample/projects/pi-remote', messages: [{ id: 'welcome', role: 'assistant', text: 'This sample session exists only in memory. No Pi process, model call, or project folder was created.' }] };
      sessions.unshift(created); reply({ sessionId: created.id, state: created }); pushList();
    } else if (!state) fail('Sample session not found. Refresh the preview to reset it.');
    else if (packet.op === 'watch') { watched = state.id; snapshot(state); reply({}); }
    else if (packet.op === 'commands') reply([
      { name: 'model', description: 'Choose a sample model', source: 'remote' },
      { name: 'thinking', description: 'Choose reasoning effort', source: 'remote' },
      { name: 'usage', description: 'View sample context usage', source: 'remote' },
      { name: 'new', description: 'Open an in-memory sample session', source: 'remote' }
    ]);
    else if (packet.op === 'models') reply({ current: state.model, models });
    else if (packet.op === 'usage') reply({ contextUsage: state.contextUsage });
    else if (packet.op === 'pin') { state.pinned = packet.pinned === true; reply({ pinned: state.pinned }); pushList(); }
    else if (packet.op === 'closeSession') { state.closed = packet.closed === true; reply({ closed: state.closed }); pushList(); }
    else if (packet.op === 'command') {
      const command = packet.command;
      if (command?.type === 'setModel') {
        const model = models.find(item => item.provider === command.provider && item.id === command.modelId);
        if (!model) { fail('Choose a model from the sample list.'); return; }
        state.model = model.provider + '/' + model.id; state.modelName = model.name;
      } else if (command?.type === 'setThinkingLevel' && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(command.level)) state.thinkingLevel = command.level;
      else if (command?.type === 'abort') state.status = 'idle';
      else if (command?.type === 'prompt' && typeof command.text === 'string' && command.text.trim() && command.text.length <= 4000) {
        state.messages.push({ id: 'sample-user-' + version, role: 'user', text: command.text },
          { id: 'sample-reply-' + version, role: 'assistant', text: 'Sample reply only. This preview does not run Pi, call a model, or change files. Your message stays in this browser connection until you refresh.' });
        state.status = 'idle';
      } else { fail('This action is not part of the visual preview.'); return; }
      if (watched === state.id) snapshot(state);
      reply({ model: state.model, thinkingLevel: state.thinkingLevel }); pushList();
    } else fail('This action is not part of the visual preview.');
  });
}
server.listen(port, '127.0.0.1', () => console.log('Design preview: http://127.0.0.1:' + server.address().port));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  for (const ws of sockets.clients) ws.terminate();
  server.close(() => process.exit(0));
});
