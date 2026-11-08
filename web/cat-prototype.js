// Throwaway: sample sessions only, nothing here talks to the host.
// Miso is one pinned conversation that can see every session, start new ones for a goal, and message sessions you confirm.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// Copied from app.js sessionKinds/botSvg so the cat and rows use the production artwork and moods.
const kinds = {
  miso: ['<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]],
    '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><g class="character-cat-ear"><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/></g><g class="character-cat-ear character-cat-ear-right"><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/></g>'],
  mochi: ['<path d="M16 10C8 10 2 16 2 23c0 5 6 7 14 7s14-2 14-7c0-7-6-13-14-13Z"/>', [[11.5, 21], [20.5, 21]], ''],
  pip: ['<rect x="5" y="9" width="22" height="20" rx="8"/>', [[12, 19], [20, 19]], '<g class="character-antenna"><path class="bot-stalk" d="M16 10V7l-5-3.5"/><circle class="bot-body" cx="11" cy="3.5" r="2"/></g>'],
  bun: ['<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<g class="character-ear"><rect class="bot-body" x="8" y="2" width="5" height="13" rx="2.5"/></g><g class="character-ear character-ear-right"><rect class="bot-body" x="19" y="4" width="5" height="11" rx="2.5"/></g>'],
  wisp: ['<path d="M16 5C22.6 5 26 10 26 17v7H6v-7C6 10 9.4 5 16 5Z"/>', [[12, 17.5], [20, 17.5]], '', '<path class="bot-body character-tail" d="M6 23h20v4Q24 31 21 27Q18 32 15 28Q12 32 9 28Q6 31 6 27Z"/>'],
  sprout: ['<rect x="4" y="10" width="24" height="19" rx="9"/>', [[12, 19], [20, 19]],
    '<path class="bot-stalk" d="M16 11V6"/><path class="bot-body character-leaf character-leaf-left" d="M16 7C10 7 7 4 8 1c5 0 8 2 8 6Z"/><path class="bot-accent character-leaf character-leaf-right" d="M16 8c0-5 3-7 8-7 0 4-3 7-8 7Z"/>'],
  zig: ['<path d="M16 5q2 0 4 4l8 15q2 5-3 5H7q-5 0-3-5l8-15q2-4 4-4Z"/>', [[12, 21], [20, 21]],
    '<g class="character-zig-foot"><rect class="bot-body" x="7" y="26" width="7" height="5" rx="2"/></g><g class="character-zig-foot character-zig-foot-right"><rect class="bot-body" x="18" y="26" width="7" height="5" rx="2"/></g>'],
  comet: ['<circle cx="19" cy="14" r="9.5"/>', [[16, 13], [23, 13]],
    '<g class="character-comet-tail"><path class="bot-accent" d="M16 17Q8 18 3 29Q14 28 22 21Z"/><path class="bot-body" d="M13 14Q6 16 2 23Q10 23 18 19Z"/><path class="bot-body" d="M20 20Q15 28 9 31Q10 24 16 18Z"/></g>'],
};
function botSvg(kind, mood, size) {
  const [body, eyes, back, front = ''] = kinds[kind];
  const face = eyes.map(([x, y]) => mood === 'saved' ? `<path class="bot-line" d="M${x - 2.4} ${y}h4.8"/>`
    : mood === 'unread' ? `<path class="bot-line" d="M${x - 2.4} ${y + 1}q2.4 -3.6 4.8 0"/>`
    : `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="2.1" ry="2.9"/><circle class="bot-shine" cx="${x + .7}" cy="${y - 1.1}" r=".7"/>`).join('');
  const badge = mood === 'waiting' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>'
    : mood === 'unread' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4"/></g>' : '';
  const zz = mood === 'saved' ? '<g class="bot-zz"><text x="24" y="9">z</text><text x="24" y="9">z</text></g>' : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look">${face}</g></g>${front}</g>${badge}${zz}</svg>`;
}
const moods = { starting: 'idle', working: 'working', waiting: 'waiting', done: 'unread' };
const labels = { starting: 'Starting', working: 'Working', waiting: 'Needs you', done: 'Done' };
function bot(kind, status, size) {
  const node = el('span', '', 'bot personality-bot'); node.dataset.kind = kind; node.dataset.mood = moods[status] ?? status; node.innerHTML = botSvg(kind, node.dataset.mood, size); return node;
}

const goal = 'Launch the one-page checkout with Apple Pay by Friday';
const variants = {
  goal: 'Give Miso a goal. It starts normal sessions, keeps you posted in one place, and asks you only when a session needs you.',
  pinned: 'Same goal, but the sessions Miso started stay pinned above the conversation, like Amp’s thread panel.',
  checkin: 'Miso watches the sessions you already have. Answer their questions here, or confirm a message Miso drafts for one.',
};
let variant, sessions, threads, timers = [], spawned, busy;

function reset() {
  for (const timer of timers) clearTimeout(timer);
  timers = []; spawned = false; busy = false;
  sessions = [
    { id: 'proto', kind: 'pip', status: 'working', title: 'Create detailed JavaScript prototypes without overwhelming users', project: 'pi-remote', age: 'now' },
    { id: 'status', kind: 'mochi', status: 'working', title: 'Improve working status design with best practices', project: 'pi-remote', age: 'now' },
    { id: 'review', kind: 'bun', status: 'waiting', title: 'Review PZ-756 withdrawal-only exclusion', project: 'primezero', age: '25m' },
    { id: 'safari', kind: 'wisp', status: 'done', title: 'Fix login redirect on Safari', project: 'primezero-web', age: '40m' },
    { id: 'go', kind: 'mochi', status: 'done', title: 'Upgrade Go to 1.25 in backend-go', project: 'backend-go', age: '1h' },
  ];
  threads = [
    { id: 'pay', kind: 'sprout', status: 'starting', title: 'Rebuild the payment step', project: 'storefront', age: 'now', line: 'Reading the checkout form' },
    { id: 'apple', kind: 'comet', status: 'starting', title: 'Add Apple Pay to checkout', project: 'storefront', age: 'now', line: 'Reading the payment SDK' },
    { id: 'tests', kind: 'zig', status: 'starting', title: 'Checkout Playwright tests', project: 'storefront', age: 'now', line: 'Waiting for the card form IDs' },
  ];
}
const later = (ms, fn) => { busy = true; timers.push(setTimeout(() => { fn(); render(); }, ms)); };
const all = () => [...(spawned ? threads : []), ...sessions];
const find = id => all().find(item => item.id === id);
function set(id, status, line) { const item = find(id); item.status = status; if (line) item.line = line; render(); }

// Session list behind the sheet: Miso's sessions are ordinary sessions, marked "via Miso".
function row(item) {
  const button = el('button', '', 'mock-row'); button.type = 'button'; button.dataset.id = item.id;
  const text = el('span', '', 'text'), meta = el('small');
  if (item.status !== 'done') meta.append(el('b', labels[item.status]), ' · ');
  meta.append(`${item.project} · ${item.age}`);
  if (threads.includes(item)) meta.append(' · ', el('span', 'via Miso', 'via'));
  text.append(el('strong', item.title), meta);
  button.append(bot(item.kind, item.status, 36), text);
  button.addEventListener('click', () => openSession(item));
  return button;
}
function openSession(item) {
  $('sheet').close();
  for (const node of document.querySelectorAll('.mock-row')) node.toggleAttribute('data-flash', node.dataset.id === item.id);
  $('status').textContent = `Would open “${item.title}”. It is a normal session: you can talk to it directly.`;
}

// One live list of Miso's sessions; every copy re-renders when a status changes.
function threadRow(item) {
  const button = el('button', '', 'thread'); button.type = 'button'; button.dataset.status = item.status;
  const text = el('span', '', 'text'); text.append(el('strong', item.title), el('small', item.line));
  button.append(bot(item.kind, item.status, 24), text, el('span', labels[item.status], 'state'));
  button.addEventListener('click', () => openSession(item));
  return button;
}
function renderThreads() {
  for (const box of document.querySelectorAll('.threads')) box.replaceChildren(...threads.map(threadRow));
  $('strip').hidden = !(variant === 'pinned' && spawned);
  const done = threads.filter(item => item.status === 'done').length;
  $('strip-title').textContent = `Sessions · ${done} of ${threads.length} done`;
}

function needs() { return all().filter(item => item.status === 'waiting').length; }
function render() {
  const n = needs(), working = spawned && threads.some(item => item.status === 'working' || item.status === 'starting');
  const mood = n ? 'waiting' : busy || working ? 'working' : 'idle';
  for (const id of ['cat-bot', 'sheet-bot']) { $(id).dataset.mood = mood; $(id).innerHTML = botSvg('miso', mood, id === 'cat-bot' ? 34 : 36); }
  $('cat-count').hidden = !n; $('cat-count').textContent = n;
  const line = n ? `${n} need${n > 1 ? '' : 's'} you` : working ? `Coordinating ${threads.length} sessions` : `Watching ${all().length} sessions`;
  $('sheet-sub').textContent = line; $('cat').setAttribute('aria-label', `Miso: ${line}`);
  const list = $('list'); list.replaceChildren(el('h3', 'Now'), ...all().map(row));
  renderThreads();
}

// Conversation.
function post(node) { $('log').append(node); node.scrollIntoView({ block: 'end', behavior: 'smooth' }); return node; }
function miso(...children) { const node = el('div', '', 'say'); node.append(...children.map(child => typeof child === 'string' ? el('p', child) : child)); return post(node); }
function me(text) { return post(el('p', text, 'me')); }
function chips(options) {
  const box = el('div', '', 'chips');
  for (const [label, handler] of options) {
    const chip = el('button', label, 'chip'); chip.type = 'button';
    chip.addEventListener('click', () => { if (box.dataset.single !== undefined) { for (const other of box.children) other.disabled = true; chip.dataset.chosen = ''; } handler(label); });
    box.append(chip);
  }
  return box;
}
// A session's question, answerable here. The answer goes to that session as your reply.
function ask(id, question, options, onAnswer) {
  const item = find(id), card = el('div', '', 'question');
  const head = el('div', '', 'question-head'); head.append(bot(item.kind, 'waiting', 20), el('small', item.title));
  const box = chips(options.map(option => [option, answer => { card.dataset.answered = ''; me(answer); set(id, 'working'); miso(`Sent to ${item.title}.`); onAnswer(answer); }]));
  box.dataset.single = '';
  card.append(head, el('p', question), box);
  miso(card);
}

function startGoal(text) {
  me(text); $('input').value = '';
  later(700, () => {
    spawned = true;
    miso('I’ll split this into three sessions in storefront. Payment and Apple Pay start now; tests follow once the card form has IDs.',
      variant === 'pinned' ? el('small', 'Started 3 sessions · pinned above', 'aside') : el('div', '', 'threads'));
  });
  later(1900, () => { set('pay', 'working', 'Adding test IDs to the card form'); set('apple', 'working', 'Checking merchant validation'); });
  later(3200, () => set('tests', 'working', 'Writing the card checkout test'));
  later(4600, () => {
    busy = false; set('apple', 'waiting', 'Needs a merchant ID');
    ask('apple', 'Which merchant ID should Apple Pay use?', ['Sandbox one from .env.example', 'I’ll paste one'], () => {
      later(1400, () => set('apple', 'working', 'Adding the Apple Pay button'));
      later(2600, () => { set('pay', 'done', 'Payment step rebuilt · 14 tests pass'); miso('Rebuild the payment step is done. I told the tests session the new card form IDs.'); });
      later(4600, () => set('apple', 'done', 'Apple Pay works in sandbox'));
      later(6200, () => {
        busy = false; set('tests', 'done', '3 checkout tests pass');
        miso('All three are done. Three commits are ready for review in storefront.', chips([['Review the changes', () => miso('Prototype stops here. The real Miso would open the combined diff.')]]));
      });
    });
  });
}

function startCheckin() {
  const away = el('ul', '', 'plain');
  away.append(el('li', 'Fix login redirect on Safari: fixed and pushed.'), el('li', 'Upgrade Go to 1.25: CI passes, two deprecation warnings left.'));
  miso('While you were away:', away);
  ask('review', 'Post these 3 review comments to the PR?', ['Post them', 'Not yet'], answer => {
    if (answer === 'Post them') later(2200, () => { busy = false; set('review', 'done'); miso('Review PZ-756 reports: posted 3 comments.'); });
    else busy = false;
  });
  miso('Two working sessions both edit web/style.css. Push one before the other commits.');
  miso(chips([['Tell the Go session to fix the warnings', draftOrder], ['What did I do yesterday?', () => miso('Yesterday: 9 sessions. Shipped the Safari login fix and session dot haptics. PZ-756 review is still open.')]]));
}
// Messages to your own sessions are drafts until you confirm.
function draftOrder() {
  const go = find('go'), draft = el('div', '', 'draft');
  const head = el('div', '', 'question-head'); head.append(bot(go.kind, go.status, 20), el('small', `To ${go.title}`));
  const send = el('button', 'Send', 'send'), edit = el('button', 'Edit', 'quiet'), actions = el('div', '', 'actions');
  send.type = edit.type = 'button'; actions.append(edit, send);
  draft.append(head, el('p', 'Fix the two deprecation warnings, then rerun CI and tell me the result.'), actions);
  send.addEventListener('click', () => {
    actions.replaceChildren(el('small', 'Sent'));
    set('go', 'working');
    later(3200, () => { busy = false; set('go', 'done'); miso('Upgrade Go reports: both warnings fixed, CI green.'); });
  });
  miso('Here’s a draft. Nothing is sent until you tap Send.', draft);
}

function setVariant(next) {
  variant = variants[next] ? next : 'goal';
  for (const tab of document.querySelectorAll('[data-variant]')) tab.setAttribute('aria-selected', tab.dataset.variant === variant);
  $('variant-note').textContent = variants[variant]; $('status').textContent = '';
  history.replaceState(null, '', `?variant=${variant}`);
  reset(); $('log').replaceChildren();
  $('input').value = variant === 'checkin' ? '' : goal;
  $('input').placeholder = variant === 'checkin' ? 'Ask Miso…' : 'Give Miso a goal…';
  if (variant === 'checkin') startCheckin();
  else miso('Hi. Tell me what you want done. I’ll start the sessions and come back when something needs you.');
  render();
}

$('composer').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('input').value.trim();
  if (!text) return;
  if (variant !== 'checkin' && !spawned && !busy) return startGoal(text);
  me(text); $('input').value = ''; miso('Prototype: try the buttons above.');
});
$('cat').addEventListener('click', () => { $('sheet').showModal(); $('log').lastElementChild?.scrollIntoView({ block: 'end' }); });
$('sheet-close').addEventListener('click', () => $('sheet').close());
$('restart').addEventListener('click', () => setVariant(variant));
$('theme').addEventListener('click', () => {
  const root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
});
for (const tab of document.querySelectorAll('[data-variant]')) tab.addEventListener('click', () => setVariant(tab.dataset.variant));
setVariant(new URLSearchParams(location.search).get('variant'));
