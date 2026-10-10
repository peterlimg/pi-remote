import { patchState } from './protocol.js';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, IMAGE_LIMIT, validateImages } from './images.js';
import MarkdownIt from './markdown-it.mjs';
import { hello, channel, validKey } from './e2e.js';
const markdown = new MarkdownIt({ html: false }).disable('image');
const $ = id => document.getElementById(id);
function atThreadBottom() {
  const box = $('transcript');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function updateScrollButton() { $('scroll-bottom').hidden = atThreadBottom(); }
// Shrinking the transcript (activity row, taller composer) keeps scrollTop, hiding the last message.
let pinnedToBottom = true, transcriptHeight = 0;
$('transcript').addEventListener('scroll', () => {
  const box = $('transcript');
  // The browser may shift scrollTop by up to the pending resize before the resize callback runs.
  pinnedToBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 2 + Math.abs(box.clientHeight - transcriptHeight);
  updateScrollButton();
}, { passive: true });
$('transcript').addEventListener('toggle', updateScrollButton, true);
new ResizeObserver(() => {
  transcriptHeight = $('transcript').clientHeight;
  if (pinnedToBottom) $('transcript').scrollTop = $('transcript').scrollHeight;
  updateScrollButton();
}).observe($('transcript'));
$('scroll-bottom').addEventListener('click', () => {
  $('transcript').scrollTop = $('transcript').scrollHeight;
  $('transcript').focus({ preventScroll: true });
  updateScrollButton();
});
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
// Keyboards and pinch zoom change the visible area without resizing the layout viewport.
// Reflow inside it, keeping the browser's magnification and all controls reachable.
function fitViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--viewport-scale', `${viewport?.scale ?? 1}`);
  document.documentElement.style.setProperty('--viewport-height', `${viewport?.height ?? innerHeight}px`);
  document.documentElement.style.setProperty('--viewport-left', `${viewport?.offsetLeft ?? 0}px`);
  document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
// iOS Safari ignores user-scalable=no; its pinch arrives as gesture events.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
fitViewport();
const versions = new Map();
let seen = JSON.parse(localStorage.getItem('pi-remote-seen') || '{}');
const cache = new Map(), drafts = new Map(), imageDrafts = new Map(), pending = new Map();
const threadImages = new Map(), usageSummaries = new Map();
let imageQueue = Promise.resolve(), uploadQueue = Promise.resolve();
const imageObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    imageObserver.unobserve(entry.target);
    loadThreadImage(threadImages.get(entry.target.dataset.imageKey));
  }
}, { root: $('transcript'), rootMargin: '160px' });
let socket, selected, sessions = [], connected = false, manualClose = false, reconnectTimer, connectionTimer, heartbeatTimer, retry = 0;
let token = localStorage.getItem('pi-remote-token') || sessionStorage.getItem('pi-remote-token') || '';
let key = localStorage.getItem('pi-remote-key') || '';
// Only a browser on the computer itself may skip encryption; the relay must never see plaintext.
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const reasoningLevels = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
let lastDialog, settingsPicker, supportsImages = false, supportsUploads = false, supportsCommandResults = false, allowResume = false, selectedSummary, legacyList;
let listLimit = 20, searchQuery = '', listTotal = 0, listMatched = 0, listLoading = true, listError = '', searchTimer, listRequest = 0;
const submissions = new Map();
const sending = new Map(), changingReasoning = new Set(), commandCatalog = new Map();
let commandOptions = [], commandIndex = 0, commandDismissed = false, commandRender;
const hashParams = new URLSearchParams(location.hash.slice(1)), hashToken = hashParams.get('token');
if (hashToken) {
  token = hashToken; key = hashParams.get('key') || '';
  history.replaceState(null, '', location.pathname);
}
// Preserve existing tab logins when upgrading to persistent browser storage.
if (token) localStorage.setItem('pi-remote-token', token);
if (key) localStorage.setItem('pi-remote-key', key); else localStorage.removeItem('pi-remote-key');
sessionStorage.removeItem('pi-remote-token');
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function notice(text) {
  // Connection state belongs in the composer, not in persistent error notices.
  if (text === 'Computer is disconnected' || text === 'Computer is offline') return;
  $('notice').textContent = text || ''; $('notice').hidden = !text;
}
function request(op, extra = {}) {
  if (!connected || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Computer is disconnected'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('No acknowledgement. Check the conversation before sending again.')); }, 35000);
    const lookup = supportsCommandResults && ['command', 'new', 'resume', 'answer'].includes(op)
      ? { op: 'commandResult', id, sessionId: extra.sessionId, requestId: id } : undefined;
    pending.set(id, { resolve, reject, timer, lookup });
    transmit(socket, { op, id, ...extra });
  });
}
function transmit(ws, value) {
  const text = JSON.stringify(value);
  if (!ws.channel) { ws.send(text); return; }
  // Seals complete in call order, so frames leave in counter order.
  ws.channel.then(sealed => sealed.seal(text)).then(frame => { if (ws.readyState === WebSocket.OPEN) ws.send(frame); }, () => {});
}
function loginFailed(text) { $('login-error').textContent = text; $('login-error').hidden = false; logout(); }
// The first connection keeps the boot screen until sessions arrive, so the app never flashes empty.
function showApp() { $('boot').hidden = true; $('app').hidden = false; }
function connection(text) { $('connection').textContent = text; $('connection').hidden = connected; updateControls(); renderPagination(); }
function disconnect() {
  closePicker();
  listRequest++; legacyList = undefined;
  const old = socket; socket = undefined; connected = false; supportsImages = false; supportsUploads = false; supportsCommandResults = false; allowResume = false;
  clearTimeout(reconnectTimer); clearTimeout(connectionTimer); clearInterval(heartbeatTimer);
  connectionTimer = undefined;
  old?.close();
  for (const [id, item] of pending) {
    // Keep the original deadline. Recovery reads a receipt; it never resends a command.
    if (!manualClose && item.lookup) { item.recovering = true; continue; }
    clearTimeout(item.timer); pending.delete(id);
    item.reject(new Error('Connection lost. Delivery may have occurred; inspect the session before retrying.'));
  }
}
function reconnect() {
  disconnect();
  if (manualClose || !token) return;
  showApp(); connection('Computer disconnected. Retrying…');
  reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
}
function connect() {
  disconnect(); manualClose = false;
  if (key ? !validKey(key) : !loopback) { loginFailed('This login link has no encryption key. Scan the QR code on your computer again.'); return; }
  $('login').hidden = true; if ($('app').hidden) $('boot').hidden = false;
  connection('Connecting…');
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket = ws;
  // Bound the whole attempt, including an open transport that never receives ready.
  connectionTimer = setTimeout(reconnect, 20000);
  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    // A connected computer answers within seconds; relay close frames can be lost in its proxy.
    clearTimeout(connectionTimer); connectionTimer = setTimeout(reconnect, 8000);
    ws.send(JSON.stringify({ type: 'auth', token, ...(key ? { e2e: true } : {}) }));
    if (key) { ws.hello = hello(); ws.send(JSON.stringify(ws.hello.packet)); }
  });
  const encryptionFailed = () => { if (socket === ws) loginFailed('Encryption check failed. Scan the QR code on your computer again.'); };
  ws.addEventListener('message', event => {
    if (socket !== ws) return;
    if (!key) { receive(event.data); return; }
    if (ws.channel) { ws.channel.then(sealed => sealed.open(event.data)).then(receive, encryptionFailed); return; }
    // Before the host's hello, only relay notices arrive in plaintext.
    let packet;
    try { packet = JSON.parse(event.data); } catch { return; }
    if (packet?.type === 'hello' && ws.hello) { ws.channel = channel(key, ws.hello.nonce, packet.nonce); ws.channel.catch(encryptionFailed); }
    else if (packet?.type === 'notice') { notice(packet.error); if (packet.error === 'Computer is offline') reconnect(); }
  });
  function receive(data) {
    if (socket !== ws) return;
    let packet;
    try { packet = JSON.parse(data); } catch { return; }
    if (!packet || typeof packet !== 'object') return;
    if (connected || packet.type === 'ready') { clearTimeout(connectionTimer); connectionTimer = undefined; }
    if (packet.type === 'ready') {
      supportsImages = packet.supportsImages === true;
      supportsUploads = packet.supportsUploads === true;
      supportsCommandResults = packet.supportsCommandResults === true;
      for (const [id, item] of pending) {
        if (!item.recovering) continue;
        item.recovering = false;
        if (supportsCommandResults) transmit(ws, item.lookup);
        else {
          clearTimeout(item.timer); pending.delete(id);
          item.reject(new Error('Delivery outcome is unknown. Inspect the conversation before sending again.'));
        }
      }
      connected = true; retry = 0; connection('Computer connected'); $('login-error').hidden = true;
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (socket !== ws || connectionTimer) return;
        connectionTimer = setTimeout(reconnect, 10000);
        transmit(ws, { op: 'ping', id: crypto.randomUUID() });
      }, 20000);
      if (listLimit > 20 || searchQuery || listError) loadList();
      if (selected) {
        request('watch', { sessionId: selected }).catch(e => notice(e.message));
        loadCommands(selected);
      }
    } else if (packet.type === 'sessions') {
      receiveList(packet);
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
      // List diffs apply here, in arrival order with pushes, even if the caller gave up waiting.
      if (packet.ok && packet.value?.changes) receiveList(packet.value);
      const item = pending.get(packet.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(packet.id);
      if (!packet.ok || packet.value?.ok === false) item.reject(new Error(packet.error || packet.value.error));
      else item.resolve(packet.value?.value ?? packet.value);
    } else if (packet.type === 'notice') notice(packet.error);
  }
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
  token = ''; key = ''; localStorage.removeItem('pi-remote-token'); localStorage.removeItem('pi-remote-key'); sessionStorage.removeItem('pi-remote-token');
  for (const images of imageDrafts.values()) releaseImages(images);
  for (const draft of sending.values()) releaseImages(draft.attachments);
  for (const draft of submissions.values()) releaseImages(draft.attachments);
  imageDrafts.clear(); sending.clear(); submissions.clear();
  clearThreadImages();
  localStorage.removeItem('pi-remote-seen'); seen = {};
  drafts.clear(); cache.clear(); commandCatalog.clear(); usageSummaries.clear(); selected = undefined; selectedSummary = undefined; sessions = [];
  clearTimeout(searchTimer); $('search').value = ''; $('search-bar').classList.remove('open'); listLimit = 20; searchQuery = ''; listTotal = 0; listMatched = 0; listLoading = true; listError = '';
  renderList();
  renderImages();
  $('prompt').value = ''; $('transcript').replaceChildren();
  $('app').hidden = true; $('boot').hidden = true; $('login').hidden = false;
}
const statusLabels = { working: 'Working', waiting: 'Needs input', idle: 'Ready', starting: 'Starting', saved: 'Saved', disconnected: 'Offline' };
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
// Compact age for the list; the exact time stays in the tooltip.
function age(date) {
  const minutes = Math.floor((Date.now() - date) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return minutes + 'm';
  if (minutes < 1440) return Math.floor(minutes / 60) + 'h';
  if (minutes < 10080) return Math.floor(minutes / 1440) + 'd';
  return shortDate.format(date);
}
const isOnline = item => ['working', 'waiting', 'idle', 'starting'].includes(item.status);
// Must match the host's order so merged rows land where the host expects.
const listOrder = (a, b) => Number(isOnline(b)) - Number(isOnline(a)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
function receiveList(packet) {
  // A relay deploy can reach the browser before its computer host is restarted.
  if (packet.total === undefined) {
    legacyList = packet;
    const matches = packet.sessions.filter(item => [item.title, item.cwd, item.preview].join(' ').toLowerCase().includes(searchQuery))
      .sort(listOrder);
    packet = { ...packet, sessions: matches.slice(0, listLimit), total: packet.sessions.length, matched: matches.length, query: searchQuery };
  }
  let rows;
  if (packet.changes) {
    // Host diffs build on each other, so every one applies in arrival order, even for a superseded search.
    const byId = new Map(packet.reset ? [] : sessions.map(item => [item.id, item]));
    for (const id of packet.removed) byId.delete(id);
    for (const item of packet.changes) byId.set(item.id, item);
    rows = [...byId.values()].sort(listOrder);
  } else {
    // Whole pages: the first push after connecting, and hosts that predate scroll windows (always 20 rows).
    if ((packet.query ?? '') !== searchQuery) return;
    rows = packet.sessions; listLoading = false; listError = '';
  }
  sessions = rows; allowResume = packet.allowResume === true;
  listTotal = packet.total ?? sessions.length; listMatched = packet.matched ?? sessions.length;
  showApp();
  markSeen();
  selectedSummary = sessions.find(item => item.id === selected) || selectedSummary;
  renderList(); updateControls();
}
async function loadList() {
  clearTimeout(searchTimer);
  const generation = ++listRequest;
  listLoading = true; listError = ''; renderPagination();
  try {
    const page = legacyList || await request('list', { limit: listLimit, query: searchQuery });
    const current = generation === listRequest;
    if (current) { listLoading = false; listError = ''; }
    if (current && !page.changes) receiveList(page);
    else if (current) renderPagination();
  } catch (e) {
    if (generation !== listRequest) return;
    listLoading = false; listError = e.message; renderPagination();
  }
}
function renderPagination() {
  $('sessions').setAttribute('aria-busy', String(listLoading));
  $('sessions').inert = listLoading;
  $('list-retry').hidden = !listError; $('list-retry').disabled = !connected || listLoading;
  // Scrolling loads more by itself; the line only speaks up while loading or after a failure.
  $('list-page').textContent = listError ? 'Could not load sessions. Try again.' : listLoading ? 'Loading sessions…' : '';
  $('list-page').parentElement.hidden = !listError && !listLoading;
  $('list-empty').hidden = listLoading || !!listError || sessions.length > 0;
}
// Reaching the last row asks for the next 20; a short screen keeps filling until it scrolls.
const moreObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loadMore(); }, { rootMargin: '0px 0px 400px' });
function loadMore() {
  if (!connected || listLoading || listError || sessions.length < listLimit || sessions.length >= listMatched) return;
  listLimit += 20; loadList();
}
function renderList() {
  const matches = sessions;
  $('count').textContent = searchQuery ? `${listMatched} / ${listTotal}` : String(listTotal);
  $('list-empty').textContent = searchQuery ? 'No matching sessions. Try another task or project.' : 'No sessions yet. Start Pi with the remote extension loaded.';
  renderPagination();
  const fragment = document.createDocumentFragment();
  for (const [label, items] of [
    ['Online', matches.filter(isOnline)],
    ['Saved & offline', matches.filter(item => !isOnline(item))]
  ]) {
    if (!items.length) continue;
    const group = el('section', undefined, 'session-group');
    group.setAttribute('aria-label', label);
    const heading = el('h3', label);
    heading.append(el('span', String(items.length), 'badge'));
    group.append(heading);
    for (const item of items.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const button = el('button', undefined, 'session' + (item.id === selected ? ' active' : ''));
      button.type = 'button'; button.setAttribute('aria-current', String(item.id === selected));
      const icon = statusIcon(item.status);
      if (item.previewRole !== 'user' && item.updatedAt > seen[item.id]) { icon.dataset.unread = ''; icon.title = 'New reply'; }
      button.append(icon);
      const body = el('div', undefined, 'session-body');
      const top = el('div', undefined, 'session-top');
      const title = el('strong', item.title, item.title === 'Untitled session' ? 'untitled' : undefined); title.title = item.title;
      top.append(title);
      if (item.status === 'working') top.append(el('span', undefined, 'connection-spinner session-spinner'));
      body.append(top);
      if (item.preview && item.preview !== item.title) {
        body.append(el('div', (item.previewRole === 'user' ? 'You: ' : 'Pi: ') + displayPaths(item.preview), 'session-preview'));
      }
      const meta = el('div', undefined, 'session-meta');
      // Ready and Saved are the resting states; only label what needs attention.
      if (!['idle', 'saved'].includes(item.status)) {
        const status = el('span', statusLabels[item.status] || item.status, 'session-state');
        status.dataset.status = item.status;
        meta.append(status);
      }
      const cwd = displayPaths(item.cwd);
      const project = el('span', cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd, 'session-project');
      project.title = cwd;
      meta.append(project);
      const date = new Date(item.updatedAt);
      if (Number.isFinite(date.getTime())) {
        const time = el('time', age(date), 'session-time');
        time.dateTime = date.toISOString(); time.title = 'Last activity: ' + date.toLocaleString();
        meta.append(time);
      }
      body.append(meta);
      button.append(body);
      button.addEventListener('click', () => selectSession(item.id)); group.append(button);
    }
    fragment.append(group);
  }
  $('sessions').replaceChildren(fragment);
  moreObserver.disconnect();
  const last = [...$('sessions').querySelectorAll('.session')].at(-1);
  if (last) moreObserver.observe(last);
  const current = sessions.find(item => item.id === selected);
  if (current) $('title').textContent = current.title;
}
// Hand for "needs you", a ring otherwise (filled blue when unread); working rows show a spinner at the right.
function statusIcon(status) {
  const icon = el('span', undefined, 'session-icon');
  icon.dataset.status = status;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = status === 'waiting'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
    : '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg>';
  return icon;
}
function displayPaths(text) {
  return text.replace(/(^|[\s"'`=:(])\/(?:Users|home)\/[^/\s"'`:]+/g, '$1~');
}
function renderProject(cwd = '') {
  cwd = displayPaths(cwd);
  $('project').textContent = cwd;
  $('project-name').textContent = cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
  $('project-name').hidden = !cwd;
}
// Read state lives per device: the last activity time of each session as of when its thread was on screen.
// Sessions never seen before start as read so a fresh device doesn't light up the whole history.
function markSeen() {
  const reading = document.visibilityState === 'visible' && document.querySelector('main').getClientRects().length > 0;
  let changed = false;
  for (const item of sessions) {
    if ((item.id in seen && !(reading && item.id === selected)) || seen[item.id] === item.updatedAt) continue;
    seen[item.id] = item.updatedAt; changed = true;
  }
  if (changed) localStorage.setItem('pi-remote-seen', JSON.stringify(seen));
}
document.addEventListener('visibilitychange', () => { markSeen(); renderList(); });
async function selectSession(id) {
  closePicker();
  // iOS slides in a screenshot of the list, taken at pushState, on edge-swipe back, however old.
  // Paint the list empty first so that screenshot can't show stale rows.
  if (!history.state?.session && matchMedia('(max-width: 700px)').matches) {
    $('sessions').replaceChildren();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  if (selected) drafts.set(selected, $('prompt').value);
  if (selected !== id) clearThreadImages();
  selected = id; selectedSummary = sessions.find(item => item.id === id); $('prompt').value = drafts.get(id) || '';
  renderImages();
  commandDismissed = false; commandIndex = 0; loadCommands(id);
  lastDialog = undefined; $('dialog').hidden = true;
  $('transcript').replaceChildren();
  updateScrollButton();
  document.querySelector('.session-info').open = false;
  renderProject(selectedSummary?.cwd);
  // An entry for the open conversation lets edge-swipe and browser Back return to the list instead of leaving the app.
  if (!history.state?.session) history.pushState({ session: true }, '');
  $('app').classList.add('viewing'); markSeen(); renderList(); notice('');
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
function clearThreadImages(keep = new Set()) {
  for (const [id, image] of threadImages) if (!keep.has(id)) {
    imageObserver.unobserve(image.node);
    clearTimeout(image.retryTimer);
    if (image.url) URL.revokeObjectURL(image.url);
    threadImages.delete(id);
  }
}
function showThreadImage(image, blob) {
  image.url = URL.createObjectURL(blob);
  const link = el('a'), preview = el('img');
  link.href = image.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Open image');
  preview.src = image.url; preview.alt = 'Attached image';
  preview.onerror = () => {
    URL.revokeObjectURL(image.url); image.url = undefined;
    image.button.textContent = 'Image unavailable. Retry'; image.node.replaceChildren(image.button);
  };
  link.append(preview); image.node.replaceChildren(link);
}
function userMessageText(message) {
  // Pi adds these coordinate hints for the model, not for the conversation UI.
  return message.images?.length ? (message.text || '').replace(/^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]\s*$/gm, '').trim() : message.text || '';
}
function loadThreadImage(image) {
  if (!image || image.loading || image.url) return;
  image.loading = true;
  image.retryAt = Date.now() + 1000;
  image.button.disabled = true; image.button.textContent = 'Loading image…';
  // One image at a time leaves the command channel free for prompts and aborts.
  imageQueue = imageQueue.then(async () => {
    if (threadImages.get(image.key) !== image) return;
    try {
      const value = await request('image', { sessionId: image.sessionId, imageId: image.id });
      const [data] = validateImages([value]);
      if (threadImages.get(image.key) !== image) return;
      const bytes = Uint8Array.from(atob(data.data), char => char.charCodeAt(0));
      showThreadImage(image, new Blob([bytes], { type: data.mimeType }));
    } catch (error) {
      image.button.textContent = 'Image unavailable. Retry'; image.button.title = error.message;
    } finally { image.loading = false; image.button.disabled = false; }
  });
}
function appendThreadImages(parent, message, attachments) {
  if (!message?.images?.length) return;
  const gallery = el('div', undefined, 'thread-images');
  for (const [index, reference] of message.images.entries()) {
    if ((!attachments && !/^[a-f0-9]{64}$/.test(reference.id)) || !IMAGE_TYPES.includes(reference.mimeType)) continue;
    const key = message.id + ':' + index;
    let image = threadImages.get(key);
    if (image && image.id !== reference.id) {
      imageObserver.unobserve(image.node);
      clearTimeout(image.retryTimer);
      if (image.url) URL.revokeObjectURL(image.url);
      threadImages.delete(key); image = undefined;
    }
    if (!image) {
      const node = el('div', undefined, 'thread-image'), button = el('button', 'Loading image…', 'secondary');
      button.type = 'button'; node.dataset.imageKey = key; node.append(button);
      image = { key, id: reference.id, sessionId: selected, node, button };
      button.addEventListener('click', () => loadThreadImage(image));
      threadImages.set(key, image);
      if (attachments?.[index]) showThreadImage(image, attachments[index].file);
      else imageObserver.observe(node);
    } else if (!image.url && !image.loading && image.retryAt && !image.retryTimer) {
      // A live snapshot can precede Pi flushing the image to its session file.
      image.retryTimer = setTimeout(() => {
        image.retryTimer = undefined;
        imageObserver.observe(image.node);
      }, Math.max(0, image.retryAt - Date.now()));
    }
    gallery.append(image.node);
  }
  parent.append(gallery);
}
function renderConversation(state) {
  $('title').textContent = sessions.find(item => item.id === selected)?.title || state.title;
  renderProject(state.cwd);
  $('status').textContent = state.status; $('status').dataset.status = state.status;
  $('empty').hidden = true; $('transcript').hidden = false; $('composer').hidden = false;
  const box = $('transcript'), bottom = atThreadBottom(), oldScroll = box.scrollTop;
  const fragment = document.createDocumentFragment();
  const expanded = new Map([...box.querySelectorAll('details[data-disclosure-id]')].map(node => [node.dataset.disclosureId, node.open]));
  const focusedTool = box.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.disclosureId : undefined;
  const messages = [...(state.messages || [])], localImages = new Map();
  const matched = [];
  for (const outgoing of submissions.values()) {
    if (outgoing.sessionId !== selected) continue;
    const index = messages.findIndex(message => message.role === 'user' && !outgoing.knownIds.has(message.id) &&
      !localImages.has(message.id) && userMessageText(message).trim() === outgoing.text.trim() &&
      (message.images?.length || 0) === outgoing.attachments.length);
    const message = index < 0 ? { id: outgoing.key, role: 'user', text: outgoing.text,
      images: outgoing.attachments.map(({ file }) => ({ id: 'local', mimeType: file.type })),
      delivery: outgoing.accepted ? 'Sent. Waiting for Pi…' : 'Sending…' } : messages[index];
    localImages.set(message.id, outgoing.attachments);
    if (index < 0) messages.push(message);
    else matched.push({ outgoing, messageId: message.id });
  }
  if (isUsageDialog(state.dialog) && usageSummaries.get(selected)?.dialog.id !== state.dialog.id) {
    usageSummaries.set(selected, { dialog: state.dialog, afterId: messages.at(-1)?.id });
  }
  const usage = usageSummaries.get(selected);
  const usagePosition = usage ? messages.findIndex(message => message.id === usage.afterId) + 1 : -1;
  clearThreadImages(new Set(messages.flatMap(message => (message.images || []).map((_, index) => message.id + ':' + index))));
  const results = new Map(messages.filter(m => m.role === 'toolResult' && m.toolCallId).map(m => [m.toolCallId, m]));
  const tools = new Map((state.tools || []).map(tool => [tool.id, tool]));
  const rendered = new Set(), activityGroups = [];
  let activity;
  const appendTool = (id, name, input, result) => {
    if (rendered.has(id)) return;
    rendered.add(id);
    const live = tools.get(id), status = result ? (result.isError ? 'error' : 'done') : live?.status || 'pending';
    const detail = el('details', undefined, 'tool');
    detail.dataset.toolId = id; detail.dataset.status = status;
    detail.dataset.disclosureId = 'tool:' + id;
    detail.open = expanded.get(detail.dataset.disclosureId) ?? false;
    const toolName = name || live?.name || 'Tool';
    if (!activity) {
      const node = el('details', undefined, 'tool-activity'), summary = el('summary');
      node.dataset.disclosureId = 'activity:' + id;
      node.open = expanded.get(node.dataset.disclosureId) ?? false;
      node.append(summary); fragment.append(node);
      activity = { node, summary, tools: [] }; activityGroups.push(activity);
    }
    const entry = { name: toolName, status }; activity.tools.push(entry);
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
    context = displayPaths(context);
    entry.line = (toolName === 'bash' ? '$' : toolName) + (context ? ' ' + context : '');
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
    const output = displayPaths(result?.text || live?.text || '');
    detail.append(summary);
    if (input) detail.append(el('pre', displayPaths(input), 'tool-input'));
    if (output || !result?.images?.length) detail.append(el('pre', output || (status === 'working' ? 'Running…' : 'No output.'), 'tool-output'));
    appendThreadImages(detail, result);
    if (result?.truncated) detail.append(el('p', 'Output shortened for mobile.', 'hint'));
    activity.node.append(detail);
  };
  if (state.historyTruncated) fragment.append(el('p', 'Latest 100 messages.', 'hint'));
  for (const [index, message] of messages.entries()) {
    if (index === usagePosition) { activity = undefined; fragment.append(renderUsage(usage)); }
    if (message.role === 'toolResult') {
      appendTool(message.toolCallId || message.id, message.toolName, '', message);
      continue;
    }
    if (message.text || message.images?.length || message.role === 'user') {
      activity = undefined;
      const article = el('article', undefined, 'message ' + (message.role === 'user' ? 'user' : 'assistant'));
      article.setAttribute('aria-label', message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Pi' : message.role);
      const body = el('div', undefined, 'message-text');
      if (message.role === 'user') body.textContent = userMessageText(message) || (message.images?.length ? '' : '(empty message)');
      else {
        // HTML and images are disabled; markdown-it also rejects unsafe link schemes.
        body.innerHTML = markdown.render(message.text || '');
        for (const link of body.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      }
      if (message.role === 'user') appendThreadImages(article, message, localImages.get(message.id));
      if (body.textContent) article.append(body);
      if (message.role !== 'user') appendThreadImages(article, message);
      if (message.delivery) article.append(el('small', message.delivery, 'delivery-status'));
      fragment.append(article);
    }
    for (const call of message.toolCalls || []) appendTool(call.id, call.name, call.text, results.get(call.id));
    if (message.truncated) { activity = undefined; fragment.append(el('p', 'Message shortened for mobile.', 'hint')); }
  }
  if (usagePosition === messages.length) { activity = undefined; fragment.append(renderUsage(usage)); }
  for (const tool of tools.values()) if (tool.status !== 'done') appendTool(tool.id, tool.name, '', results.get(tool.id));
  for (const group of activityGroups) {
    const counts = new Map();
    for (const tool of group.tools) counts.set(tool.name, (counts.get(tool.name) || 0) + 1);
    const actions = { bash: ['Ran', 'Running', 'command'], read: ['Read', 'Reading', 'file'],
      edit: ['Edited', 'Editing', 'file'], write: ['Wrote', 'Writing', 'file'],
      grep: ['Searched', 'Searching', 'time'], find: ['Searched', 'Searching', 'time'],
      ffgrep: ['Searched', 'Searching', 'time'], fffind: ['Searched', 'Searching', 'time'],
      ls: ['Listed', 'Listing', 'directory', 'directories'] };
    const labels = [...counts].map(([name, count], index) => {
      const [past, present, noun, plural] = Object.hasOwn(actions, name) ? actions[name] : ['Used ' + name, 'Using ' + name, 'time'];
      const active = group.tools.some(tool => tool.name === name && ['working', 'pending'].includes(tool.status));
      const verb = active ? present : past;
      return `${index ? verb[0].toLowerCase() + verb.slice(1) : verb} ${count} ${count === 1 ? noun : plural || noun + 's'}`;
    });
    const label = el('span', labels.join(', '), 'tool-activity-label'); label.title = label.textContent;
    if (group.tools.some(tool => ['working', 'pending'].includes(tool.status))
      || (state.status === 'working' && group === activityGroups.at(-1))) {
      // Negative delay keeps the breathing phase continuous when the row re-renders.
      label.classList.add('tool-activity-live'); label.style.animationDelay = `-${Date.now() % 2400}ms`;
    }
    const running = group.tools.findLast(tool => tool.status === 'working');
    if (running) {
      const text = el('span', undefined, 'tool-activity-text'), line = el('span', running.line, 'tool-activity-line');
      line.title = running.line; text.append(label, line); group.summary.append(text);
    } else group.summary.append(label);
    for (const [status, text] of [['error', 'failed'], ['working', 'running'], ['pending', 'pending']]) {
      const count = group.tools.filter(tool => tool.status === status).length;
      if (count) group.summary.append(el('span', `${count} ${text}`, 'tool-activity-' + status));
    }
  }
  box.replaceChildren(fragment);
  for (const { outgoing, messageId } of matched) {
    submissions.delete(outgoing.key);
    for (const queued of submissions.values()) if (queued.sessionId === selected) queued.knownIds.add(messageId);
    if (sending.get(selected) !== outgoing) releaseImages(outgoing.attachments);
  }
  if (focusedTool) [...box.querySelectorAll('details')].find(node => node.dataset.disclosureId === focusedTool)?.querySelector('summary').focus({ preventScroll: true });
  box.scrollTop = bottom ? box.scrollHeight : oldScroll;
  if (state.error) notice(state.error);
  renderDialog(state);
  updateControls();
  updateScrollButton();
}
function updateControls() {
  const state = cache.get(selected);
  const live = connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  const working = state && ['working', 'waiting'].includes(state.status);
  const hasDraft = !!$('prompt').value.trim() || !!imageDrafts.get(selected)?.length;
  const outgoing = sending.get(selected), imageCount = outgoing?.attachments.length || 0;
  $('composer-send-status').hidden = !outgoing;
  $('composer-send-status').textContent = imageCount ? `Sending ${imageCount} ${imageCount === 1 ? 'image' : 'images'}…` : 'Sending…';
  $('send').disabled = !live || sending.has(selected);
  $('send').hidden = !!working && !hasDraft;
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands';
  $('image-files').disabled = !selected || sending.has(selected);
  for (const button of $('attachments').querySelectorAll('button')) button.disabled = sending.has(selected);
  $('abort').disabled = !live;
  $('abort').hidden = !working;
  $('prompt').disabled = !selected;
  $('status').textContent = !connected ? 'Disconnected' : state?.status || 'Loading…';
  $('composer-connection').hidden = connected || !selected || manualClose;
  const activity = $('agent-activity'), active = connected && state?.status === 'working';
  if (active && (activity.hidden || activity.dataset.sessionId !== selected)) {
    const labels = ['Thinking…', 'Pondering…', 'Working…', 'Mulling it over…', 'Piecing it together…'];
    activity.querySelector('span').textContent = labels[Math.floor(Math.random() * labels.length)];
    activity.dataset.sessionId = selected;
  }
  activity.hidden = !active;
  const modelName = state?.model?.slice(state.model.indexOf('/') + 1) || '';
  $('model').textContent = modelName;
  $('model').title = modelName ? `Switch model: ${modelName}` : '';
  $('model').setAttribute('aria-label', modelName ? `Switch model: ${modelName}` : 'Choose a model');
  $('model').disabled = !live;
  $('model').hidden = !state?.model;
  $('reasoning-control').disabled = !live || changingReasoning.has(selected);
  $('reasoning-value').textContent = changingReasoning.has(selected) ? 'Changing…' : reasoningLevels[state?.thinkingLevel] || state?.thinkingLevel || 'Off';
  $('reasoning-control').hidden = !state?.thinkingLevel;
  if (settingsPicker && !live) closePicker();
  $('fast-mode').toggleAttribute('hidden', !live || state?.fastMode !== true);
  $('resume').hidden = !state || !['saved', 'disconnected'].includes(state.status);
  const resumable = allowResume || (sessions.find(x => x.id === selected) || selectedSummary)?.resumable;
  $('resume').disabled = !connected || !resumable;
  $('composer-hint').textContent = !connected ? '' :
    state?.status === 'waiting' && !state.dialog ? 'Pi is waiting for input in its terminal.' :
    state && ['saved', 'disconnected'].includes(state.status) ? (resumable ? 'Resume to continue.' : 'Read-only. Enable --allow-resume on your computer after loading the extension in every Pi terminal.') : '';
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
  const live = connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  const commandDraft = /^\/[^\s]*$/.test(input.value);
  $('commands').disabled = !live || (!!input.value && !commandDraft);
  const open = live && !commandDismissed && commandDraft && input.selectionStart === input.value.length;
  $('command-menu').hidden = !open;
  input.setAttribute('aria-expanded', String(!!open));
  $('commands').setAttribute('aria-expanded', String(!!open));
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
function closePicker(restoreFocus = false) {
  const opener = settingsPicker?.opener;
  settingsPicker = undefined;
  $('settings-picker').hidden = true;
  $('model').setAttribute('aria-expanded', 'false');
  $('reasoning-control').setAttribute('aria-expanded', 'false');
  if (restoreFocus) opener?.focus();
}
function fitPickerMenu() {
  if (settingsPicker) $('settings-picker').style.setProperty('--picker-menu-height', Math.max(0,
    $('composer').getBoundingClientRect().top - document.querySelector('.conversation-header').getBoundingClientRect().bottom - 16) + 'px');
}
const pickerMenuObserver = new ResizeObserver(fitPickerMenu);
pickerMenuObserver.observe($('composer')); pickerMenuObserver.observe($('app'));
function openPicker(id, kind, opener = document.activeElement) {
  if (settingsPicker?.kind === kind) opener = settingsPicker.opener;
  closePicker();
  const picker = { id, kind, opener }; settingsPicker = picker;
  const reasoning = kind === 'reasoning';
  commandDismissed = true; renderCommands();
  $('picker-options').replaceChildren(); $('model-search').value = ''; $('model-search').disabled = false;
  $('model-search').hidden = reasoning; $('picker-title').hidden = !reasoning;
  $('model-retry').hidden = true; $('picker-help').classList.remove('picker-error');
  $('settings-picker').setAttribute('aria-label', reasoning ? 'Choose reasoning effort' : 'Choose a model');
  $('picker-cancel').setAttribute('aria-label', reasoning ? 'Close reasoning picker' : 'Close model picker');
  $('settings-picker').hidden = false;
  $(reasoning ? 'reasoning-control' : 'model').setAttribute('aria-expanded', 'true');
  fitPickerMenu();
  return picker;
}
function renderModels() {
  const picker = settingsPicker;
  if (!picker?.models) return;
  const query = $('model-search').value.trim().toLowerCase();
  const matches = picker.models.filter(model => `${model.name || ''} ${model.provider} ${model.id}`.toLowerCase().includes(query))
    .sort((a, b) => Number(`${b.provider}/${b.id}` === picker.current) - Number(`${a.provider}/${a.id}` === picker.current)
      || a.provider.localeCompare(b.provider) || (a.name || a.id).localeCompare(b.name || b.id));
  const groups = new Map();
  for (const model of matches) {
    if (!groups.has(model.provider)) groups.set(model.provider, []);
    groups.get(model.provider).push(model);
  }
  const fragment = document.createDocumentFragment();
  for (const [provider, models] of groups) {
    const group = el('section', undefined, 'model-group');
    group.setAttribute('aria-label', provider); group.append(el('h3', provider));
    for (const model of models) {
      const key = `${model.provider}/${model.id}`, current = key === picker.current;
      const button = el('button', undefined, 'command-option picker-option'); button.type = 'button';
      button.setAttribute('aria-pressed', String(current));
      button.append(el('strong', model.name || model.id, 'picker-option-label'));
      if (current) button.append(el('span', 'Current', 'picker-current'));
      button.disabled = !!picker.busy;
      button.addEventListener('click', () => chooseModel(picker, key));
      group.append(button);
    }
    fragment.append(group);
  }
  $('picker-options').replaceChildren(fragment);
  $('picker-help').classList.remove('picker-error');
  $('picker-help').textContent = !picker.models.length ? 'No models available. Configure a provider in the Pi terminal.'
    : !matches.length ? 'No matching models. Try a model name or provider.' : '';
}
const modelLists = new Map();
async function openModels(id, opener) {
  const picker = openPicker(id, 'model', opener), cached = modelLists.get(id);
  if (cached) { Object.assign(picker, cached, { current: cache.get(id)?.model || cached.current }); renderModels(); }
  else $('picker-help').textContent = 'Loading available models…';
  if (matchMedia('(pointer: fine)').matches) $('model-search').focus();
  try {
    const result = await request('models', { sessionId: id });
    if (settingsPicker !== picker || selected !== id) return;
    if (result.models?.length) modelLists.set(id, result);
    if (cached && JSON.stringify(cached.models) === JSON.stringify(result.models) && picker.current === result.current) return;
    Object.assign(picker, result); renderModels();
  } catch (e) {
    if (settingsPicker !== picker || cached) return;
    $('picker-help').classList.add('picker-error'); $('model-retry').hidden = false;
    $('picker-help').textContent = e.message === 'Unsupported command'
      ? 'Restart this Pi terminal to load remote model switching, then reopen /model.' : e.message;
  }
}
async function switchModel(id, key) {
  const slash = key.indexOf('/');
  if (slash < 1 || slash === key.length - 1) throw new Error('Use /model provider/model-id, or /model to choose.');
  await request('command', { sessionId: id, command: { type: 'setModel', provider: key.slice(0, slash), modelId: key.slice(slash + 1) } });
}
function pickerBusy(picker, busy, message) {
  picker.busy = busy; $('model-search').disabled = busy;
  for (const button of $('picker-options').querySelectorAll('button')) button.disabled = busy;
  $('picker-help').classList.toggle('picker-error', !busy);
  $('picker-help').textContent = message;
}
async function chooseModel(picker, key) {
  if (settingsPicker !== picker || picker.busy) return;
  if (key === picker.current) { closePicker(true); return; }
  pickerBusy(picker, true, 'Switching model…');
  try {
    await switchModel(picker.id, key);
    if (settingsPicker === picker) closePicker(true);
  } catch (e) {
    if (settingsPicker === picker) pickerBusy(picker, false, e.message);
  }
}
function openReasoning(id) {
  const picker = openPicker(id, 'reasoning', $('reasoning-control'));
  for (const [level, name] of Object.entries(reasoningLevels)) {
    const current = level === cache.get(id)?.thinkingLevel;
    const button = el('button', undefined, 'command-option picker-option'); button.type = 'button';
    button.setAttribute('aria-pressed', String(current));
    button.append(el('strong', name, 'picker-option-label'));
    if (current) button.append(el('span', 'Current', 'picker-current'));
    button.addEventListener('click', () => chooseReasoning(picker, level));
    $('picker-options').append(button);
  }
  $('picker-help').textContent = '';
  if (matchMedia('(pointer: fine)').matches) $('picker-options').querySelector('[aria-pressed=true]')?.focus();
}
async function chooseReasoning(picker, level) {
  const id = picker.id;
  if (settingsPicker !== picker || changingReasoning.has(id)) return;
  if (level === cache.get(id)?.thinkingLevel) { closePicker(true); return; }
  changingReasoning.add(id); notice(''); pickerBusy(picker, true, 'Changing reasoning…'); updateControls();
  let applied = false;
  try {
    const result = await request('command', { sessionId: id, command: { type: 'setThinkingLevel', level } });
    if (cache.has(id)) cache.get(id).thinkingLevel = result.thinkingLevel;
    if (selected === id && result.thinkingLevel !== level) notice(`This model uses ${result.thinkingLevel} reasoning instead of ${level}.`);
    applied = true;
  } catch (e) {
    if (settingsPicker === picker) pickerBusy(picker, false, e.message === 'Unsupported command'
      ? 'Reload this Pi terminal with /reload to enable reasoning changes.' : e.message);
  } finally {
    changingReasoning.delete(id); updateControls();
    if (applied && settingsPicker === picker) closePicker(true);
  }
}
$('model').addEventListener('click', () => settingsPicker?.kind === 'model' ? closePicker() : openModels(selected, $('model')));
$('reasoning-control').addEventListener('click', () => settingsPicker?.kind === 'reasoning' ? closePicker() : openReasoning(selected));
$('model-search').addEventListener('input', renderModels);
$('model-retry').addEventListener('click', () => { if (settingsPicker?.kind === 'model') openModels(settingsPicker.id); });
$('picker-cancel').addEventListener('click', () => closePicker(true));
document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape' && !$('dialog').hidden && $('dialog').getClientRects().length) {
    event.preventDefault(); $('dialog-close').click(); return;
  }
  if (!settingsPicker) return;
  if (event.key === 'Escape') { event.preventDefault(); closePicker(true); }
  // The picker shares the composer form. Search must never submit its draft.
  if (event.target === $('model-search') && event.key === 'Enter') {
    event.preventDefault(); $('picker-options').querySelector('button:not(:disabled)')?.focus();
  }
});
document.addEventListener('pointerdown', event => {
  const trigger = settingsPicker?.kind === 'reasoning' ? $('reasoning-control') : $('model');
  if (settingsPicker && !$('settings-picker').contains(event.target) && !trigger.contains(event.target)) closePicker();
});
function isUsageDialog(dialog) {
  return dialog?.method === 'select' && dialog.title?.split(/\r?\n/)[0] === 'Provider usage';
}
function renderUsage(usage) {
  const article = el('article', undefined, 'message usage-summary');
  article.setAttribute('aria-label', 'Provider usage');
  const content = el('blockquote'), body = el('div', undefined, 'message-text');
  const description = [usage.dialog.title.split(/\r?\n/).slice(1).join('\n'), usage.dialog.message].filter(Boolean).join('\n');
  for (const line of description.split(/\r?\n/).filter(Boolean)) {
    if (/^(Credits|Usage limit resets|Plan|Fast mode|Semantics):/.test(line) || / Usage · /.test(line)) continue;
    const limit = line.match(/^(.+?):\s*\[[█░▓▒\s]+\]\s*(\d+(?:\.\d+)?)% left(?:\s*\((.+)\))?$/);
    if (limit && Number(limit[2]) <= 100) {
      const [, label, remaining, reset] = limit;
      content.append(el('p', `${label}: ${Number((100 - Number(remaining)).toFixed(2))}% used${reset ? ' · ' + reset : ''}`));
    } else content.append(el('p', line));
  }
  if (!content.childElementCount) content.append(el('p', 'Usage information is unavailable.'));
  if (usage.error) {
    content.append(el('p', usage.error, 'dialog-error'));
    const retry = el('button', 'Retry closing usage', 'quiet');
    retry.type = 'button';
    retry.addEventListener('click', () => { usage.error = undefined; renderConversation(cache.get(selected)); });
    content.append(retry);
  }
  body.append(content); article.append(body);
  return article;
}
async function closeUsage(usage, id) {
  if (usage.busy || usage.error || usage.closed) return;
  usage.busy = true;
  try {
    await request('answer', { sessionId: id, answer: { dialogId: usage.dialog.id,
      ...(usage.dialog.options?.includes('Close') ? { value: 'Close' } : { cancelled: true }) } });
    usage.closed = true;
    const current = cache.get(id);
    if (current?.dialog?.id === usage.dialog.id) delete current.dialog;
  } catch (e) {
    usage.error = e.message;
  } finally {
    usage.busy = false;
    if (selected === id) renderConversation(cache.get(id));
  }
}
function renderDialog(state) {
  const dialog = state.dialog;
  if (!dialog || isUsageDialog(dialog)) {
    if ($('dialog').contains(document.activeElement)) $('transcript').focus({ preventScroll: true });
    $('dialog').hidden = true; lastDialog = undefined;
    if (dialog) closeUsage(usageSummaries.get(selected), selected);
    return;
  }
  if (lastDialog === dialog.id) return;
  lastDialog = dialog.id; $('dialog').hidden = false;
  const form = el('form'), header = el('header'), body = el('div', undefined, 'dialog-body'), footer = el('footer');
  const [title, ...details] = (dialog.title || 'Pi needs your input').split(/\r?\n/);
  const heading = el('h3', title); heading.id = 'dialog-title'; heading.tabIndex = -1;
  const close = el('button', undefined, 'quiet'); close.type = 'button'; close.id = 'dialog-close';
  close.setAttribute('aria-label', 'Close dialog');
  close.append($('picker-cancel').firstElementChild.cloneNode(true));
  header.append(heading, close);
  const description = [details.join('\n'), dialog.message].filter(Boolean).join('\n\n');
  if (description) body.append(el('p', description, 'dialog-description'));
  let input;
  if (!['select', 'confirm'].includes(dialog.method)) {
    input = el(dialog.method === 'editor' ? 'textarea' : 'input');
    input.setAttribute('aria-label', title || 'Response'); input.value = dialog.prefill || ''; body.append(input);
  }
  const feedback = el('p', '', 'hint'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
  const id = selected;
  let busy = false;
  const answer = async response => {
    if (busy) return;
    busy = true;
    heading.focus({ preventScroll: true });
    for (const control of form.elements) control.disabled = true;
    feedback.hidden = false; feedback.classList.remove('dialog-error');
    feedback.textContent = 'Sending response…';
    try {
      await request('answer', { sessionId: id, answer: { dialogId: dialog.id, ...response } });
      // A receipt also closes the panel when an older host omits the removal patch.
      const current = cache.get(id);
      if (current?.dialog?.id === dialog.id) {
        delete current.dialog;
        if (selected === id) renderDialog(current);
      }
    } catch (e) {
      busy = false;
      for (const control of form.elements) control.disabled = false;
      feedback.classList.add('dialog-error'); feedback.textContent = e.message;
    }
  };
  if (dialog.method === 'select') {
    const options = el('div', undefined, 'dialog-options');
    for (const option of dialog.options || []) {
      const button = el('button', option, 'command-option'); button.type = 'button';
      button.addEventListener('click', () => answer({ value: option })); options.append(button);
    }
    body.append(options);
  } else {
    const submit = el('button', dialog.method === 'confirm' ? 'Allow' : 'Submit'); submit.type = 'submit'; footer.append(submit);
  }
  const cancel = el('button', dialog.method === 'confirm' ? 'Deny' : 'Cancel', 'secondary'); cancel.type = 'button';
  close.addEventListener('click', () => answer({ cancelled: true }));
  cancel.addEventListener('click', () => answer({ cancelled: true }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (dialog.method !== 'select') answer(dialog.method === 'confirm' ? { confirmed: true } : { value: input.value });
  });
  footer.append(cancel);
  footer.append(feedback); form.append(header, body, footer); $('dialog').replaceChildren(form);
  close.focus({ preventScroll: true });
}
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  // Accept the full private link (token and key) or, on this computer, a bare token.
  const value = $('token').value.trim();
  let params;
  try { params = new URLSearchParams(new URL(value).hash.slice(1)); } catch { /* Bare token. */ }
  token = params?.get('token') || value; key = params?.get('key') || '';
  localStorage.setItem('pi-remote-token', token);
  if (key) localStorage.setItem('pi-remote-key', key); else localStorage.removeItem('pi-remote-key');
  $('token').value = ''; connect();
});
$('logout').addEventListener('click', logout);
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer); listRequest++;
  searchQuery = $('search').value.trim().toLowerCase(); listLimit = 20;
  listLoading = true; listError = ''; renderPagination(); $('sessions').scrollTop = 0;
  searchTimer = setTimeout(loadList, 250);
});
function closeSearch() {
  if ($('search').value) { $('search').value = ''; $('search').dispatchEvent(new Event('input')); }
  $('search-bar').classList.remove('open');
}
$('search-open').addEventListener('click', () => { $('search-bar').classList.add('open'); $('search').focus(); });
$('search-close').addEventListener('click', () => { closeSearch(); $('search-open').focus(); });
// An empty search folds back into its button once you leave it; a live filter stays visible.
$('search').addEventListener('blur', event => { if (!$('search').value && event.relatedTarget !== $('search-close')) closeSearch(); });
$('search').addEventListener('keydown', event => { if (event.key === 'Escape') { closeSearch(); $('search-open').focus(); } });
$('list-retry').addEventListener('click', loadList);
$('back').addEventListener('click', () => history.state?.session ? history.back() : $('app').classList.remove('viewing'));
window.addEventListener('popstate', () => { closePicker(); $('app').classList.remove('viewing'); });
$('prompt').addEventListener('input', () => {
  closePicker(); resizePrompt();
  if (selected) drafts.set(selected, $('prompt').value);
  commandDismissed = false; commandIndex = 0;
  if ($('prompt').value === '/' && selected) loadCommands(selected);
  updateControls();
});
$('commands').addEventListener('click', () => {
  const input = $('prompt');
  input.value = '/';
  input.focus(); input.setSelectionRange(1, 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ type: 'image', mimeType: file.type, data: reader.result.slice(reader.result.indexOf(',') + 1) });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Remove it and attach it again.`));
    reader.readAsDataURL(file);
  });
}
// Stage each image on the host as soon as it is attached, so Send only carries an ID.
function uploadImage(image) {
  if (!supportsUploads) return;
  const ws = socket;
  image.uploading = true;
  image.upload = uploadQueue = uploadQueue.then(async () => {
    try {
      const { uploadId } = await request('upload', { image: await readImage(image.file) });
      if (socket === ws) image.staged = { uploadId, socket: ws };
    } catch {} // Send falls back to inline data.
    finally { image.uploading = false; if (imageDrafts.get(selected)?.includes(image)) renderImages(); }
  });
}
function releaseImages(images) {
  for (const image of images) URL.revokeObjectURL(image.url);
}
function renderImages() {
  const images = imageDrafts.get(selected) || [];
  $('attachments').hidden = !images.length;
  $('attachments').replaceChildren(...images.map(image => {
    const item = el('div', undefined, 'attachment'), preview = el('img');
    preview.src = image.url; preview.alt = image.file.name;
    const remove = el('button'); remove.type = 'button';
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    remove.setAttribute('aria-label', `Remove ${image.file.name}`); remove.disabled = sending.has(selected);
    remove.addEventListener('click', () => {
      URL.revokeObjectURL(image.url);
      imageDrafts.set(selected, images.filter(other => other !== image)); renderImages(); $('image-files').focus();
    });
    item.classList.toggle('uploading', !!image.uploading);
    item.append(preview);
    if (image.uploading) { const spinner = el('span', undefined, 'connection-spinner'); spinner.setAttribute('aria-label', 'Uploading'); item.append(spinner); }
    item.append(remove); return item;
  }));
  updateControls();
}
let openingImages = false;
// Keep the editor focused until click so we can dismiss its keyboard first.
$('image-files').addEventListener('mousedown', event => event.preventDefault());
$('image-files').addEventListener('click', event => {
  if (openingImages) { event.preventDefault(); return; }
  const active = document.activeElement;
  if (!active?.matches('textarea, input:not([type=file])')) return;
  event.preventDefault();
  openingImages = true;
  const input = event.currentTarget, id = selected, viewport = window.visualViewport;
  const started = performance.now();
  let changed = started;
  const resized = () => { changed = performance.now(); };
  const open = () => {
    // Bound the wait to Safari's short-lived file-picker gesture permission.
    if (performance.now() - changed < 100 && performance.now() - started < 900) {
      setTimeout(open, 50); return;
    }
    viewport?.removeEventListener('resize', resized);
    viewport?.removeEventListener('scroll', resized);
    openingImages = false;
    if (selected !== id || input.disabled || !input.getClientRects().length ||
      document.activeElement?.matches('textarea, input:not([type=file])')) return;
    input.click();
  };
  viewport?.addEventListener('resize', resized);
  viewport?.addEventListener('scroll', resized);
  active.blur();
  // Safari anchors once, before closing the keyboard. Keep the timer chain rooted
  // in this tap; opening from a resize callback loses its file-picker permission.
  setTimeout(open, 350);
});
$('image-files').addEventListener('change', () => {
  const files = [...$('image-files').files], images = imageDrafts.get(selected) || [];
  $('image-files').value = '';
  if (!selected || sending.has(selected) || !files.length) return;
  if (images.length + files.length > MAX_IMAGES || files.some(file => !IMAGE_TYPES.includes(file.type) || !file.size) ||
    images.reduce((sum, image) => sum + image.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_BYTES) {
    notice(IMAGE_LIMIT); return;
  }
  const added = files.map(file => ({ file, url: URL.createObjectURL(file) }));
  for (const image of added) uploadImage(image);
  imageDrafts.set(selected, [...images, ...added]);
  notice(''); renderImages();
});
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage();
});
async function sendMessage(type = 'prompt') {
  const id = selected, text = $('prompt').value, attachments = imageDrafts.get(id) || [];
  if ((!text.trim() && !attachments.length) || !id || $('send').disabled || sending.has(id)) return;
  if (attachments.length && !supportsImages) { notice('Restart Pi Remote on your computer to enable image uploads.'); return; }
  if (attachments.length && text.trim().startsWith('/')) { notice('Send images with a message, not a slash command.'); return; }
  const outgoing = { key: crypto.randomUUID(), sessionId: id, text, attachments,
    knownIds: new Set((cache.get(id)?.messages || []).map(message => message.id)), accepted: false };
  sending.set(id, outgoing);
  if (attachments.length) submissions.set(outgoing.key, outgoing);
  // The editor owns the next draft; retain this submission until delivery is confirmed.
  drafts.set(id, ''); imageDrafts.delete(id);
  $('prompt').value = ''; resizePrompt(); renderImages(); notice('');
  if (attachments.length) {
    renderConversation(cache.get(id));
    $('transcript').scrollTop = $('transcript').scrollHeight;
  }
  let restored = false;
  try {
    await Promise.all(attachments.map(image => image.upload));
    const images = await Promise.all(attachments.map(image => image.staged?.socket === socket
      ? { type: 'image', uploadId: image.staged.uploadId } : readImage(image.file)));
    // Signing out while files are being read must not send them through a later login.
    if (sending.get(id) !== outgoing) return;
    let created;
    if (text.trim() === '/new') created = await request('new', { sessionId: id });
    else if (/^\/model(?:\s|$)/.test(text.trim())) {
      const key = text.trim().slice(6).trim();
      if (key) await switchModel(id, key);
      else openModels(id);
    } else await request('command', { sessionId: id, command: { type, text, ...(images.length ? { images } : {}) } });
    if (sending.get(id) !== outgoing) return;
    outgoing.accepted = true;
    if (created && selected === id) await selectSession(created.sessionId);
  } catch (e) {
    if (sending.get(id) !== outgoing) return;
    submissions.delete(outgoing.key);
    const nextText = selected === id ? $('prompt').value : drafts.get(id) || '';
    drafts.set(id, [text, nextText].filter(Boolean).join('\n\n'));
    imageDrafts.set(id, attachments); restored = true;
    if (selected === id) { $('prompt').value = drafts.get(id); resizePrompt(); renderImages(); }
    notice(e.message);
  } finally {
    if (sending.get(id) === outgoing) {
      if (!restored && !submissions.has(outgoing.key)) releaseImages(attachments);
      sending.delete(id);
      if (selected === id && attachments.length) renderConversation(cache.get(id));
      else updateControls();
    }
  }
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
if (token) connect(); else { $('boot').hidden = true; $('login').hidden = false; }
