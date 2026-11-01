// Throwaway: matte and outline art, identical geometry, poses and session placement. No app transport or storage.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
const variants = [
  { key: 'matte', name: 'Matte filled', description: 'Soft neutral bodies. One small working gesture.' },
  { key: 'outline', name: 'Neutral outline', description: 'The same shapes and motion, drawn with a consistent stroke.' },
];
const characters = {
  review: { name: 'Review', body: '<rect x="4" y="8" width="24" height="22" rx="8"/>', detail: '<g class="study-detail"><circle cx="11.5" cy="20" r="4.5"/><circle cx="20.5" cy="20" r="4.5"/></g>' },
  fix: { name: 'Fix', body: '<circle cx="16" cy="19" r="11.5"/>', back: '<g class="study-antenna"><path d="m10 10-2-6"/><circle cx="8" cy="4" r="1.5"/></g><path d="m22 10 2-6"/><circle cx="24" cy="4" r="1.5"/>' },
  research: { name: 'Research', body: '<rect x="4" y="7" width="24" height="23" rx="10"/>', detail: '<g class="study-lens study-detail"><circle cx="20.5" cy="20" r="4.8"/><path d="m24 23.5 3 3"/></g>' },
  build: { name: 'Build', body: '<rect x="4" y="12" width="24" height="18" rx="6"/>', detail: '<g class="study-cap"><path d="M7 12a9 8 0 0 1 18 0Z"/><path d="M3 13h26"/></g>' },
};
let variant = variants[0], selected = 'fix-rest', paused = false;
const visibleIcons = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) target.classList.toggle('in-view', isIntersecting);
});
function icon(kind, mood, size, style = variant.key) {
  const character = characters[kind], node = el('span', undefined, 'study-icon');
  node.dataset.kind = kind; node.dataset.mood = mood; node.dataset.size = size; node.dataset.style = style;
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${character.name}, ${mood}, ${size}px, ${style}`);
  node.style.setProperty('--study-phase', `-${Date.now() % 2400}ms`);
  const rx = size === 20 ? 2 : 1.8;
  node.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${character.back || ''}<g class="study-body">${character.body}</g>${character.detail || ''}<g class="study-eyes"><ellipse cx="11.5" cy="20" rx="${rx}" ry="2.5"/><ellipse cx="20.5" cy="20" rx="${rx}" ry="2.5"/></g></svg>`;
  return node;
}
function renderComparison() {
  $('comparison-icons').replaceChildren(...Object.entries(characters).map(([kind, { name }]) => {
    const row = el('tr'), label = el('th', name); label.scope = 'row'; row.append(label);
    for (const { key } of variants) {
      const cell = el('td'), pair = el('div', undefined, 'icon-pair');
      pair.append(icon(kind, 'working', 28, key), icon(kind, 'resting', 20, key)); cell.append(pair); row.append(cell);
    }
    return row;
  }));
}
const sessions = [
  { id: 'review-work', kind: 'review', group: 'Now', working: true, title: 'Review X post for Pi remote improvements', age: 'now', unread: true },
  { id: 'fix-work', kind: 'fix', group: 'Now', working: true, title: 'Fix model selection issue', age: 'now' },
  { id: 'research-work', kind: 'research', group: 'Now', working: true, title: 'Investigate Claude SDK session recovery errors', age: '2m' },
  { id: 'build-work', kind: 'build', group: 'Now', working: true, title: 'Build the mobile session picker', age: '3m' },
  { id: 'build-rest', kind: 'build', group: 'Pinned', title: 'Compress video with FFmpeg without quality loss', age: '12h' },
  { id: 'research-rest', kind: 'research', group: 'Pinned', title: 'Investigate Claude SDK session recovery errors', age: '2d' },
  { id: 'review-rest', kind: 'review', group: 'Pinned', title: 'Review architecture of web app.js', age: '2d' },
  { id: 'fix-rest', kind: 'fix', group: 'Recent', title: 'Fix model selection issue', age: '7h' },
];
const pinSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 3h8v2l-1 4 3 3v2h-5v6l-1 2-1-2v-6H6v-2l3-3-1-4Z"/></svg>';
function row(item) {
  const button = el('button', undefined, 'session' + (item.working ? ' session-busy' : ''));
  button.type = 'button'; button.dataset.id = item.id; button.setAttribute('aria-pressed', String(item.id === selected));
  const indicators = el('span', undefined, 'session-indicators');
  if (item.working) {
    const bot = icon(item.kind, 'working', 28);
    if (item.unread) bot.dataset.unread = '';
    indicators.append(bot);
  } else {
    const dot = el('span', undefined, 'session-icon'); dot.dataset.status = 'idle';
    dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', 'Ready');
    dot.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
    indicators.append(dot);
  }
  const body = el('div', undefined, 'session-body'), top = el('div', undefined, 'session-top');
  top.append(el('strong', item.title));
  if (item.group === 'Pinned') {
    const pin = el('span', undefined, 'session-pinned'); pin.setAttribute('role', 'img'); pin.setAttribute('aria-label', 'Pinned'); pin.innerHTML = pinSvg; top.append(pin);
  }
  const meta = el('div', undefined, 'session-meta');
  if (item.working) { const status = el('span', 'Working', 'session-state'); status.dataset.status = 'working'; meta.append(status); }
  const project = el('span', undefined, 'session-project'); project.append(el('span', 'pi-remote', 'session-project-name'));
  meta.append(project, el('span', item.age, 'session-time'));
  if (!item.working) { const kind = el('span', undefined, 'session-kind'); kind.append(icon(item.kind, 'resting', 20)); meta.append(kind); }
  body.append(top, meta); button.append(indicators, body);
  button.addEventListener('click', () => {
    selected = item.id;
    for (const sibling of document.querySelectorAll('.session')) sibling.setAttribute('aria-pressed', String(sibling.dataset.id === selected));
  });
  return button;
}
function renderList() {
  $('list').replaceChildren(...['Now', 'Pinned', 'Recent'].map(name => {
    const group = el('section', undefined, 'session-group'); group.setAttribute('aria-label', name);
    const heading = el('div', undefined, 'session-group-heading'), items = sessions.filter(item => item.group === name);
    heading.append(el('h3', name), el('span', String(items.length), 'badge')); group.append(heading, ...items.map(row)); return group;
  }));
}
function setVariant(key) {
  variant = variants.find(item => item.key === key) || variants[0];
  $('page').dataset.variant = variant.key; $('label').textContent = variant.name; $('description').textContent = variant.description;
  for (const button of document.querySelectorAll('button[data-style]')) button.setAttribute('aria-pressed', String(button.dataset.style === variant.key));
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  renderList();
  visibleIcons.disconnect(); document.querySelectorAll('.study-icon').forEach(node => visibleIcons.observe(node));
}
function cycle() { setVariant(variant.key === 'matte' ? 'outline' : 'matte'); }
$('prev').addEventListener('click', cycle); $('next').addEventListener('click', cycle);
for (const button of document.querySelectorAll('button[data-style]')) button.addEventListener('click', () => setVariant(button.dataset.style));
$('motion').addEventListener('click', () => {
  paused = !paused; document.documentElement.classList.toggle('study-paused', paused);
  $('motion').setAttribute('aria-pressed', String(paused)); $('motion').textContent = paused ? 'Resume motion' : 'Pause motion';
});
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
function setTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Preview light theme' : 'Preview dark theme';
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#100d10' : '#fafaf8';
}
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; setTheme(); });
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('document-hidden', document.hidden));
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(); }
});
setTheme(); renderComparison(); setVariant(new URLSearchParams(location.search).get('variant'));
