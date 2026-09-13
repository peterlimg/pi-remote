import WebSocket from 'ws';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, dataDir, send, parseObject, saveConnection, publicOrigin } from '../src/config.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { cleanMessage } from '../src/catalog.mjs';
import { initialState, applyEvent } from '../src/state.mjs';
import { CommandJournal, validateCommand, commandList } from '../src/commands.mjs';
import { ensureHost, stopHost, hostStatus } from '../src/control.mjs';
import { pairingUrl, pairingQr, pairingLines, mobileUrl } from '../src/pairing.mjs';

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
    if (flush) return;
    flush = setTimeout(() => { flush = undefined; if (state && enabled && !stopped) send(socket || {}, { type: 'snapshot', state }); }, 80);
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
        if (message.type === 'ready' && !stopped && enabled && generation === epoch) ctx.ui.setStatus('pi-remote', 'remote connected');
        if (message.type !== 'command') return;
        if (stopped || generation !== epoch || message.sessionId !== state.id) throw new Error('Session changed');
        if (message.command?.type === 'getCommands') {
          send(ws, { type: 'result', id: message.id, ok: true, value: { commands: commandList(pi.getCommands?.()) } });
          return;
        }
        const command = validateCommand(message.command);
        const result = await journal.execute(state.id, message.requestId, command, async () => {
          if (stopped || generation !== epoch) throw new Error('Session changed');
          if (command.type === 'abort') {
            // ExtensionContext has no queue-clearing API. Abort only the current operation.
            ctx.abort();
          } else pi.sendUserMessage(command.text, { deliverAs: command.type === 'followUp' ? 'followUp' : 'steer', expandPromptTemplates: true });
          return { accepted: true };
        });
        send(ws, { type: 'result', id: message.id, ...result });
      } catch (error: any) {
        try { const m = parseObject(raw); send(ws, { type: 'result', id: m.id, ok: false, error: error.message }); } catch {}
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (!stopped && enabled && generation === epoch) {
        ctx.ui.setStatus('pi-remote', 'remote disconnected');
        retry = setTimeout(() => connect(epoch), 2000);
      }
    });
  };
  const setChannel = (value: boolean, context: any) => {
    if (value && (!state || !lock)) throw new Error('Resolve session ownership and /reload first');
    generation++; enabled = value;
    clearTimeout(retry); clearTimeout(flush); flush = undefined;
    socket?.close(); socket = undefined;
    if (value) connect(generation);
    context.ui.setStatus('pi-remote', value ? 'remote connecting' : 'remote off');
  };
  const cleanup = () => {
    stopped = true; enabled = false; generation++;
    clearTimeout(retry); clearTimeout(flush); flush = undefined;
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
      ctx.ui.setStatus('pi-remote', 'remote connecting');
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
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'ui_prompt_start', 'ui_prompt_end', 'agent_settled']) {
    pi.on(name, (event: any) => { if (state) { applyEvent(state, event); publish(); } });
  }
  for (const name of ['session_compact', 'session_tree']) {
    pi.on(name, () => { resetHistory(); publish(); });
  }
  let controlling = false;
  const control = async (args: string, context: any) => {
    if (controlling) { context.ui.notify('Pi Remote is already opening. Close its screen first.', 'info'); return; }
    controlling = true;
    try {
      const action = args.trim();
      if (!['', 'start', 'stop', 'status', 'setup'].includes(action)) throw new Error('Usage: /pi-remote [start|stop|status|setup]');
      let config = loadConfig();
      let running = await hostStatus(config);
      if (action === 'status') {
        context.ui.notify(!running ? 'Pi Remote is stopped. /pi-remote starts it.' :
          'Pi Remote is ' + (running.closing ? 'stopping' : 'running') + ' at ' + running.publicUrl +
          (running.relayUrl ? (running.relayConnected ? '. Relay connected.' : '. Relay reconnecting; phone access is not ready.') : ''), 'info');
        return;
      }
      if (action === 'stop') {
        await stopHost(config);
        context.ui.notify('Pi Remote stopped for all sessions. Terminal agents keep running; saved-session workers stop.', 'info');
        return;
      }
      if (context.mode !== 'tui') throw new Error('Open /pi-remote in an interactive Pi terminal to set up and display the private QR.');
      if (!state || !lock) throw new Error('Resolve session ownership and /reload first');
      if (action === 'setup' || !mobileUrl(running?.publicUrl || config.publicUrl)) {
        if (running) throw new Error('Stop Pi Remote with /pi-remote stop before changing its phone address.');
        if (process.env.PI_REMOTE_PUBLIC_URL || process.env.PI_REMOTE_RELAY_URL !== undefined) {
          throw new Error('Phone address is set by PI_REMOTE_PUBLIC_URL / PI_REMOTE_RELAY_URL. Update those variables and restart Pi, or unset them to use saved setup.');
        }
        const value = await context.ui.input('Your relay HTTPS address (deploy your own relay first; see README)', 'https://remote.example.com');
        if (value === undefined) return;
        const origin = publicOrigin(value.trim());
        if (!mobileUrl(origin)) throw new Error('Your relay needs a non-local HTTPS address. Deploy your own relay first; see README.');
        if (!await context.ui.confirm('Relay credentials',
          'Your relay must use this computer\'s tokens from node bin/pi-remote.mjs relay-env. Is it configured?')) return;
        saveConnection(origin, true);
        config = loadConfig();
      }
      context.ui.notify(running ? 'Pi Remote is running. Opening login QR...' : 'Starting Pi Remote...', 'info');
      running = await ensureHost(config);
      if (!enabled) setChannel(true, context);
      if (running.relayUrl && !running.relayConnected) context.ui.notify('Relay connecting. A sleeping Render service may take about a minute. /pi-remote status checks it.', 'warning');
      const url = pairingUrl(config, running.publicUrl), code = pairingQr(url);
      // UI-only: never persist the bearer link in session entries or model context.
      await context.ui.custom((tui: any, _theme: any, keys: any, done: any) => ({
        render: (width: number) => pairingLines(url, code, width, tui.terminal.rows),
        invalidate() {},
        handleInput(data: string) {
          if (keys.matches(data, 'tui.select.confirm') || keys.matches(data, 'tui.select.cancel') || data === '\u0003') done();
        }
      }), { overlay: true, overlayOptions: { width: '100%', maxHeight: '100%', margin: 0 } });
    } catch (error: any) { context.ui.notify('Pi Remote: ' + error.message, 'error'); }
    finally { controlling = false; }
  };
  pi.registerCommand('pi-remote', {
    description: 'Start mobile control and show login QR: /pi-remote [stop|status|setup]',
    getArgumentCompletions: (prefix: string) => ['start', 'stop', 'status', 'setup']
      .filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: control
  });
  pi.registerCommand('remote', {
    description: 'Show or disable mobile control: /remote [off|on]',
    handler: async (args: string, context: any) => {
      if (args.trim() === 'off') {
        setChannel(false, context);
        context.ui.notify('Remote control disabled; local session ownership retained.', 'info');
      } else if (args.trim() === 'on') {
        if (!enabled) setChannel(true, context);
      } else {
        await control(args, context);
      }
    }
  });
}
