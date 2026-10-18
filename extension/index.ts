import WebSocket from 'ws';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, dataDir, send, parseObject, saveConnection } from '../src/config.mjs';
import { acquireSessionLock, sessionKey } from '../src/locks.mjs';
import { branchMessages, lastPromptTime, EXTENSION_INPUT } from '../src/catalog.mjs';
import { initialState, applyEvent, noteExtensionInput } from '../src/state.mjs';
import { sessionTitle, registerSessionTitles } from '../src/session-title.mjs';
import { CommandJournal, validateCommand, commandList, modelList } from '../src/commands.mjs';
import { ensureHost, stopHost, hostStatus } from '../src/control.mjs';
import { pairingUrl, pairingQr, pairingLines, mobileUrl } from '../src/pairing.mjs';
import { progressWidget, wakeHint, connectionScreen, opentunnelInstalled, installOpentunnel, openTunnel, deploymentScreen, checkRelay, progress, relayGone, fullScreen } from '../src/setup.mjs';

// Structural typing keeps the bridge usable with Pi packages before/after the namespace rename.
// All Pi interaction is through its documented ExtensionAPI / ExtensionContext methods.
export default function remoteExtension(pi: any) {
  let ctx: any, socket: any, state: any, lock: any;
  let retry: any, flush: any, generation = 0, stopped = true, enabled = false;
  let journal: any;
  const instanceId = randomUUID();
  let controlling = false;
  const resetHistory = () => {
    if (!state || !ctx) return;
    const messages = branchMessages(ctx.sessionManager.getBranch(), (x: any) => x.message.role + ':' + (x.message.timestamp ?? x.id) + ':' + (x.message.toolCallId || ''));
    const firstRequest = messages.find((x: any) => x.role === 'user');
    state.title = sessionTitle(pi.getSessionName?.(), firstRequest ? [firstRequest] : []);
    state.messages = messages.slice(-100);
    state.lastPromptAt = lastPromptTime(messages, state.lastPromptAt);
    state.historyTruncated = messages.length > 100;
    state.model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined; state.modelName = ctx.model?.name;
    state.thinkingLevel = pi.getThinkingLevel?.() ?? ctx.thinkingLevel;
    state.contextUsage = ctx.getContextUsage?.();
    state.revision++;
  };
  const publish = () => {
    if (!state || !enabled || stopped) return;
    state.title = pi.getSessionName?.() || state.title;
    if (flush) return;
    flush = setTimeout(() => {
      flush = undefined;
      if (state && enabled && !stopped) {
        state.contextUsage = ctx.getContextUsage?.();
        send(socket || {}, { type: 'snapshot', state });
      }
    }, 80);
  };
  registerSessionTitles(pi, (title: string) => {
    if (state) { state.title = title; state.revision++; publish(); }
  });
  // Only the input event tells an extension's prompt from the user's; record it for saved history.
  pi.on('input', (event: any, context: any) => {
    if (event.source !== 'extension') return;
    pi.appendEntry(EXTENSION_INPUT, { text: event.text });
    // A host worker has no bridge socket; RPC status updates are its channel to the host.
    if (process.env.PI_REMOTE_WORKER === '1') {
      context.ui.setStatus(EXTENSION_INPUT, event.text); context.ui.setStatus(EXTENSION_INPUT, undefined);
    } else if (state) noteExtensionInput(state, event.text);
  });
  pi.on('before_agent_start', (event: any, context: any) => {
    if (process.env.PI_REMOTE_WORKER !== '1' && !enabled) return;
    let guidance = [
      'The user is reading Pi Remote on a phone. For tasks needing tools, write one short, plain-language sentence in assistant text before the first tool call. Say what you will check or do.',
      'During multi-step work, write a brief result or next-step update every few tool calls and before long commands such as tests. Do not wait for all tool work to finish before writing to the user.',
      'Keep progress updates to one short sentence. Do not expose private reasoning, dump commands, invent progress, or claim success before verification.'
    ].join('\n');
    if (context.model?.provider === 'claude-sdk') {
      const branch = context.sessionManager.getBranch();
      const recorded = branch.map((entry: any) => entry.message).filter((message: any) => message?.role === 'system')
        .map((message: any) => (message.sections?.pi_remote_progress || (typeof message.content === 'string' ? message.content : ''))
          .match(/<pi_remote_progress>\n([\s\S]*?)\n<\/pi_remote_progress>/)?.[1]).findLast(Boolean);
      // SDK checkpoints freeze the prompt: retain recorded guidance and leave older conversations unchanged.
      if (recorded) guidance = recorded;
      else if (branch.some((entry: any) => entry.message?.role === 'assistant' && entry.message.provider === 'claude-sdk')) return;
    }
    if (event.systemPromptOptions?.sections && !event.systemPromptOptions.forceSystemPrompt) {
      event.systemPromptOptions.sections.pi_remote_progress = guidance;
    } else {
      // Older Pi versions do not support named prompt sections.
      return { systemPrompt: event.systemPrompt + '\n\n<pi_remote_progress>\n' + guidance + '\n</pi_remote_progress>' };
    }
  });
  if (process.env.PI_REMOTE_WORKER === '1') return;
  const connect = (epoch: number) => {
    if (stopped || !enabled || generation !== epoch) return;
    const config = loadConfig();
    const ws = new WebSocket('ws://127.0.0.1:' + config.port + '/bridge', { maxPayload: 4 * 1024 * 1024 });
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
        if (message.command?.type === 'getUsage') {
          send(ws, { type: 'result', id: message.id, ok: true, value: {
            contextUsage: ctx.getContextUsage?.(),
            providerMessage: 'Check /usage in the Pi terminal for account limits.'
          } });
          return;
        }
        if (message.command?.type === 'getModels') {
          send(ws, { type: 'result', id: message.id, ok: true, value: {
            models: modelList(ctx.modelRegistry.getAvailable()), current: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined
          } });
          return;
        }
        const command = validateCommand(message.command);
        const result = await journal.execute(state.id, message.requestId, command, async () => {
          if (stopped || generation !== epoch) throw new Error('Session changed');
          if (command.type === 'setModel') {
            const model = ctx.modelRegistry.getAvailable().find((item: any) => item.provider === command.provider && item.id === command.modelId);
            if (!model) throw new Error('Model is not available in this session');
            if (!await pi.setModel(model)) throw new Error('Model authentication is not configured');
            return { model: `${model.provider}/${model.id}`, modelName: model.name, thinkingLevel: pi.getThinkingLevel?.() };
          }
          if (command.type === 'setThinkingLevel') {
            if (!pi.setThinkingLevel || !pi.getThinkingLevel) throw new Error('Update Pi and reload this terminal to change reasoning effort.');
            pi.setThinkingLevel(command.level);
            state.thinkingLevel = pi.getThinkingLevel(); state.revision++; publish();
            return { thinkingLevel: state.thinkingLevel };
          }
          if (command.type === 'compact') {
            if (!ctx.compact) throw new Error('Update Pi and reload this terminal to compact remotely.');
            const current = state;
            ctx.compact({ customInstructions: command.customInstructions, onError: (error: any) => {
              if (state !== current) return;
              state.error = error.message; state.revision++; publish();
            } });
          } else if (command.type === 'abort') {
            // ExtensionContext has no queue-clearing API. Abort only the current operation.
            ctx.abort();
          } else pi.sendUserMessage(command.images?.length ? [...(command.text.trim() ? [{ type: 'text', text: command.text }] : []), ...command.images] : command.text,
            { deliverAs: command.type === 'followUp' ? 'followUp' : 'steer', expandPromptTemplates: true });
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
  // Render services created from the public repository URL never auto-deploy.
  const relayOutdated = 'Pi Remote: your relay runs an older version. Redeploy it: in Render, open the service and choose Manual Deploy > Deploy latest commit. On your own server, pull and restart it.';
  let outdatedShown = false;
  pi.on('session_start', async (_event: any, context: any) => {
    cleanup(); ctx = context; stopped = false;
    const file = ctx.sessionManager.getSessionFile();
    if (!file) {
      ctx.ui.notify('Pi Remote requires a saved session. Send a first message, then /reload.', 'info');
      return;
    }
    try {
      const id = sessionKey(file);
      lock = acquireSessionLock(join(dataDir(), 'locks'), id, { file, instanceId });
      journal = new CommandJournal(join(dataDir(), 'extension-commands'));
      state = initialState({ id, file, piSessionId: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd, title: pi.getSessionName?.() || 'Pi · ' + ctx.cwd.split('/').pop(), instanceId });
      state.supportsImages = true;
      resetHistory(); enabled = true; connect(generation);
      ctx.ui.setStatus('pi-remote', 'remote connecting');
      // Users who never open /pi-remote still learn that their relay needs a redeploy, once per Pi start.
      if (!outdatedShown) void hostStatus(loadConfig()).then(running => {
        if (running?.relayOutdated && !outdatedShown) { outdatedShown = true; context.ui.notify(relayOutdated, 'warning'); }
      }, () => {});
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
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'ui_prompt_start', 'ui_prompt_end', 'agent_settled',
    'model_select', 'thinking_level_select', 'session_before_compact', 'session_compact', 'session_compact_failed']) {
    pi.on(name, (event: any) => {
      // Pi Remote's own QR and setup screens ask nothing of the phone; don't flag them as needing input.
      if (!state || (controlling && event.type === 'ui_prompt_start')) return;
      applyEvent(state, event); publish();
    });
  }
  for (const name of ['session_compact', 'session_tree']) {
    pi.on(name, () => { resetHistory(); publish(); });
  }
  const control = async (args: string, context: any) => {
    if (controlling) { context.ui.notify('Pi Remote is already opening. Close its screen first.', 'info'); return; }
    controlling = true;
    // Status, relay and install checks can take seconds before the first step shows; say so at once.
    context.ui.setWidget(progressWidget, ['Opening Pi Remote...']);
    try {
      const action = args.trim();
      if (!['', 'start', 'stop', 'restart', 'status', 'setup'].includes(action)) throw new Error('Usage: /pi-remote [start|stop|restart|status|setup]');
      let config = loadConfig();
      let running = await hostStatus(config);
      if (action === 'status') {
        context.ui.notify(!running ? 'Pi Remote is stopped. /pi-remote starts it.' :
          'Pi Remote is ' + (running.closing ? 'stopping' : 'running') + ' at ' + running.publicUrl +
          (running.relayUrl ? (running.relayConnected ? '. Relay connected.' : '. Relay reconnecting; phone access is not ready.') : ''), 'info');
        if (running.relayOutdated) context.ui.notify(relayOutdated, 'warning');
        return;
      }
      if (action === 'stop') {
        await stopHost(config);
        context.ui.notify('Pi Remote stopped for all sessions. Terminal agents keep running; saved-session workers stop.', 'info');
        return;
      }
      if (action === 'restart' && running) {
        context.ui.notify('Restarting Pi Remote...', 'info');
        await stopHost(config);
        running = null;
      }
      if (context.mode !== 'tui') throw new Error('Open /pi-remote in an interactive Pi terminal to set up and display the private QR.');
      if (!state || !lock) throw new Error('Resolve session ownership and /reload first');
      const saved = running?.publicUrl || config.publicUrl;
      // Setup outlives uninstalling the package, so a saved relay may since have been deleted.
      const gone = action !== 'setup' && mobileUrl(saved) && await relayGone(saved);
      if (gone) {
        context.ui.notify('No relay answers at ' + saved + '. It may have been deleted. Set up a new one.', 'warning');
        if (running) { await stopHost(config); running = null; }
      }
      if (action === 'setup' || gone || !mobileUrl(saved)) {
        if (running) throw new Error('Stop Pi Remote with /pi-remote stop before changing its phone address.');
        if (process.env.PI_REMOTE_PUBLIC_URL || process.env.PI_REMOTE_RELAY_URL !== undefined) {
          throw new Error('Phone address is set by PI_REMOTE_PUBLIC_URL / PI_REMOTE_RELAY_URL. Update those variables and restart Pi, or unset them to use saved setup.');
        }
        const installed = await opentunnelInstalled();
        const choice = await context.ui.custom((tui: any, theme: any, keys: any, done: any) =>
          connectionScreen(tui, keys, done, { theme, installed }), fullScreen);
        if (!choice || stopped) return;
        let origin: string | undefined;
        if (choice === 'opentunnel') {
          if (!installed && (!await progress(context.ui, 'Installing opentunnel...', (signal: AbortSignal) => installOpentunnel(signal),
            'npm downloads the opentunnel command.') || stopped)) return;
          // The phone reaches the host directly through the tunnel, so no relay is saved.
          if (!await progress(context.ui, 'Creating your tunnel...', async (signal: AbortSignal) => { origin = await openTunnel(config.port, signal); },
            'The first tunnel waits for its certificate, which can take a few minutes.') || !origin || stopped) return;
        } else {
          // The guide ends by asking for the relay address, already validated.
          origin = await context.ui.custom((tui: any, theme: any, keys: any, done: any) =>
            deploymentScreen(config, tui, keys, done, { theme }),
          fullScreen);
          if (!origin || stopped) return;
        }
        saveConnection(origin, choice === 'render');
        config = loadConfig();
      }
      if (!await progress(context.ui, running ? 'Checking Pi Remote...' : 'Starting Pi Remote...', async (signal: AbortSignal) => {
        running = await ensureHost(config);
        if (!enabled) setChannel(true, context);
        // A just-started host needs a moment to reach the relay; checking earlier only meets an offline relay.
        for (const end = Date.now() + 15000; running.relayUrl && !running.relayConnected && Date.now() < end && !signal.aborted;) {
          await new Promise(resolve => setTimeout(resolve, 200));
          try { running = await hostStatus(config) ?? running; } catch { /* Busy starting; keep waiting. */ }
        }
      }, wakeHint(config))) return;
      if (mobileUrl(running.publicUrl) && !await checkRelay(context.ui, { ...config, publicUrl: running.publicUrl })) return;
      if (running.relayOutdated) context.ui.notify(relayOutdated, 'warning');
      if (stopped) return;
      const url = pairingUrl(config, running.publicUrl), code = pairingQr(url);
      // UI-only: never persist the bearer link in session entries or model context.
      await context.ui.custom((tui: any, _theme: any, keys: any, done: any) => ({
        render: (width: number) => pairingLines(url, code, width, tui.terminal.rows),
        invalidate() {},
        handleInput(data: string) {
          if (keys.matches(data, 'tui.select.confirm') || keys.matches(data, 'tui.select.cancel') || data === '\u0003') done();
        }
      }), fullScreen);
    } catch (error: any) { context.ui.notify('Pi Remote: ' + error.message, 'error'); }
    finally { controlling = false; context.ui.setWidget(progressWidget, undefined); }
  };
  pi.registerCommand('pi-remote', {
    description: 'Start mobile control and show login QR: /pi-remote [stop|restart|status|setup]',
    getArgumentCompletions: (prefix: string) => ['start', 'stop', 'restart', 'status', 'setup']
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
