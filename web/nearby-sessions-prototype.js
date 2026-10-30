// Throwaway: sample sessions only, nothing here talks to the host.
const $ = id => document.getElementById(id);
const sessions = [
  { title: 'Fix login redirect on Safari', project: 'primezero-web', age: '20m', status: 'idle', unread: true, preview: 'Pi: Fixed. The cookie was SameSite=Strict.' },
  { title: 'Add model-independent voice input to the composer', project: 'pi-remote', age: '1d', status: 'idle', icon: '💡', preview: 'You: try the Web Speech API first' },
  { title: 'Investigate Claude SDK session recovery', project: 'pi-remote', age: 'Oct 21', status: 'saved', icon: '🔎', preview: 'Pi: Wrote docs/research/sdk-recovery.md' },
  { title: 'Untitled session', project: 'pi-remote', age: '1h', status: 'idle', preview: '' },
  { title: 'Review PZ-756 withdrawal-only exclusion', project: 'primezero', age: '3h', status: 'waiting', icon: '👀', preview: 'Pi: Post these 3 comments to the PR?' },
  { title: 'Compress video with FFmpeg while preserving quality', project: 'scratch', age: 'now', status: 'working', preview: 'Pi: Encoding pass 2 of 2…' },
  { title: 'Opentunnel reconnect flake', project: 'pi-remote', age: 'now', status: 'working', pinned: true, preview: 'Pi: Running the reconnect test 20 times…' },
  { title: 'Draft daily update', project: 'notes', age: '2d', status: 'saved', preview: 'Pi: Here is today’s update.' },
];
let current = 3, variant;

const variants = [
  { key: 'A', name: 'Signals', description: 'Today’s rows, plus the state the main list already knows' },
  { key: 'B', name: 'Project tiles', description: 'A coloured tile per project (or the session emoji), status on its corner, last message below' },
  { key: 'C', name: 'Needs you first', description: 'Tiles grouped by what needs attention; order no longer matches the dots' },
  { key: 'D', name: 'Tiles + dots', description: 'B, and the dots themselves show new, needs-input and working' },
];

const kind = item => item.status === 'waiting' ? 'waiting' : item.unread ? 'unread' : item.status === 'working' ? 'working' : '';
const label = { waiting: 'Needs input', unread: 'New reply', working: 'Working' };
const hue = name => [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
const initials = name => { const parts = name.split(/[-_ ]+/); return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).replace(/^./, c => c.toUpperCase()); };
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
function tile(item) {
  const node = el('span', item.icon || initials(item.project), 'tile' + (item.icon ? ' emoji' : ''));
  node.style.setProperty('--hue', hue(item.project));
  const badge = kind(item);
  if (badge) { const mark = el('span', badge === 'waiting' ? '!' : '', 'badge'); mark.dataset.kind = badge; node.append(mark); }
  return node;
}

function row(item) {
  const index = sessions.indexOf(item), button = el('button', undefined, 'row'), text = el('span', undefined, 'text');
  button.type = 'button'; button.dataset.status = item.status;
  button.setAttribute('aria-current', String(index === current));
  if (['waiting', 'unread'].includes(kind(item))) button.dataset.attention = kind(item);
  const title = el('strong', item.title);
  if (item.pinned) title.append(el('span', '📌', 'pin'));
  if (variant.key === 'A') {
    const state = label[kind(item)];
    text.append(title, el('small', [state, item.project].filter(Boolean).join(' · '), state ? 'label' : ''));
    button.append(statusIcon(item), text);
  } else {
    text.append(title, el('small', item.preview || item.project));
    button.append(tile(item), text);
  }
  button.append(el('time', item.age));
  button.addEventListener('click', () => { current = index; item.unread = false; render(); });
  return button;
}

function render() {
  const list = $('list'), item = sessions[current];
  $('pill-title').textContent = item.title; $('pill-project').textContent = item.project;
  if (variant.key === 'C') {
    const groups = [['Needs you', s => ['waiting', 'unread'].includes(kind(s))], ['Working', s => kind(s) === 'working'], ['Earlier', () => true]];
    const left = [...sessions], nodes = [];
    const counts = ['waiting', 'unread', 'working'].map(k => [sessions.filter(s => kind(s) === k).length, { waiting: 'need input', unread: 'new', working: 'working' }[k]]).filter(([n]) => n);
    const summary = el('p', undefined, 'summary');
    counts.forEach(([n, word], i) => { summary.append(el('b', String(n)), ` ${word}${i < counts.length - 1 ? ' · ' : ''}`); });
    nodes.push(summary);
    for (const [name, test] of groups) {
      const rows = left.filter(test);
      if (!rows.length) continue;
      rows.forEach(s => left.splice(left.indexOf(s), 1));
      nodes.push(el('h3', name), ...rows.map(row));
    }
    list.replaceChildren(...nodes);
    list.scrollTop = 0;
  } else {
    list.replaceChildren(...sessions.map(row));
    const at = list.querySelector('[aria-current=true]');
    list.scrollTop = at.offsetTop - (list.clientHeight - at.offsetHeight) / 2;
  }
  $('dots').classList.toggle('coloured', variant.key === 'D');
  $('dots').replaceChildren(...sessions.map((s, i) => { const dot = el('span', undefined, i === current ? 'current' : ''); dot.dataset.kind = kind(s); return dot; }));
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
