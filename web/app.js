import { patchState, loadedSkill, sessionTitle, taskText, replyAttempts, sessionGroup, activityOrder } from './protocol.js';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, IMAGE_LIMIT, validateImages } from './images.js';
import { isVideo, MAX_VIDEO_BYTES, VIDEO_CHUNK_BYTES, VIDEO_LIMIT, videoMessage, splitVideoMessage, VideoCache } from './videos.js';
import MarkdownIt from './markdown-it.mjs';
import { hello, channel, validKey } from './e2e.js';
const markdown = new MarkdownIt({ html: false }).disable('image');
const $ = id => document.getElementById(id);
const activityIndicator = $('agent-activity');
let historyWindow, historyRequest, historyForward = [], historyError = '', historyGeneration = 0, historyScrollTop = 0;
function atThreadBottom() {
  const box = $('transcript');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function updateScrollButton() { $('scroll-bottom').hidden = !historyWindow && atThreadBottom(); }
// Keep the latest message visible when the composer or inline activity changes height.
let pinnedToBottom = true, transcriptHeight = 0, historyTouch;
function scrollHistory(delta) {
  const box = $('transcript');
  if (delta < 0 && box.scrollTop < 400) loadHistory('before');
  else if (delta > 0 && (historyWindow || historyRequest) && box.scrollHeight - box.scrollTop - box.clientHeight < 400) loadHistory('after');
}
$('transcript').addEventListener('scroll', () => {
  const box = $('transcript');
  // The browser may shift scrollTop by up to the pending resize before the resize callback runs.
  pinnedToBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 2 + Math.abs(box.clientHeight - transcriptHeight);
  updateScrollButton();
  const direction = box.scrollTop - historyScrollTop; historyScrollTop = box.scrollTop;
  // Resizing can move the bottom upward without the reader scrolling into history.
  if (direction > 0 || !pinnedToBottom) scrollHistory(direction);
}, { passive: true });
// Collapsed tools can leave no scrolling room; input at the edge must still page history.
$('transcript').addEventListener('wheel', event => scrollHistory(event.deltaY), { passive: true });
$('transcript').addEventListener('keydown', event => {
  if (event.target !== $('transcript')) return;
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) scrollHistory(-1);
  else if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) scrollHistory(1);
});
$('transcript').addEventListener('touchstart', event => {
  const touch = event.touches.length === 1 && event.touches[0];
  historyTouch = touch && { x: touch.clientX, y: touch.clientY };
}, { passive: true });
$('transcript').addEventListener('touchmove', event => {
  if (!historyTouch || event.touches.length !== 1) { historyTouch = undefined; return; }
  const touch = event.touches[0], dx = touch.clientX - historyTouch.x, dy = touch.clientY - historyTouch.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
  historyTouch = undefined;
  if (Math.abs(dy) > Math.abs(dx)) scrollHistory(-dy);
}, { passive: true });
$('transcript').addEventListener('toggle', updateScrollButton, true);
const transcriptObserver = new ResizeObserver(() => {
  transcriptHeight = $('transcript').clientHeight;
  if (pinnedToBottom) $('transcript').scrollTop = $('transcript').scrollHeight;
  updateScrollButton();
});
transcriptObserver.observe($('transcript'));
transcriptObserver.observe(activityIndicator);
$('scroll-bottom').addEventListener('click', () => {
  if (historyWindow) showLatest();
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
window.addEventListener('pageshow', fitViewport);
// iOS Safari ignores user-scalable=no; its pinch arrives as gesture events.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
fitViewport();
const versions = new Map();
let seen = JSON.parse(localStorage.getItem('pi-remote-seen') || '{}');
const sessionIcons = new Map(JSON.parse(localStorage.getItem('pi-remote-session-icons') || '[]'));
const cache = new Map(), drafts = new Map(), imageDrafts = new Map(), pending = new Map();
const threadImages = new Map(), threadVideos = new Map(), usageSummaries = new Map();
const usageDetails = new Map(), usageLoading = new Set();
let supportsUsage = false;
let imageQueue = Promise.resolve(), uploadQueue = Promise.resolve();
const imageObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    imageObserver.unobserve(entry.target);
    loadThreadImage(threadImages.get(entry.target.dataset.imageKey));
  }
}, { root: $('transcript'), rootMargin: '160px' });
const videoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    videoObserver.unobserve(entry.target);
    loadVideoPreview(threadVideos.get(entry.target.dataset.videoPath));
  }
}, { root: $('transcript'), rootMargin: '160px' });
let socket, selected, sessions = [], connected = false, manualClose = false, reconnectTimer, connectionTimer, heartbeatTimer, retry = 0, connectionReason = '';
let token = localStorage.getItem('pi-remote-token') || sessionStorage.getItem('pi-remote-token') || '';
let key = localStorage.getItem('pi-remote-key') || '';
let videoCache = token ? new VideoCache(JSON.stringify([token, key])) : undefined;
// Only a browser on the computer itself may skip encryption; the relay must never see plaintext.
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
let loginLinkError = '', homeScreenLogin = false, homeScreenTimer;
let swipeTimer, trackingSwipe = false, openingAnimation;
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const reasoningLevels = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
let lastDialog, blankDir, settingsPicker, supportsHistory = false, supportsImages = false, supportsUploads = false, supportsVideos = false, supportsCommandResults = false, allowResume = false, selectedSummary, legacyList;
let listLimit = 20, searchQuery = '', listMatched = 0, listLoading = true, listError = '', searchTimer, listRequest = 0;
let supportsSessionSections = false, supportsSessionClosing = false, listSection = 'overview', listGroups, listLoaded = 0, overviewLimit = 20;
const listRoot = () => $(listSection === 'overview' ? 'sessions' : 'collection-sessions');
const submissions = new Map();
const sending = new Map(), changingReasoning = new Set(), commandCatalog = new Map();
let commandOptions = [], commandIndex = 0, commandDismissed = false, commandRender;
function parseLogin(input) {
  const value = input.trim().replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').replace(/&amp;/gi, '&');
  const start = value.search(/(?:^|[#?&/])token=/);
  let nextToken, nextKey;
  if (start >= 0) {
    const params = new URLSearchParams(value.slice(start).replace(/^[#?&/]/, ''));
    nextToken = params.get('token'); nextKey = params.get('key');
  } else if (loopback && value && !/[\s:/#?&=]/.test(value)) nextToken = value;
  if (!nextToken) throw new Error('Link incomplete: missing token=. Paste the whole private link.');
  // Token-only shortcuts can reuse only the key saved for that exact token.
  nextKey ??= nextToken === token ? key : '';
  if (!nextKey && !loopback) throw new Error('Link incomplete: paste the whole link including &key=');
  if (nextKey && !validKey(nextKey)) throw new Error('Link incomplete: the &key= encryption key is invalid. Paste the whole private link.');
  return { token: nextToken, key: nextKey };
}
function rememberLogin(nextToken, nextKey) {
  // Older shortcuts may contain only a token; reuse a key only for that same token.
  const resolvedKey = nextKey ?? (nextToken === token ? key : '');
  if (nextToken !== token || resolvedKey !== key) { videoCache?.clear(); videoCache = undefined; }
  key = resolvedKey; token = nextToken;
  if (token && !videoCache) videoCache = new VideoCache(JSON.stringify([token, key]));
  if (token) localStorage.setItem('pi-remote-token', token);
  if (key) localStorage.setItem('pi-remote-key', key); else localStorage.removeItem('pi-remote-key');
  sessionStorage.removeItem('pi-remote-token');
}
function readLoginHash() {
  const value = location.hash || location.search;
  if (!/(?:^|[#?&])token=/.test(value)) return false;
  loginLinkError = '';
  try {
    const credentials = parseLogin(value);
    rememberLogin(credentials.token, credentials.key);
    homeScreenLogin = !standalone && !loopback;
    if (homeScreenLogin) {
      $('home-screen-hint').hidden = false;
      $('home-screen-message').textContent = 'Login saved. Open Pi Remote from your Home Screen.';
    }
  } catch (error) { loginLinkError = error.message; }
  history.replaceState(null, '', location.pathname);
  return true;
}
// Preserve existing tab logins when upgrading to persistent browser storage.
if (!readLoginHash()) rememberLogin(token, key);
window.addEventListener('hashchange', () => {
  if (readLoginHash()) { if (loginLinkError) showLogin(loginLinkError); else connect(); }
});
const COPY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const COPIED_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
function copyButton(text, label, className) {
  const button = el('button', undefined, 'quiet ' + className); button.type = 'button';
  button.setAttribute('aria-label', label); button.title = label; button.innerHTML = COPY_ICON;
  button.addEventListener('click', async () => {
    const sessionId = selected;
    haptic(); $('copy-status').textContent = '';
    try { await navigator.clipboard.writeText(text); }
    catch { notice('Could not copy. Select the text and copy it manually.', sessionId); return; }
    button.innerHTML = COPIED_ICON; button.setAttribute('aria-label', 'Copied'); button.title = 'Copied';
    $('copy-status').textContent = label === 'Copy code' ? 'Code copied.' : 'Message copied.';
    setTimeout(() => { button.innerHTML = COPY_ICON; button.setAttribute('aria-label', label); button.title = label; }, 1500);
  });
  return button;
}
// iOS Safari has no navigator.vibrate; toggling a hidden switch input (iOS 18+) plays a system haptic.
function haptic() {
  if (navigator.vibrate?.(10)) return;
  const label = document.createElement('label'); label.hidden = true;
  const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', '');
  label.append(input); document.body.append(label); label.click(); label.remove();
}
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function resetScrollback() {
  historyGeneration++; historyWindow = undefined; historyRequest = undefined; historyForward = []; historyError = ''; historyScrollTop = 0; historyTouch = undefined;
}
function showLatest() {
  resetScrollback();
  const state = cache.get(selected);
  if (state) renderConversation(state);
  $('transcript').scrollTop = $('transcript').scrollHeight;
}
function readingAnchor() {
  const top = $('transcript').getBoundingClientRect().top;
  const node = [...$('transcript').querySelectorAll('[data-scroll-key]')].find(item => item.getBoundingClientRect().bottom > top);
  return node && { key: node.dataset.scrollKey, id: node.dataset.messageId, top: node.getBoundingClientRect().top };
}
function mergeHistory(before, after) {
  const messages = [...before];
  const ids = new Map(messages.map((message, index) => [message.id, index]));
  const aliases = new Map(messages.filter(message => message.liveId).map(message => [message.liveId, ids.get(message.id)]));
  for (const message of after) {
    // Do not collapse distinct saved entries that happen to share a timestamp.
    const index = ids.get(message.id) ?? (message.liveId ? ids.get(message.liveId) : aliases.get(message.id));
    if (index === undefined) { ids.set(message.id, messages.length); messages.push(message); }
    else {
      const previous = messages[index];
      if (previous.liveId === message.id) messages[index] = { ...message, id: previous.id, liveId: previous.liveId };
      else { ids.delete(previous.id); messages[index] = message; ids.set(message.id, index); }
    }
    if (message.liveId) aliases.set(message.liveId, ids.get(message.id));
  }
  return messages;
}
async function loadHistory(direction) {
  const state = cache.get(selected);
  if (!state) return;
  if (direction === 'after') {
    if (!historyWindow) {
      if (historyRequest && atThreadBottom()) showLatest();
      return;
    }
    const messages = historyWindow.messages;
    const combined = mergeHistory(messages, mergeHistory(historyForward, state.messages));
    if (combined.length === messages.length) {
      if (atThreadBottom()) showLatest();
      return;
    }
    const anchor = readingAnchor(), next = combined.slice(0, messages.length + 100);
    historyRequest = undefined; historyError = '';
    historyForward = combined.slice(next.length);
    historyWindow = { ...historyWindow, messages: next.slice(-200), older: historyWindow.older || next.length > 200 };
    renderConversation(state, { anchor, historyChanged: true });
    if (!historyForward.length && atThreadBottom()) showLatest();
    return;
  }
  if (!supportsHistory || !connected || historyRequest || !(historyWindow?.older ?? state.historyTruncated)) return;
  const messages = [...(historyWindow?.messages || state.messages)], cursor = messages[0];
  if (!cursor) return;
  const current = historyRequest = { sessionId: selected, generation: historyGeneration, direction };
  historyError = '';
  renderConversation(state, { anchor: readingAnchor(), historyChanged: true });
  try {
    const page = await request('history', { sessionId: selected, before: cursor.id, expectedTip: historyWindow?.tip });
    if (historyRequest !== current || selected !== current.sessionId || historyGeneration !== current.generation) return;
    const anchor = readingAnchor(), combined = mergeHistory(page.messages, messages);
    // Keep evicted newer records in memory for the return scroll.
    historyForward = mergeHistory(combined.slice(200), historyForward);
    historyWindow = { messages: combined.slice(0, 200), tip: page.tip, older: page.older };
    historyRequest = undefined;
    renderConversation(cache.get(selected), { anchor, historyChanged: true });
  } catch (error) {
    if (historyRequest !== current) return;
    historyRequest = undefined; historyError = error.message;
    renderConversation(cache.get(selected), { anchor: readingAnchor(), historyChanged: true });
  }
}
function notice(text, sessionId = '') {
  // Connection state belongs in the composer, not in persistent error notices.
  if (text === 'Computer is disconnected' || text === 'Computer is offline') return;
  $('notice').textContent = text || ''; $('notice').hidden = !text;
  $('notice').dataset.sessionId = sessionId;
}
function request(op, extra = {}) {
  if (!connected || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Computer is disconnected'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('No acknowledgement. Check the conversation before sending again.')); }, 35000);
    const lookup = supportsCommandResults && ['command', 'new', 'newProject', 'resume', 'answer'].includes(op)
      ? { op: 'commandResult', id, sessionId: op === 'newProject' ? 'new-project' : extra.sessionId, requestId: id } : undefined;
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
function showLogin(text = '') {
  manualClose = true; disconnect();
  $('login-error').textContent = text; $('login-error').hidden = !text;
  $('access-warning').hidden = true;
  $('boot').hidden = true; $('app').hidden = true; $('login').hidden = false;
  $('login-cancel').hidden = !token; $('login-logout').hidden = !token;
}
function loginFailed(text) {
  $('access-message').textContent = text; $('access-warning').hidden = false;
  reconnect(text);
}
async function homeScreenPairing() {
  homeScreenLogin = false;
  try {
    const pairing = await request('pairingCode');
    $('home-screen-code').textContent = 'If the app still asks for a login, enter ' + pairing.code + ' there. This code is single use and expires in 60 seconds.';
    clearTimeout(homeScreenTimer);
    homeScreenTimer = setTimeout(() => { $('home-screen-code').textContent = 'Code expired. Run /pi-remote on your computer for a new pairing code.'; }, Math.max(0, pairing.expiresAt - Date.now()));
  } catch { $('home-screen-code').textContent = 'If the app still asks for a login, enter the pairing code shown by /pi-remote on your computer.'; }
}
// The first connection keeps the boot screen until sessions arrive, so the app never flashes empty.
function showApp() { $('boot').hidden = true; $('app').hidden = false; }
// Routine reconnects (foreground return, network change) finish in a moment; only a lasting outage shows the banner.
let bannerTimer;
function connection(text, compact = text) {
  $('connection').textContent = text;
  $('composer-connection-text').textContent = compact;
  $('composer-connection').title = text;
  $('composer-connection').setAttribute('aria-label', text);
  if (connected) { clearTimeout(bannerTimer); bannerTimer = undefined; $('connection').hidden = true; }
  else bannerTimer ??= setTimeout(() => { $('connection').hidden = connected; }, 2000);
  updateControls(); renderPagination();
}
function disconnect() {
  closePicker(); supportsUsage = false;
  listRequest++; legacyList = undefined; projectRequest = undefined;
  const old = socket; socket = undefined; connected = false; supportsHistory = false; supportsImages = false; supportsUploads = false; supportsVideos = false; supportsCommandResults = false; allowResume = false;
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
function reconnect(reason = 'Connection interrupted') {
  disconnect();
  if (manualClose || !token) return;
  connectionReason = reason;
  showApp(); connection("Couldn't connect, retrying. " + reason, 'Reconnecting…');
  reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
}
function connect() {
  $('qr-scanner').close();
  disconnect(); manualClose = false;
  if (key && !validKey(key)) { showLogin('Link incomplete: the &key= encryption key is invalid. Paste the whole private link.'); return; }
  if (!key && !loopback) { showLogin('Link incomplete: paste the whole link including &key='); return; }
  $('login').hidden = true; if ($('app').hidden) $('boot').hidden = false;
  connection(retry ? "Couldn't connect, retrying. " + connectionReason : 'Connecting…', retry ? 'Reconnecting…' : 'Connecting…');
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket = ws;
  // Bound the whole attempt, including an open transport that never receives ready.
  connectionTimer = setTimeout(() => reconnect('Connection timed out'), 20000);
  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    // A connected computer answers within seconds; relay close frames can be lost in its proxy.
    clearTimeout(connectionTimer); connectionTimer = setTimeout(() => reconnect('Connection timed out'), 8000);
    ws.send(JSON.stringify({ type: 'auth', token, ...(key ? { e2e: true } : {}) }));
    if (key) { ws.hello = hello(); ws.send(JSON.stringify(ws.hello.packet)); }
  });
  const encryptionFailed = () => { if (socket === ws) loginFailed('Encryption check failed. Pair again.'); };
  ws.addEventListener('message', event => {
    if (socket !== ws) return;
    if (!key) { receive(event.data); return; }
    if (ws.channel) { ws.channel.then(sealed => sealed.open(event.data)).then(receive, encryptionFailed); return; }
    // Before the host's hello, only relay notices arrive in plaintext.
    let packet;
    try { packet = JSON.parse(event.data); } catch { return; }
    if (packet?.type === 'hello' && ws.hello) { ws.channel = channel(key, ws.hello.nonce, packet.nonce); ws.channel.catch(encryptionFailed); }
    else if (packet?.type === 'notice') { notice(packet.error); if (packet.error === 'Computer is offline') reconnect('Your computer is offline'); }
  });
  function receive(data) {
    if (socket !== ws) return;
    let packet;
    try { packet = JSON.parse(data); } catch { return; }
    if (!packet || typeof packet !== 'object') return;
    if (connected || packet.type === 'ready') { clearTimeout(connectionTimer); connectionTimer = undefined; }
    if (packet.type === 'ready') {
      supportsUsage = packet.supportsUsage === true;
      supportsHistory = packet.supportsHistory === true;
      supportsImages = packet.supportsImages === true;
      supportsUploads = packet.supportsUploads === true;
      supportsVideos = packet.supportsVideos === true;
      supportsCommandResults = packet.supportsCommandResults === true;
      supportsSessionSections = packet.supportsSessionSections === true;
      supportsSessionClosing = packet.supportsSessionClosing === true;
      if (supportsSessionSections) legacyList = undefined;
      blankDir = typeof packet.blankDir === 'string' ? packet.blankDir : undefined;
      for (const [id, item] of pending) {
        if (!item.recovering) continue;
        item.recovering = false;
        if (supportsCommandResults) transmit(ws, item.lookup);
        else {
          clearTimeout(item.timer); pending.delete(id);
          item.reject(new Error('Delivery outcome is unknown. Inspect the conversation before sending again.'));
        }
      }
      connected = true; retry = 0; connection('Computer connected'); $('login-error').hidden = true; $('access-warning').hidden = true;
      if (homeScreenLogin) {
        if (packet.supportsPairing) void homeScreenPairing();
        else { homeScreenLogin = false; $('home-screen-code').textContent = 'If the app still asks for a login, enter the pairing code shown by /pi-remote on your computer.'; }
      }
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => { if (socket === ws) probe(); }, 20000);
      loadProjects();
      if (supportsSessionSections || listLimit > 20 || searchQuery || listError) loadList();
      if (selected && !cache.get(selected)?.creation) {
        const id = selected;
        request('watch', { sessionId: id }).then(() => loadUsage(id)).catch(e => notice(e.message));
        loadCommands(id);
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
    if (event.code === 1008 && ['Authentication failed', 'Invalid authentication'].includes(event.reason)) {
      loginFailed('This login is no longer valid. Login expired, pair again'); return;
    }
    if (event.code === 1008 && /[Ee]ncryption/.test(event.reason)) {
      loginFailed('Encryption check failed. Pair again.'); return;
    }
    reconnect(event.reason || undefined);
  });
  ws.addEventListener('error', () => { if (socket === ws) reconnect(); });
}
// Any reply clears the timer; silence means a half-open socket.
function probe() {
  if (connectionTimer) return;
  connectionTimer = setTimeout(() => reconnect('Connection timed out'), 10000);
  transmit(socket, { op: 'ping', id: crypto.randomUUID() });
}
// Mobile browsers suspend sockets and timers in the background. Start fresh on return.
function reconnectNow() { if (token && !manualClose) { retry = 0; connect(); } }
window.addEventListener('online', reconnectNow);
// iOS also hides the page for a moment during edge-swipe back; a brief hide only checks the socket,
// so returning to the list doesn't flash Connecting….
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  fitViewport();
  if (connected && Date.now() - hiddenAt < 5000) probe(); else reconnectNow();
});
window.addEventListener('storage', event => {
  if (event.storageArea === localStorage && (event.key === 'pi-remote-token' || event.key === null) && !event.newValue) logout();
});
function logout() {
  resetSwipe();
  manualClose = true; disconnect(); $('project-picker').close(); $('qr-scanner').close(); $('session-collection').close();
  videoCache?.clear(); videoCache = undefined;
  clearTimeout(homeScreenTimer); homeScreenLogin = false;
  $('home-screen-hint').hidden = true; $('access-warning').hidden = true;
  token = ''; key = ''; localStorage.removeItem('pi-remote-token'); localStorage.removeItem('pi-remote-key'); sessionStorage.removeItem('pi-remote-token');
  for (const images of imageDrafts.values()) releaseImages(images);
  for (const draft of sending.values()) releaseImages(draft.attachments);
  for (const draft of submissions.values()) releaseImages(draft.attachments);
  imageDrafts.clear(); sending.clear(); submissions.clear();
  clearThreadImages(); clearThreadVideos();
  localStorage.removeItem('pi-remote-seen'); seen = {}; localStorage.removeItem('pi-remote-pins'); pinnedProjects = [];
  projectList = undefined; renderProjects();
  $('session-icon-picker').close();
  localStorage.removeItem('pi-remote-session-icons'); sessionIcons.clear();
  resetScrollback();
  drafts.clear(); cache.clear(); commandCatalog.clear(); usageSummaries.clear(); usageDetails.clear(); selected = undefined; selectedSummary = undefined; sessions = [];
  clearTimeout(searchTimer); $('search').value = ''; $('search-bar').classList.remove('open'); listLimit = 20; searchQuery = ''; listMatched = 0; listLoading = true; listError = '';
  listSection = 'overview'; listGroups = undefined; listLoaded = 0; overviewLimit = 20;
  sessionFeedback(''); renderList();
  renderImages();
  $('prompt').value = ''; $('transcript').replaceChildren();
  $('login-cancel').hidden = true; $('login-logout').hidden = true;
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
// Match the host: user prompts move rows, background activity only refreshes their contents.
const listOrder = (a, b) => !!b.pinned - !!a.pinned || (b.lastPromptAt ?? b.updatedAt) - (a.lastPromptAt ?? a.updatedAt) || a.id.localeCompare(b.id);
function receiveList(packet) {
  // Section-aware phones request their overview after ready; ignore the initial legacy page.
  if (supportsSessionSections && packet.section === undefined) return;
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
    rows = [...byId.values()];
  } else {
    // Whole pages: the first push after connecting, and hosts that predate scroll windows (always 20 rows).
    if ((packet.query ?? '') !== searchQuery) return;
    rows = packet.sessions; listLoading = false; listError = '';
  }
  sessions = rows.sort(packet.section === 'now' ? activityOrder : listOrder);
  if (supportsSessionSections && (packet.section !== listSection || packet.query !== searchQuery)) return;
  allowResume = packet.allowResume === true;
  listMatched = packet.matched ?? sessions.length; listLoaded = packet.loaded ?? sessions.length; listGroups = packet.groups;
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
    const page = legacyList || await request('list', { limit: listLimit, query: searchQuery, ...(supportsSessionSections ? { section: listSection } : {}) });
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
  listRoot().setAttribute('aria-busy', String(listLoading));
  listRoot().inert = listLoading;
  $('list-retry').hidden = !listError; $('list-retry').disabled = !connected || listLoading;
  // Scrolling loads more by itself; the line only speaks up while loading or after a failure.
  $('list-page').textContent = listError ? 'Could not load sessions. Try again.' : listLoading ? 'Loading sessions…' : '';
  $('list-page').parentElement.hidden = !listError && !listLoading;
  $('list-empty').hidden = listLoading || !!listError || sessions.length > 0;
}
// Reaching the last row asks for the next 20; a short screen keeps filling until it scrolls.
const moreObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loadMore(); }, { rootMargin: '0px 0px 400px' });
function loadMore() {
  if (!connected || listLoading || listError || listLoaded < listLimit || listLoaded >= listMatched) return;
  listLimit += 20; loadList();
}
function sessionRow(item) {
  const button = el('button', undefined, 'session' + (item.id === selected ? ' active' : ''));
  button.type = 'button'; button.dataset.id = item.id; button.dataset.swipe = item.pinned ? 'Unpin' : 'Pin'; button.setAttribute('aria-current', String(item.id === selected));
  const icon = statusIcon(item.status);
  if (item.previewRole !== 'user' && item.updatedAt > seen[item.id]) { icon.dataset.unread = ''; icon.title = 'New reply'; }
  const indicators = el('span', undefined, 'session-indicators');
  indicators.append(icon);
  if (['idle', 'saved'].includes(item.status)) indicators.append(el('span', statusLabels[item.status], 'sr-only'));
  button.append(indicators);
  const body = el('div', undefined, 'session-body');
  const top = el('div', undefined, 'session-top');
  const titleText = sessionTitle(item.title, cache.get(item.id)?.messages);
  const title = el('strong', titleText, titleText === 'Untitled session' ? 'untitled' : undefined); title.title = titleText;
  top.append(title);
  if (item.pinned) {
    const pin = el('span', undefined, 'session-pinned'); pin.setAttribute('role', 'img'); pin.setAttribute('aria-label', 'Pinned'); pin.title = 'Pinned';
    pin.innerHTML = pinSvg; top.append(pin);
  }
  body.append(top);
  if (item.preview && item.preview !== item.title) {
    body.append(el('div', (item.previewRole === 'user' ? 'You: ' : 'Pi: ') + displayPaths(taskText({ role: item.previewRole, text: item.preview, truncated: true })), 'session-preview'));
  }
  const meta = el('div', undefined, 'session-meta');
  if (item.closed) meta.append(el('span', 'Closed', 'session-closed'));
  // Ready and Saved are the resting states; only label what needs attention.
  if (!['idle', 'saved'].includes(item.status)) {
    const status = el('span', statusLabels[item.status] || item.status, 'session-state');
    status.dataset.status = item.status;
    meta.append(status);
  }
  const typeIcon = sessionTypeIcon(item);
  if (typeIcon || !isBlank(item.cwd)) {
    const project = el('span', undefined, 'session-project');
    if (typeIcon) project.append(typeIcon);
    if (!isBlank(item.cwd)) {
      project.append(el('span', projectName(item.cwd), 'session-project-name'));
      project.title = displayPaths(item.cwd);
    }
    meta.append(project);
  }
  const date = new Date(item.updatedAt);
  if (Number.isFinite(date.getTime())) {
    const time = el('time', age(date), 'session-time');
    time.dateTime = date.toISOString(); time.title = 'Last activity: ' + date.toLocaleString();
    meta.append(time);
  }
  body.append(meta);
  button.append(body);
  // The finger lifting after a swipe must not also open the session.
  button.addEventListener('click', () => {
    if (Date.now() - swipedAt <= 400) return;
    selectSession(item.id); $('session-collection').close();
  });
  return button;
}
function renderList() {
  // Rebuilding mid-swipe would detach the touched row and strand the gesture; release renders instead.
  if (rowSwipe) { rowSwipe.stale = true; return; }
  const root = listRoot(), scrollTop = root.scrollTop, sidebarTop = $('sidebar').scrollTop;
  $('list-empty').textContent = searchQuery ? 'No matching sessions. Try another task or project.' :
    listSection === 'now' ? 'No sessions running.' : listSection === 'pinned' ? 'No pinned sessions.' : 'No sessions yet. Start Pi with the remote extension loaded.';
  renderPagination();
  const fragment = document.createDocumentFragment();
  if (listGroups && listSection === 'overview' && !searchQuery) {
    for (const [group, label] of [['now', 'Now'], ['pinned', 'Pinned'], ['recent', 'Recent']]) {
      if (!listGroups[group]) continue;
      const section = el('section', undefined, 'session-group session-group-' + group); section.setAttribute('aria-label', label);
      const header = el('div', undefined, 'session-group-heading');
      header.append(el('h3', label), el('span', String(listGroups[group]), 'badge'));
      if (group === 'pinned' || group === 'now' && listGroups[group] > 3) {
        const more = el('button', 'View all', 'quiet'); more.type = 'button'; more.dataset.collection = group;
        more.setAttribute('aria-label', 'View all ' + (group === 'now' ? 'active' : 'pinned') + ' sessions');
        more.addEventListener('click', () => openCollection(group)); header.append(more);
      }
      section.append(header);
      const items = sessions.filter(item => sessionGroup(item) === group);
      if (group === 'now') items.sort(activityOrder);
      section.append(...items.map(sessionRow)); fragment.append(section);
    }
  } else fragment.append(...sessions.map(sessionRow));
  root.replaceChildren(fragment);
  root.scrollTop = scrollTop; $('sidebar').scrollTop = sidebarTop;
  moreObserver.disconnect();
  const last = [...root.querySelectorAll('.session')].at(-1);
  if (last) moreObserver.observe(last);
  const current = sessions.find(item => item.id === selected);
  if (current) $('title').textContent = sessionTitle(current.title, cache.get(current.id)?.messages);
}
function openCollection(section) {
  overviewLimit = listLimit; listSection = section; listLimit = 20;
  moreObserver.disconnect(); $('collection-sessions').replaceChildren();
  $('collection-feedback').append($('session-feedback'), $('list-empty'), $('list-page').parentElement);
  $('session-collection-title').textContent = section === 'now' ? 'Active sessions' : 'Pinned sessions';
  $('session-collection').showModal(); $('session-collection').focus();
  loadList();
}
$('session-collection-close').addEventListener('click', () => $('session-collection').close());
$('session-collection').addEventListener('click', event => { if (event.target === $('session-collection')) $('session-collection').close(); });
$('session-collection').addEventListener('close', () => {
  const section = listSection;
  $('search-bar').before($('session-feedback'), $('list-empty'), $('list-page').parentElement);
  listSection = 'overview'; listLimit = overviewLimit; moreObserver.disconnect();
  if (!manualClose) loadList().then(() => {
    if (document.activeElement === document.body) $('sessions').querySelector(`[data-collection="${section}"]`)?.focus({ preventScroll: true, focusVisible: false });
  });
});
const pinSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 4h5l-.75 4.5L17 11.5V13h-4v5l-1 1-1-1v-5H7v-1.5l3.25-3L9.5 4Z"/></svg>';
async function togglePin(id) {
  const item = sessions.find(item => item.id === id) || (selected === id ? selectedSummary : undefined);
  try {
    const { pinned } = await request('pin', { sessionId: id, pinned: !item?.pinned });
    // Pinning can move the selected row outside the overview window.
    if (selected === id && selectedSummary) { selectedSummary.pinned = pinned; updateControls(); }
  } catch (e) { notice(e.message, id); }
}
let sessionFeedbackTimer;
function sessionFeedback(text, undoId) {
  clearTimeout(sessionFeedbackTimer);
  const box = $('session-feedback'); box.replaceChildren(); box.hidden = !text;
  if (!text) return;
  box.append(el('span', text));
  if (undoId) {
    const undo = el('button', 'Undo', 'quiet'); undo.type = 'button';
    undo.addEventListener('click', () => { sessionFeedback(''); closeSession(undoId, false); }); box.append(undo);
  }
  const dismiss = el('button', 'Dismiss', 'quiet'); dismiss.type = 'button';
  dismiss.addEventListener('click', () => sessionFeedback('')); box.append(dismiss);
  sessionFeedbackTimer = setTimeout(() => sessionFeedback(''), 8000);
}
function confirmCloseSession(id, keyboard = false) {
  const dialog = $('session-close-confirm');
  if (dialog.open) return;
  const item = sessions.find(item => item.id === id) || (selected === id ? selectedSummary : undefined);
  dialog.dataset.sessionId = id;
  $('session-close-name').textContent = sessionTitle(item?.title, cache.get(id)?.messages);
  dialog.showModal();
  $(keyboard ? 'session-close-cancel' : 'session-close-confirm').focus({ preventScroll: true });
}
$('session-close-cancel').addEventListener('click', () => $('session-close-confirm').close());
$('session-close-confirm').addEventListener('click', event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('session-close-confirm-button').addEventListener('click', () => {
  const dialog = $('session-close-confirm'), id = dialog.dataset.sessionId;
  dialog.close(); closeSession(id);
});
async function closeSession(id, closed = true) {
  try {
    await request('closeSession', { sessionId: id, closed });
    if (closed && selected === id) {
      drafts.set(id, $('prompt').value);
      resetSwipe(); closePicker(); clearThreadImages(); clearThreadVideos(); resetScrollback();
      selected = undefined; selectedSummary = undefined;
      document.querySelector('.session-info').open = false;
      $('session-icon-picker').close(); $('app').classList.remove('viewing');
      $('title').textContent = 'Pi Remote'; renderProject(); notice('');
      $('transcript').replaceChildren(); $('transcript').hidden = true; $('dialog').hidden = true;
      $('empty').hidden = false; $('composer').hidden = true;
      if (history.state?.session) history.back();
      renderList(); updateControls();
    }
    sessionFeedback(closed ? 'Session closed. History is kept; active work continues.' : 'Session reopened.', closed ? id : undefined);
  } catch (e) { sessionFeedback(e.message); if (selected === id) notice(e.message, id); }
}
$('session-close').addEventListener('click', event => confirmCloseSession(selected, event.detail === 0));
$('session-pin').addEventListener('click', () => {
  document.querySelector('.session-info').open = false;
  togglePin(selected);
});
// Swipe right to pin or unpin, left to close. Vertical drags still scroll the list.
const rowSwipeDistance = 72;
let rowSwipe, swipedAt = 0;
for (const list of [$('sessions'), $('collection-sessions')]) list.addEventListener('touchstart', event => {
  endRowSwipe(false);
  const row = event.target.closest('.session'), touch = event.touches[0];
  rowSwipe = row && event.touches.length === 1 && (window.visualViewport?.scale ?? 1) <= 1 ? { row, x: touch.clientX, y: touch.clientY, dx: 0 } : undefined;
}, { passive: true });
for (const list of [$('sessions'), $('collection-sessions')]) list.addEventListener('touchmove', event => {
  if (!rowSwipe) return;
  if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1) { endRowSwipe(false); return; }
  const touch = event.touches[0], dx = touch.clientX - rowSwipe.x, dy = touch.clientY - rowSwipe.y;
  if (!rowSwipe.active) {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { endRowSwipe(false); return; }
    if (Math.abs(dx) < 8 || dx < 0 && !supportsSessionClosing) return;
    rowSwipe.active = true; rowSwipe.row.style.transition = ''; rowSwipe.row.classList.add('dragging');
  }
  event.preventDefault();
  const distance = supportsSessionClosing ? dx : Math.max(0, dx), ready = Math.abs(distance) > rowSwipeDistance;
  if (ready !== (Math.abs(rowSwipe.dx) > rowSwipeDistance)) haptic();
  rowSwipe.dx = distance;
  rowSwipe.row.classList.toggle('swipe-ready', ready);
  rowSwipe.row.classList.toggle('closing', rowSwipe.dx < 0);
  rowSwipe.row.style.transform = `translateX(${Math.max(-rowSwipeDistance * 1.5, Math.min(rowSwipe.dx, rowSwipeDistance * 1.5))}px)`;
}, { passive: false });
function endRowSwipe(commit = true) {
  const swipe = rowSwipe;
  if (!swipe) return;
  rowSwipe = undefined;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
  if (swipe.active) {
    swipe.row.style.transition = duration ? 'transform .2s ease-out' : 'none'; swipe.row.style.transform = ''; swipe.row.classList.remove('swipe-ready');
    swipedAt = Date.now();
    setTimeout(() => swipe.row.classList.remove('dragging', 'closing'), duration);
    if (commit && Math.abs(swipe.dx) > rowSwipeDistance) {
      if (swipe.dx < 0) confirmCloseSession(swipe.row.dataset.id);
      else togglePin(swipe.row.dataset.id);
    }
  }
  if (swipe.stale) setTimeout(renderList, swipe.active ? duration : 0);
}
for (const list of [$('sessions'), $('collection-sessions')]) {
  list.addEventListener('touchend', event => endRowSwipe(event.touches.length === 0));
  list.addEventListener('touchcancel', () => endRowSwipe(false));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) endRowSwipe(false); });
function sessionTypeIcon(item) {
  const choice = sessionIcons.get(item.id);
  const type = choice?.type || (/^(?:(?:pr|code|pull request)\s+)?(?:re-)?review\b/i.test(sessionTitle(item.title, cache.get(item.id)?.messages)) ? 'review' : 'none');
  if (type === 'none' || (type === 'custom' && !choice.icon)) return;
  const icon = el('span', type === 'custom' ? choice.icon : undefined, 'session-type-icon');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', type === 'custom' ? `Session icon: ${choice.icon}` : 'PR review');
  icon.title = icon.getAttribute('aria-label');
  if (type === 'review') icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M6 8v8M18 16V9a4 4 0 0 0-4-4h-1m2-2-2 2 2 2"/></svg>';
  return icon;
}
function renderSessionIconChoice() {
  const choice = sessionIcons.get(selected), type = choice?.type || 'auto';
  $('session-icon-current').textContent = type === 'custom' ? choice.icon : { auto: 'Automatic', review: 'PR review', none: 'None' }[type];
  for (const button of $('session-icon-options').children) button.setAttribute('aria-pressed', String(button.dataset.iconType === type));
  for (const button of $('session-emoji-options').children) button.setAttribute('aria-pressed', String(type === 'custom' && button.dataset.emoji === choice.icon));
  $('session-emoji-other').textContent = type === 'custom' ? `${choice.icon}  Other emoji…` : 'Other emoji…';
}
function saveSessionIcon(type, icon = '') {
  if (!selected) return;
  if (type === 'auto') sessionIcons.delete(selected);
  else sessionIcons.set(selected, { type, icon });
  localStorage.setItem('pi-remote-session-icons', JSON.stringify([...sessionIcons]));
  renderSessionIconChoice(); renderList();
}
for (const button of $('session-icon-options').children) button.addEventListener('click', () => saveSessionIcon(button.dataset.iconType));
for (const [emoji, name] of [['🔎', 'Research'], ['🐛', 'Bug'], ['🛠️', 'Tools'], ['💡', 'Idea'], ['📝', 'Notes'], ['⭐', 'Star']]) {
  const button = el('button', emoji);
  button.type = 'button'; button.dataset.emoji = emoji; button.setAttribute('aria-label', name);
  button.addEventListener('click', () => saveSessionIcon('custom', emoji));
  $('session-emoji-options').append(button);
}
$('session-icon-open').addEventListener('click', () => {
  document.querySelector('.session-info').open = false;
  $('session-emoji-form').hidden = true; $('session-emoji-other').setAttribute('aria-expanded', 'false');
  renderSessionIconChoice();
  $('session-icon-picker').showModal(); $('session-icon-picker').focus();
});
$('session-icon-done').addEventListener('click', () => $('session-icon-picker').close());
$('session-icon-picker').addEventListener('click', event => { if (event.target === $('session-icon-picker')) $('session-icon-picker').close(); });
$('session-icon-picker').addEventListener('close', () => document.querySelector('.session-info summary').focus({ preventScroll: true }));
$('session-emoji-other').addEventListener('click', () => {
  $('session-emoji-form').hidden = false; $('session-emoji-other').setAttribute('aria-expanded', 'true');
  $('session-custom-icon').value = sessionIcons.get(selected)?.icon || '';
  $('session-custom-icon').focus(); $('session-custom-icon').select();
});
$('session-emoji-form').addEventListener('submit', event => {
  event.preventDefault();
  const icon = [...new Intl.Segmenter().segment($('session-custom-icon').value.trim())][0]?.segment;
  if (!icon) return;
  saveSessionIcon('custom', icon); $('session-icon-picker').close();
});
function statusIcon(status) {
  const icon = el('span', undefined, 'session-icon');
  icon.dataset.status = status;
  // The list rebuilds on every update; the clock keeps the bricks in phase across replacements.
  if (status === 'working') icon.style.setProperty('--block-delay', `-${Date.now() % 900}ms`);
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = status === 'working'
    ? '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3" y="0" width="4" height="4"/><rect x="9" y="0" width="4" height="4"/><rect x="9" y="6" width="4" height="4"/><rect x="9" y="12" width="4" height="4"/><rect x="3" y="12" width="4" height="4"/><rect x="3" y="6" width="4" height="4"/></svg>'
    : status === 'waiting'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
    : '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg>';
  return icon;
}
function displayPaths(text) {
  return text.replace(/(^|[\s"'`=:(])\/(?:Users|home)\/[^/\s"'`:]+/g, '$1~');
}
// Sessions started without a project live in dated folders the host creates. Like a chat outside
// any project, they carry no project label; their title is their identity.
const isBlank = cwd => !!blankDir && !!cwd?.startsWith(blankDir + (blankDir.includes('\\') ? '\\' : '/'));
function projectName(cwd) {
  if (isBlank(cwd)) return '';
  cwd = displayPaths(cwd);
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
}
function renderProject(cwd = '') {
  $('project').textContent = displayPaths(cwd);
  $('project-name').textContent = projectName(cwd);
  $('project-name').hidden = !$('project-name').textContent;
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
  const entering = !$('app').classList.contains('viewing') && matchMedia('(max-width: 700px)').matches;
  resetScrollback();
  resetSwipe();
  closePicker();
  if (selected) drafts.set(selected, $('prompt').value);
  if (selected !== id) { clearThreadImages(); clearThreadVideos(); }
  selected = id; selectedSummary = sessions.find(item => item.id === id); $('prompt').value = drafts.get(id) || '';
  renderImages();
  commandDismissed = false; commandIndex = 0;
  if (!cache.get(id)?.creation) loadCommands(id);
  lastDialog = undefined; $('dialog').hidden = true;
  $('transcript').replaceChildren();
  updateScrollButton();
  document.querySelector('.session-info').open = false;
  $('session-icon-picker').close();
  renderSessionIconChoice();
  renderProject(selectedSummary?.cwd);
  // An entry for the open conversation lets edge-swipe and browser Back return to the list instead of leaving the app.
  if (!standalone && !history.state?.session) history.pushState({ session: true }, '');
  $('app').classList.add('viewing');
  if (entering) {
    $('app').classList.add('opening'); $('sidebar').inert = true;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    openingAnimation = document.querySelector('main').animate(reduced
      ? [{ opacity: .6 }, { opacity: 1 }]
      : [{ transform: 'translateX(100%)' }, { transform: 'none' }],
    { duration: reduced ? 120 : 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    openingAnimation.onfinish = () => {
      openingAnimation = undefined;
      $('app').classList.remove('opening'); $('sidebar').inert = false;
    };
  }
  markSeen(); renderList(); notice(''); sessionFeedback('');
  const state = cache.get(id);
  if (state) renderConversation(state);
  else {
    $('title').textContent = sessionTitle(sessions.find(x => x.id === id)?.title || 'Loading…');
    const loading = el('p', 'Loading conversation…', 'conversation-loading'); loading.setAttribute('role', 'status');
    const spinner = el('span', undefined, 'connection-spinner'); spinner.setAttribute('aria-hidden', 'true'); loading.prepend(spinner);
    $('transcript').replaceChildren(loading); $('transcript').setAttribute('aria-busy', 'true');
    $('transcript').hidden = false; $('empty').hidden = true;
    $('composer').hidden = false; updateControls();
  }
  resizePrompt();
  if (state?.creation) return;
  try {
    if (selectedSummary?.closed) await request('closeSession', { sessionId: id, closed: false });
    await request('watch', { sessionId: id }); loadUsage(id);
  }
  catch (e) {
    if (selected !== id) return;
    if (!cache.has(id)) {
      $('transcript').setAttribute('aria-busy', 'false');
      $('transcript').replaceChildren(el('p', 'Could not load conversation. Go back and try again.', 'hint'));
    }
    notice(e.message);
  }
}
function clearThreadImages(keep = new Set()) {
  for (const [id, image] of threadImages) if (!keep.has(id)) {
    if (image.url && $('image-viewer').querySelector('img').src === image.url) $('image-viewer').close();
    imageObserver.unobserve(image.node);
    clearTimeout(image.retryTimer);
    if (image.url) URL.revokeObjectURL(image.url);
    threadImages.delete(id);
  }
}
const imageViewer = $('image-viewer'), imageStage = $('image-stage'), fullImage = imageViewer.querySelector('img');
const imagePointers = new Map();
let imageZoom = 1, imageX = 0, imageY = 0, imagePull;
function resetImagePull() {
  imagePull = undefined; imageViewer.style.transform = '';
}
function positionImage(zoom = imageZoom, x = imageX, y = imageY) {
  imageZoom = Math.max(1, Math.min(8, zoom));
  const fit = Math.min(imageStage.clientWidth / (fullImage.naturalWidth || 1), imageStage.clientHeight / (fullImage.naturalHeight || 1));
  const limitX = Math.max(0, (fullImage.naturalWidth * fit * imageZoom - imageStage.clientWidth) / 2);
  const limitY = Math.max(0, (fullImage.naturalHeight * fit * imageZoom - imageStage.clientHeight) / 2);
  imageX = Math.max(-limitX, Math.min(limitX, x)); imageY = Math.max(-limitY, Math.min(limitY, y));
  fullImage.style.transform = `translate(${imageX}px, ${imageY}px) scale(${imageZoom})`;
  imageStage.classList.toggle('zoomed', imageZoom > 1);
  $('image-zoom-reset').textContent = Math.round(imageZoom * 100) + '%';
  $('image-zoom-out').disabled = imageZoom <= 1; $('image-zoom-in').disabled = imageZoom >= 8;
}
function zoomImage(zoom, x = 0, y = 0) {
  const next = Math.max(1, Math.min(8, zoom)), ratio = next / imageZoom;
  positionImage(next, x - (x - imageX) * ratio, y - (y - imageY) * ratio);
}
function openImage(event) {
  event.preventDefault();
  resetImagePull(); imagePointers.clear(); fullImage.src = event.currentTarget.href;
  imageViewer.showModal(); positionImage(1, 0, 0); imageViewer.focus();
}
function showThreadImage(image, blob) {
  image.url = URL.createObjectURL(blob);
  const link = el('a'), preview = el('img');
  link.href = image.url;
  link.setAttribute('aria-label', 'Open image');
  link.addEventListener('click', openImage);
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
  gallery.dataset.scrollKey = 'images:' + message.id;
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
function clearThreadVideos(keep = new Set()) {
  for (const [path, video] of threadVideos) if (!keep.has(path)) {
    videoObserver.unobserve(video.node);
    if (video.player) { video.player.pause(); video.player.removeAttribute('src'); video.player.load(); }
    if (video.url) URL.revokeObjectURL(video.url);
    if (video.posterURL) URL.revokeObjectURL(video.posterURL);
    threadVideos.delete(path);
  }
}
function showThreadVideo(video, file, poster) {
  video.url = URL.createObjectURL(file);
  // The conversation owns its thumbnail URL; sending releases the composer's URL.
  if (poster) video.posterURL = URL.createObjectURL(poster);
  const player = el('video'); video.player = player;
  player.controls = true; player.playsInline = true; player.preload = 'none';
  player.setAttribute('aria-label', video.name);
  if (video.posterURL) player.poster = video.posterURL;
  player.src = video.url;
  const download = el('a', 'Download video'); download.href = video.url; download.download = video.name;
  download.setAttribute('aria-label', `Download ${video.name}`);
  // iOS may open a blob download in its viewer; never replace the standalone chat.
  download.target = '_blank'; download.rel = 'noopener noreferrer';
  download.addEventListener('click', async event => {
    const data = { files: [new File([file], video.name, { type: file.type })] };
    if (!navigator.share || !navigator.canShare?.(data)) return;
    event.preventDefault();
    player.pause();
    try { await navigator.share(data); }
    catch (error) {
      if (error.name !== 'AbortError') notice('Could not save video. Try again or open Pi Remote in Safari.');
    } finally { fitViewport(); }
  });
  player.addEventListener('error', () => {
    if (threadVideos.get(video.path) !== video) return;
    video.node.replaceChildren(el('p', 'This browser cannot play this video.'), download);
  });
  video.node.replaceChildren(player, download);
}
async function loadVideoPreview(video) {
  if (!video || video.loading || video.info || video.url) return;
  video.loading = true; video.button.disabled = true;
  try {
    const info = await request('videoRead', { sessionId: video.sessionId, path: video.path, messageId: video.messageId });
    if (threadVideos.get(video.path) !== video) return;
    if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > MAX_VIDEO_BYTES) throw new Error('Invalid video size');
    video.info = info;
    video.button.setAttribute('aria-label', `Play ${video.name}`);
    if (video.posterURL) { URL.revokeObjectURL(video.posterURL); video.posterURL = undefined; }
    if (info.poster) {
      const [poster] = validateImages([info.poster]);
      video.posterURL = URL.createObjectURL(new Blob([Uint8Array.from(atob(poster.data), c => c.charCodeAt(0))], { type: poster.mimeType }));
      const image = el('img'); image.src = video.posterURL; image.alt = '';
      const play = el('span', undefined, 'video-play-icon'); play.setAttribute('aria-hidden', 'true');
      play.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg>';
      video.button.replaceChildren(image, play);
    } else video.button.textContent = 'Play video';
  } catch (error) {
    video.info = undefined; video.button.textContent = 'Video unavailable. Retry'; video.button.title = error.message;
  } finally { video.loading = false; video.button.disabled = false; }
}
async function playThreadVideo(video) {
  if (video.loading) return;
  if (!video.info) await loadVideoPreview(video);
  if (!video.info || threadVideos.get(video.path) !== video) return;
  const ws = socket, storage = videoCache, cacheId = JSON.stringify([video.sessionId, video.path]);
  const check = () => {
    if (socket !== ws || threadVideos.get(video.path) !== video) throw new Error('Video loading interrupted');
  };
  video.loading = true; video.button.disabled = true;
  try {
    let file = await storage?.get(cacheId, video.info);
    check();
    if (!file) {
      const chunks = [];
      for (let offset = 0; offset < video.info.size;) {
        check();
        video.button.textContent = `Loading video ${Math.round(offset / video.info.size * 100)}%`;
        const result = await request('videoRead', { sessionId: video.sessionId, path: video.path, offset, messageId: video.messageId });
        check();
        if (result.size !== video.info.size || result.revision !== video.info.revision || typeof result.data !== 'string' || result.data.length > Math.ceil(VIDEO_CHUNK_BYTES / 3) * 4) throw new Error('Invalid video data');
        const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
        if (!bytes.length || bytes.length > Math.min(VIDEO_CHUNK_BYTES, video.info.size - offset)) throw new Error('Invalid video chunk');
        chunks.push(bytes); offset += bytes.length;
      }
      file = new Blob(chunks, { type: video.info.mimeType });
      await storage?.put(cacheId, video.info, file);
      check();
    }
    showThreadVideo(video, file);
    video.player.play().catch(() => {}); // Safari may require another tap after the download.
  } catch (error) {
    video.info = undefined;
    video.button.textContent = 'Could not load video. Retry'; video.button.title = error.message;
  } finally { video.loading = false; video.button.disabled = false; }
}
function appendThreadVideos(parent, message, attachments, keep) {
  const sources = attachments?.length ? attachments.map(item => ({ path: item.staged?.path || item.url, file: item.file, poster: item.posterBlob }))
    : splitVideoMessage(userMessageText(message), message.role).paths.map(path => ({ path }));
  for (const { path, file, poster } of sources) {
    keep.add(path);
    let video = threadVideos.get(path);
    if (!video) {
      const node = el('div', undefined, 'thread-video'), button = el('button', 'Loading video preview…', 'secondary');
      button.type = 'button'; node.dataset.videoPath = path; node.append(button);
      video = { path, name: file?.name || path.split('/').at(-1), node, button, sessionId: selected, messageId: message.id };
      threadVideos.set(path, video);
      button.addEventListener('click', () => playThreadVideo(video));
      if (file) showThreadVideo(video, file, poster);
      else videoObserver.observe(node);
    }
    parent.append(video.node);
  }
}
function formatToolDuration(durationMs) {
  const seconds = Math.round(durationMs / 1000);
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : durationMs < 60000 ? `${(durationMs / 1000).toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function renderConversation(state, { anchor, historyChanged = false } = {}) {
  $('title').textContent = sessionTitle(sessions.find(item => item.id === selected)?.title || state.title, state.messages);
  renderProject(state.cwd);
  $('status').textContent = state.status; $('status').dataset.status = state.status;
  $('empty').hidden = true; $('transcript').hidden = false; $('composer').hidden = false;
  if (state.error || $('notice').dataset.sessionId === state.id) notice(state.error, state.id);
  $('transcript').setAttribute('aria-busy', String(!!historyRequest));
  if ((historyWindow || historyRequest) && !historyChanged) historyForward = mergeHistory(historyForward, state.messages);
  if (historyWindow && !historyChanged) {
    // Live patches update controls, not the historical DOM or the reader's scroll position.
    renderDialog(state); updateControls(); updateScrollButton(); return;
  }
  if (historyWindow) state = { ...state, messages: historyWindow.messages, tools: [] };
  const box = $('transcript'), bottom = !anchor && atThreadBottom(), oldScroll = box.scrollTop;
  const fragment = document.createDocumentFragment();
  const expanded = new Map([...box.querySelectorAll('details[data-disclosure-id]')].map(node => [node.dataset.disclosureId, node.open]));
  const focusedTool = box.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.disclosureId : undefined;
  const messages = [...(state.messages || [])], localImages = new Map(), localVideos = new Map(), keepVideos = new Set();
  const playing = [...threadVideos.values()].filter(video => video.player && !video.player.paused);
  const matched = [];
  for (const outgoing of submissions.values()) {
    if (outgoing.sessionId !== selected) continue;
    const images = outgoing.attachments.filter(item => !item.video);
    const text = outgoing.sentText ?? outgoing.text;
    const index = messages.findIndex(message => message.role === 'user' && !outgoing.knownIds.has(message.id) &&
      !localImages.has(message.id) && userMessageText(message).trim() === text.trim() &&
      (message.images?.length || 0) === images.length);
    const message = index < 0 ? { id: outgoing.key, role: 'user', text,
      images: images.map(({ file }) => ({ id: 'local', mimeType: file.type })),
      delivery: outgoing.accepted ? undefined : 'Sending…' } : messages[index];
    localImages.set(message.id, images);
    localVideos.set(message.id, outgoing.attachments.filter(item => item.video));
    if (index < 0) messages.push(message);
    else matched.push({ outgoing, messageId: message.id });
  }
  if (isUsageDialog(state.dialog) && usageSummaries.get(selected)?.dialog.id !== state.dialog.id) {
    usageSummaries.set(selected, { dialog: state.dialog, model: state.model, afterId: messages.at(-1)?.id });
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
    const durationMs = result?.durationMs ?? live?.durationMs;
    const timed = ['done', 'error'].includes(status) && Number.isFinite(durationMs) && durationMs >= 0;
    const detail = el('details', undefined, 'tool');
    detail.dataset.toolId = id; detail.dataset.status = status;
    detail.dataset.disclosureId = 'tool:' + id;
    detail.open = expanded.get(detail.dataset.disclosureId) ?? false;
    const toolName = name || live?.name || 'Tool';
    if (!activity) {
      const node = el('details', undefined, 'tool-activity'), summary = el('summary');
      node.dataset.disclosureId = 'activity:' + id; node.dataset.scrollKey = node.dataset.disclosureId;
      node.open = expanded.get(node.dataset.disclosureId) ?? false;
      node.append(summary); fragment.append(node);
      activity = { node, summary, tools: [] }; activityGroups.push(activity);
    }
    const entry = { name: toolName, status, durationMs: timed ? durationMs : undefined, timestamp: result?.timestamp }; activity.tools.push(entry);
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
    if (timed) {
      const elapsed = formatToolDuration(durationMs);
      statusLabel.textContent = status === 'error' ? `error · ${elapsed}` : elapsed;
      statusLabel.title = `Execution time: ${durationMs} ms`;
      statusLabel.setAttribute('aria-label', `${status === 'error' ? 'error, ' : ''}Execution time: ${elapsed}`);
    }
    statusLabel.hidden = status === 'done' && !timed;
    heading.append(statusLabel); summary.append(heading);
    const output = displayPaths(result?.text || live?.text || '');
    entry.preview = output.split(/\r\n|[\r\n]/).filter(line => line.trim()).slice(-2).map(line => line.slice(0, 240)).join('\n');
    detail.append(summary);
    if (input) detail.append(el('pre', displayPaths(input), 'tool-input'));
    if (output || !result?.images?.length) detail.append(el('pre', output || (status === 'working' ? 'Running…' : 'No output.'), 'tool-output'));
    if (result?.truncated) detail.append(el('p', 'Output shortened for mobile.', 'hint'));
    activity.node.append(detail);
  };
  const loading = historyRequest && el('p', 'Loading…', 'history-loading');
  loading?.setAttribute('role', 'status');
  if (loading) fragment.append(loading);
  if (historyError) { const error = el('p', historyError + ' Scroll again to retry, or return to the latest messages.', 'hint'); error.setAttribute('role', 'alert'); fragment.append(error); }
  const { recovered } = replyAttempts(state, messages);
  for (const [index, message] of messages.entries()) {
    if (index === usagePosition) { activity = undefined; fragment.append(renderUsage(usage)); }
    if (message.role === 'toolResult') {
      appendTool(message.toolCallId || message.id, message.toolName, '', message);
      appendThreadImages(fragment, message);
      continue;
    }
    // Internal notices and extension prompts belong in quiet activity rows, not chat bubbles.
    if (message.source === 'extension' || message.activityLabel) {
      activity = undefined;
      const node = el('details', undefined, 'tool-activity'), summary = el('summary');
      node.dataset.disclosureId = 'prompt:' + message.id; node.dataset.scrollKey = node.dataset.disclosureId;
      node.open = expanded.get(node.dataset.disclosureId) ?? false;
      const label = el('span', message.activityLabel || 'Prompted by an extension', 'tool-activity-label');
      label.title = label.textContent; summary.append(label);
      node.append(summary, el('p', userMessageText(message), 'extension-prompt'));
      appendThreadImages(node, message);
      if (message.truncated) node.append(el('p', 'Message shortened for mobile.', 'hint'));
      fragment.append(node);
      continue;
    }
    const skill = loadedSkill({ ...message, text: userMessageText(message) });
    const failed = message.role === 'assistant' && message.stopReason === 'error' && !recovered.has(message.id)
      && !(state.pendingReply && [message.id, message.liveId].includes(state.pendingReply));
    if (message.text || message.images?.length || message.role === 'user' || failed) {
      activity = undefined;
      if (skill) fragment.append(el('p', 'Loaded skill: ' + skill.name, 'skill-loaded'));
      const article = el('article', undefined, 'message ' + (message.role === 'user' ? 'user' : 'assistant'));
      article.dataset.messageId = message.id; article.dataset.scrollKey = message.liveId || message.id;
      article.setAttribute('aria-label', message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Pi' : message.role);
      const body = el('div', undefined, 'message-text');
      if (message.role === 'user') {
        const { text, paths } = splitVideoMessage(userMessageText(message));
        body.textContent = skill ? skill.text : text || (message.images?.length || paths.length || localVideos.get(message.id)?.length ? '' : '(empty message)');
      }
      else {
        // HTML and images are disabled; markdown-it also rejects unsafe link schemes.
        body.innerHTML = markdown.render(splitVideoMessage(message.text || '', message.role).text);
        for (const link of body.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        for (const pre of body.querySelectorAll('pre')) {
          const code = pre.querySelector('code');
          if (!code) continue;
          const block = el('div', undefined, 'code-block'), header = el('div', undefined, 'code-header');
          const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9);
          if (language) header.append(el('span', language));
          header.append(copyButton(code.textContent, 'Copy code', 'copy-code'));
          pre.tabIndex = 0; pre.setAttribute('aria-label', language ? language + ' code' : 'Code');
          pre.before(block); block.append(header, pre);
        }
      }
      if (message.role === 'user') {
        appendThreadImages(article, message, localImages.get(message.id));
        appendThreadVideos(article, message, localVideos.get(message.id), keepVideos);
      }
      if (body.textContent) article.append(body);
      if (message.role !== 'user') appendThreadImages(article, message);
      if (message.role === 'assistant') appendThreadVideos(article, message, undefined, keepVideos);
      if (message.role === 'assistant' && message.text) article.append(copyButton(message.text, 'Copy message', 'copy-message'));
      if (failed) {
        const error = el('p', 'Reply failed. Try again.', 'message-error');
        error.setAttribute('role', 'alert'); article.append(error);
      }
      if (message.role === 'assistant' && message.stopReason !== 'error' && Number.isFinite(message.taskDurationMs) && message.taskDurationMs >= 0) {
        const phrases = ['Tinkered for', 'Chipped away for', 'Puzzled over it for', 'Plugged away for', 'Kept at it for'];
        let hash = 0;
        // Timestamps keep the wording stable even when saved history uses different message IDs.
        for (const char of `${message.timestamp ?? message.id}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        article.append(el('p', phrases[hash % phrases.length] + ' ' + formatToolDuration(message.taskDurationMs), 'task-duration'));
      }
      if (message.delivery) {
        const status = el('small', message.delivery, 'delivery-status'); status.setAttribute('role', 'status'); article.append(status);
      }
      if (article.childNodes.length) fragment.append(article);
    }
    for (const call of message.toolCalls || []) appendTool(call.id, call.name, call.text, results.get(call.id));
    if (message.truncated && (!skill || skill.text)) { activity = undefined; fragment.append(el('p', 'Message shortened for mobile.', 'hint')); }
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
    const running = group.tools.findLast(tool => tool.status === 'working' && tool.preview) || group.tools.findLast(tool => tool.status === 'working');
    const recent = running || (!historyWindow && state.status === 'working' && group === activityGroups.at(-1)
      ? group.tools.findLast(tool => ['done', 'error'].includes(tool.status)) : undefined);
    if (recent) {
      const context = (running ? '' : 'Last: ') + recent.line;
      const text = el('span', undefined, 'tool-activity-text'), line = el('span', context, 'tool-activity-line');
      line.title = context; text.append(label, line);
      if (recent.preview && (running || recent.name !== 'read' || recent.status === 'error')) text.append(el('span', recent.preview, 'tool-activity-progress'));
      group.summary.append(text);
    } else group.summary.append(label);
    let elapsed;
    if (group.tools.every(tool => Number.isFinite(tool.durationMs))) {
      if (group.tools.length === 1) elapsed = group.tools[0].durationMs;
      else if (group.tools.every(tool => Number.isFinite(tool.timestamp))) {
        // Parallel tools overlap, so use their execution span rather than adding durations.
        elapsed = Math.max(...group.tools.map(tool => tool.timestamp))
          - Math.min(...group.tools.map(tool => tool.timestamp - tool.durationMs));
      }
    }
    if (Number.isFinite(elapsed)) {
      const time = el('span', formatToolDuration(elapsed), 'tool-activity-time');
      time.setAttribute('aria-label', 'Elapsed time: ' + time.textContent);
      time.title = `Elapsed time: ${elapsed} ms`; group.summary.append(time);
    }
    for (const [status, text] of [['pending', 'pending']]) {
      const count = group.tools.filter(tool => tool.status === status).length;
      if (count) group.summary.append(el('span', `${count} ${text}`, 'tool-activity-' + status));
    }
  }
  updateActivity();
  box.replaceChildren(fragment, activityIndicator);
  clearThreadVideos(keepVideos);
  for (const video of playing) if (threadVideos.get(video.path) === video) video.player.play().catch(() => {});
  for (const { outgoing, messageId } of matched) {
    submissions.delete(outgoing.key);
    for (const queued of submissions.values()) if (queued.sessionId === selected) queued.knownIds.add(messageId);
    if (sending.get(selected) !== outgoing) releaseImages(outgoing.attachments);
  }
  if (focusedTool) [...box.querySelectorAll('details')].find(node => node.dataset.disclosureId === focusedTool)?.querySelector('summary').focus({ preventScroll: true });
  box.scrollTop = bottom ? box.scrollHeight : oldScroll;
  if (anchor) {
    const node = [...box.querySelectorAll('[data-scroll-key]')].find(item => item.dataset.scrollKey === anchor.key || anchor.id && item.dataset.messageId === anchor.id);
    if (node) box.scrollTop += node.getBoundingClientRect().top - anchor.top;
  }
  historyScrollTop = box.scrollTop;
  renderDialog(state);
  updateControls();
  updateScrollButton();
}
function updateActivity() {
  const state = cache.get(selected), activity = activityIndicator, now = Date.now();
  const label = activity.querySelector('#activity-label'), time = activity.querySelector('#activity-time');
  const active = connected && !historyWindow && state?.status === 'working', compacting = state?.compacting === true;
  const retrying = state ? replyAttempts(state).retrying : false;
  const announcement = compacting ? 'Compacting conversation…' : retrying ? 'Retrying reply…' : 'Working…';
  if (label.textContent !== announcement) label.textContent = announcement;
  const status = activity.querySelector('.sr-only');
  if (status.textContent !== announcement) status.textContent = announcement;
  activity.hidden = !active;
  if (!active) return;
  const message = state.messages?.findLast(message => message.role === 'assistant');
  const elapsed = Number.isFinite(message?.timestamp) ? Math.max(0, now - message.timestamp) : 0;
  const showTime = !compacting && !retrying && elapsed >= 5000 && message?.stopReason === 'pending' && !message.text?.trim() && !message.toolCalls?.length
    && !state.tools?.some(tool => tool.status === 'working');
  time.hidden = !showTime;
  time.textContent = showTime ? ' · ' + (elapsed < 60000 ? Math.floor(elapsed / 1000) + 's' : formatToolDuration(elapsed)) : '';
}
setInterval(() => { if (!document.hidden) updateActivity(); }, 1000);
function updateControls() {
  $('session-close').hidden = !supportsSessionClosing || !selected || !!cache.get(selected)?.creation;
  $('session-close').disabled = !connected;
  const state = cache.get(selected);
  const summary = sessions.find(item => item.id === selected) || selectedSummary;
  $('session-pin').hidden = !selected || !!state?.creation;
  $('session-pin').disabled = !connected;
  $('session-pin').textContent = summary?.pinned ? 'Unpin session' : 'Pin session';
  const live = connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  const working = state && ['working', 'waiting'].includes(state.status);
  const hasDraft = !!$('prompt').value.trim() || !!imageDrafts.get(selected)?.length;
  const outgoing = sending.get(selected), imageCount = outgoing?.attachments.length || 0;
  $('composer-send-status').hidden = !outgoing;
  const noun = outgoing?.attachments.some(item => item.video) ? 'attachment' : 'image';
  $('composer-send-status').textContent = imageCount ? `Sending ${imageCount} ${noun}${imageCount === 1 ? '' : 's'}…` : 'Sending…';
  $('send').disabled = !live || sending.has(selected);
  $('send').hidden = !!working && !hasDraft;
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands';
  $('image-files').disabled = !selected || !!state?.creation || sending.has(selected);
  for (const button of $('attachments').querySelectorAll('button')) button.disabled = sending.has(selected);
  $('abort').disabled = !live;
  $('abort').hidden = !working;
  $('prompt').disabled = !selected;
  $('status').textContent = !connected ? 'Disconnected' : state?.status || 'Loading…';
  $('composer-connection').hidden = connected || !selected || manualClose;
  updateActivity();
  const modelName = state?.modelName || state?.model?.slice(state.model.indexOf('/') + 1) || '';
  const pendingModel = !!selected && (!state || state.status === 'starting') && !state?.model;
  // Pi's display name minus decorations ("Anthropic: ", "Claude SDK ", " (experimental)"); saved sessions only have the id,
  // where claude-opus-5-5[-20260101] → Opus 5.5 and other ids only lose a trailing date.
  $('model-name').textContent = state?.modelName
    ? state.modelName.replace(/^[^:]+:\s*/, '').replace(/^Claude (SDK )?/, '').replace(/\s*\([^)]*\)$/, '')
    : modelName.replace(/-\d{8}$/, '').replace(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/,
      (_, family, major, minor) => `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? '.' + minor : ''}`);
  const effort = changingReasoning.has(selected) ? 'Changing…' : reasoningLevels[state?.thinkingLevel] || state?.thinkingLevel || 'Off';
  $('model-name').textContent ||= 'Model';
  $('model').title = modelName ? `Switch model: ${modelName}` : 'Choose a model';
  $('model').setAttribute('aria-label', $('model').title);
  $('model').disabled = !live || changingReasoning.has(selected);
  $('model').hidden = !state?.model && !pendingModel;
  $('reasoning-control').disabled = !live || changingReasoning.has(selected);
  $('reasoning-value').textContent = effort;
  $('reasoning-control').hidden = !state?.thinkingLevel;
  if (settingsPicker && !live && settingsPicker.kind !== 'usage') closePicker();
  renderUsageMeter();
  if (settingsPicker?.kind === 'usage') renderUsagePanel();
  $('fast-mode').toggleAttribute('hidden', !live || state?.fastMode !== true);
  $('resume').hidden = state?.creation ? state.creation.pending : !state || !['saved', 'disconnected'].includes(state.status);
  $('resume').textContent = state?.creation ? 'Try starting again' : 'Resume session';
  const resumable = allowResume || (sessions.find(x => x.id === selected) || selectedSummary)?.resumable;
  $('resume').disabled = !connected || (state?.creation ? state.creation.pending : !resumable);
  $('composer-hint').textContent = !connected ? '' :
    state?.creation ? (state.creation.pending ? '' : 'Session did not start. Your draft is kept here.') :
    live && state.compacting ? 'Summarizing earlier messages. New messages will wait.' :
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
  $('settings-dialog').close();
  $('settings-picker').hidden = true;
  $('reasoning-control').setAttribute('aria-expanded', 'false');
  $('model').setAttribute('aria-expanded', 'false');
  $('usage-meter').setAttribute('aria-expanded', 'false');
  if (restoreFocus) opener?.focus();
}
function fitPickerMenu() {
  if (!settingsPicker) return;
  const dialog = $('settings-dialog'), sheet = settingsPicker.kind !== 'usage' && matchMedia('(max-width: 700px)').matches;
  if (!dialog.open || sheet !== dialog.hasAttribute('data-sheet')) {
    dialog.close(); dialog.toggleAttribute('data-sheet', sheet);
    if (sheet) dialog.showModal(); else dialog.show();
  }
  const height = sheet ? (window.visualViewport?.height ?? innerHeight) * .8
    : $('composer').getBoundingClientRect().top - document.querySelector('.conversation-header').getBoundingClientRect().bottom - 16;
  $('settings-picker').style.setProperty('--picker-menu-height', Math.max(0, height) + 'px');
}
matchMedia('(max-width: 700px)').addEventListener('change', fitPickerMenu);
const pickerMenuObserver = new ResizeObserver(fitPickerMenu);
pickerMenuObserver.observe($('composer')); pickerMenuObserver.observe($('app'));
function openPicker(id, kind, opener = document.activeElement) {
  if (settingsPicker?.kind === kind) opener = settingsPicker.opener;
  closePicker();
  const picker = { id, kind, opener }; settingsPicker = picker;
  const reasoning = kind === 'reasoning', usage = kind === 'usage';
  commandDismissed = true; renderCommands();
  $('picker-options').replaceChildren(); $('model-search').value = ''; $('model-search').disabled = false;
  $('model-search').hidden = reasoning || usage; $('picker-title').hidden = !reasoning && !usage;
  $('picker-title').textContent = usage ? 'Usage' : 'Reasoning effort';
  $('model-retry').hidden = true; $('picker-help').classList.remove('picker-error');
  $('settings-picker').setAttribute('aria-label', usage ? 'Usage' : reasoning ? 'Choose reasoning effort' : 'Choose a model');
  $('settings-dialog').setAttribute('aria-label', usage ? 'Usage' : 'Model settings');
  $('picker-cancel').setAttribute('aria-label', usage ? 'Close usage' : reasoning ? 'Close reasoning picker' : 'Close model picker');
  $('settings-picker').hidden = false;
  $(usage ? 'usage-meter' : reasoning ? 'reasoning-control' : 'model').setAttribute('aria-expanded', 'true');
  fitPickerMenu();
  if ($('settings-dialog').hasAttribute('data-sheet')) $('settings-dialog').focus({ preventScroll: true });
  return picker;
}
const usageNumbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const tokenNumbers = new Intl.NumberFormat();
function contextPercent(usage) {
  return usage && Number.isFinite(usage.tokens) && usage.tokens >= 0 && usage.contextWindow > 0 &&
    Number.isFinite(usage.percent) && usage.percent >= 0 ? usage.percent : undefined;
}
function usageBar(label, percent) {
  const bar = el('progress'); bar.max = 100; bar.value = Math.min(100, percent);
  bar.setAttribute('aria-label', label);
  return bar;
}
function renderUsageMeter() {
  const percent = contextPercent(cache.get(selected)?.contextUsage), known = percent !== undefined;
  const button = $('usage-meter');
  button.hidden = !selected;
  button.toggleAttribute('data-unknown', !known);
  button.dataset.level = percent > 90 ? 'error' : percent > 70 ? 'warning' : 'normal';
  button.title = known ? `${usageNumbers.format(percent)}% of context used` : 'Context usage unavailable';
  button.setAttribute('aria-label', 'Usage: ' + button.title);
  $('usage-arc').setAttribute('stroke-dasharray', `${known ? Math.min(100, percent) : 0} 100`);
}
function renderUsagePanel() {
  const state = cache.get(selected), usage = state?.contextUsage, percent = contextPercent(usage);
  const details = usageDetails.get(selected), current = details?.model === state?.model ? details : undefined;
  const content = el('div', undefined, 'usage-details'), context = el('section');
  const heading = el('div', undefined, 'usage-heading');
  heading.append(el('h3', 'Current context'), el('strong', percent === undefined ? 'Unavailable' : `${usageNumbers.format(percent)}% used`));
  context.append(heading);
  if (percent !== undefined) {
    context.append(usageBar('Current context usage', percent), el('p', `${tokenNumbers.format(usage.tokens)} / ${tokenNumbers.format(usage.contextWindow)} tokens`, 'hint'));
  } else {
    context.append(el('p', usage?.tokens === null ? 'Waiting for the next model response after compaction.' : 'This session has not reported its context usage.', 'hint'));
  }
  const limits = el('section'); limits.append(el('h3', 'Account limits'));
  const summary = usageSummaries.get(selected);
  const report = current?.providerUsage || (summary && summary.model === state?.model ? summary.dialog : undefined);
  if (report) {
    for (const row of usageRows(report)) {
      if (row.percent === undefined) { limits.append(el('p', row.text)); continue; }
      const limit = el('div', undefined, 'usage-limit'), heading = el('div', undefined, 'usage-heading');
      heading.append(el('h4', row.label), el('strong', `${usageNumbers.format(row.percent)}% used`));
      limit.append(heading, usageBar(row.label, row.percent));
      if (row.reset) limit.append(el('p', row.reset, 'hint'));
      limits.append(limit);
    }
    if (current?.capturedAt) limits.append(el('p', 'Checked ' + new Date(current.capturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'hint'));
  } else limits.append(el('p', current?.busy ? 'Checking provider limits…' : current?.providerMessage || 'Five-hour and weekly limits are shown when reported by your provider.', 'hint'));
  content.append(context, limits); $('picker-options').replaceChildren(content);
  const online = connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  $('picker-help').classList.toggle('picker-error', !!current?.error);
  $('picker-help').textContent = current?.error || (!connected ? 'Offline. Usage may be out of date.' : !online ? 'Resume this session to check current usage.' :
    !supportsUsage ? 'Restart Pi Remote on your computer to enable usage checks.' : current?.busy && report ? 'Checking provider limits…' : 'Account limits are shared across sessions.');
}
async function loadUsage(id, includeProvider = false) {
  const state = cache.get(id), key = id + (includeProvider ? ':provider' : ':context');
  if (!supportsUsage || !connected || !state || !['idle', 'working', 'waiting'].includes(state.status) || usageLoading.has(key)) return;
  usageLoading.add(key);
  const model = state.model, details = includeProvider ? { ...(usageDetails.get(id)?.model === model ? usageDetails.get(id) : {}), model, busy: true, error: '' } : undefined;
  if (details) usageDetails.set(id, details);
  if (selected === id && settingsPicker?.kind === 'usage') renderUsagePanel();
  try {
    const result = await request('usage', { sessionId: id, includeProvider });
    const current = cache.get(id);
    if (!current || current.model !== model || result.model !== model) return;
    current.contextUsage = result.contextUsage;
    if (details && usageDetails.get(id) === details) Object.assign(details, result, { providerUsage: result.providerUsage, capturedAt: Date.now() });
  } catch (error) {
    if (details) details.error = error.message === 'Unsupported command' ? 'Reload this Pi terminal to enable context usage.' : error.message;
  } finally {
    usageLoading.delete(key);
    if (details) details.busy = false;
    if (selected === id) {
      renderUsageMeter();
      if (settingsPicker?.kind === 'usage') renderUsagePanel();
    }
  }
}
function openUsage() {
  openPicker(selected, 'usage', $('usage-meter'));
  renderUsagePanel(); loadUsage(selected, true);
}
$('usage-meter').addEventListener('click', () => settingsPicker?.kind === 'usage' ? closePicker() : openUsage());
setInterval(() => { if (!document.hidden && selected) loadUsage(selected); }, 15000);
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
      button.addEventListener('click', event => chooseModel(picker, key, event.detail === 0));
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
// Restoring focus after a tap makes iOS draw a focus ring on the trigger, so only keyboard picks restore it.
async function chooseModel(picker, key, keyboard) {
  if (settingsPicker !== picker || picker.busy) return;
  if (key === picker.current) { closePicker(keyboard); return; }
  pickerBusy(picker, true, 'Switching model…');
  try {
    await switchModel(picker.id, key);
    if (settingsPicker === picker) closePicker(keyboard);
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
    button.addEventListener('click', event => chooseReasoning(picker, level, event.detail === 0));
    $('picker-options').append(button);
  }
  $('picker-help').textContent = '';
  if (matchMedia('(pointer: fine)').matches) $('picker-options').querySelector('[aria-pressed=true]')?.focus();
}
async function chooseReasoning(picker, level, keyboard) {
  const id = picker.id;
  if (settingsPicker !== picker || changingReasoning.has(id)) return;
  if (level === cache.get(id)?.thinkingLevel) { closePicker(keyboard); return; }
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
    if (applied && settingsPicker === picker) closePicker(keyboard);
  }
}
$('model').addEventListener('click', () => settingsPicker?.kind === 'model' ? closePicker() : openModels(selected, $('model')));
$('reasoning-control').addEventListener('click', () => settingsPicker?.kind === 'reasoning' ? closePicker() : openReasoning(selected));
$('settings-dialog').addEventListener('cancel', event => { event.preventDefault(); closePicker(true); });
$('model-search').addEventListener('input', renderModels);
$('model-retry').addEventListener('click', () => { if (settingsPicker?.kind === 'model') openModels(settingsPicker.id); });
$('picker-cancel').addEventListener('click', event => closePicker(event.detail === 0));
$('image-close').addEventListener('click', () => imageViewer.close());
$('image-zoom-in').addEventListener('click', () => zoomImage(imageZoom * 2));
$('image-zoom-out').addEventListener('click', () => zoomImage(imageZoom / 2));
$('image-zoom-reset').addEventListener('click', () => positionImage(1, 0, 0));
fullImage.addEventListener('load', () => {
  if (!imageViewer.open) return;
  const width = imageStage.clientWidth / fullImage.naturalWidth, height = imageStage.clientHeight / fullImage.naturalHeight;
  const fit = Math.min(width, height);
  if (!fit) return;
  // Fit phone images to the width without cropping either side.
  const zoom = matchMedia('(max-width: 700px)').matches ? Math.min(8, width / fit) : 1;
  const top = Math.max(0, (fullImage.naturalHeight * fit * zoom - imageStage.clientHeight) / 2);
  positionImage(zoom, 0, top);
});
new ResizeObserver(() => { if (imageViewer.open) positionImage(); }).observe(imageStage);
imageViewer.addEventListener('close', () => { imagePointers.clear(); resetImagePull(); });
imageViewer.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (['+', '='].includes(event.key)) zoomImage(imageZoom * 2);
  else if (event.key === '-') zoomImage(imageZoom / 2);
  else if (event.key === '0') positionImage(1, 0, 0);
  else if (event.key.startsWith('Arrow')) positionImage(imageZoom,
    imageX + (event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0),
    imageY + (event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0));
  else return;
  event.preventDefault();
});
function imageGesture() {
  const [a, b = a] = [...imagePointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}
imageStage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || imagePointers.size >= 2) return;
  imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  resetImagePull();
  if (event.pointerType === 'touch' && imagePointers.size === 1) {
    const fit = Math.min(imageStage.clientWidth / (fullImage.naturalWidth || 1), imageStage.clientHeight / (fullImage.naturalHeight || 1));
    const width = fullImage.naturalWidth * fit * imageZoom;
    const top = imageY + (imageStage.clientHeight - fullImage.naturalHeight * fit * imageZoom) / 2;
    // A tall image must pan back to its top before a new pull can dismiss it.
    if (width <= imageStage.clientWidth + 1 && top >= -1) imagePull = { x: event.clientX, y: event.clientY, distance: 0 };
  }
  // Touch and pen already capture implicitly; mouse drags need explicit capture.
  if (event.pointerType === 'mouse') imageStage.setPointerCapture(event.pointerId);
});
imageStage.addEventListener('pointermove', event => {
  if (!imagePointers.has(event.pointerId)) return;
  const before = imageGesture();
  imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (imagePull) {
    const dx = event.clientX - imagePull.x, dy = event.clientY - imagePull.y;
    if (!imagePull.distance) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (dy <= 0 || Math.abs(dx) > dy) resetImagePull();
    }
    if (imagePull) {
      imagePull.distance = Math.max(0, dy);
      imageViewer.style.transform = `translateY(${imagePull.distance}px)`;
      return;
    }
  }
  const after = imageGesture(), box = imageStage.getBoundingClientRect();
  const zoom = Math.max(1, Math.min(8, before.distance ? imageZoom * after.distance / before.distance : imageZoom));
  const x = before.x - box.x - box.width / 2, y = before.y - box.y - box.height / 2;
  const ratio = zoom / imageZoom;
  positionImage(zoom, x - (x - imageX) * ratio + after.x - before.x, y - (y - imageY) * ratio + after.y - before.y);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) imageStage.addEventListener(type, event => {
  if (!imagePointers.has(event.pointerId)) return;
  const dismiss = type === 'pointerup' && imagePull?.distance >= 80;
  imagePointers.delete(event.pointerId); resetImagePull();
  if (dismiss) imageViewer.close();
});
imageStage.addEventListener('dblclick', event => {
  const box = imageStage.getBoundingClientRect();
  zoomImage(imageZoom > 1 ? 1 : 2, event.clientX - box.x - box.width / 2, event.clientY - box.y - box.height / 2);
});
// Pull a bottom sheet down to dismiss it. A drag inside a scrolled list scrolls it instead.
function dragToClose(sheet, dialog = sheet, list) {
  let startY, fromList, dy = 0;
  sheet.addEventListener('touchstart', event => {
    fromList = !!list?.contains(event.target);
    startY = event.touches.length === 1 && (window.visualViewport?.scale ?? 1) <= 1 && !(fromList && list.scrollTop > 0) ? event.touches[0].clientY : undefined; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', event => {
    if (startY === undefined) return;
    if (event.touches.length !== 1) { startY = undefined; dy = 0; sheet.style.transform = ''; return; }
    const delta = event.touches[0].clientY - startY;
    if (fromList && delta < 0 && !dy) { startY = undefined; return; }
    event.preventDefault();
    dy = Math.max(0, delta);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const release = () => {
    if (startY === undefined) return;
    startY = undefined;
    const close = dy > sheet.offsetHeight / 4;
    sheet.style.transition = 'transform .2s ease-out';
    sheet.style.transform = close ? 'translateY(100%)' : '';
    setTimeout(() => { sheet.style.transition = sheet.style.transform = ''; if (close) dialog.close(); }, 200);
  };
  sheet.addEventListener('touchend', release);
  sheet.addEventListener('touchcancel', release);
}
dragToClose($('project-picker').querySelector('.project-sheet'), $('project-picker'), $('project-options'));
document.addEventListener('keydown', event => {
  if (event.isComposing || $('session-close-confirm').open) return;
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
  const info = document.querySelector('.session-info');
  if (info.open && !info.contains(event.target)) info.open = false;
  const trigger = settingsPicker?.kind === 'usage' ? $('usage-meter') : settingsPicker?.kind === 'reasoning' ? $('reasoning-control') : $('model');
  if (settingsPicker && !$('settings-picker').contains(event.target) && !trigger.contains(event.target)) closePicker();
});
function isUsageDialog(dialog) {
  return dialog?.method === 'select' && dialog.title?.split(/\r?\n/)[0] === 'Provider usage';
}
function usageRows(dialog) {
  const rows = [], description = [dialog.title.split(/\r?\n/).slice(1).join('\n'), dialog.message].filter(Boolean).join('\n');
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(Credits|Usage limit resets|Plan|Fast mode|Semantics):/.test(line) || / Usage · /.test(line)) continue;
    const limit = line.match(/^(.+?):\s*\[[█░▓▒\s]+\]\s*(\d+(?:\.\d+)?)% left(?:\s*\((.+)\))?$/);
    if (limit && Number(limit[2]) <= 100) {
      const [, label, remaining, reset] = limit;
      const percent = Number((100 - Number(remaining)).toFixed(2));
      rows.push({ label, percent, reset, text: `${label}: ${percent}% used${reset ? ' · ' + reset : ''}` });
    } else rows.push({ text: line });
  }
  return rows.length ? rows : [{ text: 'Usage information is unavailable.' }];
}
function renderUsage(usage) {
  const article = el('article', undefined, 'message usage-summary');
  article.setAttribute('aria-label', 'Provider usage');
  const content = el('blockquote'), body = el('div', undefined, 'message-text');
  for (const row of usageRows(usage.dialog)) content.append(el('p', row.text));
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
$('scan-login').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true; $('login-error').hidden = true;
  try {
    const { scanLogin } = await import('./qr.js');
    const credentials = await scanLogin();
    if (credentials) { $('token').value = ''; rememberLogin(credentials.token, credentials.key); connect(); }
  } catch {
    $('login-error').textContent = 'Could not load the QR scanner. Try again or paste the private link.';
    $('login-error').hidden = false;
  } finally {
    button.disabled = false;
    if (!$('login').hidden) button.focus({ preventScroll: true });
  }
});
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const credentials = parseLogin($('token').value);
    rememberLogin(credentials.token, credentials.key);
    $('token').value = ''; connect();
  } catch (error) { $('login-error').textContent = error.message; $('login-error').hidden = false; }
});
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('pair-submit'), controls = $('login').querySelectorAll('input, button');
  for (const control of controls) control.disabled = true;
  button.textContent = 'Pairing…'; $('login-error').hidden = true;
  try {
    let pairWithCode;
    try { ({ pairWithCode } = await import('./pairing.js')); }
    catch { throw new Error('Could not load pairing. Your computer may be offline, or your relay needs an update.'); }
    const credentials = await pairWithCode($('pair-code').value.trim());
    if (typeof credentials?.token !== 'string' || credentials.token.length < 32 || !validKey(credentials.key)) throw new Error('Login expired, pair again');
    rememberLogin(credentials.token, credentials.key); $('pair-code').value = ''; connect();
  } catch (error) { $('login-error').textContent = error.message; $('login-error').hidden = false; }
  finally { for (const control of controls) control.disabled = false; button.textContent = 'Pair with computer'; }
});
$('repair').addEventListener('click', () => { showLogin(); $('pair-code').focus(); });
$('login-cancel').addEventListener('click', connect);
$('home-screen-close').addEventListener('click', () => { $('home-screen-hint').hidden = true; });
$('logout').addEventListener('click', logout);
$('login-logout').addEventListener('click', logout);
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
// The bar already rides above the keyboard; iOS's reveal scroll would expose the theme colour under the page.
$('search-open').addEventListener('click', () => { haptic(); $('search-bar').classList.add('open'); $('search').focus({ preventScroll: true }); });
// Keep the keyboard open until the click lands, or blur moves the close button out from under the tap.
$('search-close').addEventListener('mousedown', event => event.preventDefault());
$('search-close').addEventListener('click', event => { closeSearch(); $('search-open').focus({ focusVisible: !event.detail }); });
// An empty search folds back into its button once you leave it; a live filter stays visible.
$('search').addEventListener('blur', event => { if (!$('search').value && event.relatedTarget !== $('search-close')) closeSearch(); });
$('search').addEventListener('keydown', event => { if (event.key === 'Escape') { closeSearch(); $('search-open').focus(); } });
$('list-retry').addEventListener('click', loadList);
// Pinned projects stay on top, then the rest most recent first (the host's order). The sheet fits about five; scroll or search for more.
let projectList, projectRequest, pinnedProjects = JSON.parse(localStorage.getItem('pi-remote-pins') || '[]');
function renderProjects(focusPin) {
  const query = $('project-search').value.trim().toLowerCase();
  const matches = (projectList || []).filter(project => !isBlank(project.cwd) && displayPaths(project.cwd).toLowerCase().includes(query));
  const pinned = matches.filter(project => pinnedProjects.includes(project.cwd));
  const recent = matches.filter(project => !pinnedProjects.includes(project.cwd));
  $('project-options').replaceChildren(...[...pinned, ...recent].map(project => {
    const cwd = displayPaths(project.cwd), name = projectName(project.cwd), isPinned = pinnedProjects.includes(project.cwd);
    const row = el('div', undefined, 'project-row'), button = el('button', undefined, 'project-option'), pin = el('button', undefined, 'project-pin');
    button.type = 'button'; button.title = cwd;
    button.append(el('span', name, 'project-option-name'), el('span', cwd, 'project-option-path'));
    button.addEventListener('click', () => startInProject(project));
    pin.type = 'button'; pin.dataset.cwd = project.cwd; pin.setAttribute('aria-pressed', String(isPinned));
    pin.setAttribute('aria-label', 'Pin ' + name); pin.title = isPinned ? 'Unpin' : 'Pin to top';
    pin.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 4h5l-.75 4.5L17 11.5V13h-4v5l-1 1-1-1v-5H7v-1.5l3.25-3L9.5 4Z"/></svg>';
    pin.addEventListener('click', event => {
      haptic();
      pinnedProjects = isPinned ? pinnedProjects.filter(cwd => cwd !== project.cwd) : [...pinnedProjects, project.cwd];
      localStorage.setItem('pi-remote-pins', JSON.stringify(pinnedProjects));
      // Keep keyboard focus on the re-rendered pin; a tap would otherwise get a focus ring.
      renderProjects(event.detail === 0 ? project.cwd : undefined);
    });
    row.append(button, pin);
    return row;
  }));
  if (projectList) $('project-status').textContent = matches.length ? '' : projectList.length ? 'No matching projects' : 'No projects yet.';
  if (focusPin) [...$('project-options').querySelectorAll('.project-pin')].find(pin => pin.dataset.cwd === focusPin)?.focus();
}
async function loadProjects() {
  if (projectRequest) return;
  const ws = socket, current = projectRequest = request('projects');
  try {
    const projects = await current;
    if (socket !== ws) return;
    projectList = projects;
    // Do not replace controls during session creation or keyboard navigation.
    if ($('project-picker').open && !$('new-project').disabled && !$('project-options').contains(document.activeElement)) renderProjects();
  } catch (e) {
    if (socket === ws && $('project-picker').open && !$('new-project').disabled && !projectList) $('project-status').textContent = e.message;
  } finally {
    if (projectRequest === current) projectRequest = undefined;
  }
}
function openProjects() {
  const dialog = $('project-picker');
  $('project-search').value = ''; renderProjects();
  if (!projectList) $('project-status').textContent = 'Loading projects…';
  // Focus the sheet, not its close button, so Safari draws no focus ring on open.
  dialog.showModal(); dialog.focus();
  loadProjects();
}
// Without a project, the host starts the session in a new folder it creates.
async function startInProject(project, id = 'new-' + crypto.randomUUID()) {
  if (cache.get(id)?.creation?.pending) return;
  const creation = { project, pending: true };
  cache.set(id, { id, title: 'Untitled session', cwd: project?.cwd || '', status: 'starting', messages: [], tools: [], creation });
  $('project-picker').close();
  void selectSession(id);
  $('prompt').focus({ preventScroll: true });
  try {
    const created = project ? await request('new', { sessionId: project.sessionId }) : await request('newProject');
    if (cache.get(id)?.creation !== creation) return;
    // Startup already has the ready state; watch keeps it current without another loading screen.
    if (created.state && !cache.has(created.sessionId)) cache.set(created.sessionId, created.state);
    drafts.set(created.sessionId, selected === id ? $('prompt').value : drafts.get(id) || '');
    // Finishing startup must not reopen a conversation the user has already left.
    if (selected === id) {
      if ($('app').classList.contains('viewing')) await selectSession(created.sessionId);
      else selected = undefined;
    }
    drafts.delete(id); cache.delete(id);
  } catch (e) {
    if (cache.get(id)?.creation !== creation) return;
    creation.pending = false;
    const state = cache.get(id);
    state.status = 'error'; state.error = e.message;
    if (selected === id) renderConversation(state);
  }
}
$('new-session').addEventListener('click', () => { haptic(); openProjects(); });
$('new-project').addEventListener('click', () => startInProject());
$('project-search').addEventListener('input', () => renderProjects());
$('project-close').addEventListener('click', () => $('project-picker').close());
$('project-picker').addEventListener('click', event => { if (event.target === $('project-picker')) $('project-picker').close(); });
function resetSwipe() {
  clearTimeout(swipeTimer);
  openingAnimation?.cancel(); openingAnimation = undefined;
  trackingSwipe = false;
  const main = document.querySelector('main');
  main.style.transition = main.style.transform = '';
  $('app').classList.remove('swiping', 'opening'); $('sidebar').inert = false;
}
$('back').addEventListener('click', () => {
  resetSwipe();
  if (history.state?.session) history.back();
  else $('app').classList.remove('viewing');
});
window.addEventListener('popstate', () => { resetSwipe(); closePicker(); $('app').classList.remove('viewing'); });
// Browser edge-swipes reveal an old history screenshot, so rows and scroll can jump when the swipe lands.
// Drag the thread off the live list in both browser and home-screen mode instead.
{
  const app = $('app'), main = document.querySelector('main');
  let startX, startY, dx;
  main.addEventListener('touchstart', event => {
    resetSwipe();
    const touch = event.touches[0];
    trackingSwipe = event.touches.length === 1 && (window.visualViewport?.scale ?? 1) <= 1 && touch.clientX < 24 && app.classList.contains('viewing') &&
      matchMedia('(max-width: 700px)').matches && !event.target.closest('button, a, input, textarea, summary, dialog');
    if (trackingSwipe) event.preventDefault();
    startX = touch.clientX; startY = touch.clientY; dx = 0;
  }, { passive: false });
  main.addEventListener('touchmove', event => {
    if (!trackingSwipe) return;
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1) { resetSwipe(); return; }
    const touch = event.touches[0];
    dx = Math.max(0, touch.clientX - startX);
    if (!app.classList.contains('swiping')) {
      if (dx < 8) { if (Math.abs(touch.clientY - startY) > 8) resetSwipe(); return; }
      app.classList.add('swiping');
    }
    event.preventDefault();
    main.style.transform = `translateX(${dx}px)`;
  }, { passive: false });
  const release = () => {
    if (!trackingSwipe) return;
    trackingSwipe = false;
    if (!app.classList.contains('swiping')) return;
    // ponytail: distance-only threshold; add flick velocity if short fast swipes feel ignored.
    const back = dx > main.offsetWidth / 3;
    if (back) haptic();
    main.style.transition = 'transform .2s ease-out';
    main.style.transform = back ? 'translateX(100%)' : '';
    swipeTimer = setTimeout(() => {
      resetSwipe();
      if (back) {
        closePicker(); app.classList.remove('viewing');
        if (history.state?.session) history.back();
      }
    }, 200);
  };
  main.addEventListener('touchend', release);
  main.addEventListener('touchcancel', resetSwipe);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetSwipe(); });
}
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
      if (completeCommand()) sendMessage();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && matchMedia('(pointer: fine)').matches) {
    event.preventDefault();
    sendMessage();
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
async function stageVideo(image) {
  const ws = socket;
  const check = () => {
    if (image.released || socket !== ws || !connected) throw new Error('Video upload interrupted. Send again to retry.');
  };
  check();
  if (!supportsVideos) throw new Error('Restart Pi Remote on your computer to enable video uploads.');
  if (image.staged?.socket === ws && image.staged.path) return image.staged;
  image.uploading = true; image.error = ''; image.progress = 0;
  if (imageDrafts.get(selected)?.includes(image)) renderImages();
  try {
    const { name, type, size } = image.file;
    const { uploadId } = await request('videoStart', { file: { name, type, size } });
    image.staged = { uploadId, socket: ws };
    for (let offset = 0; offset < size; offset += VIDEO_CHUNK_BYTES) {
      check();
      const { data } = await readImage(image.file.slice(offset, offset + VIDEO_CHUNK_BYTES));
      check();
      await request('videoChunk', { uploadId, offset, data });
      image.progress = Math.round(Math.min(offset + VIDEO_CHUNK_BYTES, size) / size * 100);
      updateVideoProgress(image);
    }
    check();
    const { path, poster } = await request('videoFinish', { uploadId });
    check(); image.staged.path = path;
    if (poster && !image.poster) {
      const [thumbnail] = validateImages([poster]);
      image.posterBlob = new Blob([Uint8Array.from(atob(thumbnail.data), c => c.charCodeAt(0))], { type: thumbnail.mimeType });
      image.poster = URL.createObjectURL(image.posterBlob);
    }
    return image.staged;
  } catch (error) {
    discardVideo(image); image.staged = undefined; image.error = error.message;
    throw error;
  } finally {
    image.uploading = false;
    if (imageDrafts.get(selected)?.includes(image)) renderImages();
  }
}
function discardVideo(image) {
  if (image.video && image.staged?.socket === socket) request('videoDiscard', { uploadId: image.staged.uploadId }).catch(() => {});
}
function releaseImages(images) {
  for (const image of images) {
    image.released = true; URL.revokeObjectURL(image.url);
    if (image.poster) URL.revokeObjectURL(image.poster);
    discardVideo(image);
  }
}
function updateVideoProgress(image) {
  if (!image.progressNode) return;
  image.progressNode.setAttribute('aria-valuenow', image.progress);
  image.progressNode.querySelector('.video-upload-arc').setAttribute('stroke-dashoffset', 100 - image.progress);
}
function renderImages() {
  const images = imageDrafts.get(selected) || [];
  $('attachments').hidden = !images.length;
  $('attachments').replaceChildren(...images.map(image => {
    const item = el('div', undefined, 'attachment'), preview = el(image.video ? 'video' : 'img');
    if (image.video) {
      item.classList.add('video-attachment');
      preview.controls = true; preview.playsInline = true; preview.preload = 'none';
      if (image.poster) preview.poster = image.poster;
      preview.setAttribute('aria-label', image.file.name);
      preview.addEventListener('error', () => {
        if (!image.poster) { preview.replaceWith(el('div', 'Preview unavailable', 'video-preview-unavailable')); return; }
        const thumbnail = el('img'); thumbnail.src = image.poster; thumbnail.alt = 'Video preview';
        preview.replaceWith(thumbnail);
      });
      preview.src = image.url;
    } else { preview.src = image.url; preview.alt = image.file.name; }
    const remove = el('button'); remove.type = 'button';
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    remove.setAttribute('aria-label', `Remove ${image.file.name}`); remove.disabled = sending.has(selected);
    remove.addEventListener('click', event => {
      releaseImages([image]);
      // WebKit rings every scripted focus; only keyboard removal (detail 0) should show it.
      imageDrafts.set(selected, images.filter(other => other !== image)); renderImages(); $('image-files').focus({ focusVisible: !event.detail });
    });
    item.classList.toggle('uploading', !!image.uploading);
    if (image.video) {
      const status = el('span', image.error ? 'Upload failed. Send to retry.' : '');
      status.setAttribute('role', 'status'); status.hidden = !image.error;
      item.append(preview, status);
      image.progressNode = undefined;
      if (image.uploading) {
        const ring = el('div', undefined, 'video-upload-progress');
        ring.setAttribute('role', 'progressbar'); ring.setAttribute('aria-label', `Uploading ${image.file.name}`);
        ring.setAttribute('aria-valuemin', '0'); ring.setAttribute('aria-valuemax', '100');
        ring.innerHTML = '<svg viewBox="0 0 56 56" aria-hidden="true"><circle class="video-upload-track" cx="28" cy="28" r="22"/><circle class="video-upload-arc" cx="28" cy="28" r="22" pathLength="100" stroke-dasharray="100"/></svg>';
        image.progressNode = ring; updateVideoProgress(image); item.append(ring);
      }
    } else {
      const link = el('a'); link.href = image.url; link.setAttribute('aria-label', `Open ${image.file.name}`);
      link.addEventListener('click', openImage);
      link.append(preview); item.append(link);
    }
    if (image.uploading && !image.video) { const spinner = el('span', undefined, 'connection-spinner'); spinner.setAttribute('aria-label', 'Uploading'); item.append(spinner); }
    item.append(remove); return item;
  }));
  updateControls();
}
let openingImages = false;
// Keep the editor focused until click so we can dismiss its keyboard first.
$('image-files').addEventListener('mousedown', event => event.preventDefault());
$('image-files').addEventListener('click', event => {
  if (openingImages) { event.preventDefault(); return; }
  const active = document.activeElement, input = event.currentTarget, viewport = window.visualViewport;
  const keyboardOpen = () => viewport && viewport.height * viewport.scale < innerHeight - 1;
  if (!active?.matches('textarea, input:not([type=file])') && !keyboardOpen()) return;
  event.preventDefault();
  openingImages = true;
  const id = selected;
  const started = performance.now();
  let changed = started;
  const resized = () => { changed = performance.now(); };
  const open = () => {
    // iOS can pause keyboard resize events; wait for recovery within its file-picker gesture timeout.
    if ((keyboardOpen() || performance.now() - changed < 100) && performance.now() - started < 900) {
      setTimeout(open, 50); return;
    }
    viewport?.removeEventListener('resize', resized);
    viewport?.removeEventListener('scroll', resized);
    openingImages = false;
    if (selected !== id || input.disabled || !input.getClientRects().length || keyboardOpen() ||
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
  const allFiles = [...images.map(image => image.file), ...files];
  if (allFiles.length > MAX_IMAGES || files.some(file => !file.size || (isVideo(file) ? file.size > MAX_VIDEO_BYTES : !IMAGE_TYPES.includes(file.type))) ||
    allFiles.filter(file => !isVideo(file)).reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_BYTES) {
    notice(allFiles.some(isVideo) ? VIDEO_LIMIT : IMAGE_LIMIT); return;
  }
  if (files.some(isVideo) && !supportsVideos) { notice('Restart Pi Remote on your computer to enable video uploads.'); return; }
  const added = files.map(file => ({ file, video: isVideo(file), url: URL.createObjectURL(file) }));
  for (const image of added) {
    if (image.video) image.upload = uploadQueue = uploadQueue.then(() => stageVideo(image)).catch(() => {});
    else uploadImage(image);
  }
  imageDrafts.set(selected, [...images, ...added]);
  notice(''); renderImages();
});
// Composer buttons never take focus from the editor. On iOS a blur starts closing the keyboard and the
// shell fills the screen at once, so the composer drops away before the tap lands and the tap is lost.
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage();
});
async function sendMessage() {
  const id = selected, text = $('prompt').value, attachments = imageDrafts.get(id) || [];
  if ((!text.trim() && !attachments.length) || !id || $('send').disabled || sending.has(id)) return;
  if (attachments.some(item => !item.video) && !supportsImages) { notice('Restart Pi Remote on your computer to enable image uploads.'); return; }
  if (attachments.some(item => item.video) && !supportsVideos) { notice('Restart Pi Remote on your computer to enable video uploads.'); return; }
  if (historyWindow) showLatest();
  const isCommand = text.trim().startsWith('/');
  if (attachments.length && isCommand) { notice('Send attachments with a message, not a slash command.'); return; }
  const outgoing = { key: crypto.randomUUID(), sessionId: id, text, attachments,
    knownIds: new Set((cache.get(id)?.messages || []).map(message => message.id)), accepted: false };
  sending.set(id, outgoing);
  if (!isCommand) submissions.set(outgoing.key, outgoing);
  // The editor owns the next draft; retain this submission until delivery is confirmed.
  drafts.set(id, ''); imageDrafts.delete(id);
  $('prompt').value = ''; resizePrompt(); renderImages(); notice('');
  // On touch screens a sent message closes the keyboard to reveal the conversation; desktops keep typing.
  if (matchMedia('(hover: none)').matches) $('prompt').blur();
  if (!isCommand) {
    renderConversation(cache.get(id));
    $('transcript').scrollTop = $('transcript').scrollHeight;
  }
  let restored = false;
  try {
    await Promise.all(attachments.map(image => image.upload));
    if (sending.get(id) !== outgoing) return;
    const videos = [];
    for (const image of attachments.filter(item => item.video)) videos.push(await stageVideo(image));
    const images = await Promise.all(attachments.filter(item => !item.video).map(image => image.staged?.socket === socket
      ? { type: 'image', uploadId: image.staged.uploadId } : readImage(image.file)));
    outgoing.sentText = videoMessage(text, videos.map(video => video.path));
    if (selected === id && videos.length) renderConversation(cache.get(id));
    // Signing out while files are being read must not send them through a later login.
    if (sending.get(id) !== outgoing) return;
    let created;
    if (text.trim() === '/new') created = await request('new', { sessionId: id });
    else if (/^\/model(?:\s|$)/.test(text.trim())) {
      const key = text.trim().slice(6).trim();
      if (key) await switchModel(id, key);
      else openModels(id);
    } else await request('command', { sessionId: id, command: { type: 'prompt', text, ...(images.length ? { images } : {}), ...(videos.length ? { videos: videos.map(video => video.uploadId) } : {}) } });
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
      if (selected === id && !isCommand) renderConversation(cache.get(id));
      else updateControls();
    }
  }
}
$('abort').addEventListener('click', async () => {
  try { await request('command', { sessionId: selected, command: { type: 'abort' } }); }
  catch (e) { notice(e.message); }
});
$('resume').addEventListener('click', async () => {
  const creation = cache.get(selected)?.creation;
  if (creation) { await startInProject(creation.project, selected); return; }
  $('resume').disabled = true;
  try { await request('resume', { sessionId: selected }); }
  catch (e) { notice(e.message); }
  finally { updateControls(); }
});
if (loginLinkError) showLogin(loginLinkError);
else if (token) connect(); else { $('boot').hidden = true; $('login').hidden = false; }
