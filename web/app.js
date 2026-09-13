import { patchState } from './protocol.js';
import MarkdownIt from './markdown-it.mjs';
const markdown = new MarkdownIt({ html: false }).disable('image');
const $ = id => document.getElementById(id);
function resizePrompt() {
  const input = $('prompt');
  if (!input.clientWidth) return;
  const scrollTop = input.scrollTop;
  input.style.height = 'auto';
  input.style.height = `${input.value ? input.scrollHeight : 0}px`;
  input.scrollTop = scrollTop;
}
let promptWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width === promptWidth) return;
  promptWidth = entry.contentRect.width;
  resizePrompt();
}).observe($('prompt'));
// iOS keyboards resize/pan the visual viewport, not the CSS layout viewport.
function fitViewport() {
  const viewport = window.visualViewport;
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return; // Leave pinch zoom to the browser.
  document.documentElement.style.setProperty('--viewport-height', `${viewport?.height ?? innerHeight}px`);
  document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
fitViewport();
const versions = new Map();
const cache = new Map(), drafts = new Map(), unread = new Set(), pending = new Map();
let socket, selected, sessions = [], connected = false, manualClose = false, reconnectTimer, connectionTimer, heartbeatTimer, retry = 0;
let token = localStorage.getItem('pi-remote-token') || sessionStorage.getItem('pi-remote-token') || '';
let lastDialog;
const sending = new Set(), commandCatalog = new Map();
let commandOptions = [], commandIndex = 0, commandDismissed = false, commandRender;
const hashToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (hashToken) {
  token = hashToken;
  history.replaceState(null, '', location.pathname);
}
// Preserve existing tab logins when upgrading to persistent browser storage.
if (token) localStorage.setItem('pi-remote-token', token);
sessionStorage.removeItem('pi-remote-token');
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function notice(text) { $('notice').textContent = text || ''; $('notice').hidden = !text; }
function request(op, extra = {}) {
  if (!connected || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Computer is disconnected'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('No acknowledgement. Check the conversation before sending again.')); }, 35000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ op, id, ...extra }));
  });
}
function connection(text) { $('connection').textContent = text; updateControls(); }
function disconnect() {
  const old = socket; socket = undefined; connected = false;
  clearTimeout(reconnectTimer); clearTimeout(connectionTimer); clearInterval(heartbeatTimer);
  connectionTimer = undefined;
  old?.close();
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Connection lost. Delivery may have occurred; inspect the session before retrying.')); }
  pending.clear();
}
function reconnect() {
  disconnect();
  if (manualClose || !token) return;
  connection('Computer disconnected. Retrying…');
  reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
}
function connect() {
  disconnect(); manualClose = false;
  $('login').hidden = true; $('app').hidden = false;
  connection('Connecting…');
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket = ws;
  // Bound the whole attempt, including an open transport that never receives ready.
  connectionTimer = setTimeout(reconnect, 20000);
  ws.addEventListener('open', () => { if (socket === ws) ws.send(JSON.stringify({ type: 'auth', token })); });
  ws.addEventListener('message', event => {
    if (socket !== ws) return;
    let packet;
    try { packet = JSON.parse(event.data); } catch { return; }
    if (!packet || typeof packet !== 'object') return;
    if (connected || packet.type === 'ready') { clearTimeout(connectionTimer); connectionTimer = undefined; }
    if (packet.type === 'ready') {
      connected = true; retry = 0; connection('Computer connected'); $('login-error').hidden = true;
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (socket !== ws || connectionTimer) return;
        connectionTimer = setTimeout(reconnect, 10000);
        ws.send(JSON.stringify({ op: 'ping', id: crypto.randomUUID() }));
      }, 20000);
      if (selected) {
        request('watch', { sessionId: selected }).catch(e => notice(e.message));
        loadCommands(selected);
      }
    } else if (packet.type === 'sessions') {
      const before = new Map(sessions.map(x => [x.id, x.updatedAt]));
      sessions = packet.sessions;
      for (const item of sessions) if (item.id !== selected && before.has(item.id) && before.get(item.id) !== item.updatedAt) unread.add(item.id);
      renderList();
      const warnings = packet.warnings || [];
      $('diagnostics').hidden = !warnings.length;
      $('warnings-summary').textContent = `${warnings.length} scan ${warnings.length === 1 ? 'warning' : 'warnings'}`;
      $('warnings').replaceChildren(...warnings.map(text => el('li', text)));
    } else if (packet.type === 'snapshot') {
      versions.set(packet.sessionId, packet.version);
      cache.set(packet.sessionId, packet.state);
      if (packet.sessionId === selected) renderConversation(packet.state);
    } else if (packet.type === 'patch') {
      if (packet.sessionId !== selected) return;
      try {
        if (versions.get(selected) + 1 !== packet.version || !cache.has(selected)) throw new Error('Resync');
        const state = patchState(cache.get(selected), packet.patch);
        versions.set(selected, packet.version); cache.set(selected, state); renderConversation(state);
      } catch { request('watch', { sessionId: selected }).catch(e => notice(e.message)); }
    } else if (packet.type === 'response') {
      const item = pending.get(packet.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(packet.id);
      if (!packet.ok || packet.value?.ok === false) item.reject(new Error(packet.error || packet.value.error));
      else item.resolve(packet.value?.value ?? packet.value);
    } else if (packet.type === 'notice') notice(packet.error);
  });
  ws.addEventListener('close', event => {
    if (socket !== ws) return;
    // Host and relay also use 1008 when auth delivery exceeds five seconds.
    if (event.code === 1008 && event.reason !== 'Authentication required') {
      $('login-error').textContent = event.reason || 'Access denied. Check your token.';
      $('login-error').hidden = false; logout(); return;
    }
    reconnect();
  });
  ws.addEventListener('error', () => { if (socket === ws) reconnect(); });
}
// Mobile browsers suspend sockets and timers in the background. Start fresh on return.
function reconnectNow() { if (token && !manualClose) { retry = 0; connect(); } }
window.addEventListener('online', reconnectNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconnectNow(); });
window.addEventListener('storage', event => {
  if (event.storageArea === localStorage && (event.key === 'pi-remote-token' || event.key === null) && !event.newValue) logout();
});
function logout() {
  manualClose = true; disconnect();
  token = ''; localStorage.removeItem('pi-remote-token'); sessionStorage.removeItem('pi-remote-token');
  drafts.clear(); cache.clear(); unread.clear(); commandCatalog.clear(); selected = undefined; sessions = [];
  $('prompt').value = ''; $('transcript').replaceChildren();
  $('app').hidden = true; $('login').hidden = false;
}
function renderList() {
  const query = $('search').value.toLowerCase();
  $('count').textContent = String(sessions.length);
  $('list-empty').hidden = sessions.length > 0;
  const fragment = document.createDocumentFragment();
  for (const item of sessions.filter(x => (x.title + ' ' + x.cwd).toLowerCase().includes(query))) {
    const button = el('button', undefined, 'session' + (item.id === selected ? ' active' : ''));
    button.type = 'button'; button.setAttribute('aria-current', String(item.id === selected));
    const top = el('div', undefined, 'session-top');
    top.append(el('strong', item.title));
    if (unread.has(item.id)) top.append(el('span', 'New', 'badge'));
    const meta = el('div', undefined, 'session-meta');
    const project = el('span', item.cwd.split(/[\\/]/).filter(Boolean).at(-1) || item.cwd, 'session-project');
    project.title = item.cwd;
    meta.append(project, el('span', item.status, 'session-state'));
    button.append(top, meta);
    button.addEventListener('click', () => selectSession(item.id)); fragment.append(button);
  }
  $('sessions').replaceChildren(fragment);
}
async function selectSession(id) {
  if (selected) drafts.set(selected, $('prompt').value);
  selected = id; unread.delete(id); $('prompt').value = drafts.get(id) || '';
  commandDismissed = false; commandIndex = 0; loadCommands(id);
  lastDialog = undefined; $('dialog').hidden = true;
  $('transcript').replaceChildren();
  document.querySelector('.session-info').open = false;
  $('project').textContent = sessions.find(x => x.id === id)?.cwd || '';
  $('app').classList.add('viewing'); renderList(); notice('');
  const state = cache.get(id);
  if (state) renderConversation(state);
  else {
    $('title').textContent = sessions.find(x => x.id === id)?.title || 'Loading…';
    $('transcript').replaceChildren(); $('transcript').hidden = false; $('empty').hidden = true;
    $('composer').hidden = false; updateControls();
  }
  resizePrompt();
  try { await request('watch', { sessionId: id }); } catch (e) { if (selected === id) notice(e.message); }
}
function renderConversation(state) {
  $('title').textContent = state.title;
  $('project').textContent = state.cwd;
  $('status').textContent = state.status; $('status').dataset.status = state.status;
  $('empty').hidden = true; $('transcript').hidden = false; $('composer').hidden = false;
  const box = $('transcript'), bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100, oldScroll = box.scrollTop;
  const fragment = document.createDocumentFragment();
  const expanded = new Map([...box.querySelectorAll('details[data-tool-id]')].map(node => [node.dataset.toolId, node.open]));
  const focusedTool = box.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.toolId : undefined;
  const messages = state.messages || [];
  const results = new Map(messages.filter(m => m.role === 'toolResult' && m.toolCallId).map(m => [m.toolCallId, m]));
  const tools = new Map((state.tools || []).map(tool => [tool.id, tool]));
  const rendered = new Set();
  const appendTool = (id, name, input, result) => {
    if (rendered.has(id)) return;
    rendered.add(id);
    const live = tools.get(id), status = result ? (result.isError ? 'error' : 'done') : live?.status || 'pending';
    const detail = el('details', undefined, 'tool');
    detail.dataset.toolId = id; detail.dataset.status = status;
    detail.open = expanded.get(id) ?? status === 'error';
    const toolName = name || live?.name || 'Tool';
    let args;
    try { args = JSON.parse(input); } catch { /* Streaming or shortened input may not be valid JSON yet. */ }
    let context = typeof args?.path === 'string' ? args.path : typeof args?.command === 'string' ? args.command : '';
    if (typeof args?.path === 'string') {
      const prefix = state.cwd?.replace(/[\\/]$/, '') + (state.cwd?.includes('\\') ? '\\' : '/');
      if (context.startsWith(prefix)) context = context.slice(prefix.length);
      const start = args.offset ?? 1;
      if (toolName === 'read' && (args.offset !== undefined || args.limit !== undefined) && Number.isInteger(start) && start > 0) {
        context += ':' + start;
        if (Number.isInteger(args.limit) && args.limit > 0) context += '-' + (start + args.limit - 1);
      }
    }
    const summary = el('summary'), heading = el('span', undefined, 'tool-heading');
    heading.append(el('strong', toolName === 'bash' ? '$' : toolName));
    if (toolName === 'bash') heading.append(el('span', 'bash', 'sr-only'));
    if (context) {
      const label = el('span', undefined, 'tool-context'); label.title = context;
      const slash = typeof args?.path === 'string' ? Math.max(context.lastIndexOf('/'), context.lastIndexOf('\\')) : -1;
      if (slash >= 0) label.append(el('span', context.slice(0, slash + 1), 'tool-directory'));
      label.append(el('span', context.slice(slash + 1), 'tool-target'));
      heading.append(label);
    }
    const statusLabel = el('span', status, 'tool-status');
    statusLabel.hidden = status === 'done';
    heading.append(statusLabel); summary.append(heading);
    const output = result?.text || live?.text || '';
    if (toolName === 'bash' && output) {
      const lines = output.trimEnd().split(/\r?\n/), preview = el('span', undefined, 'tool-preview');
      if (lines.length > 5) preview.append(el('span', `${lines.length - 5} earlier lines · expand`, 'tool-preview-hint'));
      if (result?.truncated) preview.append(el('span', 'Output shortened for mobile.', 'tool-preview-hint'));
      preview.append(el('span', lines.slice(-5).join('\n'), 'tool-preview-text'));
      summary.append(preview);
    }
    detail.append(summary);
    if (input) detail.append(el('pre', input, 'tool-input'));
    detail.append(el('pre', output || (status === 'working' ? 'Running…' : 'No output.'), 'tool-output'));
    if (result?.truncated) detail.append(el('p', 'Output shortened for mobile.', 'hint'));
    fragment.append(detail);
  };
  if (state.historyTruncated) fragment.append(el('p', 'Latest 100 messages.', 'hint'));
  for (const message of messages) {
    if (message.role === 'toolResult') {
      appendTool(message.toolCallId || message.id, message.toolName, '', message);
      continue;
    }
    if (message.text || message.role === 'user') {
      const article = el('article', undefined, 'message ' + (message.role === 'user' ? 'user' : 'assistant'));
      article.setAttribute('aria-label', message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Pi' : message.role);
      const body = el(message.role === 'user' ? 'pre' : 'div', undefined, 'message-text');
      if (message.role === 'user') body.textContent = message.text || '(empty message)';
      else {
        // HTML and images are disabled; markdown-it also rejects unsafe link schemes.
        body.innerHTML = markdown.render(message.text);
        for (const link of body.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      }
      article.append(body); fragment.append(article);
    }
    for (const call of message.toolCalls || []) appendTool(call.id, call.name, call.text, results.get(call.id));
    if (message.truncated) fragment.append(el('p', 'Message shortened for mobile.', 'hint'));
  }
  for (const tool of tools.values()) if (tool.status !== 'done') appendTool(tool.id, tool.name, '', results.get(tool.id));
  box.replaceChildren(fragment);
  if (focusedTool) [...box.querySelectorAll('details')].find(node => node.dataset.toolId === focusedTool)?.querySelector('summary').focus({ preventScroll: true });
  box.scrollTop = bottom ? box.scrollHeight : oldScroll;
  if (state.error) notice(state.error);
  renderDialog(state);
  updateControls();
}
function updateControls() {
  const state = cache.get(selected);
  const live = connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  $('send').disabled = !live || sending.has(selected);
  $('abort').disabled = !live;
  $('abort').hidden = !state || !['working', 'waiting'].includes(state.status);
  $('prompt').disabled = !selected;
  $('status').textContent = !connected ? 'Disconnected' : state?.status || 'Loading…';
  $('resume').hidden = !state || !['saved', 'disconnected'].includes(state.status);
  const meta = sessions.find(x => x.id === selected);
  $('resume').disabled = !connected || !meta?.resumable;
  $('composer-hint').textContent = !connected ? 'Reconnect to send instructions.' :
    state?.status === 'waiting' && !state.dialog ? 'Pi is waiting for input in its terminal.' :
    state && ['saved', 'disconnected'].includes(state.status) ? (meta?.resumable ? 'Resume to continue.' : 'Read-only. Enable --allow-resume on your computer after loading the extension in every Pi terminal.') : '';
  $('composer-hint').hidden = !$('composer-hint').textContent;
  renderCommands();
}
async function loadCommands(id) {
  const entry = {};
  commandCatalog.set(id, entry);
  renderCommands();
  try { entry.commands = await request('commands', { sessionId: id }); }
  catch (e) { entry.error = e.message; }
  if (selected === id && commandCatalog.get(id) === entry) renderCommands();
}
function renderCommands() {
  const input = $('prompt'), query = input.value.slice(1).toLowerCase();
  const state = cache.get(selected);
  const open = connected && state && ['idle', 'working', 'waiting'].includes(state.status) &&
    !commandDismissed && /^\/[^\s]*$/.test(input.value) && input.selectionStart === input.value.length;
  $('command-menu').hidden = !open;
  input.setAttribute('aria-expanded', String(!!open));
  if (!open) {
    input.removeAttribute('aria-activedescendant');
    commandOptions = []; commandRender = undefined;
    return;
  }
  const entry = commandCatalog.get(selected);
  // Streaming transcript updates must not replace an option during a tap.
  const rendering = [selected, query, commandIndex, entry?.commands, entry?.error];
  if (commandRender?.every((value, index) => value === rendering[index])) return;
  commandRender = rendering;
  input.removeAttribute('aria-activedescendant');
  commandOptions = (entry?.commands || []).filter(command => {
    let index = 0;
    for (const char of command.name.toLowerCase()) if (char === query[index]) index++;
    return index === query.length;
  }).sort((a, b) => Number(b.name.toLowerCase().startsWith(query)) - Number(a.name.toLowerCase().startsWith(query)));
  commandIndex = Math.min(commandIndex, Math.max(0, commandOptions.length - 1));
  $('command-options').replaceChildren(...commandOptions.map((command, index) => {
    const option = el('button', undefined, 'command-option');
    option.type = 'button'; option.tabIndex = -1; option.id = `command-option-${index}`;
    option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === commandIndex));
    option.append(el('strong', '/' + command.name));
    if (command.description) option.append(el('span', command.description));
    option.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') event.preventDefault(); });
    option.addEventListener('click', () => completeCommand(index));
    return option;
  }));
  if (commandOptions.length) input.setAttribute('aria-activedescendant', `command-option-${commandIndex}`);
  $('command-help').textContent = entry?.error || (!entry?.commands ? 'Loading commands…' : !commandOptions.length ? 'No matching commands. Built-in menus are available in the Pi terminal.' :
    'Tap or Tab to complete. Enter to run. Esc to close.');
}
function completeCommand(index = commandIndex) {
  const command = commandOptions[index];
  if (!command) return false;
  $('prompt').value = '/' + command.name + ' ';
  drafts.set(selected, $('prompt').value);
  commandDismissed = true;
  resizePrompt();
  $('prompt').focus(); renderCommands();
  return true;
}
function renderDialog(state) {
  const dialog = state.dialog;
  if (!dialog) { $('dialog').hidden = true; lastDialog = undefined; return; }
  if (lastDialog === dialog.id) return;
  lastDialog = dialog.id; $('dialog').hidden = false;
  const form = el('form');
  form.append(el('h3', dialog.title || 'Pi needs your input'));
  if (dialog.message) form.append(el('p', dialog.message));
  let input;
  if (dialog.method === 'select') {
    input = el('select');
    for (const option of dialog.options || []) { const node = el('option', option); node.value = option; input.append(node); }
  } else if (dialog.method !== 'confirm') input = el(dialog.method === 'editor' ? 'textarea' : 'input');
  if (input) { input.setAttribute('aria-label', dialog.title || 'Response'); input.value = dialog.prefill || input.value || ''; form.append(input); }
  const submit = el('button', dialog.method === 'confirm' ? 'Allow' : 'Submit'); submit.type = 'submit';
  const cancel = el('button', dialog.method === 'confirm' ? 'Deny' : 'Cancel', 'secondary'); cancel.type = 'button';
  const id = selected;
  const answer = async cancelled => {
    submit.disabled = true; cancel.disabled = true;
    try {
      await request('answer', { sessionId: id, answer: { dialogId: dialog.id,
        ...(cancelled ? { cancelled: true } : dialog.method === 'confirm' ? { confirmed: true } : { value: input.value }) } });
    } catch (e) { notice(e.message); submit.disabled = false; cancel.disabled = false; }
  };
  form.addEventListener('submit', event => { event.preventDefault(); answer(false); });
  cancel.addEventListener('click', () => answer(true));
  form.append(submit, cancel); $('dialog').replaceChildren(form);
}
$('login-form').addEventListener('submit', event => {
  event.preventDefault(); token = $('token').value.trim(); localStorage.setItem('pi-remote-token', token); $('token').value = ''; connect();
});
$('logout').addEventListener('click', logout);
$('search').addEventListener('input', renderList);
$('back').addEventListener('click', () => $('app').classList.remove('viewing'));
$('prompt').addEventListener('input', () => {
  resizePrompt();
  if (selected) drafts.set(selected, $('prompt').value);
  commandDismissed = false; commandIndex = 0;
  if ($('prompt').value === '/' && selected) loadCommands(selected);
  else renderCommands();
});
$('prompt').addEventListener('click', renderCommands);
$('composer').addEventListener('focusout', event => {
  if (!$('composer').contains(event.relatedTarget)) { commandDismissed = true; renderCommands(); }
});
$('prompt').addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (!$('command-menu').hidden && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === 'Escape') {
      event.preventDefault(); commandDismissed = true; renderCommands(); return;
    }
    if (commandOptions.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + commandOptions.length) % commandOptions.length;
      renderCommands(); $(`command-option-${commandIndex}`).scrollIntoView({ block: 'nearest' }); return;
    }
    if (event.key === 'Tab' && completeCommand()) { event.preventDefault(); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (completeCommand()) sendMessage(event.altKey ? 'followUp' : 'prompt');
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && matchMedia('(pointer: fine)').matches) {
    event.preventDefault();
    sendMessage(event.altKey ? 'followUp' : 'prompt');
  }
});
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage();
});
async function sendMessage(type = 'prompt') {
  const id = selected, text = $('prompt').value;
  if (!text.trim() || !id || $('send').disabled || sending.has(id)) return;
  sending.add(id);
  $('send').disabled = true; notice('');
  try {
    await request('command', { sessionId: id, command: { type, text } });
    if (drafts.get(id) === text) drafts.set(id, '');
    if (selected === id && $('prompt').value === text) { $('prompt').value = ''; resizePrompt(); }
  } catch (e) { notice(e.message); }
  finally { sending.delete(id); updateControls(); }
}
$('abort').addEventListener('click', async () => {
  try { await request('command', { sessionId: selected, command: { type: 'abort' } }); }
  catch (e) { notice(e.message); }
});
$('resume').addEventListener('click', async () => {
  $('resume').disabled = true;
  try { await request('resume', { sessionId: selected }); }
  catch (e) { notice(e.message); }
  finally { updateControls(); }
});
if (token) connect();
