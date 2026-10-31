// Throwaway: Grok-style session bots. One recipe (soft shape, shared eyes, top-left light); variety only from shape × colour.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// [name, outline on a 32px grid, eye centre y, eye spacing].
const shapes = {
  circle: ['Circle', '<circle cx="16" cy="16" r="12"/>', 17, 4.2],
  pebble: ['Pebble', '<path d="M5.6 17.2c-.5-6.4 3.8-11.3 10.6-12 7-.7 11 3.6 10.6 10.2-.3 6.8-4.6 11-11 11C9.8 26.4 6 23 5.6 17.2Z"/>', 17.5, 4.2],
  squircle: ['Squircle', '<path d="M16 4.5c9.2 0 11.5 2.3 11.5 11.5S25.2 27.5 16 27.5 4.5 25.2 4.5 16 6.8 4.5 16 4.5Z"/>', 17, 4.2],
  pill: ['Pill', '<rect x="8.5" y="3.5" width="15" height="25" rx="7.5"/>', 15, 3.6],
  triangle: ['Triangle', '<path d="M13.4 6.4a3 3 0 0 1 5.2 0l9 15.8a3 3 0 0 1-2.6 4.5H7a3 3 0 0 1-2.6-4.5Z"/>', 19.6, 3.4],
  hexagon: ['Hexagon', '<path d="M14.4 4.9a3.2 3.2 0 0 1 3.2 0l7.6 4.4a3.2 3.2 0 0 1 1.6 2.8v8.8a3.2 3.2 0 0 1-1.6 2.8l-7.6 4.4a3.2 3.2 0 0 1-3.2 0l-7.6-4.4a3.2 3.2 0 0 1-1.6-2.8v-8.8a3.2 3.2 0 0 1 1.6-2.8Z"/>', 16.8, 4.2],
  cloud: ['Cloud', '<path d="M9.5 25.5C6.2 25.5 4 23 4 20c0-2.7 1.9-4.8 4.5-5.2.6-4.4 3.6-7.3 7.5-7.3 3.5 0 6.4 2.2 7.3 5.4 2.8.4 4.7 2.7 4.7 5.7 0 3.8-2.6 6.9-6.2 6.9Z"/>', 18.8, 4.2],
  droplet: ['Droplet', '<path d="M16 3.5c4.6 5.4 10 10.4 10 16.3a10 10 0 0 1-20 0C6 13.9 11.4 8.9 16 3.5Z"/>', 19.6, 4],
  arch: ['Arch', '<path d="M6 27.5V15a10 10 0 0 1 20 0v12.5Z"/>', 17.5, 4.2],
  bean: ['Bean', '<path d="M7.5 9.5c3.2-5.4 11.5-6.3 15.6-1.2 3.4 4.2 2.4 7.4-.2 10.4-2.4 2.8-2.8 7.8-8.3 7.8-6.2 0-10.1-5-10.1-10.3 0-2.6 1.4-4.9 3-6.7Z"/>', 16.5, 4],
};
const colours = {
  red: ['Red', '#ef5a50'], orange: ['Orange', '#ff8a3d'], yellow: ['Yellow', '#ffc53d'], green: ['Green', '#3ec97a'],
  teal: ['Teal', '#2ebfb0'], blue: ['Blue', '#4c9bf0'], indigo: ['Indigo', '#6f74f0'], purple: ['Purple', '#a46cf0'],
  pink: ['Pink', '#f06ba8'], cream: ['Cream', '#f0e2c6'], graphite: ['Graphite', '#8b909a'],
};
const states = {
  idle: ['Ready', 'Calm; blinks now and then'],
  thinking: ['Thinking', 'Turns into three dots in its colour'],
  working: ['Working', 'Rings orbit it while it works'],
  waiting: ['Needs you', 'Eyes go flat; amber dot'],
  unread: ['New reply', 'Happy eyes; blue dot'],
  saved: ['Saved', 'Asleep and dimmed'],
};

// One shared light so every bot is lit the same way.
document.body.insertAdjacentHTML('afterbegin', '<svg class="bot-defs" width="0" height="0" aria-hidden="true"><defs><radialGradient id="bot-light" cx=".3" cy=".22" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="bot-shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient></defs></svg>');

function eyes(shape, state) {
  const [, , y, dx] = shapes[shape];
  return [-1, 1].map(side => {
    const x = 16 + side * dx;
    if (state === 'waiting') return `<rect class="bot-eye" x="${x - 2}" y="${y - .8}" width="4" height="1.6" rx=".8"/>`;
    if (state === 'unread') return `<path class="bot-eye-line" d="M${x - 2} ${y + .8}q2 -3 4 0"/>`;
    if (state === 'saved') return `<path class="bot-eye-line" d="M${x - 2} ${y - .4}q2 2 4 0"/>`;
    return `<rect class="bot-eye" x="${x - 1.2}" y="${y - 2.4}" width="2.4" height="4.8" rx="1.2" transform="rotate(${side * -12} ${x} ${y})"/>`;
  }).join('');
}
function botSvg(shape, colour, state, size) {
  if (state === 'thinking') return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-dots"><circle cx="8" cy="16" r="3.4"/><circle cx="16" cy="16" r="3.4"/><circle cx="24" cy="16" r="3.4"/></g></svg>`;
  const outline = shapes[shape][1];
  const rings = state === 'working' ? '<g class="bot-rings"><ellipse cx="16" cy="16" rx="16" ry="5.2"/><ellipse cx="16" cy="16" rx="16" ry="5.2" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="16" ry="5.2" transform="rotate(-60 16 16)"/></g>' : '';
  const badge = state === 'waiting' ? '<circle class="bot-badge" cx="27" cy="5" r="4"/>' : state === 'unread' ? '<circle class="bot-badge bot-new" cx="27" cy="5" r="4"/>' : '';
  const zz = state === 'saved' ? '<g class="bot-zz"><text x="24" y="9">z</text><text x="24" y="9">z</text></g>' : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure"><g class="bot-shape">${outline}</g><g class="bot-light" fill="url(#bot-light)">${outline}</g><g class="bot-light" fill="url(#bot-shade)">${outline}</g><g class="bot-eyes"><g class="bot-look">${eyes(shape, state)}</g></g></g>${rings}${badge}${zz}</svg>`;
}
function bot(shape, colour, state, size) {
  const node = el('span', undefined, 'bot');
  node.dataset.state = state;
  node.style.setProperty('--c', colours[colour][1]);
  node.style.setProperty('--blink', `-${Math.round(Math.random() * 5000)}ms`);
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${colours[colour][0]} ${shapes[shape][0].toLowerCase()}, ${states[state][0]}`);
  node.innerHTML = botSvg(shape, colour, state, size);
  return node;
}

// Option 2: each session gets a stable shape and colour from its id. Option 1: the title's kind picks them.
const hash = text => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
// Scramble the bits so ids that differ by one character still land far apart.
const mix = h => { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; };
const perSession = id => { const h = hash(id), shapeKeys = Object.keys(shapes), colourKeys = Object.keys(colours); return [shapeKeys[mix(h) % shapeKeys.length], colourKeys[mix(h + 1) % colourKeys.length]]; };
const kinds = {
  review: ['squircle', 'purple'], fix: ['triangle', 'red'], research: ['droplet', 'blue'], build: ['hexagon', 'green'],
  idea: ['circle', 'yellow'], notes: ['arch', 'cream'], test: ['pill', 'teal'], ship: ['pebble', 'orange'],
  tidy: ['bean', 'pink'], chat: ['cloud', 'indigo'], general: ['squircle', 'graphite'],
};
const sessions = [
  ['s1', 'research', 'idle', 'Investigate Claude SDK session recovery errors', '', '22h'],
  ['s2', 'review', 'idle', 'Review architecture of web app.js', '', '1d'],
  ['s3', 'build', 'idle', 'Add model-independent voice input to composer', '', '2d'],
  ['s4', 'idea', 'working', 'Session icon auto-assignment is unreliable', 'Pi: Here’s where each part came from…', '4h'],
  ['s5', 'research', 'unread', 'Investigate stuck working dot animation', 'Pi: Yes. Logging works the same as before…', '20h'],
  ['s6', 'ship', 'waiting', 'Submit backend-api-sports PR 38 review', 'Pi: Post these 3 comments?', '6h'],
  ['s7', 'fix', 'thinking', 'Fix stuck composer after image sending', 'You: try again with a photo', 'now'],
  ['s8', 'fix', 'saved', 'Fix login timing out after reconnect', 'Pi: Fixed. The token now refreshes.', '2d'],
  ['s9', 'test', 'idle', 'Test video attachment access', '', '3d'],
  ['s10', 'chat', 'saved', 'Greet the user', '', '5d'],
];
const stateLabels = { working: 'Working', thinking: 'Working', waiting: 'Needs input' };

function row([id, kind, state, title, preview, ageText], pick) {
  const [shape, colour] = pick(id, kind);
  const button = el('button', undefined, 'session'), indicators = el('span', undefined, 'session-indicators');
  button.type = 'button'; indicators.append(bot(shape, colour, state, 32));
  const body = el('div', undefined, 'session-body'), top = el('div', undefined, 'session-top'), meta = el('div', undefined, 'session-meta');
  top.append(el('strong', title)); body.append(top);
  if (preview) body.append(el('div', preview, 'session-preview'));
  if (stateLabels[state]) { const label = el('span', stateLabels[state], 'session-state'); label.dataset.status = state === 'thinking' ? 'working' : state; meta.append(label); }
  meta.append(el('span', 'pi-remote', 'session-project'), el('time', ageText, 'session-time'));
  body.append(meta); button.append(indicators, body);
  return button;
}
const options = (title, entries, current, onPick, render) => {
  const group = el('div', undefined, 'studio-group'), list = el('div', undefined, 'studio-options');
  group.append(el('h2', title), list);
  for (const [key, value] of entries) {
    const button = el('button', undefined, 'studio-option'); button.type = 'button';
    button.setAttribute('aria-pressed', String(key === current)); button.append(...render(key, value));
    button.addEventListener('click', () => onPick(key)); list.append(button);
  }
  return group;
};
const studio = { shape: 'pebble', colour: 'blue', state: 'idle' };

const views = [
  { key: 'session', name: 'Per session', description: 'Option 2, like Grok: every session gets its own stable shape and colour', render() {
    $('list').replaceChildren(...sessions.map(item => row(item, id => perSession(id))));
  } },
  { key: 'kind', name: 'Per kind', description: 'Option 1: the title’s verb picks the shape and colour, so all Fix sessions match', render() {
    $('legend').append(...Object.entries(kinds).filter(([kind]) => kind !== 'general').map(([kind, [shape, colour]]) => { const cell = el('div', undefined, 'roster-cell'); cell.append(bot(shape, colour, 'idle', 40), el('small', kind[0].toUpperCase() + kind.slice(1))); return cell; }));
    $('legend').className = 'roster';
    $('list').replaceChildren(...sessions.map(item => row(item, (id, kind) => kinds[kind] || kinds.general)));
  } },
  { key: 'states', name: 'States', description: 'One bot through every state, at list size and large', render() {
    $('legend').className = 'state-grid';
    $('legend').append(...Object.entries(states).map(([state, [name, note]]) => { const cell = el('div', undefined, 'state-cell'); const pair = el('div', undefined, 'state-pair'); pair.append(bot('pebble', 'blue', state, 64), bot('pebble', 'blue', state, 32)); cell.append(pair, el('strong', name), el('small', note)); return cell; }));
  } },
  { key: 'roster', name: 'Roster', description: 'Every shape in a few colours: the variety you get from one recipe', render() {
    $('legend').className = 'roster roster-wide';
    const keys = Object.keys(colours);
    $('legend').append(...Object.keys(shapes).flatMap((shape, i) => [0, 3, 6].map(step => { const cell = el('div', undefined, 'roster-cell'); cell.append(bot(shape, keys[(i + step) % keys.length], 'idle', 44)); return cell; })));
  } },
  { key: 'studio', name: 'Studio', description: 'Tap a shape, colour and state to test any combination', render() {
    const draw = () => {
      const preview = el('div', undefined, 'studio-preview');
      preview.append(bot(studio.shape, studio.colour, studio.state, 120));
      const sizes = el('div', undefined, 'studio-sizes');
      for (const size of [24, 32, 40]) { const cell = el('div'); cell.append(bot(studio.shape, studio.colour, studio.state, size), el('small', size + 'px')); sizes.append(cell); }
      $('legend').replaceChildren(preview, sizes,
        options('Shape', Object.entries(shapes), studio.shape, key => { studio.shape = key; draw(); }, key => [bot(key, studio.colour, 'idle', 30), el('small', shapes[key][0])]),
        options('Colour', Object.entries(colours), studio.colour, key => { studio.colour = key; draw(); }, key => [bot(studio.shape, key, 'idle', 30), el('small', colours[key][0])]),
        options('State', Object.entries(states), studio.state, key => { studio.state = key; draw(); }, key => [el('small', states[key][0])]));
      $('list').replaceChildren(row(['studio', '', studio.state, 'Your combination in a session row', 'Pi: This is how it reads in the list.', 'now'], () => [studio.shape, studio.colour]));
    };
    $('legend').className = 'studio';
    draw();
  } },
];
let view;
function render() {
  $('label').textContent = view.name; $('description').textContent = view.description;
  $('legend').className = ''; $('legend').replaceChildren(); $('list').replaceChildren();
  view.render();
  const url = new URL(location.href); url.searchParams.set('view', view.key); history.replaceState(null, '', url);
}
const set = key => { view = views.find(item => item.key === key) || views[0]; render(); };
const cycle = step => set(views[(views.indexOf(view) + step + views.length) % views.length].key);
$('prev').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
set(new URLSearchParams(location.search).get('view'));
