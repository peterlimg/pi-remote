// Throwaway: sample sessions only, nothing here talks to the host.
const $ = id => document.getElementById(id);
const sessions = [
  { title: 'Fix login redirect on Safari', project: 'primezero-web', age: '20m', status: 'idle', unread: true },
  { title: 'Add model-independent voice input to the composer', project: 'pi-remote', age: '1d', status: 'idle', icon: '💡' },
  { title: 'Investigate Claude SDK session recovery', project: 'pi-remote', age: 'Oct 21', status: 'saved', icon: '🔎' },
  { title: 'Untitled session', project: 'pi-remote', age: '1h', status: 'idle' },
  { title: 'Review PZ-756 withdrawal-only exclusion', project: 'primezero', age: '3h', status: 'waiting', icon: 'review' },
  { title: 'Compress video with FFmpeg while preserving quality', project: 'scratch', age: 'now', status: 'working', icon: '🛠️' },
  { title: 'Opentunnel reconnect flake', project: 'pi-remote', age: 'now', status: 'working', pinned: true, icon: '🐛' },
  { title: 'Draft daily update', project: 'notes', age: '2d', status: 'saved', icon: '📝' },
];
let current = 3, variant;

const variants = [
  { key: 'A', name: 'Signals', description: 'Status icon and label for what needs you; same order as the dots' },
  { key: 'B', name: 'Signals + emoji', description: 'A, plus the session emoji before the project, like the main list' },
  { key: 'C', name: 'Emoji or status', description: 'The left icon shows status while active, otherwise the session emoji' },
  { key: 'D', name: 'Working first', description: 'B, sorted: working, then needs you, then the rest' },
  { key: 'E', name: 'Working first, labelled', description: 'D with small group labels' },
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
function emoji(item, className) {
  const node = el('span', item.icon === 'review' ? '' : item.icon, className);
  if (item.icon === 'review') node.innerHTML = reviewSvg;
  return node;
}

function row(item) {
  const index = sessions.indexOf(item), button = el('button', undefined, 'row'), text = el('span', undefined, 'text');
  button.type = 'button'; button.dataset.status = item.status;
  button.setAttribute('aria-current', String(index === current));
  if (kind(item)) button.dataset.attention = kind(item);
  const title = el('strong', item.title);
  if (item.pinned) title.append(el('span', '📌', 'pin'));
  const meta = el('small');
  if (label[kind(item)]) meta.append(el('span', label[kind(item)], 'label'), ' · ');
  // C moves the emoji to the left slot, so the meta line only repeats it when status took that slot.
  const inlineEmoji = item.icon && variant.key !== 'A' && (variant.key !== 'C' || kind(item));
  if (inlineEmoji) meta.append(emoji(item, 'inline-emoji'));
  meta.append(item.project);
  text.append(title, meta);
  const lead = variant.key === 'C' && item.icon && !kind(item) ? emoji(item, 'lead-emoji') : statusIcon(item);
  button.append(lead, text, el('time', item.age));
  button.addEventListener('click', () => { current = index; item.unread = false; render(); });
  return button;
}

function render() {
  const list = $('list'), item = sessions[current];
  $('pill-title').textContent = item.title; $('pill-project').textContent = item.project;
  if (['D', 'E'].includes(variant.key)) {
    const groups = [['Working', s => s.status === 'working'], ['Needs you', s => ['waiting', 'unread'].includes(kind(s))], ['Others', () => true]];
    const left = [...sessions], nodes = [];
    for (const [name, test] of groups) {
      const rows = left.filter(test);
      if (!rows.length) continue;
      rows.forEach(s => left.splice(left.indexOf(s), 1));
      nodes.push(variant.key === 'E' ? el('h3', name) : el('hr'), ...rows.map(row));
    }
    if (nodes[0].tagName === 'HR') nodes.shift();
    list.replaceChildren(...nodes);
    list.scrollTop = 0;
  } else {
    list.replaceChildren(...sessions.map(row));
    const at = list.querySelector('[aria-current=true]');
    list.scrollTop = at.offsetTop - (list.clientHeight - at.offsetHeight) / 2;
  }
  $('dots').replaceChildren(...sessions.map((s, i) => el('span', undefined, i === current ? 'current' : '')));
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
