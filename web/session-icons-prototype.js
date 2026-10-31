// Throwaway: a cast of session bots and their animations, with sample sessions only.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
const star = (x, y, r) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;

// Same construction as the app: [label, title verbs, body, eyes [x, y, scale], behind body, in front, shown only while working].
const kinds = {
  review: ['Review', 'review, re-review', '<rect x="4" y="7" width="24" height="21" rx="7"/>', [[11.5, 17], [20.5, 17]], '',
    '<g class="bot-frame"><circle cx="11.5" cy="17" r="4.6"/><circle cx="20.5" cy="17" r="4.6"/></g>',
    '<path class="bot-glint" d="M9.3 16.2l3.4-3.4M18.3 16.2l3.4-3.4"/>'],
  fix: ['Fix', 'fix, debug, diagnose', '<circle cx="16" cy="19" r="11"/>', [[11.5, 19], [20.5, 19]],
    '<g class="bot-antenna"><path class="bot-stalk" d="M11 9 8 3.5"/><circle class="bot-body" cx="8" cy="3.5" r="2"/></g><g class="bot-antenna bot-right"><path class="bot-stalk" d="M21 9l3-5.5"/><circle class="bot-body" cx="24" cy="3.5" r="2"/></g>', '',
    '<path class="bot-spark" d="M4.5 1.5 3 0M5 5H3M27.5 1.5 29 0M27 5h2"/>'],
  research: ['Research', 'investigate, check, find', '<rect x="6" y="4" width="20" height="25" rx="10"/>', [[16, 15, 1.7]], '', '',
    '<circle class="bot-scan" cx="16" cy="15" r="5.5"/>'],
  build: ['Build', 'add, build, improve', '<rect x="4" y="11" width="24" height="18" rx="6"/>', [[11.5, 20], [20.5, 20]], '',
    '<path class="bot-accent" d="M7 12a9 8 0 0 1 18 0ZM4.5 11h23a1.5 1.5 0 0 1 0 3h-23a1.5 1.5 0 0 1 0-3Z"/>',
    '<g class="bot-hammer"><path class="bot-handle" d="M28 28 31 18"/><rect class="bot-accent" x="27" y="14" width="7.5" height="4.2" rx="1" transform="rotate(18 30.7 16)"/></g>'],
  idea: ['Idea', 'prototype, propose, plan', '<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]],
    '<path class="bot-stalk" d="M16 10V6.5"/><circle class="bot-bulb" cx="16" cy="4.5" r="3"/>', '',
    '<path class="bot-rays" d="M16-1.2v-1.6M11.3.6l-1.1-1.1M20.7.6l1.1-1.1M10 4.5H8.4M22 4.5h1.6"/>'],
  notes: ['Notes', 'write, draft, document', '<rect x="5" y="8" width="22" height="20" rx="6"/>', [[11.5, 18], [20.5, 18]], '',
    '<ellipse class="bot-accent" cx="14" cy="8.5" rx="10" ry="3.6" transform="rotate(-8 14 8.5)"/><circle class="bot-accent" cx="10" cy="5.2" r="1.6"/>',
    '<path class="bot-scribble" d="M7 31.5q2-2.4 4 0t4 0 4 0 4 0"/><g class="bot-pencil"><path class="bot-pencil-body" d="m24 30 6.5-6.5 2 2L26 32l-2.6.6Z"/></g>'],
  test: ['Test', 'test, verify', '<path d="M12 3h8a1 1 0 0 1 0 2h-1v6.5l7.6 12.6A3 3 0 0 1 24 28.5H8a3 3 0 0 1-2.6-4.4L13 11.5V5h-1a1 1 0 0 1 0-2Z"/>', [[13.5, 18, .85], [18.5, 18, .85]], '',
    '<path class="bot-accent" d="M6.6 22.5h18.8l1.2 2a2.6 2.6 0 0 1-2.3 3.9H7.7a2.6 2.6 0 0 1-2.3-3.9Z"/>',
    '<g class="bot-bubbles"><circle cx="15" cy="1.5" r="1.4"/><circle cx="17.8" cy="0" r="1"/><circle cx="16" cy="-2" r=".8"/></g>'],
  ship: ['Ship', 'deploy, release, submit', '<path d="M16 3c5.5 3.2 8.5 8.5 8.5 14.5V24a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-6.5C7.5 11.5 10.5 6.2 16 3Z"/>', [[12.8, 16, .85], [19.2, 16, .85]],
    '<path class="bot-accent" d="M8.5 17 4 22.5V27l4.5-2.5ZM23.5 17l4.5 5.5V27l-4.5-2.5Z"/>', '',
    '<g class="bot-flame"><path class="bot-flame-out" d="M11.5 27h9c0 3.2-2.2 5.8-4.5 7-2.3-1.2-4.5-3.8-4.5-7Z"/><path class="bot-flame-in" d="M13.5 27h5c0 1.8-1.2 3.3-2.5 4-1.3-.7-2.5-2.2-2.5-4Z"/></g>'],
  tidy: ['Tidy', 'refactor, clean, simplify', '<circle cx="16" cy="19" r="10.5"/>', [[12, 19], [20, 19]], '',
    `<path class="bot-accent" d="M8 14.5c1.5-5.5 6.5-8 11.5-6.5 2.4.7 4.2 2.3 5 4.4-4.6-1.8-10.4-1.4-16.5 2.1Z"/><path class="bot-star" d="${star(26, 7, 2.6)}"/>`,
    `<path class="bot-sparkle" d="${star(4.5, 9, 3)}"/><path class="bot-sparkle" d="${star(29, 15, 2.4)}"/><path class="bot-sparkle" d="${star(6, 27, 2)}"/>`],
  data: ['Data', 'migrate, query, backup', '<path d="M6 8c0-1.9 4.5-3.5 10-3.5S26 6.1 26 8v16.5c0 1.9-4.5 3.5-10 3.5S6 26.4 6 24.5Z"/>', [[12.5, 21.5, .9], [19.5, 21.5, .9]], '',
    '<ellipse class="bot-accent" cx="16" cy="8" rx="10" ry="3.5"/><path class="bot-band" d="M6 14.5c0 2 4.5 3.6 10 3.6s10-1.6 10-3.6"/>',
    '<ellipse class="bot-spin" cx="16" cy="8" rx="6.5" ry="2"/>'],
  guard: ['Guard', 'secure, harden, protect', '<path d="M16 3.5 26.5 7v8.5C26.5 22 22 26.5 16 28.5 10 26.5 5.5 22 5.5 15.5V7Z"/>', [[12, 15], [20, 15]], '',
    '<path class="bot-chevron" d="m12 21.5 4 2.5 4-2.5"/>',
    '<path class="bot-pulse" d="M16 3.5 26.5 7v8.5C26.5 22 22 26.5 16 28.5 10 26.5 5.5 22 5.5 15.5V7Z"/>'],
  chat: ['Chat', 'greet, ask, answer', '<path d="M6 6h20a3.5 3.5 0 0 1 3.5 3.5v11A3.5 3.5 0 0 1 26 24H15l-6 5v-5H6a3.5 3.5 0 0 1-3.5-3.5v-11A3.5 3.5 0 0 1 6 6Z"/>', [[12, 13.5], [20, 13.5]], '', '',
    '<g class="bot-typing"><circle cx="12" cy="19.5" r="1.3"/><circle cx="16" cy="19.5" r="1.3"/><circle cx="20" cy="19.5" r="1.3"/></g>'],
  design: ['Design', 'design, style, polish', '<rect x="5" y="9" width="22" height="19" rx="7"/>', [[11.5, 18.5], [20.5, 18.5]],
    '<g class="bot-swatches"><rect x="7" y="3.5" width="5" height="9" rx="2.5" fill="#ff6b9a"/><rect x="13.5" y="2" width="5" height="10" rx="2.5" fill="#ffd84d"/><rect x="20" y="3.5" width="5" height="9" rx="2.5" fill="#5fb3ff"/></g>', '', ''],
  ops: ['Ops', 'restart, configure, set up', '<rect x="5" y="9" width="22" height="19" rx="7"/>', [[11.5, 18.5], [20.5, 18.5]],
    '<path class="bot-headset" d="M6 17v-3a10 10 0 0 1 20 0v3"/>',
    '<rect class="bot-accent" x="2.5" y="14.5" width="4.5" height="7" rx="2"/><rect class="bot-accent" x="25" y="14.5" width="4.5" height="7" rx="2"/><path class="bot-headset" d="M27 21.5c0 3.8-2.8 5.8-6.5 5.8"/><circle class="bot-accent" cx="20" cy="27.3" r="1.5"/>',
    '<g class="bot-gear"><circle class="bot-gear-teeth" cx="4" cy="4.5" r="2.6"/><circle class="bot-gear-hole" cx="4" cy="4.5" r="1"/></g>'],
  general: ['Session', 'anything else', '<rect x="5" y="7" width="22" height="21" rx="8"/>', [[12, 17], [20, 17]], '', '', ''],
};

function botSvg(kind, mood, size) {
  const [, , body, eyes, back, front, work] = kinds[kind];
  const face = eyes.map(([x, y, s = 1]) => mood === 'saved' ? `<path class="bot-line" d="M${x - 2.4 * s} ${y}h${4.8 * s}"/>`
    : mood === 'unread' ? `<path class="bot-line" d="M${x - 2.4 * s} ${y + 1}q${2.4 * s} -${3.6 * s} ${4.8 * s} 0"/>`
    : `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/><circle class="bot-shine" cx="${x + .7 * s}" cy="${y - 1.1 * s}" r="${.7 * s}"/>`).join('');
  const badge = mood === 'waiting' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>'
    : mood === 'unread' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4"/></g>' : '';
  const zz = mood === 'saved' ? '<g class="bot-zz"><text x="24" y="9">z</text><text x="24" y="9">z</text></g>' : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look">${face}</g></g>${front}${mood === 'working' ? work : ''}</g>${badge}${zz}</svg>`;
}
function bot(kind, mood, size) {
  const node = el('span', undefined, 'bot');
  node.dataset.kind = kind; node.dataset.mood = mood;
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${kinds[kind][0]} bot, ${mood}`);
  node.style.setProperty('--bot-blink', `-${Math.round(Math.random() * 6000)}ms`);
  node.innerHTML = botSvg(kind, mood, size);
  return node;
}

// Ways to show the bots in the session list. The page sets data-style; the CSS does the rest.
const styles = [
  { key: 'now', name: 'Today', description: '28px bots in bright pastel, as the app is now', size: 28 },
  { key: 'tile', name: 'A · Avatar tile', description: 'Each bot sits on a soft tinted squircle, like an app icon: one even shape down the column', size: 30 },
  { key: 'muted', name: 'B · Muted colour', description: 'Same size, but softer, lower-saturation colours that sit with the text', size: 28 },
  { key: 'large', name: 'C · Larger and muted', description: '40px muted bots, closer to how they look in the picker', size: 40 },
  { key: 'mono', name: 'D · Quiet until active', description: 'Grey bots at rest; a bot takes its colour only while working, waiting or with a new reply', size: 32 },
];
const sessions = [
  ['research', 'idle', 'Investigate Claude SDK session recovery errors', '', '22h'],
  ['review', 'idle', 'Review architecture of web app.js', '', '1d'],
  ['build', 'idle', 'Add model-independent voice input to composer', '', '2d'],
  ['idea', 'working', 'Session icon auto-assignment is unreliable', 'Pi: Here’s where each part came from…', '4h'],
  ['research', 'unread', 'Investigate stuck working dot animation', 'Pi: Yes. Logging works the same as before…', '20h'],
  ['ship', 'waiting', 'Submit backend-api-sports PR 38 review', 'Pi: Post these 3 comments?', '6h'],
  ['fix', 'saved', 'Fix stuck composer after image sending', 'Pi: Fixed. Only Send appears when you have text.', '2d'],
  ['test', 'idle', 'Test video attachment access', '', '3d'],
  ['chat', 'saved', 'Greet the user', '', '5d'],
];
const stateLabels = { working: 'Working', waiting: 'Needs input' };
let style;

function lead(kind, mood) {
  const node = bot(kind, mood, style.size);
  if (style.key !== 'tile') return node;
  const tile = el('span', undefined, 'bot-tile');
  tile.dataset.kind = kind; tile.dataset.mood = mood; tile.append(node);
  return tile;
}
function row([kind, mood, title, preview, ageText]) {
  const button = el('button', undefined, 'session'), indicators = el('span', undefined, 'session-indicators');
  button.type = 'button';
  indicators.append(lead(kind, mood));
  const body = el('div', undefined, 'session-body'), top = el('div', undefined, 'session-top'), meta = el('div', undefined, 'session-meta');
  top.append(el('strong', title)); body.append(top);
  if (preview) body.append(el('div', preview, 'session-preview'));
  if (stateLabels[mood]) { const label = el('span', stateLabels[mood], 'session-state'); label.dataset.status = mood; meta.append(label); }
  meta.append(el('span', 'pi-remote', 'session-project'), el('time', ageText, 'session-time'));
  body.append(meta);
  button.append(indicators, body);
  return button;
}
function render() {
  $('page').dataset.style = style.key;
  $('label').textContent = style.name;
  $('description').textContent = style.description;
  $('legend').replaceChildren();
  $('list').replaceChildren(...sessions.map(row));
  const url = new URL(location.href); url.searchParams.set('style', style.key); history.replaceState(null, '', url);
}
const set = key => { style = styles.find(item => item.key === key) || styles[1]; render(); };
const cycle = step => set(styles[(styles.indexOf(style) + step + styles.length) % styles.length].key);
$('prev').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
set(new URLSearchParams(location.search).get('style'));
