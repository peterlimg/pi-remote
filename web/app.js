import { patchState } from './protocol.js';
import MarkdownIt from './markdown-it.mjs';
const markdown = new MarkdownIt({ html: false }).disable('image');
const $ = id => document.getElementById(id);
const versions = new Map();
const cache = new Map(), drafts = new Map(), unread = new Set(), pending = new Map();
let socket, selected, sessions = [], connected = false, manualClose = false, reconnectTimer, retry = 0;
let token = sessionStorage.getItem('pi-remote-token') || '';
let lastDialog;
const sending = new Set();
const hashToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (hashToken) {
  token = hashToken;
  sessionStorage.setItem('pi-remote-token', token);
  history.replaceState(null, '', location.pathname);
}
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function notice(text) { $('notice').textContent = text || ''; $('notice').hidden = !text; }
function request(op, extra = {}) {
  if (!connected) return Promise.reject(new Error('Computer is disconnected'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('No acknowledgement. Check the conversation before sending again.')); }, 35000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ op, id, ...extra }));
  });
}
function connection(text) { $('connection').textContent = text; updateControls(); }
function connect() {
  manualClose = false; clearTimeout(reconnectTimer);
  $('login').hidden = true; $('app').hidden = false;
  connection('Connecting…');
  socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
  socket.addEventListener('message', event => {
    let packet;
    try { packet = JSON.parse(event.data); } catch { return; }
    if (packet.type === 'ready') {
      connected = true; retry = 0; connection('Computer connected'); $('login-error').hidden = true;
      if (selected) request('watch', { sessionId: selected }).catch(e => notice(e.message));
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
  socket.addEventListener('close', event => {
    connected = false; connection('Computer disconnected');
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Connection lost. Delivery may have occurred; inspect the session before retrying.')); }
    pending.clear();
    if (event.code === 1008) {
      $('login-error').textContent = event.reason || 'Access denied. Check your token.';
      $('login-error').hidden = false; logout(); return;
    }
    if (!manualClose) reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
  });
  socket.addEventListener('error', () => {});
}
function logout() {
  manualClose = true; clearTimeout(reconnectTimer); socket?.close();
  token = ''; sessionStorage.removeItem('pi-remote-token');
  drafts.clear(); cache.clear(); unread.clear(); selected = undefined; sessions = [];
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
    const summary = el('summary');
    summary.append(el('strong', name || live?.name || 'Tool'), el('span', status, 'tool-status'));
    detail.append(summary);
    if (input) detail.append(el('pre', input, 'tool-input'));
    detail.append(el('pre', result?.text || live?.text || (status === 'working' ? 'Running…' : 'No output.'), 'tool-output'));
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
  $('mode').options[0].textContent = state?.status === 'working' ? 'Steer' : 'Message';
  $('resume').hidden = !state || !['saved', 'disconnected'].includes(state.status);
  const meta = sessions.find(x => x.id === selected);
  $('resume').disabled = !connected || !meta?.resumable;
  $('composer-hint').textContent = !connected ? 'Reconnect to send instructions.' :
    state?.status === 'waiting' && !state.dialog ? 'Pi is waiting for input in its terminal.' :
    state && ['saved', 'disconnected'].includes(state.status) ? (meta?.resumable ? 'Resume to continue.' : 'Read-only. Enable --allow-resume on your computer after loading the extension in every Pi terminal.') : '';
  $('composer-hint').hidden = !$('composer-hint').textContent;
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
  event.preventDefault(); token = $('token').value.trim(); sessionStorage.setItem('pi-remote-token', token); $('token').value = ''; connect();
});
$('logout').addEventListener('click', logout);
$('search').addEventListener('input', renderList);
$('back').addEventListener('click', () => $('app').classList.remove('viewing'));
$('prompt').addEventListener('input', () => { if (selected) drafts.set(selected, $('prompt').value); });
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(pointer: fine)').matches) {
    event.preventDefault();
    if (!$('send').disabled) {
      const mode = $('mode').value;
      if (event.altKey) $('mode').value = 'followUp';
      $('composer').requestSubmit();
      $('mode').value = mode;
    }
  }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const id = selected, text = $('prompt').value;
  if (!text.trim() || !id || sending.has(id)) return;
  sending.add(id);
  $('send').disabled = true; notice('');
  try {
    await request('command', { sessionId: id, command: { type: $('mode').value, text } });
    if (drafts.get(id) === text) drafts.set(id, '');
    if (selected === id && $('prompt').value === text) $('prompt').value = '';
  } catch (e) { notice(e.message); }
  finally { sending.delete(id); updateControls(); }
});
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
