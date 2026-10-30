// Throwaway: sample sessions only, nothing here talks to the host.
// Every field below already arrives in the session list: preview/previewRole, dialog, lastPromptAt, the unread check, emoji.
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
let current = 5, variant;

const variants = [
  { key: 'B', name: 'Signals + emoji', description: 'Your pick: status, emoji and project' },
  { key: 'F', name: 'What’s happening', description: 'Line 2 shows the question, the new reply, or how long it has run; project only when it differs' },
  { key: 'G', name: 'F + off-screen hints', description: 'F, plus a pill at the edge when something above or below needs you' },
];

const kind = item => item.status === 'working' ? 'working' : item.status === 'waiting' ? 'waiting' : item.unread ? 'unread' : '';
const label = { waiting: 'Needs input', unread: 'New reply', working: 'Working' };
const reviewSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M6 8v8M18 16V9a4 4 0 0 0-4-4h-1m2-2-2 2 2 2"/></svg>';
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

// B: state label, emoji, project.
function metaB(item) {
  const meta = el('small');
  if (label[kind(item)]) meta.append(el('span', label[kind(item)], 'label'), ' · ');
  meta.append(...emoji(item), item.project);
  return meta;
}
// F/G: what you would find if you opened it. Project only when it is not the one you are in.
function metaF(item) {
  const meta = el('small'), here = sessions[current].project, k = kind(item);
  meta.append(...emoji(item));
  if (item.project !== here) meta.append(el('span', item.project, 'project'), ' · ');
  if (k === 'waiting') meta.append(el('span', item.dialog || 'Needs input', 'label'));
  else if (k === 'working') meta.append(el('span', `Working ${item.running}`, 'label'), ...item.preview ? [' · ', item.preview.replace(/^Pi: /, '')] : []);
  else if (k === 'unread') meta.append(el('span', item.preview.replace(/^Pi: /, ''), 'label'));
  else meta.append(item.preview || (item.project === here ? item.project : 'No messages yet'));
  return meta;
}

function row(item) {
  const index = sessions.indexOf(item), button = el('button', undefined, 'row'), text = el('span', undefined, 'text');
  button.type = 'button'; button.dataset.status = item.status; button.dataset.index = index;
  button.setAttribute('aria-current', String(index === current));
  if (kind(item)) button.dataset.attention = kind(item);
  const title = el('strong', item.title);
  if (item.pinned) title.append(el('span', '📌', 'pin'));
  text.append(title, variant.key === 'B' ? metaB(item) : metaF(item));
  // A running session is always "now"; F/G put its elapsed time in line 2 instead.
  button.append(statusIcon(item), text, el('time', variant.key !== 'B' && kind(item) === 'working' ? '' : item.age));
  button.addEventListener('click', () => { current = index; item.unread = false; render(); });
  return button;
}

// G: count what needs you beyond each edge of the scrolled list.
function updateHints() {
  const list = $('list'), top = list.scrollTop, bottom = top + list.clientHeight;
  for (const [id, outside, arrow] of [['hint-up', row => row.offsetTop + row.offsetHeight / 2 < top, '↑'], ['hint-down', row => row.offsetTop + row.offsetHeight / 2 > bottom, '↓']]) {
    const rows = variant.key === 'G' ? [...list.querySelectorAll('[data-attention=waiting], [data-attention=unread]')].filter(outside) : [];
    const hint = $(id), waiting = rows.filter(row => row.dataset.attention === 'waiting').length, fresh = rows.length - waiting;
    hint.hidden = !rows.length;
    hint.dataset.kind = waiting ? 'waiting' : 'unread';
    hint.textContent = `${arrow} ${[waiting && `${waiting} needs you`, fresh && `${fresh} new`].filter(Boolean).join(' · ')}`;
    hint.onclick = () => (arrow === '↑' ? rows.at(-1) : rows[0]).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
$('list').addEventListener('scroll', updateHints, { passive: true });

function render() {
  const list = $('list'), item = sessions[current];
  $('pill-title').textContent = item.title; $('pill-project').textContent = item.project;
  list.dataset.variant = variant.key;
  list.replaceChildren(...sessions.map(row));
  const at = list.querySelector('[aria-current=true]');
  list.scrollTop = at.offsetTop - (list.clientHeight - at.offsetHeight) / 2;
  $('dots').replaceChildren(...sessions.map((s, i) => el('span', undefined, i === current ? 'current' : '')));
  updateHints();
}

function setVariant(key) {
  variant = variants.find(item => item.key === key) || variants[0];
  $('variant-label').textContent = `${variant.key} · ${variant.name}`;
  $('variant-description').textContent = variant.description;
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  render();
}
const cycle = direction => setVariant(variants[(variants.indexOf(variant) + direction + variants.length) % variants.length].key);
$('previous-variant').addEventListener('click', () => cycle(-1));
$('next-variant').addEventListener('click', () => cycle(1));
setVariant(new URLSearchParams(location.search).get('variant'));
