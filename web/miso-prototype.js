// Throwaway: sample check-ins only, nothing here talks to the host.
// The host renders session facts as rows; Miso adds at most one sentence per check-in.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// Copied from app.js sessionKinds/botSvg so rows use the production artwork and moods.
const kinds = {
  miso: ['<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]],
    '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><g class="character-cat-ear"><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/></g><g class="character-cat-ear character-cat-ear-right"><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/></g>'],
  mochi: ['<path d="M16 10C8 10 2 16 2 23c0 5 6 7 14 7s14-2 14-7c0-7-6-13-14-13Z"/>', [[11.5, 21], [20.5, 21]], ''],
  pip: ['<rect x="5" y="9" width="22" height="20" rx="8"/>', [[12, 19], [20, 19]], '<g class="character-antenna"><path class="bot-stalk" d="M16 10V7l-5-3.5"/><circle class="bot-body" cx="11" cy="3.5" r="2"/></g>'],
  bun: ['<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<g class="character-ear"><rect class="bot-body" x="8" y="2" width="5" height="13" rx="2.5"/></g><g class="character-ear character-ear-right"><rect class="bot-body" x="19" y="4" width="5" height="11" rx="2.5"/></g>'],
  sprout: ['<rect x="4" y="10" width="24" height="19" rx="9"/>', [[12, 19], [20, 19]],
    '<path class="bot-stalk" d="M16 11V6"/><path class="bot-body character-leaf character-leaf-left" d="M16 7C10 7 7 4 8 1c5 0 8 2 8 6Z"/><path class="bot-accent character-leaf character-leaf-right" d="M16 8c0-5 3-7 8-7 0 4-3 7-8 7Z"/>'],
  zig: ['<path d="M16 5q2 0 4 4l8 15q2 5-3 5H7q-5 0-3-5l8-15q2-4 4-4Z"/>', [[12, 21], [20, 21]],
    '<g class="character-zig-foot"><rect class="bot-body" x="7" y="26" width="7" height="5" rx="2"/></g><g class="character-zig-foot character-zig-foot-right"><rect class="bot-body" x="18" y="26" width="7" height="5" rx="2"/></g>'],
};
function botSvg(kind, mood, size) {
  const [body, eyes, back, front = ''] = kinds[kind];
  const face = eyes.map(([x, y]) => mood === 'unread' ? `<path class="bot-line" d="M${x - 2.4} ${y + 1}q2.4 -3.6 4.8 0"/>`
    : `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="2.1" ry="2.9"/><circle class="bot-shine" cx="${x + .7}" cy="${y - 1.1}" r=".7"/>`).join('');
  const badge = mood === 'waiting' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>' : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look">${face}</g></g>${front}</g>${badge}</svg>`;
}
function bot(kind, mood, size) {
  const node = el('span', '', 'bot personality-bot'); node.dataset.kind = kind; node.dataset.mood = mood; node.innerHTML = botSvg(kind, mood, size); return node;
}

// Sample data shaped like the real check-ins on 13 Nov.
const sessions = {
  aws: { kind: 'zig', title: 'Run AWS SSO login in next-frontend', short: 'AWS sign-in' },
  review: { kind: 'bun', title: 'Review PZ-947 and PZ-948 staff exclusion', short: 'PZ-947 review' },
  icon: { kind: 'pip', title: 'Restore the Codemode slash icon', short: 'Codemode icon' },
  go: { kind: 'mochi', title: 'Upgrade Go to 1.25 in backend-go', short: 'Go 1.25' },
  parity: { kind: 'sprout', title: 'Switch the PZ-948 dashboard to the new exclusion', short: 'PZ-948 dashboard', viaMiso: true },
  // Miso's own cross-session advice, not a session.
  miso: { kind: 'miso', title: 'Heads-up from Miso', short: 'Heads-up' },
};
const script = [
  { type: 'checkin', at: '7:24', lead: 'AWS sign-in needs you. The staff exclusion review is done.', items: [
    { s: 'aws', state: 'needs', line: 'May it try your primezero.au Chrome profile?', options: ['Use it', 'Not that one'],
      detail: 'The murphy profile still needs sign-in. Phone-code login won’t work because the callback must return to the Mac. No credentials entered.' },
    { s: 'review', state: 'done', line: 'Backend matches both tickets. Focused tests pass.', flag: 'PZ-948 dashboard acceptance is still open',
      detail: 'The dashboard still writes excludedPermanent directly. No decision requested.' }] },
  { type: 'checkin', at: '7:31', lead: 'AWS sign-in moved on. It needs you to finish in Chrome.', items: [
    { s: 'aws', state: 'needs', line: 'Finish sign-in with the private Chrome link, then reply “done”.', options: ['Done'],
      detail: 'The link lasts about 12 minutes. Keep it private.' }] },
  { type: 'me', text: 'What’s still open on PZ-948?' },
  { type: 'miso', text: 'Only dashboard parity: the dashboard writes excludedPermanent directly instead of using the new exclusion. I can start a session for it.' },
  { type: 'checkin', at: '8:36', lead: 'Two sessions finished. I drafted a fix for Go and proposed a PZ-948 session.', items: [
    { s: 'icon', state: 'done', line: 'Restored / beside Codemode. Pushed and tunnel-verified.' },
    { s: 'go', state: 'done', line: 'CI passes. Two deprecation warnings left.', draft: 'Fix the two deprecation warnings, then rerun CI and tell me the result.' },
    { s: 'parity', state: 'propose', line: 'Proposed new session in pz-882-referral.', project: 'pz-882-referral',
      start: 'Make the staff dashboard use the new exclusion instead of writing excludedPermanent, then run the dashboard tests.' },
    { s: 'miso', state: 'advice', line: 'Codemode icon and another pi-remote session both edit web/style.css. Push one before the other commits.' }] },
  { type: 'checkin', at: '9:02', lead: 'AWS sign-in finished. Nothing else needs you.', items: [
    { s: 'aws', state: 'done', line: 'Signed in. The murphy profile is saved for next time.' },
    { s: 'parity', state: 'working', line: 'Started by Miso. Reading the dashboard write path.', after: 'start' }] },
];
const variants = {
  digest: 'Each check-in is one compact card: Miso’s one-line lead, then one row per session. Older cards fold to their lead unless something in them still needs you.',
  threads: 'Each session appears once. A new update replaces its row and moves it down, with earlier updates folded inside. No repeated narration.',
  inbox: 'What needs you is pinned above the chat and answered there. Check-ins become single lines in the chat you can expand.',
  since: 'No check-in messages at all. One “Since you looked” summary updates in place: what needs you, then what changed. Mark it seen to clear it.',
  mentions: 'Miso still talks, but each session is a tappable chip inside the sentence. Tap a chip to open its actions and details right there.',
  avatars: 'Your sessions sit in a strip under the header, like contacts. A badge means it needs you; tap one to see its latest update. The chat keeps only Miso’s one-liners.',
  focus: 'One thing at a time. A single card at the bottom walks through what needs you; everything else is a quiet one-line history above it.',
};
let variant, shown, answers, sent, opened, toastTimer, seenAt, expanded, selected, focusIndex;

// Follow-ups to a proposal exist only if you approved it.
const proposal = item => script.flatMap(entry => entry.items || []).find(other => other.s === item.s && other.start);
const visibleScript = () => script.slice(0, shown).map(entry => entry.items ? { ...entry, items: entry.items.filter(item => !item.after || sent.has(proposal(item))) } : entry);
const checkins = () => visibleScript().filter(entry => entry.type === 'checkin');
function latestBySession() {
  const latest = new Map();
  for (const checkin of checkins()) for (const item of checkin.items) latest.set(item.s, { item, at: checkin.at });
  return latest;
}
const live = item => latestBySession().get(item.s)?.item === item && item.options && !answers.has(item);
const pendingDraft = item => (item.draft || item.start) && !sent.has(item) && !answers.has(item);
const needsYou = () => [...latestBySession().values()].filter(({ item }) => live(item) || pendingDraft(item));

function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600);
}

// One session row: identity, state, one line, and any action that still applies.
function row(item, { actions = true, older = [] } = {}) {
  const session = sessions[item.s], isLive = live(item), superseded = item.options && !isLive && !answers.has(item);
  const state = isLive ? 'Needs you' : item.start ? (pendingDraft(item) ? 'Approve?' : sent.has(item) ? 'Started' : 'Not now')
    : answers.has(item) ? 'Answered' : superseded ? 'Replaced' : pendingDraft(item) ? 'Draft ready'
    : item.state === 'advice' ? 'Heads-up' : item.state === 'working' ? 'Working' : 'Done';
  const node = el('div', '', 'row');
  node.dataset.state = isLive || pendingDraft(item) ? 'needs' : superseded ? 'past' : ['advice', 'working'].includes(item.state) ? item.state : 'done';
  const title = el('button', '', 'row-title'); title.type = 'button';
  title.append(el('span', session.title, 'row-name'), ...(session.viaMiso ? [el('span', 'via Miso', 'row-via')] : []), el('span', state, 'row-state'));
  title.addEventListener('click', () => toast(`Would open “${session.title}”.`));
  const body = el('div', '', 'row-body');
  body.append(title, el('p', answers.has(item) ? `${item.line} You: ${answers.get(item)}` : item.line, 'row-line'));
  if (item.flag) body.append(el('p', item.flag, 'row-flag'));
  body.append(...extras(item, actions, older));
  node.append(bot(session.kind, isLive ? 'waiting' : item.state === 'working' ? 'working' : superseded || pendingDraft(item) ? 'idle' : 'unread', 28), body);
  return node;
}
// The parts of a row that act or explain: answer options, a draft, details and earlier updates.
function extras(item, actions = true, older = []) {
  const nodes = [], session = sessions[item.s];
  if (actions && live(item)) {
    const options = el('div', '', 'options');
    for (const option of item.options) {
      const button = el('button', option, 'option'); button.type = 'button';
      button.addEventListener('click', () => { answers.set(item, option); toast(`Sent “${option}” to ${session.title}.`); render(); });
      options.append(button);
    }
    nodes.push(options);
  } else if (live(item)) nodes.push(el('p', 'Answer above.', 'row-hint'));
  if (item.draft || item.start) nodes.push(draft(item, actions));
  if (item.detail || older.length) {
    const more = el('details', '', 'row-more'), list = el('div');
    more.append(el('summary', older.length ? `${older.length} earlier ${older.length === 1 ? 'update' : 'updates'}` : 'Details'), list);
    if (item.detail) list.append(el('p', item.detail));
    for (const earlier of older) list.append(el('p', `${earlier.at} · ${earlier.item.line}`, 'row-earlier'));
    keepOpen(more, 'more:' + item.s + item.line);
    nodes.push(more);
  }
  return nodes;
}
function draft(item, actions) {
  const box = el('div', '', 'draft');
  // A proposed session is approved exactly like a draft message.
  const starting = !!item.start;
  box.append(el('small', starting ? `New session · ${item.project}` : 'Draft to this session'), el('p', item.start || item.draft));
  if (sent.has(item)) box.append(el('small', starting ? 'Started · Miso will report back' : 'Sent · waiting for its reply', 'draft-state'));
  else if (answers.has(item)) box.append(el('small', 'Not started', 'draft-state'));
  else if (actions) {
    const bar = el('div', '', 'draft-actions'), edit = el('button', starting ? 'Not now' : 'Edit', 'quiet'), send = el('button', starting ? 'Start session' : 'Send', 'send-text');
    edit.type = send.type = 'button';
    edit.addEventListener('click', () => { if (!starting) return toast('Prototype: Edit opens the text for changes.'); answers.set(item, 'Not now'); render(); });
    send.addEventListener('click', () => { sent.add(item); toast(starting ? 'Started a new session in pz-882-referral.' : `Sent to ${sessions[item.s].title}.`); render(); });
    bar.append(edit, send); box.append(bar);
  } else box.append(el('small', 'Review above', 'draft-state'));
  return box;
}
function keepOpen(details, key, fallback = false) {
  details.open = opened.has(key) ? opened.get(key) : fallback;
  details.addEventListener('toggle', () => opened.set(key, details.open));
}
const say = text => el('p', text, 'miso-say');
const me = text => el('p', text, 'me');
const chat = entry => entry.type === 'me' ? me(entry.text) : say(entry.text);

function renderDigest(log) {
  const visible = visibleScript(), last = visible.findLastIndex(entry => entry.type === 'checkin');
  for (const [index, entry] of visible.entries()) {
    if (entry.type !== 'checkin') { log.append(chat(entry)); continue; }
    const card = el('details', '', 'digest'), summary = el('summary');
    summary.append(el('time', entry.at), el('span', entry.lead, 'lead'));
    card.append(summary, ...entry.items.map(item => row(item)));
    // Never fold away something that still needs an answer.
    keepOpen(card, 'digest:' + entry.at, index === last || entry.items.some(item => live(item) || pendingDraft(item)));
    log.append(card);
  }
}
function renderThreads(log) {
  const visible = visibleScript(), history = new Map(), lastAt = new Map();
  for (const [index, entry] of visible.entries()) if (entry.type === 'checkin') for (const item of entry.items) {
    history.set(item.s, [...(history.get(item.s) || []), { item, at: entry.at }]); lastAt.set(item.s, index);
  }
  const last = visible.findLastIndex(entry => entry.type === 'checkin');
  for (const [index, entry] of visible.entries()) {
    if (entry.type !== 'checkin') { log.append(chat(entry)); continue; }
    const here = entry.items.filter(item => lastAt.get(item.s) === index);
    if (!here.length) continue;
    log.append(index === last ? say(entry.lead) : el('p', entry.at, 'divider'));
    const group = el('div', '', 'thread-group');
    for (const item of here) group.append(row(item, { older: history.get(item.s).slice(0, -1).reverse() }));
    log.append(group);
  }
}
function renderInbox(log) {
  const waiting = needsYou(), inbox = $('inbox');
  inbox.hidden = !waiting.length;
  inbox.replaceChildren(...(waiting.length ? [el('h2', `Needs you · ${waiting.length}`), ...waiting.map(({ item }) => row(item))] : []));
  for (const entry of visibleScript()) {
    if (entry.type !== 'checkin') { log.append(chat(entry)); continue; }
    const line = el('details', '', 'logline'), summary = el('summary');
    summary.append(el('time', entry.at), el('span', entry.lead, 'lead'));
    line.append(summary, ...entry.items.map(item => row(item, { actions: false })));
    keepOpen(line, 'line:' + entry.at);
    log.append(line);
  }
}

const visibleCheckins = from => visibleScript().slice(from).filter(entry => entry.type === 'checkin');
function sessionHistory() {
  const history = new Map();
  for (const checkin of checkins()) for (const item of checkin.items) history.set(item.s, [...(history.get(item.s) || []), { item, at: checkin.at }]);
  return history;
}
const quietLine = entry => { const line = el('p', '', 'quiet-line'); line.append(el('time', entry.at), el('span', entry.lead)); return line; };

function renderSince(log) {
  for (const entry of visibleScript()) if (entry.type !== 'checkin') log.append(chat(entry));
  const fresh = visibleCheckins(seenAt), card = el('section', '', 'since');
  if (!fresh.length) {
    card.append(el('p', `You’re caught up. Nothing new since ${checkins().at(-1).at}.`, 'since-clear'));
    log.append(card); return;
  }
  const latest = new Map();
  for (const checkin of fresh) for (const item of checkin.items) latest.set(item.s, item);
  const items = [...latest.values()], need = items.filter(item => live(item) || pendingDraft(item)), rest = items.filter(item => !need.includes(item));
  const head = el('div', '', 'since-head'), clear = el('button', 'Mark seen', 'quiet'); clear.type = 'button';
  clear.addEventListener('click', () => { seenAt = shown; render(); });
  head.append(el('h2', `Since you looked · ${fresh[0].at}`), clear);
  card.append(head);
  if (need.length) card.append(el('h3', 'Needs you'), ...need.map(item => row(item)));
  if (rest.length) card.append(el('h3', 'Changed'), ...rest.map(item => row(item)));
  log.append(card);
}
function renderMentions(log) {
  for (const entry of visibleScript()) {
    if (entry.type !== 'checkin') { log.append(chat(entry)); continue; }
    const block = el('div', '', 'mention-block');
    block.append(el('time', entry.at));
    for (const item of entry.items) {
      const session = sessions[item.s], superseded = item.options && !live(item) && !answers.has(item);
      const line = el('p', '', 'mention-line' + (superseded ? ' past' : '')), chip = el('button', '', 'mention'); chip.type = 'button';
      const needs = live(item) || pendingDraft(item), key = entry.at + item.s;
      chip.dataset.needs = String(needs);
      chip.append(bot(session.kind, live(item) ? 'waiting' : 'unread', 18), el('span', session.short));
      chip.setAttribute('aria-expanded', String(needs || expanded.has(key)));
      chip.addEventListener('click', () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); });
      line.append(chip, ' ', answers.has(item) ? `${item.line} You: ${answers.get(item)}` : item.line);
      block.append(line);
      if (needs || expanded.has(key)) {
        const more = el('div', '', 'mention-more'), open = el('button', 'Open session', 'quiet'); open.type = 'button';
        open.addEventListener('click', () => toast(`Would open “${session.title}”.`));
        more.append(...extras(item), open); block.append(more);
      }
    }
    log.append(block);
  }
}
function renderAvatars(log) {
  // Sessions that need you come first, then the most recently updated.
  const history = sessionHistory(), needs = id => { const { item } = history.get(id).at(-1); return live(item) || pendingDraft(item); };
  const recent = [...history.keys()].reverse().filter(id => id !== 'miso'), order = [...recent.filter(needs), ...recent.filter(id => !needs(id))];
  const strip = el('div', '', 'faces');
  for (const id of order) {
    const { item } = history.get(id).at(-1), session = sessions[id], needs = live(item) || pendingDraft(item);
    const face = el('button', '', 'face'); face.type = 'button'; face.dataset.needs = String(needs);
    face.setAttribute('aria-pressed', String(selected === id));
    face.append(bot(session.kind, live(item) ? 'waiting' : needs ? 'idle' : 'unread', 40), el('span', session.short));
    face.addEventListener('click', () => { selected = selected === id ? undefined : id; render(); });
    strip.append(face);
  }
  const top = $('inbox'); top.hidden = false; top.className = 'faces-bar';
  top.replaceChildren(strip);
  if (selected) top.append(row(history.get(selected).at(-1).item, { older: history.get(selected).slice(0, -1).reverse() }));
  for (const entry of visibleScript()) log.append(entry.type === 'checkin' ? quietLine(entry) : chat(entry));
}
function renderFocus(log) {
  for (const entry of visibleScript()) log.append(entry.type === 'checkin' ? quietLine(entry) : chat(entry));
  const queue = needsYou(), card = el('section', '', 'focus');
  if (!queue.length) {
    card.append(el('h2', 'Nothing needs you'), el('p', `${checkins().reduce((sum, checkin) => sum + checkin.items.filter(item => item.state === 'done').length, 0)} updates since 7:24 are in the history above.`, 'row-hint'));
  } else {
    focusIndex = Math.min(focusIndex, queue.length - 1);
    const head = el('div', '', 'focus-head'), prev = el('button', 'Previous', 'quiet'), next = el('button', 'Next', 'quiet');
    prev.type = next.type = 'button'; prev.disabled = focusIndex === 0; next.disabled = focusIndex === queue.length - 1;
    prev.addEventListener('click', () => { focusIndex--; render(); }); next.addEventListener('click', () => { focusIndex++; render(); });
    head.append(el('h2', `${focusIndex + 1} of ${queue.length} need you`), prev, next);
    card.append(head, row(queue[focusIndex].item));
  }
  log.append(card);
}

function render({ scroll = false } = {}) {
  const n = needsYou().length;
  $('top-bot').dataset.mood = n ? 'waiting' : 'idle'; $('top-bot').innerHTML = botSvg('miso', n ? 'waiting' : 'idle', 30);
  $('top-sub').textContent = n ? `${n} ${n === 1 ? 'needs' : 'need'} you` : 'Watching 21';
  $('inbox').hidden = true; $('inbox').className = 'inbox';
  const log = $('log'); log.replaceChildren();
  ({ digest: renderDigest, threads: renderThreads, inbox: renderInbox, since: renderSince, mentions: renderMentions, avatars: renderAvatars, focus: renderFocus })[variant](log);
  $('next').disabled = shown >= script.length;
  if (scroll) requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
}
function setVariant(next) {
  variant = variants[next] ? next : 'digest';
  for (const tab of document.querySelectorAll('[data-variant]')) tab.setAttribute('aria-selected', tab.dataset.variant === variant);
  $('variant-note').textContent = variants[variant];
  history.replaceState(null, '', `?variant=${variant}`);
  shown = script.length - 1; answers = new Map(); sent = new Set(); opened = new Map();
  seenAt = 0; expanded = new Set(); selected = undefined; focusIndex = 0;
  render({ scroll: true });
}

$('next').addEventListener('click', () => { shown = Math.min(script.length, shown + 1); render({ scroll: true }); });
$('restart').addEventListener('click', () => setVariant(variant));
$('theme').addEventListener('click', () => {
  const root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
});
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('input').value.trim();
  if (!text) return;
  $('input').value = ''; $('log').append(me(text), say('Prototype: try the rows above.'));
  window.scrollTo({ top: document.body.scrollHeight });
});
for (const tab of document.querySelectorAll('[data-variant]')) tab.addEventListener('click', () => setVariant(tab.dataset.variant));
setVariant(new URLSearchParams(location.search).get('variant'));
