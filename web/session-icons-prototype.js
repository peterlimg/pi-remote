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
  { key: 'I', name: 'Bots', description: 'Grok Bot style: one bot per kind; it bobs while working, wiggles when it needs you, smiles at a new reply, sleeps when saved' },
  { key: 'J', name: 'Pixel bots', description: 'Same idea as 8×8 sprites, matching the pixel bricks of the working indicator' },
  { key: 'K', name: 'Calm bots', description: 'Bots that only blink; a small corner dot shows working, needs you or new reply' },
  { key: 'L', name: 'Notion icons', description: 'Notion page icons: filled glyph in Notion’s palette, before the title; grey page when there is no kind' },
  { key: 'M', name: 'Notion emoji', description: 'Notion’s most common page icon: an emoji before the title, at title size' },
  { key: 'N', name: 'Notion Faces', description: 'Hand-drawn ink faces with one spot colour; the expression shows the state' },
];
const bots = ['I', 'J', 'K', 'N'];
// Filled 24px glyphs in the spirit of Notion's built-in icons; .cut lines are knocked out in the page colour.
const notionGlyphs = {
  review: '<path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-10l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path class="cut" d="m8 10.5 2.5 2.5L16 7.5"/>',
  fix: '<circle cx="12" cy="6.5" r="3.2"/><rect x="6.5" y="9" width="11" height="12.5" rx="5.5"/><path class="cut" d="M12 10.5v10"/><path class="leg" d="M6.5 12.5H3M6.5 16.5H3M7.2 20l-2.4 2M17.5 12.5H21M17.5 16.5H21M16.8 20l2.4 2M10.2 4 8.6 2M13.8 4l1.6-2"/>',
  research: '<circle cx="10.5" cy="10.5" r="5" opacity=".3"/><circle class="ring" cx="10.5" cy="10.5" r="6.5"/><path class="leg" d="m15.8 15.8 5.2 5.2" stroke-width="3.4"/>',
  build: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/>',
  idea: '<path d="M12 2a7 7 0 0 0-4.2 12.6c.8.6 1.2 1.4 1.2 2.4h6c0-1 .4-1.8 1.2-2.4A7 7 0 0 0 12 2Z"/><rect x="9" y="18.3" width="6" height="2" rx="1"/><rect x="10" y="21.3" width="4" height="1.7" rx=".85"/>',
  notes: '<path d="M6 2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path class="cut" d="M14 2.5V8h5.5M8 12.5h8M8 16.5h6"/>',
  none: '<path class="outline" d="M6.5 2.8h7.7l5 5V19.5a1.7 1.7 0 0 1-1.7 1.7H6.5a1.7 1.7 0 0 1-1.7-1.7V4.5a1.7 1.7 0 0 1 1.7-1.7Z"/><path class="outline" d="M14 3v5h5M8.5 12.5h7M8.5 16h5"/>',
};
const notionEmoji = { review: '👀', fix: '🐞', research: '🔭', build: '🔨', idea: '💡', notes: '📝', none: '📄' };
function pageIcon(kind = 'none', size = 20) {
  const node = el('span', variant.key === 'M' ? notionEmoji[kind] : '', 'page-icon');
  node.dataset.kind = kind; node.setAttribute('role', 'img'); node.setAttribute('aria-label', glyphs[kind]?.[0] || 'Page');
  if (variant.key === 'M') node.style.fontSize = size * .85 + 'px';
  else node.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${notionGlyphs[kind]}</svg>`;
  return node;
}
// Notion Faces-style doodles on a 32px grid: ink outline, ink hair, one spot of colour per kind.
const doodleParts = {
  review: '<path class="hair" d="M7 13c2-5 6-7.4 10-7 4 .4 7.5 3 8.5 7-3-2-6-2.6-9.5-2.2-3.4.3-6.4 1-9 2.2Z"/><g class="doodle-line"><circle cx="12.3" cy="17" r="3.2"/><circle cx="19.7" cy="17" r="3.2"/><path d="M15.5 16.6h1"/></g><path class="acc-line" d="M9.1 17H6.4M22.9 17h2.7"/>',
  fix: '<path class="hair" d="M6.5 14 8 8l2.5 3 1.5-5 2.5 4 2-5 2 5 2.5-4 1.5 5 2.5-3 1.5 6c-6-2.5-13-2.5-19.5 0Z"/><rect class="acc" x="19.5" y="20" width="5.5" height="2.6" rx="1.3" transform="rotate(-25 22 21.3)"/>',
  research: '<path class="doodle-line" d="M7 13.5c-1-3 1-5.5 3.5-5 0-2.5 3-3.6 4.8-2 1.6-1.8 4.6-1 4.9 1.3 2.7-.4 4.4 2.3 3.6 4.7"/><circle class="acc-line" cx="19.7" cy="17" r="3.4"/><path class="acc-line" d="M22.6 18.8c1.2 2.4 1.4 4.6.6 6.8"/>',
  build: '<path class="acc" d="M6.3 14.2C6.5 8.4 10.7 5.3 16 5.3s9.5 3.1 9.7 8.9Z"/><path class="doodle-line" d="M6.3 14.2C6.5 8.4 10.7 5.3 16 5.3s9.5 3.1 9.7 8.9ZM6.2 12.2h19.6"/><circle class="hair" cx="16" cy="4.2" r="1.6"/>',
  idea: '<circle class="hair" cx="16" cy="5.2" r="3"/><path class="doodle-line" d="M7.6 12.6c2.5-3.6 5.4-4.9 8.4-4.9s5.9 1.3 8.4 4.9"/><path class="acc-line" d="m21.8 3.4 1.6-1.6M24 6.6h2.2M10.2 3.4 8.6 1.8"/>',
  notes: '<path class="hair" d="M5.5 20.5c-1.5-8 2.5-14 10.5-14s12 6 10.5 14c-1-3-1.4-5.8-3-7.4-3.6 1-9.5 1-15 0-1.6 1.6-2 4.4-3 7.4Z"/><path class="acc-line thick" d="m25.2 9.6 4-6"/>',
  none: '',
};
const mouths = { idle: 'M13.6 21.8q2.4 1.6 4.8 0', working: 'M14 22.2h4', waiting: 'M13.3 22.6q1.35-1.3 2.7 0t2.7 0', unread: 'M12.8 20.8q3.2 3.8 6.4 0', saved: 'M15 22.3h2' };
function doodleSvg(kind, state) {
  const eyes = state === 'saved' ? '<path class="doodle-line" d="M11 17.2q1.3 1 2.6 0M18.4 17.2q1.3 1 2.6 0"/>'
    : '<circle class="ink" cx="12.3" cy="17" r="1.3"/><circle class="ink" cx="19.7" cy="17" r="1.3"/>';
  return `<path class="face" d="M16 6.5c5.9-.2 10.3 4.6 10.2 10.6-.1 6.1-4.4 10.4-10.3 10.4S5.6 23 5.8 16.9C6 11 10.2 6.7 16 6.5Z"/>${doodleParts[kind]}<g class="eyes"><g class="look">${eyes}</g></g><path class="doodle-line" d="${mouths[state] || mouths.idle}"/>`;
}
// Geometric bots on a 32px grid: one construction (body + eyes), told apart by shape and accessory.
const botParts = {
  review: { body: '<rect x="4" y="7" width="24" height="21" rx="7"/>', eyes: [[11.5, 17], [20.5, 17]], extra: '', front: '<g class="ink-line"><circle cx="11.5" cy="17" r="4.6"/><circle cx="20.5" cy="17" r="4.6"/><path d="M16.1 16.4h-.2"/></g>' },
  fix: { body: '<circle cx="16" cy="19" r="11"/>', eyes: [[11.5, 19], [20.5, 19]], extra: '<g class="hue-line"><path d="M11 9 8 3.5M21 9l3-5.5"/></g><circle class="tip" cx="8" cy="3.5" r="2"/><circle class="tip" cx="24" cy="3.5" r="2"/>' },
  research: { body: '<rect x="6" y="4" width="20" height="25" rx="10"/>', eyes: [[16, 15, 1.7]], extra: '' },
  build: { body: '<rect x="4" y="11" width="24" height="18" rx="6"/>', eyes: [[11.5, 20], [20.5, 20]], extra: '<path class="accent" d="M7 12a9 8 0 0 1 18 0Z"/><rect class="accent" x="3" y="11" width="26" height="3" rx="1.5"/>' },
  idea: { body: '<circle cx="16" cy="20" r="10"/>', eyes: [[12, 20], [20, 20]], extra: '<g class="hue-line"><path d="M16 10V6.5"/></g><circle class="bulb" cx="16" cy="4.5" r="3"/>' },
  notes: { body: '<rect x="5" y="8" width="22" height="20" rx="6"/>', eyes: [[11.5, 18], [20.5, 18]], extra: '<ellipse class="accent" cx="14" cy="8.5" rx="10" ry="3.6" transform="rotate(-8 14 8.5)"/><circle class="accent" cx="10" cy="5.2" r="1.6"/>' },
  none: { body: '<rect x="5" y="7" width="22" height="21" rx="8"/>', eyes: [[12, 17], [20, 17]], extra: '' },
};
const botNames = { none: 'Session' };
const botState = item => item.unread ? 'unread' : item.status || 'idle';
function eyesSvg(eyes, state) {
  return eyes.map(([x, y, s = 1]) => {
    if (state === 'saved') return `<path class="ink-line" d="M${x - 2.4 * s} ${y}h${4.8 * s}"/>`;
    if (state === 'unread') return `<path class="ink-line" d="M${x - 2.4 * s} ${y + 1}q${2.4 * s} -${3.6 * s} ${4.8 * s} 0"/>`;
    return `<ellipse class="ink" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/><circle class="shine" cx="${x + .7 * s}" cy="${y - 1.1 * s}" r="${.7 * s}"/>`;
  }).join('');
}
function badgeSvg(state) {
  if (state === 'waiting') return '<g class="bot-badge" data-state="waiting"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>';
  if (state === 'unread' || state === 'working' && variant.key === 'K') return `<g class="bot-badge" data-state="${state}"><circle cx="27" cy="5" r="4"/></g>`;
  return '';
}
// 8×8 sprites: # body, a accessory, l lens, y light, e eye.
const sprites = {
  review: ['........', '.######.', '########', '#ll##ll#', '#le##el#', '########', '.######.', '..#..#..'],
  fix: ['.a....a.', '..a..a..', '.######.', '########', '#e####e#', '########', '.######.', '.#.##.#.'],
  research: ['...a....', '..####..', '.######.', '.##ee##.', '.##ee##.', '.######.', '..####..', '..#..#..'],
  build: ['..aaaa..', '.aaaaaa.', 'aaaaaaaa', '.######.', '.#e##e#.', '.######.', '.######.', '..#..#..'],
  idea: ['...yy...', '...yy...', '....a...', '.######.', '##e##e##', '########', '.######.', '..#..#..'],
  notes: ['..aaaa..', '.aaaaaaa', '.######.', '##e##e##', '########', '#.####.#', '.######.', '..#..#..'],
  none: ['........', '..####..', '.######.', '##e##e##', '########', '.######.', '..####..', '..#..#..'],
};
function pixelSvg(kind) {
  const cells = { '#': [], a: [], l: [], y: [], e: [] };
  sprites[kind].forEach((line, y) => [...line].forEach((c, x) => cells[c]?.push(`<rect x="${x * 4}" y="${y * 4}" width="4" height="4"/>`)));
  return `<g class="body">${cells['#'].join('')}</g><g class="accent">${cells.a.join('')}</g><g class="lens">${cells.l.join('')}</g><g class="bulb">${cells.y.join('')}</g><g class="eyes"><g class="look ink">${cells.e.join('')}</g></g>`;
}
function bot(kind = 'none', item = {}, size = 28) {
  const node = el('span', undefined, 'bot'), state = botState(item), parts = botParts[kind];
  node.dataset.kind = kind; node.dataset.state = state; node.dataset.style = variant.key;
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${glyphs[kind]?.[0] || botNames[kind]} bot, ${state}`);
  // Desynchronised blinks so a list of bots never blinks in unison.
  node.style.setProperty('--blink-delay', `-${(Math.random() * 6).toFixed(2)}s`);
  const inner = variant.key === 'J' ? pixelSvg(kind) : variant.key === 'N' ? doodleSvg(kind, state)
    : `${parts.extra}<g class="body">${parts.body}</g><g class="eyes"><g class="look">${eyesSvg(parts.eyes, state)}</g></g>${parts.front || ''}`;
  node.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="figure">${inner}</g>${badgeSvg(state)}</svg>`;
  return node;
}
// One row showing how a bot carries each state.
function statesStrip() {
  const strip = el('div', undefined, 'bot-states');
  for (const [label, item] of [['Ready', {}], ['Working', { status: 'working' }], ['Needs you', { status: 'waiting' }], ['New reply', { unread: true }], ['Saved', { status: 'saved' }]]) {
    const cell = el('div'); cell.append(bot('build', item, 36), el('small', label)); strip.append(cell);
  }
  return strip;
}
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
  if (bots.includes(variant.key)) return bot(item.kind, item);
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
  const title = el('strong', item.title);
  if (['L', 'M'].includes(variant.key)) title.prepend(pageIcon(item.kind));
  top.append(title);
  if (item.pinned) top.append(Object.assign(el('span', '', 'session-pinned'), { innerHTML: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 3H8v2l1 1v5l-3 3v2h5v5l1 1 1-1v-5h5v-2l-3-3V6l1-1Z"/></svg>' }));
  body.append(top);
  if (item.preview) body.append(el('div', item.preview, 'session-preview'));
  const meta = el('div', undefined, 'session-meta');
  if (item.status === 'working' || item.status === 'waiting') {
    const state = el('span', item.status === 'working' ? 'Working' : 'Needs input', 'session-state');
    state.dataset.status = item.status; meta.append(state);
  }
  const project = el('span', undefined, 'session-project');
  if (item.kind && !['E', 'G', 'H', 'L', 'M', ...bots].includes(variant.key)) project.append(variant.key === 'F' ? chip(item.kind) : kindIcon(item.kind));
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
    big.append(['L', 'M'].includes(variant.key) ? pageIcon(kind, 32) : bots.includes(variant.key) ? bot(kind, {}, 40) : variant.key === 'F' ? chip(kind) : variant.key === 'G' ? ring(kind, {}, 28) : kindIcon(kind, 28));
    if (variant.key !== 'F') small.append(name);
    cell.append(big, small);
    return cell;
  }));
  $('list').replaceChildren(...bots.includes(variant.key) ? [statesStrip()] : [], ...sessions.map(row));
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
}
const set = key => { variant = variants.find(v => v.key === key) || variants[1]; render(); };
const cycle = step => set(variants[(variants.indexOf(variant) + step + variants.length) % variants.length].key);
$('prev').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
set(new URLSearchParams(location.search).get('variant'));
