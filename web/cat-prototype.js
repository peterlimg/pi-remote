// Throwaway: sample sessions only, nothing here talks to the host.
// Miso reads what the session list already has (status, dialog, last reply) plus a one-line memory per session.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// Copied from app.js sessionKinds/botSvg so the cat and rows use the production artwork and moods.
const kinds = {
  miso: ['<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]],
    '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><g class="character-cat-ear"><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/></g><g class="character-cat-ear character-cat-ear-right"><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/></g>'],
  mochi: ['<path d="M16 10C8 10 2 16 2 23c0 5 6 7 14 7s14-2 14-7c0-7-6-13-14-13Z"/>', [[11.5, 21], [20.5, 21]], ''],
  pip: ['<rect x="5" y="9" width="22" height="20" rx="8"/>', [[12, 19], [20, 19]], '<g class="character-antenna"><path class="bot-stalk" d="M16 10V7l-5-3.5"/><circle class="bot-body" cx="11" cy="3.5" r="2"/></g>'],
  sol: ['<circle cx="16" cy="17" r="9"/>', [[12, 17], [20, 17]], '<g class="character-sun-rays"><path d="M16 2v3M16 29v3M1 17h3M28 17h3M5 6l2 2M25 26l2 2M5 28l2-2M25 8l2-2"/></g>'],
  bun: ['<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<g class="character-ear"><rect class="bot-body" x="8" y="2" width="5" height="13" rx="2.5"/></g><g class="character-ear character-ear-right"><rect class="bot-body" x="19" y="4" width="5" height="11" rx="2.5"/></g>'],
  wisp: ['<path d="M16 5C22.6 5 26 10 26 17v7H6v-7C6 10 9.4 5 16 5Z"/>', [[12, 17.5], [20, 17.5]], '', '<path class="bot-body character-tail" d="M6 23h20v4Q24 31 21 27Q18 32 15 28Q12 32 9 28Q6 31 6 27Z"/>'],
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

const sessions = [
  { id: 'proto', kind: 'pip', mood: 'working', title: 'Create detailed JavaScript prototypes without overwhelming users', project: 'pi-remote', age: 'now', running: '12 min',
    memory: 'Building three prototype variants; editing web/style.css.' },
  { id: 'status', kind: 'mochi', mood: 'working', title: 'Improve working status design with best practices', project: 'pi-remote', age: 'now', running: '4 min',
    memory: 'Running Playwright on the status rows; also editing web/style.css.' },
  { id: 'coord', kind: 'sol', mood: 'waiting', title: 'Pi Remote coordinator workspace design', project: 'pi-remote', age: '3m',
    ask: 'Worker asks: keep the task list per session, or one shared list?', memory: 'Two workers running. Paused on a storage decision.' },
  { id: 'review', kind: 'bun', mood: 'waiting', title: 'Review PZ-756 withdrawal-only exclusion', project: 'primezero', age: '25m',
    ask: 'Post these 3 review comments to the PR?', memory: 'Drafted 3 inline comments. Nothing posted yet.' },
  { id: 'safari', kind: 'wisp', mood: 'unread', title: 'Fix login redirect on Safari', project: 'primezero-web', age: '40m',
    done: 'Fixed and pushed. The cookie was SameSite=Strict.', memory: 'Done. Pushed a1c93fe to main; CI running.' },
  { id: 'go', kind: 'mochi', mood: 'unread', title: 'Upgrade Go to 1.25 in backend-go', project: 'backend-go', age: '1h',
    done: 'CI passes. Two deprecation warnings left.', memory: 'Upgrade done. Left 2 deprecation warnings for later.' },
];
const tip = { text: 'Two working sessions both edit web/style.css. Push one before the other starts its commit.', ids: ['proto', 'status'] };
const variants = {
  brief: 'Tap Miso for a short brief: what needs you, what finished, what is still running, and one tip.',
  bubble: 'Miso says one thing at a time above the bar. Tap the bubble to open that session; tap Miso for the next.',
  chat: 'A brief you can talk to. Orders to sessions are drafts you confirm. Shown here as the later step.',
};
let variant = new URLSearchParams(location.search).get('variant') || 'brief', state = 'needs', bubbleIndex = 0, checking = false;

const needs = () => state === 'needs' ? sessions.filter(item => item.mood === 'waiting') : [];
const done = () => state === 'needs' ? sessions.filter(item => item.mood === 'unread') : [];
const running = () => sessions.filter(item => item.mood === 'working');
const mood = item => state === 'quiet' && item.mood !== 'working' ? 'idle' : item.mood;

function catMood() { return checking ? 'working' : needs().length ? 'waiting' : done().length ? 'unread' : 'saved'; }
function catLine() {
  if (checking) return 'Checking your sessions…';
  const n = needs().length, d = done().length;
  if (n) return `${n} session${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} you`;
  if (d) return `${d} finished while you were away`;
  return `All quiet. ${running().length} still working.`;
}

function renderCat() {
  const m = catMood(), n = needs().length;
  $('cat-bot').dataset.mood = m; $('cat-bot').innerHTML = botSvg('miso', m, 34);
  $('sheet-bot').dataset.mood = m; $('sheet-bot').innerHTML = botSvg('miso', m, 40);
  $('cat-count').hidden = !n || checking; $('cat-count').textContent = n;
  $('cat').setAttribute('aria-label', `Miso: ${catLine()}`);
  $('sheet-sub').textContent = catLine();
  renderBubble();
}

function row(item) {
  const button = el('button', '', 'mock-row'); button.type = 'button'; button.dataset.id = item.id;
  const bot = el('span', '', 'bot personality-bot'); bot.dataset.kind = item.kind; bot.dataset.mood = mood(item); bot.innerHTML = botSvg(item.kind, mood(item), 36);
  const text = el('span', '', 'text'), meta = el('small');
  const label = { working: 'Working', waiting: 'Needs input', unread: 'New reply' }[mood(item)];
  if (label) meta.append(el('b', label), ' · ');
  meta.append(`${item.project} · ${item.age}`);
  text.append(el('strong', item.title), meta);
  button.append(bot, text);
  button.addEventListener('click', () => openSession(item));
  return button;
}
function renderList() {
  const list = $('list'); list.replaceChildren(el('h3', 'Now'));
  for (const item of sessions) list.append(row(item));
}
function openSession(item) {
  $('sheet').close();
  for (const node of document.querySelectorAll('.mock-row')) node.toggleAttribute('data-flash', node.dataset.id === item.id);
  $('status').textContent = `Would open “${item.title}”.`;
}

// A: brief sheet.
function card(item, line, action) {
  const node = el('button', '', 'brief-card'); node.type = 'button';
  const bot = el('span', '', 'bot personality-bot'); bot.dataset.kind = item.kind; bot.dataset.mood = mood(item); bot.innerHTML = botSvg(item.kind, mood(item), 28);
  const text = el('span', '', 'text'); text.append(el('strong', item.title), el('span', line));
  node.append(bot, text, el('span', action, 'go'));
  node.addEventListener('click', () => openSession(item));
  return node;
}
function section(title, items, line, action) {
  if (!items.length) return [];
  const block = el('section'); block.append(el('h3', `${title} · ${items.length}`), ...items.map(item => card(item, line(item), action)));
  return [block];
}
function tipBlock() {
  const block = el('section', '', 'tip'); block.append(el('h3', 'Miso noticed'), el('p', tip.text)); return [block];
}
function renderBrief() {
  $('sheet-body').replaceChildren(
    ...section('Needs you', needs(), item => item.ask, 'Answer'),
    ...section('Finished while you were away', done(), item => item.done, 'Open'),
    ...section('Still working', running(), item => `${item.running} · ${item.memory}`, ''),
    ...tipBlock());
  $('sheet-foot').textContent = 'Checked 1 min ago · reads status and last replies only';
}

// C: chat. Messages are the same facts, said by Miso, plus a draft order you must confirm.
function say(...children) { const node = el('div', '', 'say'); node.append(...children); return node; }
function renderChat() {
  const body = $('sheet-body'), items = [];
  const n = needs(), d = done();
  items.push(say(el('p', n.length ? `Hi. ${catLine()}:` : catLine()), ...n.map(item => card(item, item.ask, 'Answer'))));
  if (d.length) { const list = el('ul', '', 'plain'); list.append(...d.map(item => el('li', `${item.title}: ${item.done}`))); items.push(say(el('p', 'While you were away:'), list)); }
  items.push(say(el('p', tip.text)));
  const chips = el('div', '', 'chips');
  for (const [label, handler] of [['What did I do yesterday?', () => reply('Yesterday: 9 sessions. Shipped Safari login fix and session dots haptics; PZ-756 review still open.')],
    ['Tell the Go session to fix the warnings', draftOrder], ['Remind me at 9am', () => reply('Okay. I will bring this brief back at 9:00.')]]) {
    const chip = el('button', label, 'chip'); chip.type = 'button'; chip.addEventListener('click', handler); chips.append(chip);
  }
  body.replaceChildren(...items, chips);
  const form = el('form', '', 'ask'); const input = el('input'); input.placeholder = 'Ask Miso…'; input.disabled = true;
  form.append(input); $('sheet-foot').replaceChildren(form);
}
function reply(text) { $('sheet-body').append(say(el('p', text))); $('sheet-body').lastChild.scrollIntoView({ block: 'end' }); }
function draftOrder() {
  const go = sessions.find(item => item.id === 'go');
  const draft = el('div', '', 'draft');
  draft.append(el('small', `Send to “${go.title}”`), el('p', 'Fix the two deprecation warnings, then rerun CI and tell me the result.'));
  const send = el('button', 'Send', 'send'), edit = el('button', 'Edit', 'quiet');
  send.type = edit.type = 'button';
  send.addEventListener('click', () => { draft.replaceChildren(el('small', 'Sent · Miso will report back when it finishes')); });
  const actions = el('div', '', 'actions'); actions.append(edit, send); draft.append(actions);
  $('sheet-body').append(say(el('p', 'Draft order. Nothing is sent until you tap Send.'), draft));
  $('sheet-body').lastChild.scrollIntoView({ block: 'end' });
}

// B: one line at a time above the bar.
function bubbleItems() {
  return [...needs().map(item => ({ item, text: `${item.title}: ${item.ask}` })),
    ...done().map(item => ({ item, text: `${item.title}: ${item.done}` })),
    { item: sessions.find(item => item.id === tip.ids[0]), text: tip.text }];
}
function renderBubble() {
  const show = variant === 'bubble' && !checking && !$('bubble').dataset.dismissed;
  $('bubble').hidden = !show;
  if (!show) return;
  const list = bubbleItems(), entry = list[bubbleIndex % list.length];
  $('bubble-open').textContent = entry.text;
  $('bubble-open').onclick = () => openSession(entry.item);
  $('bubble').dataset.kind = entry.item.mood;
}

function openSheet() {
  if (variant === 'bubble') { delete $('bubble').dataset.dismissed; bubbleIndex++; renderBubble(); return; }
  variant === 'chat' ? renderChat() : renderBrief();
  $('sheet').showModal();
}
// The real bot checks on a timer; here "Check now" and page load stand in for that.
function recheck() {
  checking = true; renderCat();
  setTimeout(() => { checking = false; renderCat(); }, 1600);
}
function setVariant(next) {
  variant = next;
  for (const tab of document.querySelectorAll('[data-variant]')) tab.setAttribute('aria-selected', tab.dataset.variant === variant);
  $('variant-note').textContent = variants[variant];
  history.replaceState(null, '', `?variant=${variant}`);
  delete $('bubble').dataset.dismissed; renderCat();
}

$('cat').addEventListener('click', openSheet);
$('sheet-close').addEventListener('click', () => $('sheet').close());
$('sheet').addEventListener('click', event => { if (event.target === $('sheet')) $('sheet').close(); });
$('bubble-close').addEventListener('click', () => { $('bubble').dataset.dismissed = ''; renderBubble(); });
$('recheck').addEventListener('click', recheck);
$('theme').addEventListener('click', () => {
  const root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
});
for (const tab of document.querySelectorAll('[data-variant]')) tab.addEventListener('click', () => setVariant(tab.dataset.variant));
for (const button of document.querySelectorAll('[data-state]')) button.addEventListener('click', () => { state = button.dataset.state; renderList(); renderCat(); });
renderList(); setVariant(variants[variant] ? variant : 'brief'); recheck();
