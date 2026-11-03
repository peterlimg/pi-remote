// Session bot studies. Static examples only; no app transport or storage.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
// Original drawings match production; the six new personalities get their own motion parts.
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
  ship: ['Ship', '<path d="M16 3c5.5 3.2 8.5 8.5 8.5 14.5V24a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-6.5C7.5 11.5 10.5 6.2 16 3Z"/>', [[12.8, 16, .85], [19.2, 16, .85]],
    '<path class="bot-accent" d="M8.5 17 4 22.5V27l4.5-2.5ZM23.5 17l4.5 5.5V27l-4.5-2.5Z"/>', '',
    '<g class="bot-flame"><path class="bot-flame-out" d="M11.5 27h9c0 3.2-2.2 5.8-4.5 7-2.3-1.2-4.5-3.8-4.5-7Z"/><path class="bot-flame-in" d="M13.5 27h5c0 1.8-1.2 3.3-2.5 4-1.3-.7-2.5-2.2-2.5-4Z"/></g>'],
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
};
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
const variants = [
  { key: 'inline', name: 'A · Bigger details', description: '28px after project and time. Same title layout.', size: 28, leading: false },
  { key: 'leading', name: 'B · Aligned avatars', description: '32px at the left. Keep compact, single-line titles.', size: 32, leading: true },
  { key: 'roomy', name: 'C · Larger + two lines', description: '40px at the left. More title, fewer rows at once.', size: 40, leading: true },
];
const personalityKinds = ['pip', 'sprout', 'bun', 'mochi', 'pebble', 'wisp'];
const keptKinds = ['idea', 'fix', 'build', 'notes', 'ship'];
// Sample characters belong to the session, not its task or title.
const sessions = [
  { id: 'active-fix', group: 'Now', kind: 'fix', character: 'pip', status: 'working', title: 'Fix mobile session reconnect handling', project: 'pi-remote', age: 'now', unread: true },
  { id: 'active-research', group: 'Now', kind: 'research', character: 'wisp', status: 'waiting', title: 'Investigate saved session recovery', project: 'pi-remote', age: '2m' },
  { id: 'prototype', group: 'Pinned', kind: 'idea', character: 'idea', title: 'Prototype animation icons in session list', project: 'pi-remote', age: '3m', unread: true },
  { id: 'compress', group: 'Pinned', kind: 'build', character: 'build', title: 'Compress video with FFmpeg without quality loss', project: 'pi-remote', age: '1d' },
  { id: 'recovery', group: 'Pinned', kind: 'research', character: 'pebble', title: 'Investigate SDK session recovery errors', project: 'pi-remote', age: '2d' },
  { id: 'review-logic', group: 'Recent', kind: 'review', character: 'sprout', title: 'Review promotional exclusion logic', project: 'api-service', age: '8m' },
  { id: 'visibility', group: 'Recent', kind: 'research', character: 'mochi', title: 'Check agent-desktop visibility', project: 'pi-remote', age: '1h' },
  { id: 'review-post', group: 'Recent', kind: 'review', character: 'notes', title: 'Review X post for Pi Remote improvements', project: 'pi-remote', age: '11h' },
  { id: 'fix-model', group: 'Recent', kind: 'fix', character: 'fix', title: 'Fix model selection issue', project: 'pi-remote', age: '19h' },
  { id: 'fix-sdk', group: 'Recent', kind: 'fix', character: 'ship', title: 'Fix SDK session issue', project: 'pi-remote', age: '23h' },
];
const pinSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 3h8v2l-1 4 3 3v2h-5v6l-1 2-1-2v-6H6v-2l3-3-1-4Z"/></svg>';
const statusLabels = { idle: 'Ready', working: 'Working', waiting: 'Needs input' };
const showProposals = new URL(location.href).searchParams.get('icons') === 'more';
let variant = variants[1], selected = 'prototype', selectionNotice = '', showActive = false, paused = false;
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const visibleBots = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) target.classList.toggle('in-view', isIntersecting);
});
function row(item) {
  const kind = showProposals ? item.character : item.kind;
  const status = item.status || 'idle', busy = ['working', 'waiting'].includes(status), leading = variant.leading || busy;
  const button = el('button', undefined, 'session' + (busy ? ' session-busy' : '') + (item.id === selected ? ' active' : ''));
  button.type = 'button'; button.dataset.id = item.id; button.dataset.status = status;
  button.setAttribute('aria-current', String(item.id === selected));
  button.setAttribute('aria-label', `Select sample: ${item.title}. ${sessionKinds[kind][0]}. ${statusLabels[status]}.${item.unread ? ' New reply.' : ''}`);
  const indicators = el('span', undefined, 'session-indicators');
  const bot = el('span', undefined, 'bot layout-bot');
  bot.dataset.kind = kind; bot.dataset.mood = busy ? status : 'idle'; bot.dataset.size = String(variant.size);
  bot.dataset.unread = String(!!item.unread && leading);
  if (showProposals) {
    bot.dataset.proposed = '';
    bot.classList.toggle('personality-bot', personalityKinds.includes(kind));
  }
  bot.setAttribute('role', 'img'); bot.setAttribute('aria-label', `${sessionKinds[kind][0]}, ${statusLabels[status]}${item.unread && leading ? ', new reply' : ''}`);
  const seed = [...item.id].reduce((sum, char) => sum + char.charCodeAt(0) * 97, 0);
  bot.style.setProperty('--bot-t', `-${(Date.now() + (showProposals ? seed : 0)) % 6000}ms`);
  bot.style.setProperty('--bot-blink', `-${(Date.now() + seed) % 6000}ms`);
  bot.innerHTML = botSvg(kind, busy ? status : 'idle', variant.size, !!item.unread && leading);
  visibleBots.observe(bot);
  if (leading) indicators.append(bot);
  else {
    const dot = el('span', undefined, 'session-icon'); dot.dataset.status = status;
    dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', item.unread ? 'New reply' : statusLabels[status]);
    if (item.unread) dot.dataset.unread = '';
    dot.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
    indicators.append(dot);
  }
  const body = el('div', undefined, 'session-body'), top = el('div', undefined, 'session-top');
  const title = el('strong', item.title); title.title = item.title; top.append(title);
  if (item.group === 'Pinned') {
    const pin = el('span', undefined, 'session-pinned'); pin.setAttribute('role', 'img'); pin.setAttribute('aria-label', 'Pinned'); pin.innerHTML = pinSvg; top.append(pin);
  }
  const meta = el('div', undefined, 'session-meta');
  if (busy) { const label = el('span', statusLabels[status], 'session-state'); label.dataset.status = status; meta.append(label); }
  const project = el('span', undefined, 'session-project'); project.append(el('span', item.project, 'session-project-name'));
  meta.append(project, el('span', item.age, 'session-time'));
  if (!leading) { const inline = el('span', undefined, 'session-kind'); inline.append(bot); meta.append(inline); }
  body.append(top, meta); button.append(indicators, body);
  button.addEventListener('click', () => { selected = item.id; selectionNotice = `Selected sample: ${item.title}`; render(); });
  return button;
}
function render() {
  visibleBots.disconnect();
  $('page').dataset.variant = variant.key; $('page').style.setProperty('--bot-size', `${variant.size}px`);
  $('proposal-note').hidden = !showProposals;
  $('characters').hidden = !showProposals;
  if (showProposals) $('characters').replaceChildren(...[...personalityKinds, ...keptKinds].map((kind, index) => {
    const figure = el('figure', undefined, 'character-swatch'), bot = el('span', undefined, 'bot layout-bot');
    bot.classList.toggle('personality-bot', personalityKinds.includes(kind));
    bot.dataset.kind = kind; bot.dataset.mood = 'working'; bot.dataset.proposed = ''; bot.dataset.size = '32'; bot.dataset.unread = 'false';
    bot.setAttribute('aria-hidden', 'true');
    bot.style.setProperty('--bot-t', `-${(Date.now() + index * 700) % 6000}ms`);
    bot.style.setProperty('--bot-blink', `-${(Date.now() + index * 1000) % 6000}ms`);
    bot.innerHTML = botSvg(kind, 'working', 32); visibleBots.observe(bot);
    figure.append(bot, el('figcaption', sessionKinds[kind][0])); return figure;
  }));
  $('list').replaceChildren(...['Now', 'Pinned', 'Recent'].filter(group => group !== 'Now' || showActive).map(name => {
    const group = el('section', undefined, 'session-group'); group.setAttribute('aria-label', name);
    const heading = el('div', undefined, 'session-group-heading'), items = sessions.filter(item => item.group === name);
    heading.append(el('h3', name), el('span', String(items.length), 'badge')); group.append(heading, ...items.map(row)); return group;
  }));
  $('label').textContent = variant.name; $('description').textContent = variant.description;
  $('selection').textContent = selectionNotice || 'Sample sessions. Tap a row to preview selection.';
  $('activity').setAttribute('aria-pressed', String(showActive)); $('activity').textContent = showActive ? 'Hide active sessions' : 'Show active sessions';
  const url = new URL(location.href); url.searchParams.delete('scenario'); url.searchParams.delete('step'); url.searchParams.set('variant', variant.key);
  history.replaceState(null, '', url);
}
function cycle(direction) { variant = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length]; render(); }
$('previous').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
$('activity').addEventListener('click', () => {
  showActive = !showActive; render();
  if (showActive) $('list').firstElementChild.scrollIntoView({ block: 'start' });
});
function syncMotion() {
  document.documentElement.classList.toggle('paused', paused);
  document.documentElement.classList.toggle('document-hidden', document.hidden);
  $('motion').disabled = motionPreference.matches;
  $('motion').setAttribute('aria-pressed', String(paused || motionPreference.matches));
  $('motion').textContent = paused ? 'Resume motion' : 'Pause motion';
}
$('motion').addEventListener('click', () => { paused = !paused; syncMotion(); });
motionPreference.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);
function syncTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Preview light theme' : 'Preview dark theme';
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#100d10' : '#f2f3f0';
}
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); });
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); cycle(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); cycle(-1); }
});
variant = variants.find(item => item.key === new URL(location.href).searchParams.get('variant')) || variants[1];
if (showProposals) $('preview-hint').textContent = 'The lineup shows working animations. Resting sessions keep their quieter behaviour. Each sample keeps its character when you change the view. No live icons change.';
syncTheme(); syncMotion(); render();
