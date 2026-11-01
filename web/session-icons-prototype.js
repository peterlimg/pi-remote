// Throwaway: three second-line bot placements with the original status dots. Sample data only.
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


const variants = [
  { key: 'A', name: 'A · Beside project', description: 'Small bot leads the project line. Dots keep the title clear.' },
  { key: 'B', name: 'B · Right of details', description: 'Bot sits at the right of the project line, away from the text.' },
  { key: 'C', name: 'C · Activity line', description: 'Bot gets a second line with its activity. Taller, but easier to read.' },
];
const stateLabels = { idle: 'Ready', saved: 'Saved', working: 'Working', waiting: 'Needs input', unread: 'New reply' };
const jobs = { build: 'Building', review: 'Reviewing', fix: 'Fixing', research: 'Investigating', ship: 'Shipping', idea: 'Thinking', test: 'Testing', design: 'Designing' };
let variant, playing = false, selected = 'review-post';

// The artwork and animation classes match the shipped bots.
function bot(kind, mood, size) {
  const [, , body, eyes, back, front, work] = kinds[kind];
  const face = eyes.map(([x, y, s = 1]) => mood === 'saved' ? `<path class="bot-line" d="M${x - 2.4 * s} ${y}h${4.8 * s}"/>`
    : `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/><circle class="bot-shine" cx="${x + .7 * s}" cy="${y - 1.1 * s}" r="${.7 * s}"/>`).join('');
  const node = el('span', undefined, 'bot');
  node.dataset.kind = kind; node.dataset.mood = mood === 'unread' ? 'idle' : mood;
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${kinds[kind][0]} bot, ${stateLabels[mood].toLowerCase()}`);
  node.style.setProperty('--bot-t', `-${Date.now() % 6000}ms`);
  node.style.setProperty('--bot-blink', `-${Date.now() % 6000}ms`);
  node.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look">${face}</g></g>${front}${mood === 'working' ? work : ''}</g></svg>`;
  return node;
}

// Original statusIcon construction: ring at rest, blue unread dot, bricks while working, hand for input.
function statusIcon(mood) {
  const icon = el('span', undefined, 'session-icon');
  icon.dataset.status = mood === 'unread' ? 'idle' : mood;
  icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', stateLabels[mood]);
  if (mood === 'unread') icon.dataset.unread = '';
  icon.style.setProperty('--block-delay', `-${Date.now() % 900}ms`);
  icon.innerHTML = mood === 'working'
    ? '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3" y="0" width="4" height="4"/><rect x="9" y="0" width="4" height="4"/><rect x="9" y="6" width="4" height="4"/><rect x="9" y="12" width="4" height="4"/><rect x="3" y="12" width="4" height="4"/><rect x="3" y="6" width="4" height="4"/></svg>'
    : mood === 'waiting'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
    : '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
  return icon;
}

const sessions = [
  { id: 'compress', kind: 'build', mood: 'idle', title: 'Compress video with FFmpeg without quality loss', age: '11h', pinned: true },
  { id: 'research', kind: 'research', mood: 'saved', title: 'Investigate Claude SDK session recovery errors', age: '2d', pinned: true },
  { id: 'architecture', kind: 'review', mood: 'idle', title: 'Review architecture of web app.js', age: '2d', pinned: true },
  { id: 'review-post', kind: 'review', mood: 'working', title: 'Review X post for Pi remote improvements', preview: 'Pi: Checking the wording against the latest changes…', age: 'now' },
  { id: 'fix-model', kind: 'fix', mood: 'working', title: 'Fix model selection issue', preview: 'You: Keep the compact toolbar on the phone.', age: 'now' },
  { id: 'release', kind: 'ship', mood: 'waiting', title: 'Ship the mobile navigation fixes', preview: 'Pi: Ready to publish. Should I go ahead?', age: '6h' },
  { id: 'ideas', kind: 'idea', mood: 'unread', title: 'Prototype session pane improvements', preview: 'Pi: Three options are ready to compare.', age: '10h' },
  { id: 'video', kind: 'test', mood: 'saved', title: 'Test video delivery on the phone', preview: 'Pi: Both formats play in the browser.', age: '1d' },
  { id: 'design', kind: 'design', mood: 'idle', title: 'Polish the mobile session list', project: 'a-very-long-project-name-for-mobile-layout', age: '2d' },
];

function row(item) {
  const mood = playing ? 'working' : item.mood;
  const button = el('button', undefined, 'session');
  button.type = 'button'; button.dataset.id = item.id;
  button.setAttribute('aria-pressed', String(item.id === selected));
  const indicators = el('span', undefined, 'session-indicators');
  indicators.append(statusIcon(mood));
  const body = el('div', undefined, 'session-body'), top = el('div', undefined, 'session-top');
  top.append(el('strong', item.title));
  if (item.pinned) {
    const pin = el('span', undefined, 'session-pinned');
    pin.setAttribute('role', 'img'); pin.setAttribute('aria-label', 'Pinned');
    pin.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 3h8v2l-1 4 3 3v2h-5v6l-1 2-1-2v-6H6v-2l3-3-1-4Z"/></svg>';
    top.append(pin);
  }
  body.append(top);
  if (variant.key === 'C') {
    const activity = el('div', undefined, 'bot-activity'); activity.dataset.mood = mood;
    activity.append(bot(item.kind, mood, 24), el('span', mood === 'working' ? jobs[item.kind] : `${kinds[item.kind][0]} · ${stateLabels[mood]}`));
    body.append(activity);
  }
  if (item.preview) body.append(el('div', item.preview, 'session-preview'));
  const meta = el('div', undefined, 'session-meta');
  if (variant.key === 'A') meta.append(bot(item.kind, mood, 20));
  if (variant.key !== 'C' && ['working', 'waiting'].includes(mood)) {
    const status = el('span', stateLabels[mood], 'session-state'); status.dataset.status = mood; meta.append(status);
  }
  const project = el('span', undefined, 'session-project');
  project.append(el('span', item.project || 'pi-remote', 'session-project-name'));
  meta.append(project, el('span', item.age, 'session-time'));
  if (variant.key === 'B') meta.append(bot(item.kind, mood, 24));
  body.append(meta); button.append(indicators, body);
  button.addEventListener('click', () => {
    selected = item.id;
    for (const sibling of document.querySelectorAll('.session')) sibling.setAttribute('aria-pressed', String(sibling.dataset.id === selected));
  });
  return button;
}
function group(name, pinned) {
  const section = el('section', undefined, 'session-group');
  section.setAttribute('aria-label', name);
  const heading = el('div', undefined, 'session-group-heading'), items = sessions.filter(item => !!item.pinned === pinned);
  heading.append(el('h2', name), el('span', String(items.length), 'badge'));
  section.append(heading, ...items.map(row));
  return section;
}
function render() {
  $('page').dataset.variant = variant.key;
  $('label').textContent = variant.name; $('description').textContent = variant.description;
  $('play').setAttribute('aria-pressed', String(playing));
  $('play').textContent = playing ? 'Show sample states' : 'Play all bots';
  $('list').replaceChildren(group('Pinned', true), group('Recent', false));
}
function set(key) {
  variant = variants.find(item => item.key === key) || variants[0];
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  render();
}
const cycle = step => set(variants[(variants.indexOf(variant) + step + variants.length) % variants.length].key);
$('prev').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
$('play').addEventListener('click', () => { playing = !playing; render(); });
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
});
set(new URLSearchParams(location.search).get('variant'));
