// Throwaway: sample sessions only, nothing here talks to the host.
// Rows are variant G (status, what's happening, off-screen hints); the variants compare where search goes. New session stays out of this pane.
const $ = id => document.getElementById(id);
const sessions = [
  { title: 'Draft daily update', project: 'notes', age: '2d', status: 'saved', icon: '📝', preview: 'Pi: Here is today’s update.' },
  { title: 'Fix login redirect on Safari', project: 'primezero-web', age: '20m', status: 'idle', unread: true, preview: 'Pi: Fixed. The cookie was SameSite=Strict, so Safari dropped it on the redirect.' },
  { title: 'Investigate Claude SDK session recovery', project: 'pi-remote', age: 'Oct 21', status: 'saved', icon: '🔎', preview: 'Pi: Wrote docs/research/sdk-recovery.md' },
  { title: 'Add model-independent voice input to the composer', project: 'pi-remote', age: '1d', status: 'idle', icon: '💡', preview: 'You: try the Web Speech API first' },
  { title: 'Compress video with FFmpeg while preserving quality', project: 'scratch', age: 'now', running: '3m', status: 'working', icon: '🛠️', preview: 'Pi: Encoding pass 2 of 2…' },
  { title: 'Untitled session', project: 'pi-remote', age: '1h', status: 'idle', preview: '' },
  { title: 'Opentunnel reconnect flake', project: 'pi-remote', age: 'now', running: '12m', status: 'working', pinned: true, icon: '🐛', preview: 'You: run the reconnect test 20 times' },
  { title: 'Keep the composer still while a session loads', project: 'pi-remote', age: '2h', status: 'idle', preview: 'Pi: Pushed c2a33ae to main.' },
  { title: 'Rename Linear labels for Q4', project: 'primezero', age: '5h', status: 'idle', preview: 'Pi: Renamed 14 labels.' },
  { title: 'Session dots haptics on iOS 26.5', project: 'pi-remote', age: '1d', status: 'idle', preview: 'Pi: The switch trick ticks on release.' },
  { title: 'Review PZ-756 withdrawal-only exclusion', project: 'primezero', age: '3h', status: 'waiting', icon: 'review', dialog: 'Post these 3 review comments to the PR?', preview: 'Pi: Drafted 3 comments.' },
  { title: 'Upgrade Go to 1.25 in backend-go', project: 'backend-go', age: '40m', status: 'idle', unread: true, preview: 'Pi: Done. CI passes; two deprecation warnings remain.' },
];
let current = sessions[5], variant, query = '', searchOpen = false;

const variants = [
  { key: '1', name: 'Field at the bottom', description: 'A slim search field under the list, by your thumb' },
  { key: '2', name: 'Scroll up to search', description: 'The field sits above the first session; it is off-screen until you scroll up' },
  { key: '3', name: 'Search by the dots', description: 'The list stays as G; a search button beside the dots opens the field' },
];

const kind = item => item.status === 'working' ? 'working' : item.status === 'waiting' ? 'waiting' : item.unread ? 'unread' : '';
const reviewSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M6 8v8M18 16V9a4 4 0 0 0-4-4h-1m2-2-2 2 2 2"/></svg>';
const searchSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// Same glyphs as app.js statusIcon; style.css animates the bricks and colours unread/waiting.
function statusIcon(item) {
  const icon = el('span', undefined, 'session-icon');
  icon.dataset.status = item.status;
  if (item.unread) icon.dataset.unread = '';
  icon.innerHTML = item.status === 'working'
    ? '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3" y="0" width="4" height="4"/><rect x="9" y="0" width="4" height="4"/><rect x="9" y="6" width="4" height="4"/><rect x="9" y="12" width="4" height="4"/><rect x="3" y="12" width="4" height="4"/><rect x="3" y="6" width="4" height="4"/></svg>'
    : item.status === 'waiting'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
    : '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg>';
  return icon;
}
function emoji(item) {
  if (!item.icon) return [];
  const node = el('span', item.icon === 'review' ? '' : item.icon, 'inline-emoji');
  if (item.icon === 'review') node.innerHTML = reviewSvg;
  return [node];
}
// What you would find if you opened it. Project only when it is not the one you are in.
function meta(item) {
  const line = el('small'), k = kind(item);
  line.append(...emoji(item));
  if (item.project !== current.project) line.append(el('span', item.project, 'project'), ' · ');
  if (k === 'waiting') line.append(el('span', item.dialog || 'Needs input', 'label'));
  else if (k === 'working') line.append(el('span', `Working ${item.running}`, 'label'), ...item.preview ? [' · ', item.preview.replace(/^Pi: /, '')] : []);
  else if (k === 'unread') line.append(el('span', item.preview.replace(/^Pi: /, ''), 'label'));
  else line.append(item.preview || (item.project === current.project ? item.project : 'No messages yet'));
  return line;
}
function row(item) {
  const button = el('button', undefined, 'row'), text = el('span', undefined, 'text');
  button.type = 'button'; button.dataset.status = item.status;
  button.setAttribute('aria-current', String(item === current));
  if (kind(item)) button.dataset.attention = kind(item);
  const title = el('strong', item.title);
  if (item.pinned) title.append(el('span', '📌', 'pin'));
  text.append(title, meta(item));
  button.append(statusIcon(item), text, el('time', kind(item) === 'working' ? '' : item.age));
  button.addEventListener('click', () => { current = item; item.unread = false; clearSearch(); renderList(); });
  return button;
}

// One search field, moved into whichever slot the variant uses.
const search = el('label', undefined, 'search-box'), input = el('input'), bar = el('div', undefined, 'pane-bar');
search.insertAdjacentHTML('afterbegin', searchSvg);
input.type = 'search'; input.placeholder = 'Search sessions'; input.autocomplete = 'off'; input.enterKeyHint = 'search';
search.append(input); bar.append(search);
input.addEventListener('input', () => { query = input.value.trim(); renderList(); });
$('dots-search').addEventListener('click', () => { searchOpen = !searchOpen; layout(); if (searchOpen) input.focus(); });
function clearSearch() { query = ''; input.value = ''; input.blur(); if (variant.key === '3') { searchOpen = false; layout(); } }
const matches = () => sessions.filter(item => [item.title, item.project, item.preview, item.dialog].some(text => text?.toLowerCase().includes(query.toLowerCase())));

function layout() {
  const slots = { 1: [$('list-wrap'), bar], 2: [$('list-wrap')], 3: searchOpen ? [bar, $('list-wrap')] : [$('list-wrap')] }[variant.key];
  $('pane').replaceChildren(...slots);
  bar.classList.toggle('top', slots[0] === bar);
  bar.classList.toggle('in-list', variant.key === '2');
  $('dots-search').hidden = variant.key !== '3';
  $('dots-search').setAttribute('aria-pressed', String(searchOpen));
  if (variant.key === '2') $('list').replaceChildren(bar);
  renderList();
}

function renderList() {
  const list = $('list'), shown = query ? matches() : sessions;
  $('pill-title').textContent = current.title; $('pill-project').textContent = current.project;
  const nodes = shown.map(row);
  if (!nodes.length) nodes.push(el('p', 'No sessions match', 'empty'));
  // Scroll-up search lives inside the list; replacing it would drop focus mid-typing.
  if (variant.key === '2') { [...list.children].forEach(child => child !== bar && child.remove()); list.append(...nodes); }
  else list.replaceChildren(...nodes);
  const at = list.querySelector('[aria-current=true]');
  list.scrollTop = query || !at ? 0 : at.offsetTop - (list.clientHeight - at.offsetHeight) / 2;
  $('dots').replaceChildren(...sessions.map(s => el('span', undefined, s === current ? 'current' : '')));
  updateHints();
}

// Count what needs you beyond each edge of the scrolled list.
function updateHints() {
  const list = $('list'), top = list.scrollTop, bottom = top + list.clientHeight;
  for (const [id, outside, arrow] of [['hint-up', row => row.offsetTop + row.offsetHeight / 2 < top, '↑'], ['hint-down', row => row.offsetTop + row.offsetHeight / 2 > bottom, '↓']]) {
    const rows = [...list.querySelectorAll('[data-attention=waiting], [data-attention=unread]')].filter(outside);
    const hint = $(id), waiting = rows.filter(row => row.dataset.attention === 'waiting').length, fresh = rows.length - waiting;
    hint.hidden = !rows.length;
    hint.dataset.kind = waiting ? 'waiting' : 'unread';
    hint.textContent = `${arrow} ${[waiting && `${waiting} needs you`, fresh && `${fresh} new`].filter(Boolean).join(' · ')}`;
    hint.onclick = () => (arrow === '↑' ? rows.at(-1) : rows[0]).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
$('list').addEventListener('scroll', updateHints, { passive: true });

// Keep the pane above the iOS keyboard while searching.
const fit = () => {
  const view = visualViewport, phone = document.querySelector('.phone');
  phone.style.height = view.height + 'px'; phone.style.setProperty('--phone-height', view.height + 'px');
  phone.style.transform = `translateY(${view.offsetTop}px)`;
};
visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); fit();

function setVariant(key) {
  variant = variants.find(item => item.key === key) || variants[0];
  $('variant-label').textContent = `${variant.key} · ${variant.name}`;
  $('variant-description').textContent = variant.description;
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  query = ''; input.value = ''; searchOpen = false;
  layout();
}
const cycle = direction => setVariant(variants[(variants.indexOf(variant) + direction + variants.length) % variants.length].key);
$('previous-variant').addEventListener('click', () => cycle(-1));
$('next-variant').addEventListener('click', () => cycle(1));
setVariant(new URLSearchParams(location.search).get('variant'));
