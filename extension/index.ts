import WebSocket from 'ws';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, dataDir, send, parseObject } from '../src/config.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { cleanMessage } from '../src/catalog.mjs';
import { initialState, applyEvent } from '../src/state.mjs';
import { CommandJournal, validateCommand } from '../src/commands.mjs';

// Structural typing keeps the bridge usable with Pi packages before/after the namespace rename.
// All Pi interaction is through its documented ExtensionAPI / ExtensionContext methods.
export default function remoteExtension(pi: any) {
  if (process.env.PI_REMOTE_WORKER === '1') return;
  let ctx: any, socket: any, state: any, lock: any;
  let retry: any, flush: any, generation = 0, stopped = true, enabled = false;
  let journal: any;
  const instanceId = randomUUID();
  const resetHistory = () => {
    if (!state || !ctx) return;
    const entries = ctx.sessionManager.getBranch().filter((x: any) => x.type === 'message');
    state.messages = entries.slice(-100).map((x: any) => cleanMessage(x.message,
      x.message.role + ':' + (x.message.timestamp ?? x.id) + ':' + (x.message.toolCallId || '')));
    state.historyTruncated = entries.length > 100; state.revision++;
  };
  const publish = () => {
    if (!state || !enabled || stopped) return;
    clearTimeout(flush);
    flush = setTimeout(() => send(socket || {}, { type: 'snapshot', state }), 80);
  };
  const connect = (epoch: number) => {
    if (stopped || !enabled || generation !== epoch) return;
    const config = loadConfig();
    const ws = new WebSocket('ws://127.0.0.1:' + config.port + '/bridge', { maxPayload: 1024 * 1024 });
    socket = ws;
    ws.on('open', () => {
      if (generation !== epoch || stopped) { ws.close(); return; }
      send(ws, { type: 'auth', token: config.bridgeToken, instanceId });
      send(ws, { type: 'register', state, owner: lock.owner });
    });
    ws.on('message', async (raw: any) => {
      try {
        const message = parseObject(raw);
        if (message.type !== 'command') return;
        if (stopped || generation !== epoch || message.sessionId !== state.id) throw new Error('Session changed');
        const command = validateCommand(message.command);
        const result = await journal.execute(state.id, message.requestId, command, async () => {
          if (stopped || generation !== epoch) throw new Error('Session changed');
          if (command.type === 'abort') {
            // ExtensionContext has no queue-clearing API. Abort only the current operation.
            ctx.abort();
          } else pi.sendUserMessage(command.text, { deliverAs: command.type === 'followUp' ? 'followUp' : 'steer' });
          return { accepted: true };
        });
        send(ws, { type: 'result', id: message.id, ...result });
      } catch (error: any) {
        try { const m = parseObject(raw); send(ws, { type: 'result', id: m.id, ok: false, error: error.message }); } catch {}
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (!stopped && enabled && generation === epoch) retry = setTimeout(() => connect(epoch), 2000);
    });
  };
  const cleanup = () => {
    stopped = true; enabled = false; generation++;
    clearTimeout(retry); clearTimeout(flush);
    if (socket) { socket.removeAllListeners('close'); socket.close(); socket = undefined; }
    if (lock) { lock.release(); lock = undefined; }
    state = undefined;
  };
  pi.on('session_start', async (_event: any, context: any) => {
    cleanup(); ctx = context; stopped = false;
    const file = ctx.sessionManager.getSessionFile();
    if (!file) {
      ctx.ui.notify('Pi Remote requires a saved session. Send a first message, then /reload.', 'info');
      return;
    }
    try {
      const id = sessionKey(file);
      lock = acquireLock(join(dataDir(), 'locks'), id, { file, instanceId });
      journal = new CommandJournal(join(dataDir(), 'extension-commands'));
      state = initialState({ id, file, piSessionId: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd, title: pi.getSessionName?.() || 'Pi · ' + ctx.cwd.split('/').pop(), instanceId });
      resetHistory(); enabled = true; connect(generation);
      ctx.ui.setStatus('pi-remote', 'remote enabled');
    } catch (error: any) {
      ctx.ui.notify('Pi Remote: ' + error.message, 'error');
    }
  });
  pi.on('session_shutdown', cleanup);
  pi.on('input', (_event: any, context: any) => {
    if (!stopped && state === undefined && !lock && context.sessionManager.getSessionFile()) {
      context.ui.notify('Remote ownership could not be established. Resolve the lock and /reload.', 'error');
      return { action: 'handled' };
    }
  });
  for (const name of ['agent_start', 'agent_end', 'message_start', 'message_update', 'message_end',
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end']) {
    pi.on(name, (event: any) => { if (state) { applyEvent(state, event); publish(); } });
  }
  for (const name of ['session_compact', 'session_tree']) {
    pi.on(name, () => { resetHistory(); publish(); });
  }
  pi.registerCommand('remote', {
    description: 'Show or disable mobile control: /remote [off|on]',
    handler: async (args: string, context: any) => {
      if (args.trim() === 'off') {
        enabled = false; clearTimeout(retry); clearTimeout(flush); socket?.close();
        context.ui.setStatus('pi-remote', 'remote off');
        context.ui.notify('Remote control disabled; local session ownership retained.', 'info');
      } else if (args.trim() === 'on') {
        if (!state || !lock) throw new Error('Resolve session ownership and /reload first');
        if (!enabled) { enabled = true; connect(generation); }
        context.ui.setStatus('pi-remote', 'remote enabled');
      } else {
        context.ui.notify('Run pi-remote pair in another terminal for the phone login URL. /remote off disables this session.', 'info');
      }
    }
  });
}
