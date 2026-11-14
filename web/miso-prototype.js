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
  aws: { kind: 'zig', title: 'Run AWS SSO login in next-frontend' },
  review: { kind: 'bun', title: 'Review PZ-947 and PZ-948 staff exclusion' },
  icon: { kind: 'pip', title: 'Restore the Codemode slash icon' },
  go: { kind: 'mochi', title: 'Upgrade Go to 1.25 in backend-go' },
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
  { type: 'miso', text: 'Only dashboard parity: the dashboard writes excludedPermanent directly instead of using the new exclusion. Want me to draft a note to the review session?' },
  { type: 'checkin', at: '8:36', lead: 'Two sessions finished. Go left two warnings, so I drafted a fix.', items: [
    { s: 'icon', state: 'done', line: 'Restored / beside Codemode. Pushed and tunnel-verified.' },
    { s: 'go', state: 'done', line: 'CI passes. Two deprecation warnings left.', draft: 'Fix the two deprecation warnings, then rerun CI and tell me the result.' }] },
  { type: 'checkin', at: '9:02', lead: 'AWS sign-in finished. Nothing else needs you.', items: [
    { s: 'aws', state: 'done', line: 'Signed in. The murphy profile is saved for next time.' }] },
];
const variants = {
  digest: 'Each check-in is one compact card: Miso’s one-line lead, then one row per session. Older cards fold to their lead unless something in them still needs you.',
  threads: 'Each session appears once. A new update replaces its row and moves it down, with earlier updates folded inside. No repeated narration.',
  inbox: 'What needs you is pinned above the chat and answered there. Check-ins become single lines in the chat you can expand.',
};
let variant, shown, answers, sent, opened, toastTimer;

const checkins = () => script.slice(0, shown).filter(entry => entry.type === 'checkin');
function latestBySession() {
  const latest = new Map();
  for (const checkin of checkins()) for (const item of checkin.items) latest.set(item.s, { item, at: checkin.at });
  return latest;
}
const live = item => latestBySession().get(item.s)?.item === item && item.options && !answers.has(item);
const pendingDraft = item => item.draft && !sent.has(item);
const needsYou = () => [...latestBySession().values()].filter(({ item }) => live(item) || pendingDraft(item));

function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600);
}

// One session row: identity, state, one line, and any action that still applies.
function row(item, { actions = true, older = [] } = {}) {
  const session = sessions[item.s], isLive = live(item), superseded = item.options && !isLive && !answers.has(item);
  const state = isLive ? 'Needs you' : answers.has(item) ? 'Answered' : superseded ? 'Replaced' : pendingDraft(item) ? 'Draft ready' : 'Done';
  const node = el('div', '', 'row'); node.dataset.state = isLive || pendingDraft(item) ? 'needs' : superseded ? 'past' : 'done';
  const title = el('button', '', 'row-title'); title.type = 'button';
  title.append(el('span', session.title, 'row-name'), el('span', state, 'row-state'));
  title.addEventListener('click', () => toast(`Would open “${session.title}”.`));
  const body = el('div', '', 'row-body');
  body.append(title, el('p', answers.has(item) ? `${item.line} You: ${answers.get(item)}` : item.line, 'row-line'));
  if (item.flag) body.append(el('p', item.flag, 'row-flag'));
  if (actions && isLive) {
    const options = el('div', '', 'options');
    for (const option of item.options) {
      const button = el('button', option, 'option'); button.type = 'button';
      button.addEventListener('click', () => { answers.set(item, option); toast(`Sent “${option}” to ${session.title}.`); render(); });
      options.append(button);
    }
    body.append(options);
  } else if (isLive) body.append(el('p', 'Answer above.', 'row-hint'));
  if (item.draft) body.append(draft(item, actions));
  if (item.detail || older.length) {
    const more = el('details', '', 'row-more'), list = el('div');
    more.append(el('summary', older.length ? `${older.length} earlier ${older.length === 1 ? 'update' : 'updates'}` : 'Details'), list);
    if (item.detail) list.append(el('p', item.detail));
    for (const earlier of older) list.append(el('p', `${earlier.at} · ${earlier.item.line}`, 'row-earlier'));
    keepOpen(more, 'more:' + item.s + item.line);
    body.append(more);
  }
  node.append(bot(session.kind, isLive ? 'waiting' : superseded ? 'idle' : 'unread', 28), body);
  return node;
}
function draft(item, actions) {
  const box = el('div', '', 'draft');
  box.append(el('small', 'Draft to this session'), el('p', item.draft));
  if (sent.has(item)) box.append(el('small', 'Sent · waiting for its reply', 'draft-state'));
  else if (actions) {
    const bar = el('div', '', 'draft-actions'), edit = el('button', 'Edit', 'quiet'), send = el('button', 'Send', 'send-text');
    edit.type = send.type = 'button';
    edit.addEventListener('click', () => toast('Prototype: Edit opens the text for changes.'));
    send.addEventListener('click', () => { sent.add(item); toast(`Sent to ${sessions[item.s].title}.`); render(); });
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
  const visible = script.slice(0, shown), last = visible.findLastIndex(entry => entry.type === 'checkin');
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
  const visible = script.slice(0, shown), history = new Map(), lastAt = new Map();
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
  for (const entry of script.slice(0, shown)) {
    if (entry.type !== 'checkin') { log.append(chat(entry)); continue; }
    const line = el('details', '', 'logline'), summary = el('summary');
    summary.append(el('time', entry.at), el('span', entry.lead, 'lead'));
    line.append(summary, ...entry.items.map(item => row(item, { actions: false })));
    keepOpen(line, 'line:' + entry.at);
    log.append(line);
  }
}

function render({ scroll = false } = {}) {
  const n = needsYou().length;
  $('top-bot').dataset.mood = n ? 'waiting' : 'idle'; $('top-bot').innerHTML = botSvg('miso', n ? 'waiting' : 'idle', 30);
  $('top-sub').textContent = n ? `${n} ${n === 1 ? 'needs' : 'need'} you` : 'Watching 21';
  $('inbox').hidden = true;
  const log = $('log'); log.replaceChildren();
  ({ digest: renderDigest, threads: renderThreads, inbox: renderInbox })[variant](log);
  $('next').disabled = shown >= script.length;
  if (scroll) requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
}
function setVariant(next) {
  variant = variants[next] ? next : 'digest';
  for (const tab of document.querySelectorAll('[data-variant]')) tab.setAttribute('aria-selected', tab.dataset.variant === variant);
  $('variant-note').textContent = variants[variant];
  history.replaceState(null, '', `?variant=${variant}`);
  shown = script.length - 1; answers = new Map(); sent = new Set(); opened = new Map();
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
