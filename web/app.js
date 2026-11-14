import { patchState, loadedSkill, sessionTitle, taskText, replyAttempts, sessionActivity, sessionGroup, activityOrder, workerRunning } from './protocol.js';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, IMAGE_LIMIT, validateImages } from './images.js';
import { isVideo, MAX_VIDEO_BYTES, VIDEO_CHUNK_BYTES, VIDEO_LIMIT, videoMessage, splitVideoMessage, VideoCache } from './videos.js';
import MarkdownIt from './markdown-it.mjs';
import { renderDiagrams } from './diagrams.js';
import { hello, channel, validKey } from './e2e.js';
const markdown = new MarkdownIt({ html: false }).disable('image');
// Only disclosure-only lines become markup; all other HTML stays escaped.
markdown.block.ruler.before('html_block', 'disclosure', (state, start, end, silent) => {
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
  const match = /^(?:(<details(?:\s+open)?\s*>)\s*)?(?:<summary\s*>(.*?)<\/summary\s*>\s*)?(?:(<\/details\s*>)\s*)?$/i.exec(line);
  if (!match || !line) return false;
  if (silent) return true;
  const html = content => { state.push('html_block', '', 0).content = content + '\n'; };
  if (match[1]) html('<details class="markdown-details"' + (/\sopen[\s>]/i.test(match[1]) ? ' open' : '') + '>');
  if (match[2] !== undefined) {
    html('<summary>');
    const text = state.push('inline', '', 0); text.content = match[2]; text.children = [];
    html('</summary>');
  }
  if (match[3]) html('</details>');
  state.line = start + 1;
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
function refreshDiagramTheme() {
  if (!document.querySelector('code.language-mermaid')) return;
  const state = cache.get(selected);
  if (state) renderConversation(state, { anchor: readingAnchor(), historyChanged: true });
  renderCoordinatorLog();
}
new MutationObserver(refreshDiagramTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshDiagramTheme);
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
// The thread scrolls under the floating dock, so its end spacer reserves the dock's height.
new ResizeObserver(([{ target }]) => {
  document.documentElement.style.setProperty('--dock-height', `${target.offsetHeight}px`);
  if (pinnedToBottom) $('transcript').scrollTop = $('transcript').scrollHeight;
  updateScrollButton();
}).observe($('dock'));
new ResizeObserver(([{ target }]) => {
  const height = target.getBoundingClientRect().height;
  document.querySelector('main').style.setProperty('--coordinator-height', `${height ? height + parseFloat(getComputedStyle(target).marginBottom) : 0}px`);
}).observe($('coordinator-context'));
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
  // iOS can shrink innerHeight with the keyboard, so also compare the layout viewport.
  document.documentElement.toggleAttribute('data-keyboard', !!viewport && Math.max(innerHeight, document.documentElement.clientHeight) - viewport.height * viewport.scale > 150);
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
const modelLists = new Map(), newSessionProfiles = new Map();
const threadImages = new Map(), threadVideos = new Map(), usageSummaries = new Map();
const usageDetails = new Map(), usageLoading = new Set(), usageTotals = new Map(), usageTurns = new Map();
let supportsUsage = false;
let imageQueue = Promise.resolve(), uploadQueue = Promise.resolve();
const visibleImages = (entries, observer) => {
  for (const entry of entries) if (entry.isIntersecting) {
    observer.unobserve(entry.target);
    loadThreadImage(threadImages.get(entry.target.dataset.imageKey));
  }
};
const imageObserver = new IntersectionObserver(visibleImages, { root: $('transcript'), rootMargin: '160px' });
const coordinatorImageObserver = new IntersectionObserver(visibleImages, { root: $('coordinator-scroll'), rootMargin: '160px' });
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
let swipeTimer, trackingSwipe = false, openingAnimation, pendingSwipeRender;
let switchOrder, switchOrigin, headingGesture, headingSwitching = false, headingNudged = false, lastHeadingTap = 0;
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const reasoningLevels = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
let lastDialog, blankDir, settingsPicker, supportsHistory = false, supportsImages = false, supportsUploads = false, supportsVideos = false, supportsCommandResults = false, allowResume = false, selectedSummary, legacyList;
let listLimit = 20, searchQuery = '', listMatched = 0, listLoading = true, listError = '', searchTimer, listRequest = 0;
let pushKey, pushOn = false, pushBusy = false;
let assistantId, supportsCoordinator = false, supportsWorkerInspection = false, coordinatorRenderKey, coordinatorLog;
let coordinatorDrag, coordinatorDragAnimation;
const coordinatorPositions = new Map();
let supportsSessionSections = false, supportsRecentAvailability = false, recentAvailability = 'online', supportsSessionClosing = false, supportsNewPreparation = false, supportsActivityDebug = false, listSection = 'overview', listGroups, listLoaded = 0, overviewLimit = 20;
const activityDebug = { page: crypto.randomUUID(), queue: [], sending: false, renders: 0, renderAt: 0,
  last: undefined, framePending: false, frameDelay: null, frameAt: 0 };
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
  if (nextToken !== token || resolvedKey !== key) { videoCache?.clear(); videoCache = undefined; modelLists.clear(); newSessionProfiles.clear(); }
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
// iOS Safari lacks navigator.vibrate; a switch input supplies click-triggered feedback.
// shortcut: iOS may block this after drags; use a native gesture control for reliable swipe haptics.
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
    const lookup = supportsCommandResults && ['command', 'new', 'newProject', 'resume', 'answer', 'newCoordinator', 'taskAction', 'assistantDraft'].includes(op)
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
  listRequest++; legacyList = undefined; projectRequest = undefined; preparation = undefined; supportsNewPreparation = false;
  const old = socket; socket = undefined; connected = false; supportsWorkerInspection = false; supportsHistory = false; supportsImages = false; supportsUploads = false; supportsVideos = false; supportsCommandResults = false; allowResume = false;
  debugActivity('disconnect'); supportsActivityDebug = false;
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
      supportsRecentAvailability = packet.supportsRecentAvailability === true;
      supportsSessionClosing = packet.supportsSessionClosing === true;
      supportsNewPreparation = packet.supportsNewPreparation === true;
      supportsActivityDebug = packet.supportsActivityDebug === true;
      supportsCoordinator = packet.supportsCoordinator === true;
      supportsWorkerInspection = packet.supportsWorkerInspection === true;
      $('assistant-open').hidden = packet.supportsAssistant !== true; assistantId = packet.assistantId; pushKey = packet.pushKey;
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
      connected = true; reportViewing(); retry = 0; connection('Computer connected'); $('login-error').hidden = true; $('access-warning').hidden = true;
      void syncPush();
      const opening = new URLSearchParams(location.search).get('open');
      if (/^[a-f0-9]{64}$/.test(opening || '')) { history.replaceState(null, '', location.pathname); void selectSession(opening); }
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
        request('watch', { sessionId: id }).then(() => {
          loadUsage(id);
          if (coordinatorLog && $('coordinator-sheet').open) watchCoordinatorWorker(coordinatorLog);
        }).catch(e => notice(e.message));
        loadCommands(id);
      }
    } else if (packet.type === 'sessions') {
      receiveList(packet);
    } else if (['workerSnapshot', 'workerPatch', 'workerNotice'].includes(packet.type)) {
      receiveCoordinatorWorker(packet);
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
  transmit(socket, { op: 'ping', id: crypto.randomUUID(), viewingSessionId: viewedSession() });
}
function viewedSession() {
  return document.visibilityState === 'visible' && document.querySelector('main').getClientRects().length && !$('app').hidden ? selected || null : null;
}
function reportViewing() {
  if (connected && socket?.readyState === WebSocket.OPEN) transmit(socket, { op: 'viewing', id: crypto.randomUUID(), viewingSessionId: viewedSession() });
}
window.addEventListener('resize', reportViewing);
window.addEventListener('pagehide', () => { if (connected) transmit(socket, { op: 'viewing', id: crypto.randomUUID(), viewingSessionId: null }); });
// Mobile browsers suspend sockets and timers in the background. Start fresh on return.
function reconnectNow() { if (token && !manualClose) { retry = 0; connect(); } }
window.addEventListener('online', reconnectNow);
// iOS also hides the page for a moment during edge-swipe back; a brief hide only checks the socket,
// so returning to the list doesn't flash Connecting….
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  debugActivity('visibility'); reportViewing();
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
  activityDebug.queue = []; activityDebug.last = undefined;
  for (const images of imageDrafts.values()) releaseImages(images);
  for (const draft of sending.values()) releaseImages(draft.attachments);
  for (const draft of submissions.values()) releaseImages(draft.attachments);
  imageDrafts.clear(); sending.clear(); submissions.clear();
  clearThreadImages(); clearThreadVideos();
  localStorage.removeItem('pi-remote-seen'); seen = {}; localStorage.removeItem('pi-remote-pins'); pinnedProjects = [];
  projectList = undefined; renderProjects();
  $('session-icon-picker').close();
  resetScrollback();
  drafts.clear(); cache.clear(); commandCatalog.clear(); modelLists.clear(); newSessionProfiles.clear(); usageSummaries.clear(); usageDetails.clear(); usageTotals.clear(); usageTurns.clear(); selected = undefined; selectedSummary = undefined; sessions = [];
  clearTimeout(searchTimer); $('search').value = ''; $('search-bar').classList.remove('open'); listLimit = 20; searchQuery = ''; listMatched = 0; listLoading = true; listError = '';
  listSection = 'overview'; listGroups = undefined; listLoaded = 0; overviewLimit = 20; recentAvailability = 'online';
  $('recent-filter-menu').hidePopover(); $('recent-online').checked = true; $('recent-offline').checked = false;
  $('recent-online').disabled = true; $('recent-offline').disabled = false;
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
  if (supportsSessionSections && (packet.section !== listSection || packet.query !== searchQuery ||
    supportsRecentAvailability && packet.availability !== recentAvailability)) return;
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
    const page = legacyList || await request('list', { limit: listLimit, query: searchQuery, ...(supportsSessionSections ? { section: listSection } : {}), ...(supportsRecentAvailability ? { availability: recentAvailability } : {}) });
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
  $('list-empty').hidden = listLoading || !!listError || sessions.length > 0 || !!listGroups && listSection === 'overview' && !searchQuery;
}
// Reaching the last row asks for the next 20; a short screen keeps filling until it scrolls.
const moreObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loadMore(); }, { rootMargin: '0px 0px 400px' });
function loadMore() {
  if (!connected || listLoading || listError || listLoaded < listLimit || listLoaded >= listMatched) return;
  listLimit += 20; loadList();
}
const isUnread = item => item.previewRole !== 'user' && item.updatedAt > seen[item.id];
function sessionRow(item) {
  const button = el('button', undefined, 'session' + (item.id === selected ? ' active' : ''));
  button.type = 'button'; button.dataset.id = item.id; button.dataset.swipe = item.pinned ? 'Unpin' : 'Pin'; button.setAttribute('aria-current', String(item.id === selected));
  const status = sessionActivity(item), kind = sessionKind(item), busy = ['working', 'waiting'].includes(status) && kind && !kind.emoji;
  if (busy) button.classList.add('session-busy');
  const icon = statusIcon(status);
  if (isUnread(item)) { icon.dataset.unread = ''; icon.title = 'New reply'; }
  const indicators = el('span', undefined, 'session-indicators');
  indicators.append(kind && !kind.emoji ? showSessionKind(icon, item, 32) : icon);
  if ('unread' in icon.dataset) indicators.append(el('span', 'New reply', 'sr-only'));
  if (['idle', 'saved'].includes(status)) indicators.append(el('span', statusLabels[status], 'sr-only'));
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
  const meta = el('div', undefined, 'session-meta');
  if (item.closed) meta.append(el('span', 'Closed', 'session-closed'));
  // Ready and Saved are the resting states; only label what needs attention.
  if (!['idle', 'saved'].includes(status)) {
    const label = el('span', statusLabels[status] || status, 'session-state');
    label.dataset.status = status;
    // Keep the three-second sweep continuous when live updates rebuild the row.
    if (status === 'working') label.style.animationDelay = `-${Date.now() % 3000}ms`;
    meta.append(label);
  }
  if (!isBlank(item.cwd)) {
    const project = el('span', undefined, 'session-project');
    project.append(el('span', projectName(item.cwd), 'session-project-name'));
    project.title = displayPaths(item.cwd);
    meta.append(project);
  }
  const date = new Date(item.updatedAt);
  if (Number.isFinite(date.getTime())) {
    const time = el('time', age(date), 'session-time');
    time.dateTime = date.toISOString(); time.title = 'Last activity: ' + date.toLocaleString();
    meta.append(time);
  }
  if (kind?.emoji) meta.append(dressKind(el('span', undefined, 'session-kind'), kind, 20, status));
  body.append(meta);
  button.append(body);
  // The finger lifting after a swipe must not also open the session.
  button.addEventListener('click', () => {
    if (Date.now() - swipedAt <= 400) return;
    haptic(); selectSession(item.id); $('session-collection').close();
  });
  return button;
}
function positionRecentFilter() {
  const filter = $('recent-filter'), menu = $('recent-filter-menu');
  if (!filter) return;
  const anchor = filter.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
  menu.style.right = Math.max(8, innerWidth - anchor.right) + 'px';
  menu.style.top = Math.max(8, Math.min(anchor.bottom + 4, innerHeight - bounds.height - 8)) + 'px';
}
// WebKit rings every scripted focus, so only a keyboard opening (click detail 0) moves focus into the menu.
let recentFilterByKeyboard = false;
document.addEventListener('click', event => { if (event.target.closest?.('#recent-filter')) recentFilterByKeyboard = !event.detail; }, true);
$('recent-filter-menu').addEventListener('toggle', event => {
  const open = event.newState === 'open';
  $('recent-filter')?.setAttribute('aria-expanded', String(open));
  if (!open) return;
  positionRecentFilter();
  if (recentFilterByKeyboard) $('recent-filter-menu').querySelector('input:not(:disabled)').focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !$('recent-filter-menu').matches(':popover-open')) return;
  event.preventDefault(); $('recent-filter-menu').hidePopover(); $('recent-filter')?.focus({ preventScroll: true });
});
$('recent-filter-menu').addEventListener('change', () => {
  const checked = [...$('recent-filter-menu').querySelectorAll('input:checked')];
  for (const input of $('recent-filter-menu').querySelectorAll('input')) input.disabled = checked.length === 1 && input.checked;
  haptic(); recentAvailability = checked.length === 1 ? checked[0].value : checked.length ? 'all' : 'none';
  listLimit = 20; moreObserver.disconnect();
  positionRecentFilter(); loadList();
});
window.addEventListener('resize', positionRecentFilter);
for (const list of [$('sessions'), $('sidebar')]) list.addEventListener('scroll', () => {
  if ($('recent-filter-menu').matches(':popover-open')) positionRecentFilter();
}, { passive: true });
function renderList() {
  // Rebuilding mid-swipe would detach the touched row and strand the gesture; release renders instead.
  if (rowSwipe) { rowSwipe.stale = true; return; }
  const root = listRoot(), scrollTop = root.scrollTop, sidebarTop = $('sidebar').scrollTop;
  const filterFocused = document.activeElement.id === 'recent-filter';
  $('list-empty').textContent = searchQuery ? 'No matching sessions. Try another task or project.' :
    listSection === 'now' ? 'No sessions running.' : listSection === 'pinned' ? 'No pinned sessions.' : 'No sessions yet. Start Pi with the remote extension loaded.';
  renderPagination();
  const fragment = document.createDocumentFragment();
  if (listGroups && listSection === 'overview' && !searchQuery) {
    for (const [group, label] of [['now', 'Now'], ['pinned', 'Pinned'], ['recent', 'Recent']]) {
      if (!listGroups[group] && (group !== 'recent' || !supportsRecentAvailability)) continue;
      const section = el('section', undefined, 'session-group session-group-' + group); section.setAttribute('aria-label', label);
      const header = el('div', undefined, 'session-group-heading');
      header.append(el('h3', label), el('span', String(listGroups[group]), 'badge'));
      if (group === 'recent' && supportsRecentAvailability) {
        const filter = el('button', undefined, 'quiet'); filter.type = 'button'; filter.id = 'recent-filter';
        filter.setAttribute('aria-label', 'Filter recent sessions'); filter.title = 'Filter recent sessions';
        filter.setAttribute('popovertarget', 'recent-filter-menu'); filter.setAttribute('aria-haspopup', 'dialog');
        filter.setAttribute('aria-controls', 'recent-filter-menu'); filter.setAttribute('aria-expanded', String($('recent-filter-menu').matches(':popover-open')));
        filter.dataset.active = String(recentAvailability !== 'all');
        filter.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
        filter.addEventListener('click', positionRecentFilter);
        header.append(filter);
      }
      if (group === 'pinned' || group === 'now' && listGroups[group] > 3) {
        const more = el('button', 'View all', 'quiet'); more.type = 'button'; more.dataset.collection = group;
        more.setAttribute('aria-label', 'View all ' + (group === 'now' ? 'active' : 'pinned') + ' sessions');
        more.addEventListener('click', () => openCollection(group)); header.append(more);
      }
      section.append(header);
      const items = sessions.filter(item => sessionGroup(item) === group);
      if (group === 'now') items.sort(activityOrder);
      if (group === 'recent' && supportsRecentAvailability && !items.length) {
        section.append(el('p', recentAvailability === 'online' ? 'No online sessions. Include Offline in the filter to see saved sessions.' : recentAvailability === 'offline' ? 'No offline sessions.' : recentAvailability === 'none' ? 'No statuses selected. Choose Online or Offline in the filter.' : 'No recent sessions.', 'hint recent-empty'));
      }
      section.append(...items.map(sessionRow)); fragment.append(section);
    }
  } else fragment.append(...sessions.map(sessionRow));
  root.replaceChildren(fragment);
  syncBotVisibility();
  if (!$('recent-filter')) $('recent-filter-menu').hidePopover();
  root.scrollTop = scrollTop; $('sidebar').scrollTop = sidebarTop;
  if (filterFocused && !listLoading) $('recent-filter')?.focus({ preventScroll: true });
  moreObserver.disconnect();
  const last = [...root.querySelectorAll('.session')].at(-1);
  if (last) moreObserver.observe(last);
  const current = sessions.find(item => item.id === selected);
  if (current) { $('title').textContent = sessionTitle(current.title, cache.get(current.id)?.messages); renderProject(current.cwd, current); }
  renderHeading();
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
  sessionFeedbackTimer = setTimeout(() => sessionFeedback(''), 3000);
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
      $('session-icon-picker').close(); $('app').classList.remove('viewing'); misoReturn = false; reportViewing();
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
// Each kind is a bot on a 32px grid: the same body-and-eyes construction, told apart by shape and accessory.
// [label, body, eyes [x, y, scale], drawn behind the body, drawn in front]; style.css gives each kind its colour.
const botStar = (x, y, r) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
// [label, body, eyes, behind the body, in front, shown only while working: each bot's own job].
const sessionKinds = {
  review: ['Review', '<rect x="4" y="7" width="24" height="21" rx="7"/>', [[11.5, 17], [20.5, 17]], ''],
  fix: ['Fix', '<circle cx="16" cy="19" r="11"/>', [[11.5, 19], [20.5, 19]],
    '<g class="bot-antenna"><path class="bot-stalk" d="M11 9 8 3.5"/><circle class="bot-body" cx="8" cy="3.5" r="2"/></g><g class="bot-antenna bot-right"><path class="bot-stalk" d="M21 9l3-5.5"/><circle class="bot-body" cx="24" cy="3.5" r="2"/></g>', '',
    '<path class="bot-spark" d="M4.5 1.5 3 0M5 5H3M27.5 1.5 29 0M27 5h2"/>'],
  research: ['Research', '<rect x="3" y="8" width="26" height="21" rx="10.5"/>', [[12, 18], [20, 18]], '', '', '<circle class="bot-scan" cx="16" cy="18" r="6"/>'],
  build: ['Build', '<rect x="4" y="11" width="24" height="18" rx="6"/>', [[11.5, 20], [20.5, 20]], '',
    '<path class="bot-accent" d="M7 12a9 8 0 0 1 18 0ZM4.5 11h23a1.5 1.5 0 0 1 0 3h-23a1.5 1.5 0 0 1 0-3Z"/>',
    '<g class="bot-hammer"><path class="bot-handle" d="M28 28 31 18"/><rect class="bot-accent" x="27" y="14" width="7.5" height="4.2" rx="1" transform="rotate(18 30.7 16)"/></g>'],
  idea: ['Idea', '<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<path class="bot-stalk" d="M16 10V6.5"/><circle class="bot-bulb" cx="16" cy="4.5" r="3"/>', '',
    '<path class="bot-rays" d="M16-1.2v-1.6M11.3.6l-1.1-1.1M20.7.6l1.1-1.1M10 4.5H8.4M22 4.5h1.6"/>'],
  notes: ['Notes', '<rect x="5" y="8" width="22" height="20" rx="6"/>', [[11.5, 18], [20.5, 18]], '',
    '<ellipse class="bot-accent" cx="14" cy="8.5" rx="10" ry="3.6" transform="rotate(-8 14 8.5)"/><circle class="bot-accent" cx="10" cy="5.2" r="1.6"/>',
    '<path class="bot-scribble" d="M7 31.5q2-2.4 4 0t4 0 4 0 4 0"/><g class="bot-pencil"><path class="bot-pencil-body" d="m24 30 6.5-6.5 2 2L26 32l-2.6.6Z"/></g>'],
  test: ['Test', '<path d="M12 3h8a1 1 0 0 1 0 2h-1v6.5l7.6 12.6A3 3 0 0 1 24 28.5H8a3 3 0 0 1-2.6-4.4L13 11.5V5h-1a1 1 0 0 1 0-2Z"/>', [[13.5, 18, .85], [18.5, 18, .85]], '',
    '<path class="bot-accent" d="M6.6 22.5h18.8l1.2 2a2.6 2.6 0 0 1-2.3 3.9H7.7a2.6 2.6 0 0 1-2.3-3.9Z"/>',
    '<g class="bot-bubbles"><circle cx="15" cy="1.5" r="1.4"/><circle cx="17.8" cy="0" r="1"/><circle cx="16" cy="-2" r=".8"/></g>'],
  ship: ['Ship', '<path d="M16 3c5.5 3.2 8.5 8.5 8.5 14.5V24a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-6.5C7.5 11.5 10.5 6.2 16 3Z"/>', [[12.8, 16, .85], [19.2, 16, .85]],
    '<path class="bot-accent" d="M8.5 17 4 22.5V27l4.5-2.5ZM23.5 17l4.5 5.5V27l-4.5-2.5Z"/>', '',
    '<g class="bot-flame"><path class="bot-flame-out" d="M11.5 27h9c0 3.2-2.2 5.8-4.5 7-2.3-1.2-4.5-3.8-4.5-7Z"/><path class="bot-flame-in" d="M13.5 27h5c0 1.8-1.2 3.3-2.5 4-1.3-.7-2.5-2.2-2.5-4Z"/></g>'],
  tidy: ['Tidy', '<circle cx="16" cy="19" r="10.5"/>', [[12, 19], [20, 19]], '',
    `<path class="bot-accent" d="M8 14.5c1.5-5.5 6.5-8 11.5-6.5 2.4.7 4.2 2.3 5 4.4-4.6-1.8-10.4-1.4-16.5 2.1Z"/><path class="bot-star" d="${botStar(26, 7, 2.6)}"/>`,
    `<path class="bot-sparkle" d="${botStar(4.5, 9, 3)}"/><path class="bot-sparkle" d="${botStar(29, 15, 2.4)}"/><path class="bot-sparkle" d="${botStar(6, 27, 2)}"/>`],
  data: ['Data', '<path d="M6 8c0-1.9 4.5-3.5 10-3.5S26 6.1 26 8v16.5c0 1.9-4.5 3.5-10 3.5S6 26.4 6 24.5Z"/>', [[12.5, 21.5, .9], [19.5, 21.5, .9]], '',
    '<ellipse class="bot-accent" cx="16" cy="8" rx="10" ry="3.5"/><path class="bot-band" d="M6 14.5c0 2 4.5 3.6 10 3.6s10-1.6 10-3.6"/>',
    '<ellipse class="bot-spin" cx="16" cy="8" rx="6.5" ry="2"/>'],
  guard: ['Guard', '<path d="M16 3.5 26.5 7v8.5C26.5 22 22 26.5 16 28.5 10 26.5 5.5 22 5.5 15.5V7Z"/>', [[12, 15], [20, 15]], '',
    '<path class="bot-chevron" d="m12 21.5 4 2.5 4-2.5"/>',
    '<path class="bot-pulse" d="M16 3.5 26.5 7v8.5C26.5 22 22 26.5 16 28.5 10 26.5 5.5 22 5.5 15.5V7Z"/>'],
  chat: ['Chat', '<path d="M6 6h20a3.5 3.5 0 0 1 3.5 3.5v11A3.5 3.5 0 0 1 26 24H15l-6 5v-5H6a3.5 3.5 0 0 1-3.5-3.5v-11A3.5 3.5 0 0 1 6 6Z"/>', [[12, 13.5], [20, 13.5]], '', '',
    '<g class="bot-typing"><circle cx="12" cy="19.5" r="1.3"/><circle cx="16" cy="19.5" r="1.3"/><circle cx="20" cy="19.5" r="1.3"/></g>'],
  design: ['Design', '<rect x="5" y="9" width="22" height="19" rx="7"/>', [[11.5, 18.5], [20.5, 18.5]],
    '<g class="bot-swatches"><rect x="7" y="3.5" width="5" height="9" rx="2.5" fill="#ff6b9a"/><rect x="13.5" y="2" width="5" height="10" rx="2.5" fill="#ffd84d"/><rect x="20" y="3.5" width="5" height="9" rx="2.5" fill="#5fb3ff"/></g>'],
  ops: ['Ops', '<rect x="5" y="9" width="22" height="19" rx="7"/>', [[11.5, 18.5], [20.5, 18.5]], '<path class="bot-headset" d="M6 17v-3a10 10 0 0 1 20 0v3"/>',
    '<rect class="bot-accent" x="2.5" y="14.5" width="4.5" height="7" rx="2"/><rect class="bot-accent" x="25" y="14.5" width="4.5" height="7" rx="2"/><path class="bot-headset" d="M27 21.5c0 3.8-2.8 5.8-6.5 5.8"/><circle class="bot-accent" cx="20" cy="27.3" r="1.5"/>',
    '<g class="bot-gear"><circle class="bot-gear-teeth" cx="4" cy="4.5" r="2.6"/><circle class="bot-gear-hole" cx="4" cy="4.5" r="1"/></g>'],
  pip: ['Pip', '<rect x="5" y="9" width="22" height="20" rx="8"/>', [[12, 19], [20, 19]],
    '<g class="character-antenna"><path class="bot-stalk" d="M16 10V7l-5-3.5"/><circle class="bot-body" cx="11" cy="3.5" r="2"/></g>', '',
    '<path class="character-signal" d="M6 3H4M8 0 7-1M13 0l1-1"/>'],
  sprout: ['Sprout', '<rect x="4" y="10" width="24" height="19" rx="9"/>', [[12, 19], [20, 19]],
    '<path class="bot-stalk" d="M16 11V6"/><path class="bot-body character-leaf character-leaf-left" d="M16 7C10 7 7 4 8 1c5 0 8 2 8 6Z"/><path class="bot-accent character-leaf character-leaf-right" d="M16 8c0-5 3-7 8-7 0 4-3 7-8 7Z"/>', '',
    '<g class="character-seeds"><circle class="character-seed" cx="9" cy="5" r="1"/><circle class="character-seed" cx="23" cy="7" r=".8"/></g>'],
  bun: ['Bun', '<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]],
    '<g class="character-ear"><rect class="bot-body" x="8" y="2" width="5" height="13" rx="2.5"/></g><g class="character-ear character-ear-right"><rect class="bot-body" x="19" y="4" width="5" height="11" rx="2.5"/></g>'],
  mochi: ['Mochi', '<path d="M16 10C8 10 2 16 2 23c0 5 6 7 14 7s14-2 14-7c0-7-6-13-14-13Z"/>', [[11.5, 21], [20.5, 21]], ''],
  pebble: ['Pebble', '<path d="M12 5h6c3.5 0 5.5 2 7 5l3 9c1.5 5-1.5 10-7 10H10c-5 0-8-4-6.5-9l4-11C8.3 6.5 9.6 5 12 5Z"/>', [[12, 18.5], [20, 18.5]], '', '',
    '<g class="character-orbit"><circle cx="3" cy="13" r="1"/><circle cx="29" cy="21" r=".8"/></g>'],
  wisp: ['Wisp', '<path d="M16 5C22.6 5 26 10 26 17v7H6v-7C6 10 9.4 5 16 5Z"/>', [[12, 17.5], [20, 17.5]], '',
    '<path class="bot-body character-tail" d="M6 23h20v4Q24 31 21 27Q18 32 15 28Q12 32 9 28Q6 31 6 27Z"/>'],
  miso: ['Miso', '<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]],
    '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><g class="character-cat-ear"><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/></g><g class="character-cat-ear character-cat-ear-right"><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/></g>'],
  puff: ['Puff', '<path d="M8 28C3 28 1 24 3 20C0 15 5 10 9 11C10 4 20 3 23 10C29 9 32 15 28 20C31 24 28 28 24 28Z"/>', [[12, 20], [20, 20]],
    '<g class="character-cloud-puff"><circle class="bot-body" cx="5" cy="20" r="4"/></g><g class="character-cloud-puff character-cloud-puff-right"><circle class="bot-body" cx="27" cy="21" r="3.5"/></g>'],
  moss: ['Moss', '<path d="M3 20Q2 9 8 8Q13 6 16 12Q19 6 24 8Q30 9 29 20Q32 30 16 30Q0 30 3 20Z"/>', [[10, 15.5], [22, 15.5]],
    '<g class="character-frog-foot"><ellipse class="bot-body" cx="6" cy="29.5" rx="4" ry="2"/></g><g class="character-frog-foot character-frog-foot-right"><ellipse class="bot-body" cx="26" cy="29.5" rx="4" ry="2"/></g>'],
  jelly: ['Jelly', '<path d="M4 20C4 10 8 4 16 4s12 6 12 16Q22 23 16 21Q10 23 4 20Z"/>', [[12, 15], [20, 15]],
    '<path class="character-tentacle" d="M9 19v5q-4 4 0 7"/><path class="character-tentacle character-tentacle-middle" d="M16 20v6q4 2 0 5"/><path class="character-tentacle character-tentacle-right" d="M23 19v6q-4 2 0 6"/>'],
  nim: ['Nim', '<ellipse cx="16" cy="19" rx="8" ry="10"/>', [[12.5, 18], [19.5, 18]],
    '<g class="character-wing"><path class="bot-accent" d="M10 18C2 10-1 13 2 21c-3 5 2 8 8 3Z"/></g><g class="character-wing character-wing-right"><path class="bot-accent" d="M22 18c8-8 11-5 8 3 3 5-2 8-8 3Z"/></g><path class="bot-stalk" d="m13 10-2-5m8 5 2-5"/>'],
  zig: ['Zig', '<path d="M16 5q2 0 4 4l8 15q2 5-3 5H7q-5 0-3-5l8-15q2-4 4-4Z"/>', [[12, 21], [20, 21]],
    '<g class="character-zig-foot"><rect class="bot-body" x="7" y="26" width="7" height="5" rx="2"/></g><g class="character-zig-foot character-zig-foot-right"><rect class="bot-body" x="18" y="26" width="7" height="5" rx="2"/></g>'],
  stella: ['Stella', '<path d="M14.3 3.9Q16 1 17.7 3.9l3.4 6.5 7.2 1Q31.5 12 29 14.5l-5.3 5.1 1.3 7.3Q25.6 30.5 22.5 29L16 25.6 9.5 29Q6.4 30.5 7 26.9l1.3-7.3L3 14.5Q.5 12 3.7 11.4l7.2-1Z"/>', [[12, 18], [20, 18]], '', '',
    '<g class="character-stardust"><path d="M3 2v4M1 4h4M29 26v4M27 28h4"/></g>'],
  luna: ['Luna', '<path d="M25 3C17 1 8 4 4 12C0 22 7 30 16 30C22 30 27 27 30 22C20 26 13 20 13 12C13 7 18 3 25 3Z"/>', [[7.5, 20, .9], [12.5, 21, .9]], '', '',
    '<path class="character-moon-mote" d="M25 7q0 4 4 4-4 0-4 4 0-4-4-4 4 0 4-4Z"/>'],
  sol: ['Sol', '<circle cx="16" cy="17" r="9"/>', [[12, 17], [20, 17]],
    '<g class="character-sun-rays"><path d="M16 2v3M16 29v3M1 17h3M28 17h3M5 6l2 2M25 26l2 2M5 28l2-2M25 8l2-2"/></g>'],
  orbit: ['Orbit', '<circle cx="16" cy="16" r="10"/>', [[12, 13.5], [20, 13.5]],
    '<g class="character-planet-ring"><ellipse class="character-ring-back" cx="16" cy="17" rx="15" ry="5" transform="rotate(-22 16 17)"/></g>',
    '<g class="character-planet-ring"><path class="character-ring-front" d="M2 22C8 29 28 20 30 12"/></g>'],
  comet: ['Comet', '<circle cx="19" cy="14" r="9.5"/>', [[16, 13], [23, 13]],
    '<g class="character-comet-tail"><path class="bot-accent" d="M16 17Q8 18 3 29Q14 28 22 21Z"/><path class="bot-body" d="M13 14Q6 16 2 23Q10 23 18 19Z"/><path class="bot-body" d="M20 20Q15 28 9 31Q10 24 16 18Z"/></g>'],
  vega: ['Vega', '<path d="M16 2Q18 12 29 16Q18 19 16 30Q13 19 3 16Q13 13 16 2Z"/>', [[12.5, 16], [19.5, 16]], '', '',
    '<g class="character-vega-motes"><circle cx="4" cy="4" r="1.1"/><circle cx="28" cy="28" r=".8"/></g>'],
  general: ['Session', '<rect x="5" y="7" width="22" height="21" rx="8"/>', [[12, 17], [20, 17]], ''],
};
// The face carries the state: eyes close and z's drift when saved, it smiles at a new reply, and the badge marks what needs you.
function botSvg(kind, mood, size, unread = mood === 'unread') {
  const [, body, eyes, back, front = '', work = ''] = sessionKinds[kind];
  const face = eyes.map(([x, y, s = 1]) => mood === 'saved' ? `<path class="bot-line" d="M${x - 2.4 * s} ${y}h${4.8 * s}"/>`
    : mood === 'unread' ? `<path class="bot-line" d="M${x - 2.4 * s} ${y + 1}q${2.4 * s} -${3.6 * s} ${4.8 * s} 0"/>`
    : `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/><circle class="bot-shine" cx="${x + .7 * s}" cy="${y - 1.1 * s}" r="${.7 * s}"/>`).join('');
  const badge = mood === 'waiting' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>'
    : unread ? '<g class="bot-badge"><circle cx="27" cy="5" r="4"/></g>' : '';
  const zz = mood === 'saved' ? '<g class="bot-zz"><text x="24" y="9">z</text><text x="24" y="9">z</text></g>' : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look">${face}</g></g>${front}${mood === 'working' ? work : ''}</g>${badge}${zz}</svg>`;
}
const personalityKinds = ['pip', 'sprout', 'bun', 'mochi', 'pebble', 'wisp', 'miso', 'puff', 'moss', 'jelly', 'nim', 'zig', 'stella', 'luna', 'sol', 'orbit', 'comet', 'vega'];
const sessionCharacters = [...new Set(['pip', 'sprout', 'bun', 'mochi', 'pebble', 'wisp', 'idea', 'fix', 'build', 'notes', 'ship', ...personalityKinds])];
function sessionSeed(id = '') {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index++) seed = Math.imul(seed ^ id.charCodeAt(index), 16777619);
  return seed >>> 0;
}
const botObserver = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) target.classList.toggle('in-view', isIntersecting);
});
let botVisibilityQueued = false;
function syncBotVisibility() {
  document.documentElement.classList.toggle('document-hidden', document.hidden);
  if (botVisibilityQueued) return;
  botVisibilityQueued = true;
  queueMicrotask(() => {
    botVisibilityQueued = false;
    botObserver.disconnect();
    document.querySelectorAll('.bot, .session-state[data-status=working]').forEach(node => botObserver.observe(node));
  });
}
document.addEventListener('visibilitychange', syncBotVisibility);
// Characters take the status slot; custom emoji keep the plain activity indicator.
function showSessionKind(icon, item, size = 28) {
  const kind = sessionKind(item), unread = 'unread' in icon.dataset, status = sessionActivity(item);
  if (!kind || kind.emoji && (unread || !['idle', 'saved'].includes(status))) return icon;
  return dressKind(icon, kind, size, status, unread);
}
function sessionKind(item) {
  if (item.id === assistantId) return { type: 'miso', label: 'Miso', id: item.id };
  let choice = sessionIcons.get(item.id);
  if (!choice || choice.type === 'none') {
    // Save the first draw so rerenders and catalogue additions cannot reroll it.
    choice = { type: sessionCharacters[Math.floor(Math.random() * sessionCharacters.length)] };
    sessionIcons.set(item.id, choice);
    localStorage.setItem('pi-remote-session-icons', JSON.stringify([...sessionIcons]));
  }
  if (choice.type === 'custom' && choice.icon) return { type: 'custom', emoji: choice.icon, label: `Session icon: ${choice.icon}` };
  if (Object.hasOwn(sessionKinds, choice.type)) return { type: choice.type, label: sessionKinds[choice.type][0], id: item.id };
}
// Activity outranks a new reply: a working bot keeps moving and wears the unread badge.
function dressKind(node, kind, size, status, unread = false) {
  node.dataset.kind = kind.type;
  if (kind.emoji) node.textContent = kind.emoji;
  else {
    const mood = ['working', 'waiting'].includes(status) ? status : unread ? 'unread' : ['saved', 'disconnected'].includes(status) ? 'saved' : 'idle';
    node.classList.add('bot'); node.classList.toggle('personality-bot', personalityKinds.includes(kind.type)); node.dataset.mood = mood;
    // Both clocks are tied to the session, so rebuilding rows never restarts the movement.
    const seed = sessionSeed(kind.id);
    node.style.setProperty('--bot-t', `-${(Date.now() + seed) % 6000}ms`);
    node.style.setProperty('--bot-blink', `-${(Date.now() + seed) % 6000}ms`);
    node.innerHTML = botSvg(kind.type, mood, size, unread);
    syncBotVisibility();
  }
  // The general bot says nothing the status label doesn't.
  if (kind.type === 'general') return node;
  node.removeAttribute('aria-hidden'); node.setAttribute('role', 'img'); node.setAttribute('aria-label', kind.label); node.title = kind.label;
  return node;
}
// The header leads with the session's bot beside both lines; it shows activity but not unread, since you are reading it.
function headingKind(item) {
  const kind = item && sessionKind(item);
  return kind ? [dressKind(el('span', undefined, 'heading-kind'), kind, 32, sessionActivity(item))] : [];
}
// Keep older manual choices available while the picker defaults to the approved family.
function renderSessionIconChoice() {
  const item = sessions.find(row => row.id === selected) || selectedSummary, kind = item && sessionKind(item);
  $('session-icon-current').textContent = kind?.emoji || (kind?.type === 'general' ? 'Default' : kind?.label || '');
  for (const button of $('session-kind-options').children) {
    const pressed = button.dataset.kind === kind?.type, mood = pressed ? 'working' : 'idle';
    button.hidden = !sessionCharacters.includes(button.dataset.kind) && !pressed;
    button.setAttribute('aria-pressed', String(pressed));
    button.firstElementChild.dataset.mood = mood; button.firstElementChild.innerHTML = botSvg(button.dataset.kind, mood, 44);
  }
  $('session-emoji-other').textContent = kind?.emoji ? `${kind.emoji}  Other emoji…` : 'Other emoji…';
  syncBotVisibility();
}
function saveSessionIcon(type, icon = '') {
  if (!selected) return;
  sessionIcons.set(selected, { type, icon });
  localStorage.setItem('pi-remote-session-icons', JSON.stringify([...sessionIcons]));
  renderSessionIconChoice(); renderList();
}
for (const kind of new Set([...sessionCharacters, ...Object.keys(sessionKinds)])) {
  if (kind === 'general') continue;
  const button = el('button'), bot = el('span', undefined, 'bot');
  button.type = 'button'; button.dataset.kind = kind;
  bot.dataset.kind = kind; bot.classList.toggle('personality-bot', personalityKinds.includes(kind)); bot.setAttribute('aria-hidden', 'true');
  button.append(bot, el('span', sessionKinds[kind][0]));
  button.addEventListener('click', () => saveSessionIcon(kind));
  $('session-kind-options').append(button);
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
// The picker scrolls; keep the emoji field and its button above the keyboard as it opens.
visualViewport?.addEventListener('resize', () => { if (!$('session-emoji-form').hidden) $('session-emoji-form').scrollIntoView({ block: 'nearest' }); });
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
function renderProject(cwd = '', item) {
  $('project').textContent = displayPaths(cwd);
  // Miso's header carries its live status instead of a status line in the chat.
  const watch = item?.id === assistantId && cache.get(assistantId)?.assistant;
  $('project-name').textContent = !watch ? projectName(cwd) : watch.questions.length ? `${watch.questions.length} ${watch.questions.length === 1 ? 'needs' : 'need'} you` : `Watching ${watch.watching}`;
  $('project-name').hidden = !$('project-name').textContent;
  $('title-kind').replaceChildren(...headingKind(item));
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
// A session opened from Miso goes back to Miso, not the list.
let misoReturn = false, skipPop = false, misoBackdrop, misoScroll = 0, misoPinned = true;
// A frozen copy of Miso's screen sits behind the session while swiping back to it.
// A closed shadow root keeps the copy's ids out of the live page while reusing its styles.
function keepMisoBackdrop() {
  misoBackdrop?.remove();
  misoScroll = $('transcript').scrollTop; misoPinned = pinnedToBottom;
  const copy = document.querySelector('main').cloneNode(true);
  copy.removeAttribute('style');
  copy.querySelectorAll('dialog, [popover], img[src^="blob:"], video').forEach(node => node.remove());
  const link = el('link'), shell = el('div', undefined, 'shell viewing');
  link.rel = 'stylesheet'; link.href = document.querySelector('link[rel=stylesheet]').href;
  shell.append(copy);
  misoBackdrop = el('div', undefined, 'miso-backdrop'); misoBackdrop.inert = true; misoBackdrop.setAttribute('aria-hidden', 'true');
  misoBackdrop.attachShadow({ mode: 'closed' }).append(link, shell);
  misoBackdrop.transcript = copy.querySelector('#transcript');
  document.querySelector('main').before(misoBackdrop);
}
function backToMiso(swiped = false) {
  if (!misoReturn || selected === assistantId) return false;
  // Switch now: waiting for popstate would paint the list or the old session first.
  void selectSession(assistantId);
  if (history.state?.fromMiso) { skipPop = true; history.back(); }
  // A swipe already revealed Miso's copy; the back button needs its own motion.
  if (!swiped && !reducedMotion()) document.querySelector('main').animate([{ transform: 'translateX(-30%)', opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  return true;
}
async function selectSession(id, keepOrder = false, fromMiso = false) {
  // Only taps inside Miso (thread rows and cards) return there; any other navigation clears it.
  const returning = misoReturn && id === assistantId;
  if (fromMiso && selected === assistantId) keepMisoBackdrop();
  else if (!fromMiso) { misoBackdrop?.remove(); misoBackdrop = undefined; }
  misoReturn = fromMiso;
  const worker = cache.get(id)?.coordination?.role === 'worker' || cache.get(selected)?.coordination?.tasks?.some(task => task.sessionId === id);
  const entering = !$('app').classList.contains('viewing') && matchMedia('(max-width: 700px)').matches;
  if (!keepOrder) switchOrder = undefined;
  $('nearby-sessions').hidePopover();
  resetScrollback();
  resetSwipe();
  closePicker();
  if (selected) drafts.set(selected, $('prompt').value);
  if (selected !== id) { keepPeek(selected); clearThreadImages(); clearThreadVideos(); }
  selected = id; selectedSummary = sessions.find(item => item.id === id); $('prompt').value = drafts.get(id) || '';
  renderImages();
  commandDismissed = false; commandIndex = 0;
  if (!cache.get(id)?.creation) loadCommands(id);
  lastDialog = undefined; $('dialog').hidden = true;
  $('transcript').replaceChildren();
  updateScrollButton();
  document.querySelector('.session-info').open = false;
  $('session-icon-picker').close(); $('coordinator-sheet').close(); coordinatorRenderKey = undefined;
  renderSessionIconChoice();
  renderProject(selectedSummary?.cwd, selectedSummary);
  // An entry for the open conversation lets edge-swipe and browser Back return to the list instead of leaving the app.
  if (!standalone && (!history.state?.session || fromMiso)) history.pushState({ session: true, fromMiso }, '');
  $('app').classList.add('viewing'); reportViewing();
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
  markSeen(); renderList(); notice(''); sessionFeedback(''); nudgeHeading();
  const state = cache.get(id);
  if (state) renderConversation(state);
  // Land where Miso was left, matching the copy shown during the swipe.
  if (state && returning && !misoPinned) { $('transcript').scrollTop = misoScroll; pinnedToBottom = false; updateScrollButton(); }
  if (!state) {
    $('title').textContent = sessionTitle(sessions.find(x => x.id === id)?.title || 'Loading…');
    const loading = el('p', 'Loading conversation…', 'conversation-loading'); loading.setAttribute('role', 'status');
    const spinner = el('span', undefined, 'connection-spinner'); spinner.setAttribute('aria-hidden', 'true'); loading.prepend(spinner);
    $('transcript').replaceChildren(loading); $('transcript').setAttribute('aria-busy', 'true');
    $('transcript').hidden = false; $('empty').hidden = true;
    $('composer').hidden = !!worker; updateControls();
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
function clearThreadImages(keep = new Set(), sessionId) {
  for (const [id, image] of threadImages) if (!keep.has(id) && (sessionId === undefined || image.sessionId === sessionId)) {
    if (image.url && $('image-viewer').querySelector('img').src === image.url) $('image-viewer').close();
    image.observer.unobserve(image.node);
    clearTimeout(image.retryTimer);
    if (image.url) URL.revokeObjectURL(image.url);
    threadImages.delete(id);
  }
}
const imageViewer = $('image-viewer'), imageStage = $('image-stage'), fullImage = imageViewer.querySelector('img');
const imagePointers = new Map();
let imageZoom = 1, imageX = 0, imageY = 0, imagePull, imageGallery, imageTap, imageLastTap;
function resetImagePull() {
  imagePull = undefined; imageViewer.style.transform = ''; imageStage.style.transform = '';
}
function positionImage(zoom = imageZoom, x = imageX, y = imageY) {
  fullImage.getAnimations().forEach(animation => animation.cancel());
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
  const from = getComputedStyle(fullImage).transform;
  const next = Math.max(1, Math.min(8, zoom)), ratio = next / imageZoom;
  positionImage(next, x - (x - imageX) * ratio, y - (y - imageY) * ratio);
  if (!reducedMotion()) fullImage.animate({ transform: [from, fullImage.style.transform] },
    { duration: 260, easing: 'cubic-bezier(.16, 1, .3, 1)' });
}
function imageFitZoom() {
  const width = imageStage.clientWidth / (fullImage.naturalWidth || 1), height = imageStage.clientHeight / (fullImage.naturalHeight || 1);
  const fit = Math.min(width, height);
  return matchMedia('(max-width: 700px)').matches && fit ? Math.min(8, width / fit) : 1;
}
// Unloaded thread images count too, so the position reflects the whole conversation.
const galleryItems = () => [...(imageGallery?.querySelectorAll('[data-image-key], #attachments a') ?? [])];
const galleryHref = item => item?.href ?? item?.querySelector('a')?.href;
function showImage(href) {
  resetImagePull(); imagePointers.clear(); imageTap = imageLastTap = undefined;
  fullImage.src = href; positionImage(1, 0, 0);
  const items = galleryItems(), index = items.findIndex(item => galleryHref(item) === href);
  $('image-position').textContent = `${index + 1} / ${items.length}`;
  $('image-position').hidden = index < 0 || items.length < 2;
  // Preload neighbours so a swipe can land on them.
  if (index >= 0) for (const item of [items[index - 1], items[index + 1]]) if (item?.dataset.imageKey) loadThreadImage(threadImages.get(item.dataset.imageKey));
}
function openImage(event) {
  event.preventDefault();
  imageGallery = event.currentTarget.closest('#transcript, #attachments, #coordinator-log');
  imageViewer.showModal(); showImage(event.currentTarget.href); imageViewer.focus();
}
function stepImage(step) {
  const items = galleryItems(), index = items.findIndex(item => galleryHref(item) === fullImage.src);
  const href = index >= 0 && galleryHref(items[index + step]);
  if (href) showImage(href);
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
function appendThreadImages(parent, message, attachments, sessionId = selected) {
  if (!message?.images?.length) return;
  const gallery = el('div', undefined, 'thread-images');
  gallery.dataset.scrollKey = 'images:' + message.id;
  for (const [index, reference] of message.images.entries()) {
    if ((!attachments && !/^[a-f0-9]{64}$/.test(reference.id)) || !IMAGE_TYPES.includes(reference.mimeType)) continue;
    const key = (sessionId === selected ? '' : sessionId + ':') + message.id + ':' + index;
    let image = threadImages.get(key);
    if (image && image.id !== reference.id) {
      image.observer.unobserve(image.node);
      clearTimeout(image.retryTimer);
      if (image.url) URL.revokeObjectURL(image.url);
      threadImages.delete(key); image = undefined;
    }
    if (!image) {
      const node = el('div', undefined, 'thread-image'), button = el('button', 'Loading image…', 'secondary');
      button.type = 'button'; node.dataset.imageKey = key; node.append(button);
      image = { key, id: reference.id, sessionId, node, button, observer: sessionId === selected ? imageObserver : coordinatorImageObserver };
      button.addEventListener('click', () => loadThreadImage(image));
      threadImages.set(key, image);
      if (attachments?.[index]) showThreadImage(image, attachments[index].file);
      else image.observer.observe(node);
    } else if (!image.url && !image.loading && image.retryAt && !image.retryTimer) {
      // A live snapshot can precede Pi flushing the image to its session file.
      image.retryTimer = setTimeout(() => {
        image.retryTimer = undefined;
        image.observer.observe(image.node);
      }, Math.max(0, image.retryAt - Date.now()));
    }
    gallery.append(image.node);
  }
  parent.append(gallery);
}
const videoViewer = $('video-viewer');
let videoReturn, videoPull;
function resetVideoPull() { videoPull = undefined; videoViewer.style.transform = ''; }
function restoreVideo() {
  resetVideoPull();
  const player = videoViewer.querySelector('video');
  if (!player) return;
  player.pause(); player.controls = false;
  if (videoReturn?.isConnected) { videoReturn.prepend(player); videoReturn.focus({ preventScroll: true }); }
  else player.remove();
  videoReturn = undefined;
}
function closeVideo() { videoViewer.close(); restoreVideo(); }
function openVideo(player) {
  videoReturn = player.parentElement;
  videoReturn.style.height = `${videoReturn.offsetHeight}px`;
  player.controls = true;
  videoViewer.append(player); videoViewer.showModal(); videoViewer.focus();
  player.play().catch(() => {}); // Safari may require another tap after the download.
}
function videoPlayIcon() {
  const play = el('span', undefined, 'video-play-icon'); play.setAttribute('aria-hidden', 'true');
  play.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg>';
  return play;
}
function clearThreadVideos(keep = new Set()) {
  for (const [path, video] of threadVideos) if (!keep.has(path)) {
    videoObserver.unobserve(video.node);
    video.node.querySelector(':popover-open')?.hidePopover();
    if (video.player) {
      if (videoViewer.contains(video.player)) closeVideo();
      video.player.pause(); video.player.removeAttribute('src'); video.player.load();
    }
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
  player.playsInline = true; player.preload = 'none';
  player.setAttribute('aria-label', video.name);
  if (video.posterURL) player.poster = video.posterURL;
  player.src = video.url;
  const actions = el('div', undefined, 'video-actions'), more = el('button', undefined, 'video-more');
  actions.id = 'video-actions-' + crypto.randomUUID(); actions.popover = 'auto';
  actions.setAttribute('role', 'dialog'); actions.setAttribute('aria-label', `Video actions for ${video.name}`);
  more.type = 'button'; more.setAttribute('aria-label', `Video actions for ${video.name}`);
  more.setAttribute('popovertarget', actions.id); more.setAttribute('aria-haspopup', 'dialog');
  more.setAttribute('aria-controls', actions.id); more.setAttribute('aria-expanded', 'false');
  more.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  actions.addEventListener('toggle', event => {
    const open = event.newState === 'open'; more.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const anchor = more.getBoundingClientRect(), bounds = actions.getBoundingClientRect();
    actions.style.left = Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)) + 'px';
    actions.style.top = Math.max(8, Math.min(anchor.bottom + 4, innerHeight - bounds.height - 8)) + 'px';
  });
  const download = el('a', 'Download video'); download.href = video.url; download.download = video.name;
  actions.append(download);
  download.setAttribute('aria-label', `Download ${video.name}`);
  // iOS may open a blob download in its viewer; never replace the standalone chat.
  download.target = '_blank'; download.rel = 'noopener noreferrer';
  download.addEventListener('click', async event => {
    actions.hidePopover();
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
    if (videoViewer.contains(player)) closeVideo();
    video.node.replaceChildren(el('p', 'This browser cannot play this video.'), more, actions);
  });
  video.button.setAttribute('aria-label', `Play ${video.name}`);
  video.button.replaceChildren(player, videoPlayIcon());
  video.node.replaceChildren(video.button);
  if (video.role === 'assistant') video.node.append(more, actions);
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
      video.button.replaceChildren(image, videoPlayIcon());
    } else video.button.textContent = 'Play video';
  } catch (error) {
    video.info = undefined; video.button.textContent = 'Video unavailable. Retry'; video.button.title = error.message;
  } finally { video.loading = false; video.button.disabled = false; }
}
async function playThreadVideo(video) {
  if (video.loading) return;
  if (video.player) { openVideo(video.player); return; }
  if (!video.info) await loadVideoPreview(video);
  if (!video.info || threadVideos.get(video.path) !== video) return;
  const ws = socket, storage = videoCache, cacheId = JSON.stringify([video.sessionId, video.path]);
  const check = () => {
    if (socket !== ws || threadVideos.get(video.path) !== video) throw new Error('Video loading interrupted');
  };
  video.loading = true; video.button.disabled = true;
  video.button.style.height = `${video.button.offsetHeight}px`;
  video.button.setAttribute('aria-busy', 'true');
  const progress = el('span', undefined, 'video-play-icon'); progress.setAttribute('aria-hidden', 'true');
  progress.innerHTML = '<span class="video-loading-icon"><span class="connection-spinner"></span></span>';
  video.button.querySelector('.video-play-icon')?.remove();
  video.button.append(progress);
  try {
    let file = await storage?.get(cacheId, video.info);
    check();
    if (!file) {
      const chunks = [];
      for (let offset = 0; offset < video.info.size;) {
        check();
        video.button.setAttribute('aria-label', `Downloading ${video.name} ${Math.round(offset / video.info.size * 100)}%`);
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
    openVideo(video.player);
  } catch (error) {
    video.info = undefined;
    video.button.textContent = 'Could not load video. Retry'; video.button.title = error.message;
    video.button.removeAttribute('aria-label');
  } finally {
    video.loading = false; video.button.disabled = false;
    video.button.removeAttribute('aria-busy'); progress.remove();
  }
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
      video = { path, name: file?.name || path.split('/').at(-1), node, button, sessionId: selected, messageId: message.id, role: message.role };
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
const assistantCards = new Map();
// Question notifications: the host pushes encrypted payloads; this subscribes the device.
function pushSupported() { return pushKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
const keyText = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pushSubscription() { return (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription(); }
async function syncPush() {
  pushOn = false;
  if (pushSupported()) {
    try {
      const subscription = await pushSubscription(), serverKey = subscription?.options.applicationServerKey;
      // A different host key means the host's push identity was reset; the old subscription cannot work.
      if (subscription && serverKey && keyText(serverKey) !== pushKey) await subscription.unsubscribe();
      else if (subscription) { await request('pushSubscribe', { subscription: subscription.toJSON() }); pushOn = true; }
    } catch { /* Shown as off; enabling again repairs it. */ }
  }
  renderPushControl();
}
async function setPush(enable) {
  pushBusy = true; renderPushControl();
  try {
    if (enable) {
      // iOS grants permission only when asked directly from the tap.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { notice('Notifications were not allowed (' + permission + '). Check Settings → Notifications → Pi Remote.'); return; }
      const registration = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(atob(pushKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)) });
      await request('pushSubscribe', { subscription: subscription.toJSON() });
    } else {
      const subscription = await pushSubscription();
      if (subscription) { await request('pushUnsubscribe', { endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
    }
    pushOn = enable;
  } catch (error) { notice('Could not ' + (enable ? 'turn on' : 'turn off') + ' notifications: ' + error.message); }
  finally { pushBusy = false; renderPushControl(); }
}
function renderPushControl() {
  const button = $('assistant-push'), blocked = pushSupported() && Notification.permission === 'denied';
  button.hidden = selected !== assistantId || !pushSupported();
  button.textContent = blocked ? 'Notifications blocked in Settings' : pushOn ? 'Turn off question notifications' : 'Turn on question notifications';
  button.disabled = pushBusy || blocked;
}
$('assistant-push').addEventListener('click', () => void setPush(!pushOn));
navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type === 'openSession' && /^[a-f0-9]{64}$/.test(event.data.sessionId || '')) void selectSession(event.data.sessionId);
});
// Thread rows show host facts in one line: a question's title, or the first paragraph of a reply.
const plainLine = text => (text || '').replace(/```[\s\S]*?```/g, ' ').split(/\n\s*\n/).find(part => part.trim())
  ?.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim() || '';
const eventLine = event => event.kind === 'question' ? event.snapshot?.question?.title || 'Asked a question' : plainLine(event.snapshot?.preview) || 'Finished a turn';
const clockTime = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function threadRow(id, thread, question, drafts, cards, expanded) {
  const summary = sessions.find(item => item.id === id), latest = thread?.updates.at(-1), active = drafts[0];
  const title = question?.title || active?.title || summary?.title || latest?.snapshot?.title || latest?.title || 'Session';
  const working = !!summary && sessionActivity(summary) === 'working';
  const label = question ? 'Needs you' : active ? { drafted: 'Draft ready', delivering: 'Sending', uncertain: 'Check delivery', delivered: 'Sent' }[active.state]
    : working ? 'Working' : latest?.kind === 'question' ? 'Answered' : 'Done';
  const row = el('div', undefined, 'thread-row'); row.dataset.sessionId = id;
  row.dataset.state = question || ['drafted', 'uncertain'].includes(active?.state) ? 'needs' : working ? 'working' : 'done';
  const kind = sessionKind({ id });
  const icon = kind ? dressKind(el('span', undefined, 'thread-icon'), kind, 28, question ? 'waiting' : working ? 'working' : 'idle', !question && !working && !!summary && isUnread(summary)) : el('span');
  const body = el('div', undefined, 'thread-body'), head = el('button', undefined, 'thread-head'); head.type = 'button';
  head.append(el('span', title, 'thread-title'), el('span', label, 'thread-state'));
  head.addEventListener('click', () => selectSession(id, false, true));
  body.append(head);
  // A live question's card already states the latest event.
  if (latest && !(question && latest.kind === 'question')) body.append(el('p', eventLine(latest), 'thread-line'));
  body.append(...cards);
  const earlier = thread?.updates.slice(0, -1).reverse() || [];
  if (earlier.length) {
    const more = el('details', undefined, 'thread-earlier'), list = el('div');
    more.dataset.disclosureId = 'thread:' + id; more.open = expanded.get(more.dataset.disclosureId) ?? false;
    more.append(el('summary', `${earlier.length} earlier ${earlier.length === 1 ? 'update' : 'updates'}`), list);
    for (const event of earlier) list.append(el('p', `${clockTime(event.at)} · ${eventLine(event)}`));
    body.append(more);
  }
  row.append(icon, body);
  return row;
}
function renderCheckin(state, threads = new Map(), groups = [], expanded = new Map()) {
  const section = el('section', undefined, 'assistant-checkin');
  section.setAttribute('aria-label', 'Miso check-in');
  if (!state.messages?.length) {
    section.append(el('h2', "Hi, I'm Miso."), el('p', 'I keep an eye on your sessions. Ask me what needs you, or answer a question below.'));
  }
  const { questions } = state.assistant;
  const keep = new Set(), cards = new Map(), cardsFor = id => cards.get(id) || cards.set(id, []).get(id);
  for (const question of questions) {
    const { sessionId, dialog } = question, key = sessionId + ':' + dialog.id;
    keep.add(key);
    let card = assistantCards.get(key);
    if (!card) {
      card = el('form', undefined, 'assistant-question');
      card.dataset.questionId = dialog.id;
      card.setAttribute('aria-label', 'Question from ' + (question.title || question.project));
      const source = el('button', question.title || question.project || 'Open session', 'quiet assistant-question-source'); source.type = 'button';
      source.addEventListener('click', () => selectSession(sessionId, false, true));
      const heading = el('h3', dialog.title || 'Your input is needed'); heading.tabIndex = -1;
      card.append(source, heading);
      if (dialog.message) card.append(el('p', dialog.message, 'assistant-question-message'));
      const controls = el('div', undefined, 'assistant-question-actions');
      const feedback = el('p', '', 'hint'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
      let busy = false;
      const answer = async response => {
        if (busy) return;
        busy = true; heading.focus({ preventScroll: true });
        for (const control of card.elements) control.disabled = true;
        feedback.hidden = false; feedback.textContent = 'Sending your answer…';
        try {
          await request('answer', { sessionId, answer: { dialogId: dialog.id, ...response } });
          feedback.textContent = 'Answer sent.';
          // Keep the receipt until the host removes the question; never infer a target reply.
        } catch (error) {
          busy = false;
          for (const control of card.elements) control.disabled = false;
          feedback.textContent = error.message;
        }
      };
      const option = (label, response) => {
        const button = el('button', label, 'secondary'); button.type = 'button';
        button.addEventListener('click', () => answer(response)); controls.append(button);
      };
      let input;
      if (dialog.method === 'select') {
        for (const value of dialog.options || []) option(value, { value });
      } else if (dialog.method === 'confirm') {
        option('Allow', { confirmed: true }); option('Deny', { confirmed: false });
      } else if (['input', 'editor'].includes(dialog.method)) {
        input = el(dialog.method === 'editor' ? 'textarea' : 'input');
        input.setAttribute('aria-label', dialog.title || 'Your answer'); input.value = dialog.prefill || '';
        card.append(input);
        const submit = el('button', 'Send answer'); submit.type = 'submit'; controls.append(submit);
      }
      if (dialog.method !== 'confirm') option('Cancel', { cancelled: true });
      card.addEventListener('submit', event => { event.preventDefault(); if (input) void answer({ value: input.value }); });
      card.append(controls, feedback); assistantCards.set(key, card);
    }
    cardsFor(sessionId).push(card);
  }
  for (const draft of state.assistant.drafts || []) {
    const key = 'draft:' + draft.id + ':' + draft.revision + ':' + draft.state + ':' + JSON.stringify(draft.feedback);
    keep.add(key);
    let card = assistantCards.get(key);
    if (!card) {
      card = el('form', undefined, 'assistant-question assistant-draft'); card.dataset.draftId = draft.id;
      card.setAttribute('aria-label', 'Draft to ' + (draft.title || draft.project));
      const source = el('button', draft.title || draft.project || 'Open session', 'quiet assistant-question-source'); source.type = 'button';
      source.addEventListener('click', () => selectSession(draft.sessionId, false, true));
      const heading = el('h3', ({ drafted: 'Review before sending', delivering: 'Sending…', delivered: 'Sent to session', uncertain: 'Delivery uncertain', cancelled: 'Draft cancelled' })[draft.state]);
      heading.tabIndex = -1; card.append(source, heading);
      const feedback = el('p', '', 'hint'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
      if (draft.state === 'drafted') {
        const input = el('textarea'); input.value = draft.text; input.dataset.savedText = draft.text; input.maxLength = 4000;
        input.setAttribute('aria-label', 'Draft message');
        const controls = el('div', undefined, 'assistant-question-actions');
        const send = el('button', 'Send'), save = el('button', 'Save changes', 'secondary'), cancel = el('button', 'Discard', 'secondary');
        for (const button of [send, save, cancel]) button.type = 'button';
        save.hidden = true;
        let busy = false;
        const refresh = () => { const dirty = input.value !== draft.text; send.disabled = busy || dirty; save.hidden = !dirty; };
        input.addEventListener('input', refresh);
        const action = async name => {
          if (busy) return;
          busy = true; heading.focus({ preventScroll: true });
          for (const control of card.elements) control.disabled = true;
          feedback.hidden = false; feedback.textContent = name === 'send' ? 'Sending this revision…' : 'Saving…';
          try {
            await request('assistantDraft', { sessionId: state.id, action: { action: name, draftId: draft.id, revision: draft.revision, ...(name === 'edit' ? { text: input.value } : {}) } });
            feedback.textContent = 'Saved. Waiting for the host update…';
          } catch (error) {
            busy = false;
            for (const control of card.elements) control.disabled = false;
            refresh(); feedback.textContent = error.message;
          }
        };
        send.addEventListener('click', () => action('send'));
        save.addEventListener('click', () => action('edit'));
        cancel.addEventListener('click', () => action('cancel'));
        controls.append(send, save, cancel);
        card.append(input, el('p', 'Only Send approves this revision. Busy or offline sessions are left alone.', 'hint'), controls);
      } else {
        const details = el('details'); details.append(el('summary', 'Message'), el('p', draft.text, 'assistant-question-message')); card.append(details);
        if (draft.state === 'uncertain') card.append(el('p', 'It may have arrived. Open the session before creating another draft. This draft will not be sent again.', 'hint'));
        else if (draft.state === 'delivered' && !draft.feedback) card.append(el('p', 'Waiting for the session’s reply. Sent does not mean the work is complete.', 'hint'));
        if (draft.feedback?.text) card.append(el('h4', 'Session reply'), el('p', draft.feedback.text, 'assistant-question-message'));
        else if (draft.feedback?.note) card.append(el('p', draft.feedback.note, 'hint'));
      }
      const previous = [...assistantCards.values()].find(node => node.dataset.draftId === draft.id)?.querySelector('textarea');
      if (previous && previous.value !== previous.dataset.savedText && previous.value !== draft.text) {
        const recovered = el('details'); recovered.open = true;
        recovered.append(el('summary', 'Draft changed elsewhere. Your unsaved edit'), el('p', previous.value, 'assistant-question-message'), copyButton(previous.value, 'Copy unsaved edit', 'quiet'));
        card.append(recovered);
      }
      card.addEventListener('submit', event => event.preventDefault());
      card.append(feedback); assistantCards.set(key, card);
    }
    cardsFor(draft.sessionId).push(card);
  }
  for (const key of assistantCards.keys()) if (!keep.has(key)) assistantCards.delete(key);
  // One row per session: at its latest check-in, or at the bottom while it still involves you.
  for (const id of new Set([...threads.keys(), ...cards.keys()])) {
    const thread = threads.get(id), row = threadRow(id, thread, questions.find(question => question.sessionId === id),
      (state.assistant.drafts || []).filter(draft => draft.sessionId === id), cards.get(id) || [], expanded);
    if (cards.has(id) || !thread) section.append(row);
    else { thread.group.rows.append(row); thread.group.count++; }
  }
  // The latest check-in keeps Miso's lead; older ones shrink to a time and one line you can open.
  for (const [index, group] of groups.entries()) {
    const latest = index === groups.length - 1;
    if (!group.count && !latest) { group.node.remove(); continue; }
    if (latest && group.lead) group.node.append(group.lead);
    else {
      const note = el('details', undefined, 'thread-time'), summary = el('summary');
      note.dataset.disclosureId = 'time:' + group.at; note.open = expanded.get(note.dataset.disclosureId) ?? false;
      summary.append(el('time', clockTime(group.at)), ...(group.lead ? [el('span', plainLine(group.lead.textContent), 'thread-time-lead')] : []));
      note.append(summary);
      if (group.lead) note.append(group.lead); else note.dataset.empty = '';
      group.node.append(note);
    }
    group.node.append(group.rows);
  }
  return section;
}
function renderConversation(state, { anchor, historyChanged = false } = {}) {
  // Removing the touched message mid-drag loses touchend and strands the translated page.
  if (trackingSwipe) { pendingSwipeRender = () => renderConversation(state, { anchor, historyChanged }); return; }
  pendingSwipeRender = undefined;
  activityDebug.renders++; activityDebug.renderAt = performance.now();
  $('title').textContent = sessionTitle(sessions.find(item => item.id === selected)?.title || state.title, state.messages);
  renderProject(state.cwd, sessions.find(item => item.id === selected) || selectedSummary || (state.id === assistantId ? state : undefined));
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
  const questionFocus = document.activeElement?.closest('.assistant-checkin') ? document.activeElement : undefined;
  // A diagram arriving mid-reply can change the default, but not the reader's explicit choice.
  const expanded = new Map([...box.querySelectorAll('details[data-disclosure-id]')]
    .filter(node => !node.classList.contains('markdown-details') || node.dataset.disclosureChosen)
    .map(node => [node.dataset.disclosureId, node.open]));
  const focusedTool = box.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.disclosureId : undefined;
  const messages = [...(state.messages || [])], localImages = new Map(), localVideos = new Map(), keepVideos = new Set();
  if (state.coordination?.role === 'coordinator' && state.coordination.readOnly && !messages.length) {
    const intro = el('section', undefined, 'coordinator-intro');
    intro.append(el('h2', 'Read-only coordinator'), el('p', 'Ask for an investigation of this project. Up to two independent Pi sessions can work while you keep talking here. Give all replies and instructions in this conversation. Open Workers to inspect their read-only logs.'));
    fragment.append(intro);
  }
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
  clearThreadImages(new Set(messages.flatMap(message => (message.images || []).map((_, index) => message.id + ':' + index))), selected);
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
    const toolName = name || live?.name || 'Tool', codemode = toolName === 'codemode';
    if (activity && activity.codemode !== codemode) activity = undefined;
    if (!activity) {
      const node = el('details', undefined, 'tool-activity'), summary = el('summary');
      node.dataset.disclosureId = 'activity:' + id; node.dataset.scrollKey = node.dataset.disclosureId;
      node.open = expanded.get(node.dataset.disclosureId) ?? codemode;
      if (codemode) node.classList.add('codemode-activity');
      node.append(summary); fragment.append(node);
      activity = { node, summary, tools: [], codemode }; activityGroups.push(activity);
    }
    const entry = { name: toolName, status, durationMs: timed ? durationMs : undefined, timestamp: result?.timestamp }; activity.tools.push(entry);
    let args;
    try { args = JSON.parse(input); } catch { /* Streaming or shortened input may not be valid JSON yet. */ }
    entry.sessionAction = args?.action;
    // Terminal colour and cursor codes (Playwright's line rewrites, for one) render as boxes in the browser.
    const output = displayPaths((result?.text || live?.text || '').replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g, ''));
    entry.preview = output.split(/\r\n|[\r\n]/).filter(line => line.trim()).slice(-2).map(line => line.slice(0, 240)).join('\n');
    if (state.assistant && toolName === 'sessions' && status === 'done') {
      try {
        const value = JSON.parse(result?.text || live?.text || '');
        entry.sessionAction ||= value.revision ? 'draft' : undefined;
        entry.sessionIds = Array.isArray(value.sessions) ? value.sessions.map(item => item.id) : value.id && !value.revision ? [value.id] : [];
      } catch { /* Shortened output cannot supply an accurate count. */ }
    }
    if (codemode) {
      const code = typeof args?.code === 'string' ? args.code : typeof args === 'string' ? args : undefined;
      const first = code?.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('// @options:'));
      const named = first?.startsWith('// ') ? first.slice(3).trim() : '';
      // shortcut: literal tool references only; use a title comment for dynamic or templated scripts.
      const source = (code || '').replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\/(?:\\.|[^/\\\r\n])+\/[dgimsuvy]*/g, ' ');
      const labels = new Map([
        ['read', 'Read files'], ['ffgrep', 'Search code'], ['fffind', 'Find files'],
        ['edit', 'Edit files'], ['write', 'Write files'], ['bash', 'Run commands'],
        ['radius_web_search', 'Search web'], ['remote_tasks', 'Manage workers']
      ]);
      const actions = [...new Set([...source.matchAll(/\btools\s*\.\s*(\w+)\s*\(/g)].map(match => labels.get(match[1])).filter(Boolean))];
      const title = (named || actions.join(' · ') || `Run ${activity.tools.length}`).slice(0, 120);
      const statusText = ({ done: 'Complete', working: 'Running', pending: 'Pending', error: 'Failed' })[status] || status;
      entry.line = title;
      detail.classList.add('codemode-tool');
      const summary = el('summary'), marker = el('span', undefined, 'codemode-marker');
      marker.setAttribute('aria-hidden', 'true');
      const path = status === 'done' ? '<path d="m5 12 4 4L19 6"/>' : status === 'error'
        ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>'
        : status === 'pending' ? '<circle cx="12" cy="12" r="9"/>'
        : '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
      marker.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
      const heading = el('span', undefined, 'tool-heading');
      heading.append(el('span', title, 'codemode-title'), el('span', ' · ' + statusText, 'codemode-state sr-only'));
      summary.append(marker, heading);
      if (timed) {
        const time = el('span', formatToolDuration(durationMs), 'tool-status');
        time.setAttribute('aria-label', 'Execution time: ' + time.textContent); summary.append(time);
      }
      detail.append(summary, el('p', 'Output', 'codemode-output-heading'));
      if (output || !result?.images?.length) detail.append(el('pre', output || (status === 'working' ? 'Running…' : status === 'pending' ? 'Waiting to run…' : 'No output.'), 'tool-output'));
      if (input) {
        const script = el('details', undefined, 'codemode-script');
        script.dataset.disclosureId = 'script:' + id;
        script.open = expanded.get(script.dataset.disclosureId) ?? false;
        script.append(el('summary', code === undefined ? 'Input' : 'Script'), el('pre', displayPaths(code ?? input), 'tool-input'));
        detail.append(script);
      }
      if (result?.truncated) detail.append(el('p', 'Output shortened for mobile.', 'hint'));
      activity.node.append(detail); return;
    }
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
  // Miso threads: each check-in's events are collected per session; rows are placed after the loop.
  const threads = new Map(), groups = [];
  let group;
  for (const [index, message] of messages.entries()) {
    if (index === usagePosition) { activity = undefined; fragment.append(renderUsage(usage)); }
    if (message.role === 'toolResult') {
      appendTool(message.toolCallId || message.id, message.toolName, '', message);
      appendThreadImages(fragment, message);
      continue;
    }
    // Internal notices and extension prompts belong in quiet activity rows, not chat bubbles.
    if (state.assistant && message.role === 'user' && userMessageText(message).startsWith('[Pi Remote session events]\n')) {
      activity = undefined;
      group = { node: el('div', undefined, 'thread-group'), rows: el('div'), count: 0, at: message.timestamp };
      groups.push(group); fragment.append(group.node);
      try {
        for (const event of JSON.parse(userMessageText(message).split('\n')[1])) {
          const thread = threads.get(event.sessionId) || { updates: [] };
          thread.updates.push(event); thread.group = group; threads.set(event.sessionId, thread);
        }
      } catch { /* A shortened payload keeps only Miso's lead. */ }
      continue;
    }
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
      if (message.role === 'user') group = undefined;
      if (skill) fragment.append(el('p', 'Loaded skill: ' + skill.name, 'skill-loaded'));
      const workerInstruction = state.coordination?.role === 'worker' && message.role === 'user';
      const article = el('article', undefined, 'message ' + (message.role === 'user' && !workerInstruction ? 'user' : 'assistant'));
      if (workerInstruction) article.append(el('p', 'Instruction to worker', 'coordinator-instruction-label'));
      article.dataset.messageId = message.id; article.dataset.scrollKey = message.liveId || message.id;
      article.setAttribute('aria-label', workerInstruction ? 'Instruction to worker' : message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Pi' : message.role);
      const body = el('div', undefined, 'message-text');
      if (message.role === 'user') {
        const { text, paths } = splitVideoMessage(userMessageText(message));
        body.textContent = skill ? skill.text : text || (message.images?.length || paths.length || localVideos.get(message.id)?.length ? '' : '(empty message)');
      }
      else {
        // Only disclosure markup is allowed; images, arbitrary HTML and unsafe link schemes stay disabled.
        body.innerHTML = markdown.render(splitVideoMessage(message.text || '', message.role).text);
        for (const [index, detail] of [...body.querySelectorAll('.markdown-details')].entries()) {
          detail.dataset.disclosureId = 'message:' + (message.liveId || message.id) + ':' + index;
          detail.open = expanded.get(detail.dataset.disclosureId) ?? (detail.open || !!detail.querySelector('code.language-mermaid'));
          if (expanded.has(detail.dataset.disclosureId)) detail.dataset.disclosureChosen = 'true';
          detail.querySelector(':scope > summary')?.addEventListener('click', event => {
            if (!event.target.closest('a')) detail.dataset.disclosureChosen = 'true';
          });
        }
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
      if (message.role === 'assistant' && message.text && !state.assistant) article.append(copyButton(message.text, 'Copy message', 'copy-message'));
      if (failed) {
        const error = el('p', 'Reply failed. Try again.', 'message-error');
        error.setAttribute('role', 'alert'); article.append(error);
      }
      if (message.role === 'assistant' && !state.assistant && message.stopReason !== 'error' && Number.isFinite(message.taskDurationMs) && message.taskDurationMs >= 0) {
        const phrases = ['Tinkered for', 'Chipped away for', 'Puzzled over it for', 'Plugged away for', 'Kept at it for'];
        let hash = 0;
        // Timestamps keep the wording stable even when saved history uses different message IDs.
        for (const char of `${message.timestamp ?? message.id}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        article.append(el('p', phrases[hash % phrases.length] + ' ' + formatToolDuration(message.taskDurationMs), 'task-duration'));
      }
      if (message.delivery) {
        const status = el('small', message.delivery, 'delivery-status'); status.setAttribute('role', 'status'); article.append(status);
      }
      // Miso's reply to a check-in becomes that check-in's lead line.
      if (article.childNodes.length && group && message.role === 'assistant') group.lead = article;
      else if (article.childNodes.length) fragment.append(article);
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
    const labels = [...counts].flatMap(([name, count]) => {
      const failed = group.tools.filter(tool => tool.name === name && tool.status === 'error').length, nonFailed = count - failed;
      const [past, present, noun, plural] = Object.hasOwn(actions, name) ? actions[name] : ['Used ' + name, 'Using ' + name, 'time'];
      const active = group.tools.some(tool => tool.name === name && ['working', 'pending'].includes(tool.status));
      const phrases = [];
      if (nonFailed) phrases.push(`${active ? present : past} ${nonFailed} ${nonFailed === 1 ? noun : plural || noun + 's'}`);
      if (failed) phrases.push(`${name} failed ${failed} ${failed === 1 ? 'time' : 'times'}`);
      return phrases;
    }).map((label, index) => (index ? label[0].toLowerCase() : label[0].toUpperCase()) + label.slice(1));
    const sessionChecks = state.assistant && group.tools.every(tool => tool.name === 'sessions');
    // Miso's own lookups are plumbing; the working indicator and cards already show the outcome.
    if (sessionChecks && !group.tools.some(tool => tool.status === 'error')) { group.node.remove(); continue; }
    if (sessionChecks) {
      const ids = new Set(group.tools.flatMap(tool => tool.sessionIds || []));
      labels.splice(0, labels.length, group.tools.some(tool => tool.status === 'error') ? 'Session check failed'
        : group.tools.some(tool => ['working', 'pending'].includes(tool.status)) ? 'Checking sessions…'
        : group.tools.some(tool => tool.sessionAction === 'draft') ? 'Prepared drafts for review'
        : group.tools.every(tool => tool.sessionIds) ? `Checked ${ids.size} ${ids.size === 1 ? 'session' : 'sessions'}` : 'Checked sessions');
    }
    const label = el('span', labels.join(', '), 'tool-activity-label'); label.title = label.textContent;
    const running = group.tools.findLast(tool => tool.status === 'working' && tool.preview) || group.tools.findLast(tool => tool.status === 'working');
    const recent = !sessionChecks && (running || (!historyWindow && state.status === 'working' && group === activityGroups.at(-1)
      ? group.tools.findLast(tool => ['done', 'error'].includes(tool.status)) : undefined));
    if (group.codemode) {
      label.textContent = [['done', 'complete'], ['working', 'running'], ['pending', 'pending'], ['error', 'failed']]
        .map(([status, text]) => { const count = group.tools.filter(tool => tool.status === status).length; return count ? `${count} ${text}` : ''; }).filter(Boolean).join(' · ');
      label.title = label.textContent;
      group.node.dataset.status = group.tools.some(tool => tool.status === 'error') ? 'error' : running ? 'working' : group.tools.some(tool => tool.status === 'pending') ? 'pending' : 'done';
      const mark = el('span', undefined, 'codemode-mark'); mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6-6 6 6 6m8-12 6 6-6 6M13.5 3l-3 18"/></svg>';
      group.summary.append(mark);
    }
    if (recent || group.codemode) {
      const text = el('span', undefined, 'tool-activity-text');
      if (group.codemode) text.append(el('span', 'Codemode', 'codemode-title'));
      text.append(label);
      if (recent) {
        const context = (running ? '' : 'Last: ') + recent.line, line = el('span', context, 'tool-activity-line');
        line.title = context; text.append(line);
        if (!group.codemode && recent.preview && (running || recent.name !== 'read' || recent.status === 'error')) text.append(el('span', recent.preview, 'tool-activity-progress'));
      }
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
      time.title = `Elapsed time: ${elapsed} ms`;
      if (group.codemode) { time.textContent += ' elapsed'; group.summary.querySelector('.tool-activity-text').append(time); }
      else group.summary.append(time);
    }
    for (const [status, text] of [['pending', 'pending']]) {
      const count = group.tools.filter(tool => tool.status === status).length;
      if (count && !group.codemode) group.summary.append(el('span', `${count} ${text}`, 'tool-activity-' + status));
    }
  }
  if (state.assistant) {
    const section = renderCheckin(state, threads, groups, expanded);
    if (!historyWindow) fragment.append(section);
  }
  updateActivity();
  // Keep the indicator connected so streaming updates do not restart its CSS animation.
  if (activityIndicator.parentNode !== box) box.append(activityIndicator);
  for (const child of [...box.childNodes]) if (child !== activityIndicator) child.remove();
  box.insertBefore(fragment, activityIndicator);
  renderDiagrams(box, openImage, () => {
    if (pinnedToBottom) box.scrollTop = box.scrollHeight;
    updateScrollButton();
  }, selected);
  clearThreadVideos(keepVideos);
  for (const video of playing) if (threadVideos.get(video.path) === video) video.player.play().catch(() => {});
  for (const { outgoing, messageId } of matched) {
    submissions.delete(outgoing.key);
    for (const queued of submissions.values()) if (queued.sessionId === selected) queued.knownIds.add(messageId);
    if (sending.get(selected) !== outgoing) releaseImages(outgoing.attachments);
  }
  if (questionFocus) {
    if (questionFocus.isConnected) questionFocus.focus({ preventScroll: true });
    else box.focus({ preventScroll: true });
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
let activityLabelAt = 0;
function updateActivity() {
  const state = cache.get(selected), activity = activityIndicator, now = Date.now();
  const label = activity.querySelector('#activity-label'), time = activity.querySelector('#activity-time');
  const active = connected && !historyWindow && state?.status === 'working', compacting = state?.compacting === true;
  const retrying = state ? replyAttempts(state).retrying : false;
  if (active && (activity.hidden || activity.dataset.sessionId !== selected || activity.dataset.compacting !== String(compacting) || activity.dataset.retrying !== String(retrying) || now >= activityLabelAt)) {
    const labels = ['Thinking…', 'Pondering…', 'Working…', 'Mulling it over…', 'Reasoning it out…',
      'Connecting the dots…', 'Turning it over…', 'Thinking it through…', 'Weighing options…', 'Sorting through it…',
      'Looking closer…', 'Considering it…', 'Finding an angle…', 'Making sense of it…', 'Reflecting…',
      'Contemplating…', 'Deliberating…', 'Musing…', 'Ruminating…', 'Turning the gears…', 'Untangling it…',
      'Exploring the idea…', 'Considering angles…', 'Making connections…', 'Working through it…', 'Thinking it over…',
      'Taking it in…', 'Letting it simmer…', 'Noodling on it…', 'Piecing it together…']
      .filter(text => text !== label.textContent);
    label.textContent = compacting ? 'Compacting conversation…' : retrying ? 'Retrying reply…' : labels[Math.floor(Math.random() * labels.length)];
    activityLabelAt = now + 8000;
    activity.dataset.sessionId = selected; activity.dataset.compacting = String(compacting); activity.dataset.retrying = String(retrying);
  }
  // Screen readers keep a stable announcement while the visible phrase rotates.
  const announcement = compacting ? 'Compacting conversation…' : retrying ? 'Retrying reply…' : 'Working…';
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
function flushActivityDebug() {
  if (!connected || !supportsActivityDebug || activityDebug.sending || !activityDebug.queue.length) return;
  const records = activityDebug.queue.splice(0, 20), login = token;
  activityDebug.sending = true;
  request('activityDebug', { records }).catch(() => {
    if (token === login) activityDebug.queue = [...records, ...activityDebug.queue].slice(-30);
  }).finally(() => { activityDebug.sending = false; });
}
function debugActivity(reason = 'sample') {
  flushActivityDebug();
  const state = cache.get(selected), viewing = $('app').classList.contains('viewing');
  const working = viewing && state?.status === 'working';
  if (!working && !activityDebug.last?.working) return;
  const now = performance.now(), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const key = [selected, state?.status, connected, viewing, document.visibilityState, reducedMotion].join(':');
  if (reason === 'sample' && key === activityDebug.last?.key && now - activityDebug.last.at < 5000) return;
  try {
    const svg = activityIndicator.querySelector('svg'), style = getComputedStyle(svg), rect = svg.getBoundingClientRect();
    const animations = svg.getAnimations?.() || [], animation = animations[0];
    const ms = value => Number.isFinite(value) ? Math.round(value) : null;
    activityDebug.queue.push({ page: activityDebug.page, session: /^[a-f0-9]{64}$/.test(selected || '') ? selected : null, reason, at: Date.now(), elapsedMs: ms(now),
      sampleGapMs: activityDebug.last ? ms(now - activityDebug.last.at) : null,
      status: state?.status || 'none', connected, visible: !document.hidden, viewing, reducedMotion, standalone,
      revision: versions.get(selected) ?? null, renders: activityDebug.renders, updateAgeMs: activityDebug.renderAt ? ms(now - activityDebug.renderAt) : null,
      rendered: svg.isConnected && rect.width > 0 && rect.height > 0,
      inViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
      width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
      animationCount: animations.length, animationName: ['connection-spin', 'none'].includes(style.animationName) ? style.animationName : 'other',
      currentTime: ms(animation?.currentTime), startTime: ms(animation?.startTime), playState: animation?.playState || 'none', animationPending: animation?.pending === true,
      cssPlayState: style.animationPlayState || 'none', durationMs: ms(parseFloat(style.animationDuration) * 1000), transform: style.transform || 'none',
      framePending: activityDebug.framePending, frameDelayMs: activityDebug.frameDelay,
      frameAgeMs: activityDebug.frameAt ? ms(now - activityDebug.frameAt) : null, userAgent: navigator.userAgent.slice(0, 256) });
    activityDebug.queue = activityDebug.queue.slice(-30);
    activityDebug.last = { key, working, at: now };
    // One frame probe per sample, not a continuous animation loop that could hide the bug.
    if (!document.hidden && !activityDebug.framePending) {
      activityDebug.framePending = true;
      requestAnimationFrame(() => {
        activityDebug.frameAt = performance.now(); activityDebug.frameDelay = ms(activityDebug.frameAt - now); activityDebug.framePending = false;
      });
    }
    flushActivityDebug();
  } catch { /* Diagnostics must never interrupt the conversation. */ }
}
window.addEventListener('pagehide', () => debugActivity('pagehide'));
// iOS 18 Safari sometimes re-shows the dots without creating their CSS spin, mostly when switching from an idle session.
// Re-applying the animation makes WebKit create it again. Runs after diagnostics so samples still record the stall.
function restartStalledDots() {
  const dots = activityIndicator.querySelector('.activity-dots');
  if (dots.getAnimations().length || !dots.getClientRects().length || reducedMotion()) return;
  dots.style.animation = 'none'; getComputedStyle(dots).animationName; dots.style.animation = '';
}
setInterval(() => { if (!document.hidden) { updateActivity(); debugActivity(); restartStalledDots(); } }, 1000);
const coordinatorLabels = { queued: 'Queued', recovering: 'Recovering', starting: 'Starting', working: 'Working', waiting: 'Needs answer', reported: 'Result ready', completed: 'Accepted',
  stopping: 'Stopping', stopped: 'Stopped', unknown: 'Needs inspection' };
const coordinatorLabel = task => task.workspace?.integration === 'applied' ? 'Integrated' : coordinatorLabels[task.state] || task.state;
function renderCoordinator(state) {
  const role = state?.coordination, available = supportsCoordinator && !!state && !state.creation;
  const worker = role?.role === 'worker', tasks = role?.role === 'coordinator' ? role.tasks : [];
  $('coordinator-tasks').hidden = !available || !tasks.length;
  $('coordinator-parent').hidden = !available || !worker;
  $('coordinator-tasks').disabled = !connected; $('coordinator-parent').disabled = !connected;
  $('coordinator-context').hidden = !available || !tasks.length;
  $('coordinator-inspection').hidden = !available || !worker;
  $('coordinator-inspection-note').textContent = worker ? 'Read-only worker log. Give instructions to ' + role.coordinatorTitle + ' in the main conversation.' : '';
  $('coordinator-return').textContent = worker ? 'Return to ' + role.coordinatorTitle : '';
  $('coordinator-return').disabled = worker && !connected && !cache.has(role.coordinatorId);
  $('coordinator-worker-count').textContent = tasks.length;
  const summary = [], working = tasks.filter(workerRunning).length;
  if (working) summary.push(working + ' working');
  for (const [states, label] of [[['queued'], 'queued'], [['recovering'], 'recovering'], [['waiting'], 'needs answer'], [['reported'], 'ready'], [['unknown'], 'need inspection']]) {
    const count = tasks.filter(task => states.includes(task.state)).length;
    if (count) summary.push(count + ' ' + label);
  }
  $('coordinator-worker-summary').textContent = summary.join(' · ') || 'No active work';
  if (!$('coordinator-sheet').open) return;
  const key = JSON.stringify([selected, tasks, connected]);
  if (key === coordinatorRenderKey) return;
  coordinatorRenderKey = key;
  $('coordinator-log-back').hidden = !coordinatorLog;
  $('coordinator-task-list').hidden = !!coordinatorLog; $('coordinator-log').hidden = !coordinatorLog;
  if (coordinatorLog) {
    const task = tasks.find(task => task.sessionId === coordinatorLog.id);
    if (!task) { $('coordinator-sheet').close(); return; }
    $('coordinator-title').textContent = task.title;
    $('coordinator-subtitle').textContent = coordinatorLabel(task);
    renderCoordinatorLog(); return;
  }
  $('coordinator-title').textContent = 'Workers';
  $('coordinator-subtitle').textContent = summary.join(' · ') || 'No active work';
  const list = $('coordinator-task-list'), focused = list.querySelector('button:focus')?.dataset.workerId;
  list.replaceChildren();
  const active = new Set(['starting', 'working', 'waiting', 'stopping', 'queued', 'recovering']);
  for (const task of [...tasks].sort((a, b) => Number(active.has(b.state)) - Number(active.has(a.state)))) {
    const row = el('div'); row.setAttribute('role', 'listitem'); row.setAttribute('aria-label', task.title); row.dataset.state = task.state;
    const button = el('button', undefined, 'coordinator-worker'); button.type = 'button'; button.dataset.workerId = task.id;
    button.dataset.state = task.state; button.setAttribute('aria-label', task.title + ', ' + coordinatorLabel(task));
    const name = el('span'); name.append(el('strong', task.title), el('small', coordinatorLabel(task)));
    const arrow = $('coordinator-open').querySelector('svg').cloneNode(true); button.append(name, arrow);
    button.addEventListener('click', event => openCoordinatorWorker(task.sessionId, event.detail === 0)); row.append(button); list.append(row);
    if (focused === task.id) button.focus({ preventScroll: true });
  }
  if (!tasks.length) list.append(el('p', 'No workers yet.', 'hint'));
}
function stopCoordinatorWorker() {
  if (!coordinatorLog) return;
  coordinatorPositions.set(coordinatorLog.id, $('coordinator-scroll').scrollTop);
  clearThreadImages(new Set(), coordinatorLog.id);
  coordinatorLog = undefined;
  if (connected && supportsWorkerInspection) request('inspectWorker', { sessionId: null }).catch(() => {});
}
function watchCoordinatorWorker(log) {
  log.error = undefined;
  if (!connected) { log.error = 'Computer disconnected. Reconnect to load this log.'; renderCoordinatorLog(); return; }
  if (!supportsWorkerInspection) { log.error = 'Live worker logs need the pending host update. Task details are available below.'; renderCoordinatorLog(); return; }
  request('inspectWorker', { sessionId: log.id }).catch(error => {
    if (coordinatorLog !== log) return;
    log.error = error.message; renderCoordinatorLog();
  });
}
function openCoordinatorWorker(id, keyboard) {
  stopCoordinatorWorker();
  coordinatorPositions.set('roster:' + selected, $('coordinator-scroll').scrollTop);
  $('coordinator-log').replaceChildren();
  coordinatorLog = { id, state: cache.get(id), scrollTop: coordinatorPositions.get(id) || 0 };
  coordinatorRenderKey = undefined; renderCoordinator(cache.get(selected));
  $(keyboard ? 'coordinator-log-back' : 'coordinator-sheet').focus({ preventScroll: true });
  watchCoordinatorWorker(coordinatorLog);
}
function receiveCoordinatorWorker(packet) {
  const log = coordinatorLog;
  if (!log || packet.sessionId !== log.id || !$('coordinator-sheet').open) return;
  if (packet.type === 'workerNotice') log.error = packet.error;
  else {
    try {
      if (packet.type === 'workerPatch' && (!log.state || log.version + 1 !== packet.version)) throw new Error('Resync');
      log.state = packet.type === 'workerSnapshot' ? packet.state : patchState(log.state, packet.patch);
      log.version = packet.version; log.error = undefined; cache.set(log.id, log.state);
    } catch { watchCoordinatorWorker(log); return; }
  }
  renderCoordinatorLog();
}
async function loadCoordinatorHistory(direction) {
  const log = coordinatorLog;
  if (!log?.state || log.loading || !connected) return;
  const messages = log.history?.messages || log.state.messages;
  const cursor = direction === 'before' ? messages[0] : messages.at(-1);
  if (!cursor) return;
  log.loading = true; log.error = undefined; renderCoordinatorLog();
  try {
    const page = await request('history', { sessionId: log.id, [direction]: cursor.id, expectedTip: log.history?.tip });
    if (coordinatorLog !== log) return;
    log.history = page; log.scrollTop = 0; log.rendered = false;
  } catch (error) { if (coordinatorLog === log) log.error = error.message; }
  finally { if (coordinatorLog === log) { log.loading = false; renderCoordinatorLog(); } }
}
function renderCoordinatorLog() {
  const log = coordinatorLog;
  if (!log || !$('coordinator-sheet').open) return;
  const task = cache.get(selected)?.coordination?.tasks?.find(task => task.sessionId === log.id);
  if (!task) return;
  const box = $('coordinator-log'), scroll = $('coordinator-scroll'), oldTop = log.rendered ? scroll.scrollTop : log.scrollTop;
  const bottom = log.rendered && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
  const expanded = new Map([...box.querySelectorAll('details')].map(node => [node.dataset.disclosureId, node.open]));
  const focused = box.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.disclosureId : undefined;
  const fragment = document.createDocumentFragment();
  const detail = (id, label) => {
    const node = el('details', undefined, 'coordinator-log-detail'); node.dataset.disclosureId = id; node.open = expanded.get(id) || false;
    node.append(el('summary', label)); return node;
  };
  const meta = detail('task', 'Task details');
  meta.append(el('h3', 'Assignment'), el('p', task.instruction));
  if (task.kind === 'code') {
    meta.append(el('h3', 'Coding workspace'), el('p', task.workspace?.path || 'Preparing workspace…'));
    meta.append(el('p', task.workspace?.integration === 'applied' ? 'Reviewed changes integrated into the parent repository.' : 'Changes stay in this worktree until reviewed and integrated from the main conversation.'));
  }
  if (task.recovery?.phase && task.recovery.phase !== 'idle') meta.append(el('h3', 'Recovery'), el('p', task.recovery.attempts + ' of ' + task.recovery.limit + ' automatic attempts. ' + (task.recovery.reason || 'Checking saved work before continuing.')));
  if (task.pendingInputs) meta.append(el('p', task.pendingInputs + ' instruction(s) waiting to be read.'));
  if ((task.state === 'waiting' || task.recovery?.phase === 'blocked') && task.question) meta.append(el('h3', 'Question for coordinator'), el('p', task.question));
  if (task.result) meta.append(el('h3', task.state === 'reported' ? 'Returned result' : 'Last result'), el('p', task.result));
  if (task.error) meta.append(el('p', task.error, 'coordinator-task-warning'));
  if (task.delivery === 'unknown') meta.append(el('p', 'Notification delivery is uncertain. Ask the coordinator to inspect before repeating an action.', 'coordinator-task-warning'));
  if (!connected) fragment.append(el('p', 'Computer disconnected. Reconnect to update this log.', 'hint'));
  if (log.error) {
    fragment.append(el('p', log.error, 'coordinator-task-warning'));
    const retry = el('button', 'Retry loading log', 'quiet'); retry.type = 'button'; retry.disabled = !connected || !supportsWorkerInspection;
    retry.addEventListener('click', () => watchCoordinatorWorker(log)); fragment.append(retry);
  }
  fragment.append(meta);
  if (!log.state) fragment.append(el('p', log.error ? 'Task details are available above.' : 'Loading worker log…', 'hint'));
  else {
    const state = log.state, messages = log.history?.messages || state.messages || [];
    const page = el('div', undefined, 'coordinator-log-pages');
    const pageButton = (label, action) => {
      const button = el('button', label, 'quiet'); button.type = 'button'; button.disabled = !connected || log.loading;
      button.addEventListener('click', action); page.append(button);
    };
    if (log.history?.older ?? state.historyTruncated) pageButton('Earlier messages', () => loadCoordinatorHistory('before'));
    if (log.history) pageButton('Latest messages', () => { log.history = undefined; log.rendered = false; log.scrollTop = 0; renderCoordinatorLog(); });
    if (log.loading) page.append(el('p', 'Loading messages…', 'hint'));
    fragment.append(page);
    clearThreadImages(new Set(messages.flatMap(message => (message.images || []).map((_, index) => log.id + ':' + message.id + ':' + index))), log.id);
    const results = new Map(messages.filter(message => message.role === 'toolResult').map(message => [message.toolCallId || message.id, message]));
    const tools = new Map((log.history ? [] : state.tools || []).map(tool => [tool.id, tool])), rendered = new Set();
    const appendTool = (id, name, input, result) => {
      if (rendered.has(id)) return;
      rendered.add(id);
      const live = tools.get(id), status = result ? result.isError ? 'error' : 'done' : live?.status || 'pending';
      let args;
      try { args = JSON.parse(input || '{}'); } catch { /* Input may still be streaming. */ }
      const context = typeof args?.path === 'string' ? args.path : typeof args?.pattern === 'string' ? args.pattern : '';
      const label = (name || live?.name || 'Tool') + (status === 'error' ? ' failed' : '') + (context ? ' · ' + displayPaths(context) : '');
      const node = detail('tool:' + id, label); node.dataset.status = status;
      node.append(el('p', status === 'error' ? 'Failed' : status === 'done' ? 'Complete' : 'Running…', 'hint'));
      if (input) node.append(el('pre', displayPaths(input), 'tool-input'));
      node.append(el('pre', displayPaths(result?.text || live?.text || 'No output yet.'), 'tool-output'));
      if (result?.truncated) node.append(el('p', 'Output shortened for mobile.', 'hint'));
      appendThreadImages(node, result, undefined, log.id); fragment.append(node);
    };
    for (const message of messages) {
      if (message.role === 'toolResult') { appendTool(message.toolCallId || message.id, message.toolName, '', message); continue; }
      if (message.text || message.images?.length || message.role === 'user') {
        const instruction = message.role === 'user', article = el('article', undefined, 'message assistant');
        article.dataset.messageId = message.id; article.setAttribute('aria-label', instruction ? 'Instruction to worker' : 'Pi');
        const body = el('div', undefined, 'message-text');
        if (instruction) { article.append(el('p', 'Instruction to worker', 'coordinator-instruction-label')); body.textContent = userMessageText(message); }
        else {
          body.innerHTML = markdown.render(message.text || '');
          for (const link of body.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
          for (const [index, node] of [...body.querySelectorAll('details')].entries()) {
            node.dataset.disclosureId = message.id + ':' + index; node.open = expanded.get(node.dataset.disclosureId) ?? node.open;
          }
        }
        article.append(body); appendThreadImages(article, message, undefined, log.id); fragment.append(article);
      }
      if (message.stopReason === 'error') fragment.append(el('p', 'Worker reply failed. Give instructions in the main conversation.', 'coordinator-task-warning'));
      for (const call of message.toolCalls || []) appendTool(call.id, call.name, call.text, results.get(call.id));
      if (message.truncated) fragment.append(el('p', 'Message shortened for mobile.', 'hint'));
    }
    for (const tool of tools.values()) if (tool.status !== 'done') appendTool(tool.id, tool.name, '', results.get(tool.id));
    if (state.error) fragment.append(el('p', state.error, 'coordinator-task-warning'));
    if (log.history?.newer) {
      const next = el('button', 'Newer messages', 'quiet'); next.type = 'button'; next.disabled = !connected || log.loading;
      next.addEventListener('click', () => loadCoordinatorHistory('after')); fragment.append(next);
    }
  }
  box.replaceChildren(fragment);
  renderDiagrams(box, openImage, () => { if (bottom) scroll.scrollTop = scroll.scrollHeight; }, log.id);
  if (focused) [...box.querySelectorAll('details')].find(node => node.dataset.disclosureId === focused)?.querySelector('summary').focus({ preventScroll: true });
  scroll.scrollTop = bottom ? scroll.scrollHeight : oldTop; log.rendered = true;
}
function openCoordinatorTasks() {
  if (cache.get(selected)?.coordination?.role !== 'coordinator') return;
  document.querySelector('.session-info').open = false;
  stopCoordinatorWorker(); resetCoordinatorDrag(); coordinatorRenderKey = undefined;
  $('coordinator-sheet').showModal(); $('coordinator-open').setAttribute('aria-expanded', 'true');
  renderCoordinator(cache.get(selected)); $('coordinator-scroll').scrollTop = 0;
  $('coordinator-sheet').focus({ preventScroll: true });
}
function returnToCoordinator() {
  const owner = cache.get(selected)?.coordination?.coordinatorId;
  if (owner) void selectSession(owner);
}
$('coordinator-open').addEventListener('click', openCoordinatorTasks);
$('coordinator-return').addEventListener('click', returnToCoordinator);
$('coordinator-tasks').addEventListener('click', openCoordinatorTasks);
$('coordinator-parent').addEventListener('click', returnToCoordinator);
$('coordinator-done').addEventListener('click', () => $('coordinator-sheet').close());
$('coordinator-log-back').addEventListener('click', event => {
  const id = coordinatorLog?.id;
  stopCoordinatorWorker(); coordinatorRenderKey = undefined; renderCoordinator(cache.get(selected));
  $('coordinator-scroll').scrollTop = coordinatorPositions.get('roster:' + selected) || 0;
  const worker = [...$('coordinator-task-list').querySelectorAll('button')].find(button => button.dataset.workerId === cache.get(selected)?.coordination?.tasks.find(task => task.sessionId === id)?.id);
  (event.detail === 0 && worker ? worker : $('coordinator-sheet')).focus({ preventScroll: true });
});
$('coordinator-sheet').addEventListener('click', event => { if (event.target === $('coordinator-sheet')) $('coordinator-sheet').close(); });
$('coordinator-sheet').addEventListener('close', () => { stopCoordinatorWorker(); resetCoordinatorDrag(); $('coordinator-open').setAttribute('aria-expanded', 'false'); });
function resetCoordinatorDrag() {
  coordinatorDrag = undefined; coordinatorDragAnimation?.cancel(); coordinatorDragAnimation = undefined;
  document.querySelector('.coordinator-sheet').style.transform = '';
}
function releaseCoordinatorDrag(dismiss) {
  const drag = coordinatorDrag; coordinatorDrag = undefined;
  if (!drag?.dragging) return;
  if (reducedMotion()) { resetCoordinatorDrag(); if (dismiss) $('coordinator-sheet').close(); return; }
  const surface = document.querySelector('.coordinator-sheet'), end = dismiss ? Math.max(surface.offsetHeight, drag.distance) : 0;
  const animation = surface.animate({ transform: [`translateY(${drag.distance}px)`, `translateY(${end}px)`] },
    { duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' });
  coordinatorDragAnimation = animation;
  animation.finished.then(() => { if (coordinatorDragAnimation === animation) { if (dismiss) $('coordinator-sheet').close(); else resetCoordinatorDrag(); } }, () => {});
}
const coordinatorSurface = document.querySelector('.coordinator-sheet');
coordinatorSurface.addEventListener('touchstart', event => {
  if (coordinatorDragAnimation || event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1 ||
    $('coordinator-scroll').contains(event.target) && $('coordinator-scroll').scrollTop > 0) return;
  const touch = event.touches[0]; coordinatorDrag = { x: touch.clientX, y: touch.clientY, distance: 0, dragging: false };
}, { passive: true });
coordinatorSurface.addEventListener('touchmove', event => {
  if (!coordinatorDrag) return;
  if (event.touches.length !== 1) { releaseCoordinatorDrag(false); return; }
  const dx = event.touches[0].clientX - coordinatorDrag.x, dy = event.touches[0].clientY - coordinatorDrag.y;
  if (!coordinatorDrag.dragging) {
    if (dy < -12 || Math.abs(dx) > 12 && Math.abs(dx) >= Math.abs(dy)) { coordinatorDrag = undefined; return; }
    if (dy < 12 || dy < Math.abs(dx) * 1.25) return;
    coordinatorDrag.dragging = true; coordinatorSurface.getAnimations().forEach(animation => animation.cancel());
  }
  event.preventDefault(); coordinatorDrag.distance = Math.max(0, dy); coordinatorSurface.style.transform = `translateY(${coordinatorDrag.distance}px)`;
}, { passive: false });
coordinatorSurface.addEventListener('touchend', event => {
  if (!coordinatorDrag?.dragging) { coordinatorDrag = undefined; return; }
  event.preventDefault(); releaseCoordinatorDrag(coordinatorDrag.distance > Math.min(100, coordinatorSurface.offsetHeight / 4));
}, { passive: false });
coordinatorSurface.addEventListener('touchcancel', () => releaseCoordinatorDrag(false));

function updateControls() {
  $('session-close').hidden = !supportsSessionClosing || !selected || !!cache.get(selected)?.creation;
  $('session-close').disabled = !connected;
  const state = cache.get(selected), inspectingWorker = state?.coordination?.role === 'worker';
  renderCoordinator(state);
  if (state) $('composer').hidden = inspectingWorker;
  const summary = sessions.find(item => item.id === selected) || selectedSummary;
  $('session-pin').hidden = !selected || !!state?.creation || selected === assistantId;
  $('session-icon-open').hidden = selected === assistantId;
  renderPushControl();
  $('session-pin').disabled = !connected;
  $('session-pin').textContent = summary?.pinned ? 'Unpin session' : 'Pin session';
  const live = !inspectingWorker && connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  const working = state && ['working', 'waiting'].includes(state.status);
  const hasDraft = !!$('prompt').value.trim() || !!imageDrafts.get(selected)?.length;
  const outgoing = sending.get(selected), imageCount = outgoing?.attachments.length || 0;
  $('composer-send-status').hidden = !outgoing;
  const noun = outgoing?.attachments.some(item => item.video) ? 'attachment' : 'image';
  $('composer-send-status').textContent = imageCount ? `Sending ${imageCount} ${noun}${imageCount === 1 ? '' : 's'}…` : 'Sending…';
  $('send').disabled = !live || sending.has(selected);
  $('send').hidden = !!working && !hasDraft;
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands';
  $('attach').disabled = !selected || !!state?.creation || sending.has(selected);
  $('image-files').disabled = $('attach').disabled;
  for (const button of $('attachments').querySelectorAll('button')) button.disabled = sending.has(selected);
  $('abort').disabled = !live;
  $('abort').hidden = !working || hasDraft;
  $('prompt').disabled = !selected || inspectingWorker;
  $('status').textContent = !connected ? 'Disconnected' : state?.status || 'Loading…';
  $('composer-connection').hidden = connected || !selected || manualClose;
  updateActivity(); debugActivity();
  // Until a just-opened session's state arrives, its chips stay blanked rather than flashing placeholders, then fade in.
  $('composer').classList.toggle('settling', !!selected && !state);
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
  $('reasoning-value').textContent = { Minimal: 'Min', Medium: 'Med', 'Extra high': 'XHigh' }[effort] || effort;
  $('reasoning-control').title = `Change reasoning effort: ${effort}`;
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
function commandToken() {
  const input = $('prompt'), cursor = input.selectionStart;
  if (cursor !== input.selectionEnd) return;
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(input.value.slice(0, cursor));
  if (!match) return;
  const suffix = /^[^\s]*/.exec(input.value.slice(cursor))[0];
  if (suffix.includes('/')) return;
  return { start: cursor - match[1].length - 1, end: cursor + suffix.length, query: match[1].toLowerCase() };
}
function renderCommands() {
  const input = $('prompt'), token = commandToken(), query = token?.query || '';
  const state = cache.get(selected);
  const live = connected && state && ['idle', 'working', 'waiting'].includes(state.status);
  $('commands').disabled = !live;
  const open = live && !commandDismissed && !!token;
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
  const rendering = [selected, token.start, query, commandIndex, entry?.commands, entry?.error];
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
    `Tap or Tab to complete. Enter to ${token.start === 0 ? 'run' : 'complete'}. Esc to close.`);
}
function completeCommand(index = commandIndex) {
  const command = commandOptions[index], token = commandToken(), input = $('prompt');
  if (!command || !token) return false;
  const separator = /^\s/.exec(input.value.slice(token.end))?.[0] || '';
  input.setRangeText('/' + command.name + (separator || ' '), token.start, token.end + separator.length, 'end');
  drafts.set(selected, input.value);
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
  renderStatusLine();
}
// The actionable part of Pi's terminal footer: latest cache hit, session cost, context%/window. Token totals live in the Usage panel.
const footerTokens = count => count < 1000 ? `${count}` : count < 10000 ? `${(count / 1000).toFixed(1)}k` :
  count < 1e6 ? `${Math.round(count / 1000)}k` : count < 1e7 ? `${(count / 1e6).toFixed(1)}M` : `${Math.round(count / 1e6)}M`;
function renderStatusLine() {
  const state = cache.get(selected), totals = usageTotals.get(selected), usage = state?.contextUsage, line = $('status-line');
  if (state) {
    // Totals change once per reply; refresh when a reply arrives or the turn settles.
    const turn = `${state.messages.findLast(message => message.role === 'assistant')?.id}:${state.status}`;
    if (usageTurns.get(selected) !== turn) { usageTurns.set(selected, turn); loadUsage(selected); }
  }
  // A just-opened session keeps the line's space, blanked, until its state and first totals arrive, so the composer
  // neither drops when the line collapses nor fills it in two steps.
  const settling = !!selected && (!state || !totals && usageLoading.has(selected + ':context'));
  line.classList.toggle('settling', settling);
  if (settling) return;
  // A streaming reply has no usage until the provider reports it; keep the last known rate meanwhile.
  const parts = [], hit = state?.messages.findLast(message => message.role === 'assistant' && Number.isFinite(message.cacheHit))?.cacheHit;
  // A session's first reply only writes the cache; 0% then is expected, not a warning.
  if (totals?.cacheRead > 0 && Number.isFinite(hit)) {
    const cached = el('span', `CH${Math.round(hit)}%`);
    // A rebuilt cache (model switch, compaction, idle expiry) is the costly turn worth noticing.
    cached.dataset.level = hit < 50 ? 'warning' : 'normal';
    parts.push(cached);
  }
  if (totals?.cost > 0) parts.push(el('span', `$${totals.cost.toFixed(2)}`));
  if (usage?.contextWindow > 0) {
    const percent = contextPercent(usage), context = el('span', `${percent === undefined ? '?' : Math.round(percent) + '%'}/${footerTokens(usage.contextWindow)}`);
    context.dataset.level = percent > 90 ? 'error' : percent > 70 ? 'warning' : 'normal';
    parts.push(context);
  }
  line.replaceChildren(...parts);
  line.hidden = !state || !parts.length;
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
    if (result.totals) usageTotals.set(id, result.totals);
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
$('status-line').addEventListener('click', () => $('usage-meter').click());
setInterval(() => { if (!document.hidden && selected) loadUsage(selected); }, 15000);
function modelVersion(model) {
  // shortcut: infer recency from versions until discovery supplies release dates.
  const version = /\d+(?:[.-]\d+)*/;
  return (model.name?.match(version) || model.id.match(version))?.[0].replaceAll('-', '.') || '';
}
function renderModels() {
  const picker = settingsPicker;
  if (!picker?.models) return;
  const query = $('model-search').value.trim().toLowerCase();
  const matches = picker.models.filter(model => `${model.name || ''} ${model.provider} ${model.id}`.toLowerCase().includes(query))
    .sort((a, b) => Number(`${b.provider}/${b.id}` === picker.current) - Number(`${a.provider}/${a.id}` === picker.current)
      || a.provider.localeCompare(b.provider)
      || modelVersion(b).localeCompare(modelVersion(a), undefined, { numeric: true })
      || (a.name || a.id).localeCompare(b.name || b.id));
  const groups = new Map();
  for (const model of matches) {
    if (!groups.has(model.provider)) groups.set(model.provider, []);
    groups.get(model.provider).push(model);
  }
  const fragment = document.createDocumentFragment();
  for (const [provider, models] of groups) {
    const group = el('section', undefined, 'model-group');
    group.id = `model-group-${provider}`;
    group.setAttribute('aria-label', provider); group.append(el('h3', provider));
    const expanded = picker.expandedProviders?.has(provider) === true;
    for (const model of query || expanded ? models : models.slice(0, 4)) {
      const key = `${model.provider}/${model.id}`, current = key === picker.current;
      const button = el('button', undefined, 'command-option picker-option'); button.type = 'button';
      button.setAttribute('aria-pressed', String(current));
      button.append(el('strong', model.name || model.id, 'picker-option-label'));
      if (current) button.append(el('span', 'Current', 'picker-current'));
      button.disabled = !!picker.busy;
      button.addEventListener('click', event => chooseModel(picker, key, event.detail === 0));
      group.append(button);
    }
    if (!query && models.length > 4) {
      const more = el('button', expanded ? 'Show fewer' : `Show ${models.length - 4} more`, 'command-option model-more');
      more.type = 'button'; more.disabled = !!picker.busy;
      more.setAttribute('aria-expanded', String(expanded)); more.setAttribute('aria-controls', group.id);
      more.addEventListener('click', event => {
        picker.expandedProviders ||= new Set();
        if (expanded) picker.expandedProviders.delete(provider); else picker.expandedProviders.add(provider);
        renderModels();
        if (event.detail === 0) (expanded ? $(group.id).querySelector('.model-more') : $(group.id).querySelectorAll('.picker-option')[4]).focus();
      });
      group.append(more);
    }
    fragment.append(group);
  }
  $('picker-options').replaceChildren(fragment);
  $('picker-help').classList.remove('picker-error');
  $('picker-help').textContent = !picker.models.length ? 'No models available. Configure a provider in the Pi terminal.'
    : !matches.length ? 'No matching models. Try a model name or provider.' : '';
}
async function openModels(id, opener) {
  const key = cache.get(id)?.modelCacheKey || id;
  const picker = openPicker(id, 'model', opener), cached = modelLists.get(key);
  if (cached) { Object.assign(picker, cached, { current: cache.get(id)?.model || cached.current }); renderModels(); }
  else $('picker-help').textContent = 'Loading available models…';
  if (matchMedia('(pointer: fine)').matches) $('model-search').focus();
  try {
    const result = await request('models', { sessionId: id });
    if (settingsPicker !== picker || selected !== id) return;
    if (result.models?.length) modelLists.set(key, result);
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
$('video-close').addEventListener('click', closeVideo);
videoViewer.addEventListener('close', restoreVideo);
videoViewer.addEventListener('touchstart', event => {
  resetVideoPull();
  if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1 || event.target.closest('button, a, input')) return;
  const touch = event.touches[0], player = videoViewer.querySelector('video');
  // Leave the native controls at the bottom of the player alone.
  if (event.target === player && touch.clientY >= player.getBoundingClientRect().bottom - 80) return;
  videoPull = { x: touch.clientX, y: touch.clientY, distance: 0 };
}, { passive: true });
videoViewer.addEventListener('touchmove', event => {
  if (!videoPull) return;
  if (event.touches.length !== 1) { resetVideoPull(); return; }
  const dx = event.touches[0].clientX - videoPull.x, dy = event.touches[0].clientY - videoPull.y;
  if (!videoPull.active) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
    if (dy <= 0 || Math.abs(dx) > dy) { resetVideoPull(); return; }
    videoPull.active = true;
  }
  event.preventDefault();
  videoPull.distance = Math.max(0, dy);
  videoViewer.style.transform = `translateY(${videoPull.distance}px)`;
}, { passive: false });
for (const type of ['touchend', 'touchcancel']) videoViewer.addEventListener(type, () => {
  const dismiss = type === 'touchend' && videoPull?.distance >= 80;
  resetVideoPull();
  if (dismiss) closeVideo();
}, { passive: true });
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
  const zoom = imageFitZoom();
  const top = Math.max(0, (fullImage.naturalHeight * fit * zoom - imageStage.clientHeight) / 2);
  positionImage(zoom, 0, top);
});
new ResizeObserver(() => { if (imageViewer.open) positionImage(); }).observe(imageStage);
imageViewer.addEventListener('close', () => {
  fullImage.getAnimations().forEach(animation => animation.cancel());
  imagePointers.clear(); imageTap = imageLastTap = undefined; resetImagePull();
});
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
  if (fullImage.getAnimations().length) {
    const transform = new DOMMatrix(getComputedStyle(fullImage).transform);
    positionImage(transform.a, transform.e, transform.f);
  }
  imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  imageTap = imagePointers.size === 1 ? { x: event.clientX, y: event.clientY, time: event.timeStamp, pointerType: event.pointerType } : undefined;
  if (!imageTap) imageLastTap = undefined;
  resetImagePull();
  if (event.pointerType === 'touch' && imagePointers.size === 1) {
    const fit = Math.min(imageStage.clientWidth / (fullImage.naturalWidth || 1), imageStage.clientHeight / (fullImage.naturalHeight || 1));
    const width = fullImage.naturalWidth * fit * imageZoom;
    const top = imageY + (imageStage.clientHeight - fullImage.naturalHeight * fit * imageZoom) / 2;
    // A tall image must pan back to its top before a new pull can dismiss it.
    if (width <= imageStage.clientWidth + 1) imagePull = { x: event.clientX, y: event.clientY, distance: 0, canDismiss: top >= -1 };
  }
  // Touch and pen already capture implicitly; mouse drags need explicit capture.
  if (event.pointerType === 'mouse') imageStage.setPointerCapture(event.pointerId);
});
imageStage.addEventListener('pointermove', event => {
  if (!imagePointers.has(event.pointerId)) return;
  if (imageTap && Math.hypot(event.clientX - imageTap.x, event.clientY - imageTap.y) > 10) imageTap = imageLastTap = undefined;
  const before = imageGesture();
  imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (imagePull) {
    const dx = event.clientX - imagePull.x, dy = event.clientY - imagePull.y;
    if (!imagePull.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      imagePull.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : imagePull.canDismiss && dy > 0 ? 'y' : undefined;
      if (!imagePull.axis) resetImagePull();
    }
    if (imagePull?.axis === 'x') {
      imagePull.distance = dx;
      imageStage.style.transform = `translateX(${dx}px)`;
      return;
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
  const pull = type === 'pointerup' ? imagePull : undefined;
  const tap = type === 'pointerup' && imageTap && event.timeStamp - imageTap.time <= 350 &&
    Math.hypot(event.clientX - imageTap.x, event.clientY - imageTap.y) <= 10 ? imageTap : undefined;
  imagePointers.delete(event.pointerId); imageTap = undefined; resetImagePull();
  if (pull?.axis === 'y' && pull.distance >= 80) imageViewer.close();
  else if (pull?.axis === 'x' && Math.abs(pull.distance) >= 60) stepImage(pull.distance < 0 ? 1 : -1);
  if (tap && imageLastTap && tap.pointerType === imageLastTap.pointerType && event.timeStamp - imageLastTap.time <= 350 &&
      Math.hypot(event.clientX - imageLastTap.x, event.clientY - imageLastTap.y) <= 24) {
    const box = imageStage.getBoundingClientRect(), fit = imageFitZoom();
    zoomImage(imageZoom > fit + 0.01 ? fit : fit * 2, event.clientX - box.x - box.width / 2, event.clientY - box.y - box.height / 2);
    imageLastTap = undefined;
  } else imageLastTap = tap ? { ...tap, time: event.timeStamp } : undefined;
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
  if (state.coordination?.role === 'worker') { $('dialog').hidden = true; lastDialog = undefined; return; }
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
$('assistant-open').innerHTML = `<span class="bot personality-bot" data-kind="miso" data-mood="idle" aria-hidden="true">${botSvg('miso', 'idle', 32)}</span>`;
$('assistant-open').addEventListener('click', async () => {
  haptic();
  try { assistantId = (await request('assistant')).sessionId; await selectSession(assistantId); }
  catch (error) { notice(error.message); }
});
$('search-open').addEventListener('click', () => { haptic(); $('search-bar').classList.add('open'); $('search').focus({ preventScroll: true }); });
// Keep the keyboard open until the click lands, or blur moves the close button out from under the tap.
$('search-close').addEventListener('mousedown', event => event.preventDefault());
$('search-close').addEventListener('click', event => { closeSearch(); $('search-open').focus({ focusVisible: !event.detail }); });
// An empty search folds back into its button once you leave it; a live filter stays visible.
$('search').addEventListener('blur', event => { if (!$('search').value && event.relatedTarget !== $('search-close')) closeSearch(); });
$('search').addEventListener('keydown', event => { if (event.key === 'Escape') { closeSearch(); $('search-open').focus(); } });
$('list-retry').addEventListener('click', loadList);
// Pinned projects stay on top, then the rest most recent first (the host's order). The sheet fits about five; scroll or search for more.
let projectList, projectRequest, preparation, pinnedProjects = JSON.parse(localStorage.getItem('pi-remote-pins') || '[]');
function prepareProject(project) {
  if (!supportsNewPreparation) return;
  const key = project?.cwd || '', ws = socket;
  if (preparation?.key === key && preparation.pending) return;
  const entry = preparation = { key, pending: true };
  request('prepareNew', project ? { sessionId: project.sessionId } : {}).then(profile => {
    if (socket !== ws) return;
    newSessionProfiles.set(key, profile);
    modelLists.set(profile.modelCacheKey, { models: profile.models, current: profile.model });
  }).catch(() => { if (preparation === entry) preparation = undefined; })
    .finally(() => { entry.pending = false; });
}
function prepareNextSession() {
  if (!projectList) return;
  const cwd = cache.get(selected)?.cwd || selectedSummary?.cwd;
  const project = projectList.find(item => item.cwd === cwd) || projectList.find(item => pinnedProjects.includes(item.cwd)) || projectList.find(item => !isBlank(item.cwd));
  prepareProject(isBlank(cwd) ? undefined : project);
}
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
    prepareNextSession();
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
  prepareNextSession(); loadProjects();
}
// Without a project, the host starts the session in a new folder it creates.
async function startInProject(project, id = 'new-' + crypto.randomUUID()) {
  if (cache.get(id)?.creation?.pending) return;
  const creation = { project, pending: true }, profile = supportsNewPreparation ? newSessionProfiles.get(project?.cwd || '') : undefined;
  preparation = undefined;
  cache.set(id, { id, title: 'Untitled session', cwd: project?.cwd || '', status: 'starting', messages: [], tools: [], creation,
    model: profile?.model, modelName: profile?.modelName, thinkingLevel: profile?.thinkingLevel, modelCacheKey: profile?.modelCacheKey });
  $('project-picker').close();
  void selectSession(id);
  $('prompt').focus({ preventScroll: true });
  try {
    const created = project ? await request('new', { sessionId: project.sessionId }) : await request('newProject');
    if (cache.get(id)?.creation !== creation) return;
    prepareProject(project);
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
  $('app').classList.remove('swiping', 'opening', 'to-miso'); $('sidebar').inert = false;
  const render = pendingSwipeRender; pendingSwipeRender = undefined; render?.();
}
$('back').addEventListener('click', () => {
  haptic(); resetSwipe();
  if (backToMiso()) return;
  if (history.state?.session) history.back();
  else { $('app').classList.remove('viewing'); misoReturn = false; reportViewing(); }
});
window.addEventListener('popstate', () => {
  if (skipPop) { skipPop = false; return; }
  resetSwipe(); closePicker(); $('nearby-sessions').hidePopover();
  if (misoReturn && history.state?.session && selected !== assistantId) { void selectSession(assistantId); return; }
  $('app').classList.remove('viewing'); misoReturn = false; reportViewing();
});
// Swiping the title steps through the session list's order. The order freezes while switching this way,
// since a prompt would otherwise move the session to the top and swiping back would skip past it.
function switchIds() {
  // Idle pinned sessions stay out of the switcher; the one you are on stays so you can swipe away and back.
  const ids = switchOrder?.includes(selected) ? switchOrder : [...$('sessions').querySelectorAll('.session')].map(row => row.dataset.id)
    .filter(id => id === selected || sessionGroup(sessions.find(item => item.id === id) || {}) !== 'pinned');
  return ids.filter(id => sessions.some(item => item.id === id));
}
const neighbour = step => { const ids = switchIds(), at = ids.indexOf(selected); return at < 0 ? undefined : ids[at + step]; };
function renderHeading() {
  const ids = switchIds(), at = ids.indexOf(selected);
  for (const [side, step] of [['prev', -1], ['next', 1]]) {
    const item = at < 0 ? undefined : sessions.find(row => row.id === ids[at + step]);
    const text = el('div', undefined, 'heading-text');
    if (item) text.append(el('span', sessionTitle(item.title, cache.get(item.id)?.messages)), el('span', projectName(item.cwd)));
    $('heading-' + side).replaceChildren(...item ? [...headingKind(item), text] : []);
  }
  renderDots();
}
// progress is the drag's fraction of a full step, so the bright dot follows the finger.
function renderDots(progress = 0) {
  const ids = switchIds(), at = ids.indexOf(selected), dots = $('session-dots');
  $('session-swipe').hidden = at < 0 || ids.length < 2;
  if ($('session-swipe').hidden) return dots.replaceChildren();
  let track = dots.firstElementChild;
  if (track?.children.length !== ids.length + 1) {
    track = el('div', undefined, 'session-dots-track');
    track.append(...ids.map(() => el('i')), el('b')); dots.replaceChildren(track);
  }
  const size = Math.min(ids.length, 5), position = at + progress, clamp = value => Math.min(Math.max(value - 2, 0), ids.length - size);
  const first = clamp(Math.round(position)), step = 12, origin = switchOrder && ids.indexOf(switchOrigin);
  [...track.children].slice(0, -1).forEach((dot, i) => {
    dot.classList.toggle('edge', i === first && i > 0 || i === first + size - 1 && i < ids.length - 1);
    dot.classList.toggle('origin', i === origin);
  });
  dots.style.width = size * step - 6 + 'px';
  track.style.transform = `translateX(${-clamp(position) * step}px)`;
  track.lastElementChild.style.transform = `translateX(${position * step}px)`;
}
const switchEase = 'cubic-bezier(.2, .8, .2, 1)', reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// A static copy of each thread as last seen, so swiping can slide it in beside the current one.
// shortcut: sessions not opened in this visit have no copy (the host watches one session at a time); add a host preview op if that matters.
const peeks = new Map();
let peek;
function keepPeek(id) {
  if (!id || $('transcript').hidden || $('transcript').getAttribute('aria-busy') === 'true') return;
  const copy = $('transcript').cloneNode(true);
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.querySelectorAll('img[src^="blob:"], video').forEach(node => node.remove()); // their object URLs are revoked on leaving
  copy.removeAttribute('id'); copy.removeAttribute('tabindex'); copy.className = 'transcript-peek'; copy.inert = true; copy.setAttribute('aria-hidden', 'true');
  peeks.delete(id); peeks.set(id, copy);
  if (peeks.size > 8) peeks.delete(peeks.keys().next().value);
}
// The conversation follows the finger too (page is its offset), with the target's copy alongside, so a switch reads as a page turn.
function offsetHeading(dx, animate, page = dx, target = page && neighbour(page < 0 ? 1 : -1)) {
  const box = $('transcript'), motion = animate ? `transform .22s ${switchEase}, opacity .22s` : '', reduced = reducedMotion();
  const copy = !reduced && page ? peeks.get(target) : undefined;
  if (peek && peek !== copy) {
    const old = peek; peek = undefined;
    if (animate) { old.style.transition = motion; old.style.transform = `translateX(${old.side * box.offsetWidth}px)`; setTimeout(() => old.remove(), 220); }
    else old.remove();
  }
  if (copy && !peek) {
    peek = copy; peek.side = Math.sign(-page);
    Object.assign(peek.style, { top: box.offsetTop + 'px', left: box.offsetLeft + 'px', width: box.offsetWidth + 'px', height: box.offsetHeight + 'px', transition: '', transform: `translateX(${page + peek.side * box.offsetWidth}px)` });
    box.after(peek); peek.scrollTop = peek.scrollHeight;
  }
  for (const [node, x] of [[$('heading-strip'), dx], ...reduced ? [] : [[box, page]], ...peek ? [[peek, page + peek.side * box.offsetWidth]] : []]) {
    node.style.transition = motion;
    node.style.transform = x ? `translateX(${x}px)` : '';
  }
}
function switchTo(id, ids) {
  if (!switchOrder) switchOrigin = selected;
  haptic(); switchOrder = ids; selectSession(id, true);
}
function stepSession(direction, id = neighbour(direction)) {
  const ids = switchIds();
  if (headingSwitching || !id) { renderDots(); return offsetHeading(0, true); }
  headingSwitching = true; localStorage.setItem('pi-remote-title-swipe-learned', '1');
  offsetHeading(-direction * $('heading-strip').offsetWidth, true, -direction * $('transcript').offsetWidth, id); renderDots(ids.indexOf(id) - ids.indexOf(selected));
  const previewed = !!peek;
  if (!previewed) $('transcript').style.opacity = '0';
  setTimeout(() => {
    headingSwitching = false; offsetHeading(0); $('transcript').style.opacity = '';
    switchTo(id, ids);
    // The copy already slid into place; otherwise the next conversation enters from the side the swipe pulls toward.
    if (!previewed) $('transcript').animate([{ transform: `translateX(${reducedMotion() ? 0 : direction * 40}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: switchEase });
  }, 220);
}
// Double-tapping the title or the strip above the composer returns to the session the switching started from.
function returnToOrigin() {
  const ids = switchIds();
  if (switchOrigin !== selected && ids.includes(switchOrigin)) stepSession(Math.sign(ids.indexOf(switchOrigin) - ids.indexOf(selected)), switchOrigin);
}
// Until the first swipe, opening a session briefly slides the next title into view, once per visit.
function nudgeHeading() {
  if (headingNudged || localStorage.getItem('pi-remote-title-swipe-learned') || reducedMotion()) return;
  const direction = neighbour(1) ? 1 : neighbour(-1) ? -1 : 0, id = selected;
  if (!direction) return;
  headingNudged = true;
  setTimeout(() => {
    if (headingGesture || headingSwitching || selected !== id) return;
    offsetHeading(-direction * 20, true);
    setTimeout(() => headingGesture || headingSwitching || offsetHeading(0, true), 280);
  }, 700);
}
function openNearby() {
  const ids = switchIds(), at = ids.indexOf(selected), menu = $('nearby-sessions'), list = $('nearby-list');
  if (at < 0) return;
  const here = projectName(sessions.find(row => row.id === selected)?.cwd);
  list.replaceChildren(...ids.map(id => {
    const item = sessions.find(row => row.id === id), status = sessionActivity(item), text = el('span', undefined, 'nearby-text'), meta = el('small');
    const button = el('button'); button.type = 'button'; button.dataset.status = status;
    if (id === selected) button.setAttribute('aria-current', 'true');
    const icon = statusIcon(status), fresh = isUnread(item), project = projectName(item.cwd);
    if (fresh) icon.dataset.unread = '';
    const preview = item.preview ? displayPaths(taskText({ role: item.previewRole, text: item.preview, truncated: true })) : '';
    const elapsed = age(new Date(item.lastPromptAt ?? item.updatedAt));
    // Line 2 says what opening the session would show: its question, the new reply, or how long it has run.
    const state = status === 'waiting' ? item.dialog?.title?.split('\n')[0] || statusLabels.waiting
      : status === 'working' ? statusLabels.working + (elapsed === 'now' ? '' : ' ' + elapsed) : '';
    const detail = status === 'waiting' ? '' : fresh && !state ? preview : preview && (item.previewRole === 'user' ? 'You: ' : 'Pi: ') + preview;
    if (status === 'waiting') button.dataset.attention = 'waiting';
    else if (fresh && !state && preview) button.dataset.attention = 'unread';
    // The project only when it differs from the one you are in.
    const parts = [project !== here && project && el('span', project, 'nearby-project'), state && el('span', state, 'nearby-state'), detail].filter(Boolean);
    meta.append(...parts.flatMap((part, i) => i ? [' · ', part] : [part]));
    if (!parts.length) meta.append(project || 'No messages yet');
    text.append(el('strong', sessionTitle(item.title, cache.get(id)?.messages)), meta);
    // A running session is always "now"; its elapsed time is on line 2 instead.
    button.append(showSessionKind(icon, item, 24), text, el('time', status === 'working' ? '' : age(new Date(item.updatedAt))));
    button.addEventListener('click', () => { menu.hidePopover(); if (id !== selected) stepSession(Math.sign(ids.indexOf(id) - at), id); });
    return button;
  }));
  // Open just above the held dots.
  menu.style.bottom = document.documentElement.clientHeight - $('session-swipe').getBoundingClientRect().top + 'px';
  $('session-swipe').classList.add('held');
  menu.showPopover();
  // About four rows show at once, centred on the current session; a half row hints that the rest scroll.
  const current = list.querySelector('[aria-current]');
  list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
  updateNearbyHints();
}
// Count sessions that need you beyond each edge, so a long list never hides them.
function updateNearbyHints() {
  const list = $('nearby-list'), top = list.scrollTop, bottom = top + list.clientHeight, rows = [...list.querySelectorAll('[data-attention]')];
  for (const [id, arrow, outside] of [['nearby-up', '↑', row => row.offsetTop + row.offsetHeight / 2 < top], ['nearby-down', '↓', row => row.offsetTop + row.offsetHeight / 2 > bottom]]) {
    const away = rows.filter(outside), waiting = away.filter(row => row.dataset.attention === 'waiting').length, hint = $(id);
    hint.hidden = !away.length;
    hint.dataset.kind = waiting ? 'waiting' : 'unread';
    hint.textContent = `${arrow} ${[waiting && `${waiting} needs you`, away.length - waiting && `${away.length - waiting} new`].filter(Boolean).join(' · ')}`;
    hint.onclick = () => (arrow === '↑' ? away.at(-1) : away[0]).scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
}
$('nearby-list').addEventListener('scroll', updateNearbyHints, { passive: true });
$('nearby-sessions').addEventListener('toggle', event => { if (event.newState === 'closed') $('session-swipe').classList.remove('held'); });
// iOS 26.5+ only ticks for a finger on a real switch, so an invisible one covers the dots: lifting after a hold,
// or a tap, toggles it natively. Its pointer events still bubble to the strip's gesture handlers.
// shortcut: whether iOS counts the lift after a 450 ms hold as a tap is unverified; check on a device.
{
  const input = document.createElement('input');
  if (!navigator.vibrate && matchMedia('(pointer: coarse)').matches && 'switch' in input) {
    input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1; input.className = 'session-swipe-haptic';
    $('session-swipe').append(input);
  }
}
// A manual popover: auto light-dismiss would treat the finger lifting after the hold as an outside click.
document.addEventListener('pointerdown', event => {
  if ($('nearby-sessions').matches(':popover-open') && !event.target.closest('#nearby-sessions')) $('nearby-sessions').hidePopover();
}, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('nearby-sessions').hidePopover(); });
for (const surface of [$('heading'), $('session-swipe')]) {
  surface.addEventListener('pointerdown', event => {
    if (headingGesture || headingSwitching || event.button || !selected || switchIds().length < 2) return;
    surface.setPointerCapture(event.pointerId);
    // Only the dots open the nearby sessions when held: they swell while the press builds, then pop as the list opens.
    const dots = surface === $('session-swipe');
    if (dots) surface.classList.add('pressing');
    headingGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, samples: [], timer: dots && setTimeout(() => {
      if (!headingGesture) return;
      surface.classList.remove('pressing');
      headingGesture.mode = 'held'; haptic(); openNearby();
    }, 450) };
  });
  surface.addEventListener('pointermove', event => {
    const gesture = headingGesture;
    if (event.pointerId !== gesture?.id || gesture.mode === 'held' || gesture.mode === 'ignored') return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      clearTimeout(gesture.timer); $('session-swipe').classList.remove('pressing');
      gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'swiping' : 'ignored';
      if (gesture.mode === 'ignored') return;
      $('session-swipe').classList.add('dragging');
    }
    gesture.dx = neighbour(dx < 0 ? 1 : -1) ? dx : dx / 3; // rubber band at either end of the list
    gesture.samples = [...gesture.samples, { x: event.clientX, t: event.timeStamp }].filter(sample => event.timeStamp - sample.t < 100);
    offsetHeading(gesture.dx);
    renderDots(Math.max(-1, Math.min(1, -gesture.dx / $('heading-strip').offsetWidth)));
  });
  for (const type of ['pointerup', 'pointercancel']) surface.addEventListener(type, event => {
    const gesture = headingGesture;
    if (event.pointerId !== gesture?.id) return;
    clearTimeout(gesture.timer); headingGesture = undefined; $('session-swipe').classList.remove('pressing');
    if (!gesture.mode && type === 'pointerup') {
      if (event.timeStamp - lastHeadingTap < 350) { lastHeadingTap = 0; returnToOrigin(); } else lastHeadingTap = event.timeStamp;
    }
    if (gesture.mode !== 'swiping') return;
    $('session-swipe').classList.remove('dragging');
    const direction = gesture.dx < 0 ? 1 : -1, [first, last] = [gesture.samples[0], gesture.samples.at(-1)];
    const velocity = first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    if (type === 'pointerup' && (Math.abs(gesture.dx) > $('heading-strip').offsetWidth * .35 || -velocity * direction > .3)) stepSession(direction);
    else { offsetHeading(0, true); renderDots(); }
  });
}
// Browser edge-swipes reveal an old history screenshot, so rows and scroll can jump when the swipe lands.
// Drag the thread off the live list in both browser and home-screen mode instead.
{
  const app = $('app'), main = document.querySelector('main');
  // Safari permits native switch-drag feedback even when a swipe has no click activation.
  // shortcut: iOS arms switch dragging after 200 ms; reliable fast-swipe feedback needs a native haptics bridge.
  const nativeInput = document.createElement('input');
  if (!navigator.vibrate && matchMedia('(pointer: coarse)').matches && 'switch' in nativeInput) {
    const edge = el('div', undefined, 'swipe-haptic-edge'); edge.id = 'swipe-haptic-edge';
    edge.setAttribute('aria-hidden', 'true');
    nativeInput.type = 'checkbox'; nativeInput.setAttribute('switch', ''); nativeInput.tabIndex = -1;
    nativeInput.id = 'swipe-haptic-input';
    edge.append(nativeInput); app.append(edge);
    const fitEdge = () => {
      const transcript = $('transcript').getBoundingClientRect();
      const top = Math.max(transcript.top, document.querySelector('.conversation-header').getBoundingClientRect().bottom);
      const height = Math.max(0, Math.min(transcript.bottom, $('dock').getBoundingClientRect().top) - top);
      edge.style.left = app.getBoundingClientRect().left + 'px'; edge.style.top = top + 'px'; edge.style.height = height + 'px';
      nativeInput.style.width = main.clientWidth * 2 / 3 + 'px'; nativeInput.style.transform = `scaleY(${height / 32})`;
    };
    const edgeObserver = new ResizeObserver(fitEdge);
    edgeObserver.observe($('transcript')); edgeObserver.observe($('dock'));
    window.visualViewport?.addEventListener('scroll', fitEdge);
    let origin, x, y;
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) nativeInput.addEventListener(type, event => {
      if (type === 'touchstart' && event.touches.length === 1) {
        const touch = event.touches[0]; x = touch.clientX; y = touch.clientY;
        edge.style.pointerEvents = 'none'; origin = document.elementFromPoint(x, y)?.closest('button, a, summary'); edge.style.pointerEvents = '';
        nativeInput.checked = false; nativeInput.style.left = x - edge.getBoundingClientRect().left + 'px';
      }
      const completes = type === 'touchend' && trackingSwipe && main.classList.contains('swiping') && dx > main.offsetWidth / 3;
      const forwarded = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches: event.touches, nativeSwipeHaptic: true });
      (origin || main).dispatchEvent(forwarded);
      if (type === 'touchend' || type === 'touchcancel') {
        // Let Safari finish a committed native gesture, but never turn a canceled swipe into a switch tap.
        if (!completes) { event.preventDefault(); nativeInput.disabled = true; }
        if (type === 'touchend' && origin && event.changedTouches?.length === 1) {
          const touch = event.changedTouches[0];
          if (Math.hypot(touch.clientX - x, touch.clientY - y) < 8 && origin.isConnected) origin.click();
        }
        origin = undefined;
        requestAnimationFrame(() => { nativeInput.checked = false; nativeInput.disabled = false; nativeInput.style.left = ''; });
      } else if (!trackingSwipe) event.preventDefault();
    }, { passive: false });
  }
  let startX, startY, dx;
  main.addEventListener('touchstart', event => {
    resetSwipe();
    const touch = event.touches[0];
    // A right thumb can reach the thread's middle without reaching the left edge.
    trackingSwipe = event.touches.length === 1 && (window.visualViewport?.scale ?? 1) <= 1 && app.classList.contains('viewing') &&
      (touch.clientX < 24 || event.target.closest('#transcript')) && matchMedia('(max-width: 700px)').matches &&
      !event.target.closest('button, a, input, textarea, summary, dialog, pre, table');
    if (trackingSwipe && touch.clientX < 24) event.preventDefault();
    startX = touch.clientX; startY = touch.clientY; dx = 0;
  }, { passive: false });
  main.addEventListener('touchmove', event => {
    if (!trackingSwipe) return;
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1) { resetSwipe(); return; }
    const touch = event.touches[0], dy = Math.abs(touch.clientY - startY);
    dx = Math.max(0, touch.clientX - startX);
    if (!app.classList.contains('swiping')) {
      if (dy > 8 && dy >= dx) { resetSwipe(); return; }
      if (dx < 8) return;
      app.classList.add('swiping'); app.classList.toggle('to-miso', !!misoBackdrop && misoReturn && selected !== assistantId);
      if (app.classList.contains('to-miso')) misoBackdrop.transcript.scrollTop = misoPinned ? misoBackdrop.transcript.scrollHeight : misoScroll;
    }
    event.preventDefault();
    main.style.transform = `translateX(${dx}px)`;
  }, { passive: false });
  const release = event => {
    if (!trackingSwipe) return;
    trackingSwipe = false;
    if (!app.classList.contains('swiping')) return resetSwipe();
    // Keep the native edge threshold aligned with Safari's switch feedback.
    const back = dx > (event.nativeSwipeHaptic ? main.offsetWidth / 3 : 72);
    if (back && !event.nativeSwipeHaptic) haptic();
    main.style.transition = 'transform .2s ease-out';
    main.style.transform = back ? 'translateX(100%)' : '';
    swipeTimer = setTimeout(() => {
      resetSwipe();
      if (back && backToMiso(true)) closePicker();
      else if (back) {
        closePicker(); app.classList.remove('viewing'); misoReturn = false; reportViewing();
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
  if (commandToken()?.query === '' && selected) loadCommands(selected);
  updateControls();
});
$('commands').addEventListener('click', () => {
  const input = $('prompt');
  if (!commandToken()) {
    const cursor = input.selectionStart;
    const before = /\S$/.test(input.value.slice(0, cursor)) ? ' ' : '';
    const after = /^\S/.test(input.value.slice(cursor)) ? ' ' : '';
    input.setRangeText(before + '/' + after, cursor, cursor, 'end');
    const position = cursor + before.length + 1;
    input.setSelectionRange(position, position);
  }
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
$('prompt').addEventListener('click', renderCommands);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === $('prompt')) renderCommands();
});
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
      const run = commandToken()?.start === 0;
      if (completeCommand() && run) sendMessage();
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
    if (videoViewer.querySelector('video')?.src === image.url) closeVideo();
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
      preview.playsInline = true; preview.preload = 'none';
      if (image.poster) preview.poster = image.poster;
      preview.setAttribute('aria-label', image.file.name);
      preview.addEventListener('error', () => {
        if (videoViewer.contains(preview)) closeVideo();
        const play = preview.closest('button');
        if (play) { play.disabled = true; play.querySelector('.video-play-icon')?.remove(); }
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
      imageDrafts.set(selected, images.filter(other => other !== image)); renderImages(); $('attach').focus({ focusVisible: !event.detail });
    });
    item.classList.toggle('uploading', !!image.uploading);
    if (image.video) {
      const status = el('span', image.error ? 'Upload failed. Send to retry.' : '');
      status.setAttribute('role', 'status'); status.hidden = !image.error;
      const play = el('button', undefined, 'video-open'); play.type = 'button';
      play.setAttribute('aria-label', `Play ${image.file.name}`);
      play.addEventListener('click', () => openVideo(preview));
      play.append(preview, videoPlayIcon()); item.append(play, status);
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
// iOS's own sheet already offers Photo Library, camera and Files, so + opens it directly.
$('attach').addEventListener('click', () => {
  closePicker(); commandDismissed = true; renderCommands();
  notice(''); $('image-files').click();
});
$('image-files').addEventListener('change', () => {
  const files = [...$('image-files').files], images = imageDrafts.get(selected) || [];
  $('image-files').value = '';
  if (!selected || cache.get(selected)?.coordination?.role === 'worker' || sending.has(selected) || !files.length) return;
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
// Give feedback before handlers disable controls or open a native picker.
document.querySelector('.composer-toolbar').addEventListener('click', event => {
  if (event.target.closest('button:not(:disabled)')) haptic();
}, { capture: true });
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  sendMessage();
});
async function sendMessage() {
  const id = selected, text = $('prompt').value, attachments = imageDrafts.get(id) || [];
  if ((!text.trim() && !attachments.length) || !id || cache.get(id)?.coordination?.role === 'worker' || $('send').disabled || sending.has(id)) return;
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
