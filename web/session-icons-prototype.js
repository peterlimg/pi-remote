const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
// One stroke family on a 24px grid so every kind reads at 16px next to the existing review glyph.
const glyphs = {
  review: ['PR review', '<circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M6 8v8M18 16V9a4 4 0 0 0-4-4h-1m2-2-2 2 2 2"/>'],
  fix: ['Fix', '<path d="m8 2 1.9 1.9M14.1 3.9 16 2M9 7.1v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Zm0 0v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'],
  research: ['Research', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'],
  build: ['Build', '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/>'],
  idea: ['Idea', '<path d="M15 14c.2-1 .7-1.7 1.5-2.5A5.5 5.5 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>'],
  notes: ['Notes', '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6a2 2 0 0 1-.9.5l-2.9.8.8-2.9a2 2 0 0 1 .5-.8Z"/>'],
};
const emoji = { review: '', fix: '🐛', research: '🔎', build: '🛠️', idea: '💡', notes: '📝' };
const sessions = [
  { title: 'Investigate Claude SDK session recovery errors', kind: 'research', project: 'pi-remote', age: '1h', pinned: true },
  { title: 'Review architecture of web app.js', kind: 'review', project: 'pi-remote', age: '21h', pinned: true },
  { title: 'Add model-independent voice input to composer', kind: 'build', project: 'pi-remote', age: '1d', pinned: true },
  { title: 'Prototype richer session list pane designs', kind: 'idea', project: 'pi-remote', age: '5m', status: 'working', preview: 'Pi: I checked, and there’s no bug. The arc needs…' },
  { title: 'Fix stuck composer after image sending', kind: 'fix', project: 'pi-remote', age: '10m', unread: true, preview: 'Pi: Fixed. Only Send appears when you have text.' },
  { title: 'Review PZ-756 withdrawal-only exclusion logic', kind: 'review', project: 'primezero', age: '6h', status: 'waiting', preview: 'Pi: Post these 3 comments to the PR?' },
  { title: 'Draft daily update', kind: 'notes', project: 'notes', age: '2d', status: 'saved', preview: 'Pi: Here is today’s update.' },
  { title: 'Check staging database connectivity', kind: 'research', project: 'primezero', age: '3d', status: 'saved', preview: 'Pi: Connected through the bastion.' },
  { title: 'Start a coding session', project: 'pi-remote', age: '4d', status: 'saved' },
];
const variants = [
  { key: 'Now', name: 'Today', description: 'The current emoji, for comparison' },
  { key: 'A', name: 'Line', description: 'One muted line-icon family, same weight as the text' },
  { key: 'B', name: 'Colour line', description: 'Same glyphs, each kind has its own colour' },
  { key: 'C', name: 'Tile', description: 'Coloured glyph on a soft tinted tile' },
  { key: 'D', name: 'Dot', description: 'Just a colour dot; the title already says the verb' },
  { key: 'E', name: 'Lead slot', description: 'Kind takes the empty circle on the left; status wins while active' },
  { key: 'F', name: 'Label chip', description: 'Linear labels: colour dot and word in an outlined pill' },
  { key: 'G', name: 'Status ring', description: 'Linear status circle: colour is the kind; dashed saved, half working, ¾ needs you, check new reply' },
  { key: 'H', name: 'Calm glyph', description: 'Linear 2026 calm look: grey kind icon, colour only on a dot that needs you' },
];
let variant;

function kindIcon(kind, size = 16) {
  const node = el('span', undefined, 'kind');
  node.dataset.kind = kind; node.setAttribute('role', 'img'); node.setAttribute('aria-label', glyphs[kind][0]);
  if (variant.key === 'D') return node;
  if (variant.key === 'Now' && kind !== 'review') { node.textContent = emoji[kind]; node.style.fontSize = size * .75 + 'px'; return node; }
  if (variant.key === 'C') size = size === 16 ? 13 : 22;
  node.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${size > 20 ? 1.6 : 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[kind][1]}</svg>`;
  return node;
}
function chip(kind) {
  const node = el('span', glyphs[kind][0], 'chip');
  node.dataset.kind = kind; node.prepend(el('i'));
  return node;
}
// Linear-style circle on a 16px grid: ring for the kind colour, inner pie for the state.
function ring(kind, item = {}, size = 16) {
  const node = el('span', undefined, 'kind ring'), state = item.unread ? 'unread' : item.status || 'idle';
  node.dataset.kind = kind || 'none'; node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${kind ? glyphs[kind][0] : 'Session'}, ${state}`);
  const inner = {
    saved: '',
    working: '<path class="spin" d="M8 8V4a4 4 0 0 1 0 8Z" fill="currentColor"/>',
    waiting: '<path d="M8 8V4a4 4 0 1 1-4 4Z" fill="currentColor"/>',
    unread: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/><path d="m5.4 8.2 1.8 1.8 3.4-3.6" stroke="var(--bg)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  }[state] || '';
  node.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"${state === 'saved' ? ' stroke-dasharray="2.4 2"' : ''}/>${inner}</svg>`;
  return node;
}
function badged(item) {
  const node = kindIcon(item.kind), state = item.unread ? 'unread' : item.status;
  node.classList.add('badged');
  if (state === 'saved') node.dataset.saved = '';
  if (['working', 'waiting', 'unread'].includes(state)) {
    const badge = el('span', undefined, 'badge');
    badge.dataset.state = state; node.append(badge);
  }
  return node;
}
function lead(item) {
  const active = ['working', 'waiting'].includes(item.status) || item.unread;
  if (variant.key === 'E' && item.kind && !active) return kindIcon(item.kind);
  if (variant.key === 'G') return ring(item.kind, item);
  if (variant.key === 'H' && item.kind) return badged(item);
  return statusIcon(item);
}
// Same glyphs as app.js statusIcon; style.css animates and colours them.
function statusIcon(item) {
  const icon = el('span', undefined, 'session-icon');
  icon.dataset.status = item.status || 'idle';
  if (item.unread) icon.dataset.unread = '';
  icon.innerHTML = item.status === 'working'
    ? '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3" y="0" width="4" height="4"/><rect x="9" y="0" width="4" height="4"/><rect x="9" y="6" width="4" height="4"/><rect x="9" y="12" width="4" height="4"/><rect x="3" y="12" width="4" height="4"/><rect x="3" y="6" width="4" height="4"/></svg>'
    : item.status === 'waiting'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
    : '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg>';
  return icon;
}
function row(item) {
  const button = el('button', undefined, 'session'), indicators = el('span', undefined, 'session-indicators');
  button.type = 'button';
  indicators.append(lead(item));
  const body = el('div', undefined, 'session-body'), top = el('div', undefined, 'session-top');
  top.append(el('strong', item.title));
  if (item.pinned) top.append(Object.assign(el('span', '', 'session-pinned'), { innerHTML: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 3H8v2l1 1v5l-3 3v2h5v5l1 1 1-1v-5h5v-2l-3-3V6l1-1Z"/></svg>' }));
  body.append(top);
  if (item.preview) body.append(el('div', item.preview, 'session-preview'));
  const meta = el('div', undefined, 'session-meta');
  if (item.status === 'working' || item.status === 'waiting') {
    const state = el('span', item.status === 'working' ? 'Working' : 'Needs input', 'session-state');
    state.dataset.status = item.status; meta.append(state);
  }
  const project = el('span', undefined, 'session-project');
  if (item.kind && !['E', 'G', 'H'].includes(variant.key)) project.append(variant.key === 'F' ? chip(item.kind) : kindIcon(item.kind));
  project.append(el('span', item.project, 'session-project-name'));
  meta.append(project, el('time', item.age, 'session-time'));
  body.append(meta);
  button.append(indicators, body);
  return button;
}
function render() {
  $('page').dataset.variant = variant.key;
  $('label').textContent = variant.key === 'Now' ? variant.name : `${variant.key} · ${variant.name}`;
  $('description').textContent = variant.description;
  $('legend').replaceChildren(...Object.entries(glyphs).map(([kind, [name]]) => {
    const cell = el('div'), big = el('span', undefined, 'big'), small = el('small');
    big.append(variant.key === 'F' ? chip(kind) : variant.key === 'G' ? ring(kind, {}, 28) : kindIcon(kind, 28));
    if (variant.key !== 'F') small.append(name);
    cell.append(big, small);
    return cell;
  }));
  $('list').replaceChildren(...sessions.map(row));
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
}
const set = key => { variant = variants.find(v => v.key === key) || variants[1]; render(); };
const cycle = step => set(variants[(variants.indexOf(variant) + step + variants.length) % variants.length].key);
$('prev').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
set(new URLSearchParams(location.search).get('variant'));
