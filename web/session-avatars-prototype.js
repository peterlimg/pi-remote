// Avatar set studies. Static samples only; no app transport or storage.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
let uid = 0;

// Now: production drawings, coloured by the production stylesheet.
const current = {
  luna: ['Luna', '<path d="M25 3C17 1 8 4 4 12C0 22 7 30 16 30C22 30 27 27 30 22C20 26 13 20 13 12C13 7 18 3 25 3Z"/>', [[7.5, 20, .9], [12.5, 21, .9]]],
  miso: ['Miso', '<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]], '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/>'],
  jelly: ['Jelly', '<path d="M4 20C4 10 8 4 16 4s12 6 12 16Q22 23 16 21Q10 23 4 20Z"/>', [[12, 15], [20, 15]], '<path class="character-tentacle" d="M9 19v5q-4 4 0 7"/><path class="character-tentacle" d="M16 20v6q4 2 0 5"/><path class="character-tentacle" d="M23 19v6q-4 2 0 6"/>'],
  sol: ['Sol', '<circle cx="16" cy="17" r="9"/>', [[12, 17], [20, 17]], '<g class="character-sun-rays"><path d="M16 2v3M16 29v3M1 17h3M28 17h3M5 6l2 2M25 26l2 2M5 28l2-2M25 8l2-2"/></g>'],
  moss: ['Moss', '<path d="M3 20Q2 9 8 8Q13 6 16 12Q19 6 24 8Q30 9 29 20Q32 30 16 30Q0 30 3 20Z"/>', [[10, 15.5], [22, 15.5]], '<ellipse class="bot-body" cx="6" cy="29.5" rx="4" ry="2"/><ellipse class="bot-body" cx="26" cy="29.5" rx="4" ry="2"/>'],
  orbit: ['Orbit', '<circle cx="16" cy="16" r="10"/>', [[12, 13.5], [20, 13.5]], '<ellipse class="character-ring-back" cx="16" cy="17" rx="15" ry="5" transform="rotate(-22 16 17)"/>', '<path class="character-ring-front" d="M2 22C8 29 28 20 30 12"/>'],
  comet: ['Comet', '<circle cx="19" cy="14" r="9.5"/>', [[16, 13], [23, 13]], '', '<path class="bot-accent" d="M16 17Q8 18 3 29Q14 28 22 21Z"/><path class="bot-body" d="M13 14Q6 16 2 23Q10 23 18 19Z"/><path class="bot-body" d="M20 20Q15 28 9 31Q10 24 16 18Z"/>'],
  nim: ['Nim', '<ellipse cx="16" cy="19" rx="8" ry="10"/>', [[12.5, 18], [19.5, 18]], '<path class="bot-accent" d="M10 18C2 10-1 13 2 21c-3 5 2 8 8 3Z"/><path class="bot-accent" d="M22 18c8-8 11-5 8 3 3 5-2 8-8 3Z"/><path class="bot-stalk" d="m13 10-2-5m8 5 2-5"/>'],
  bun: ['Bun', '<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<rect class="bot-body" x="8" y="2" width="5" height="13" rx="2.5"/><rect class="bot-body" x="19" y="4" width="5" height="11" rx="2.5"/>'],
  pip: ['Pip', '<rect x="5" y="9" width="22" height="20" rx="8"/>', [[12, 19], [20, 19]], '<path class="bot-stalk" d="M16 10V7l-5-3.5"/><circle class="bot-body" cx="11" cy="3.5" r="2"/>'],
  sprout: ['Sprout', '<rect x="4" y="10" width="24" height="19" rx="9"/>', [[12, 19], [20, 19]], '<path class="bot-stalk" d="M16 11V6"/><path class="bot-body" d="M16 7C10 7 7 4 8 1c5 0 8 2 8 6Z"/><path class="bot-accent" d="M16 8c0-5 3-7 8-7 0 4-3 7-8 7Z"/>'],
  stella: ['Stella', '<path d="M14.3 3.9Q16 1 17.7 3.9l3.4 6.5 7.2 1Q31.5 12 29 14.5l-5.3 5.1 1.3 7.3Q25.6 30.5 22.5 29L16 25.6 9.5 29Q6.4 30.5 7 26.9l1.3-7.3L3 14.5Q.5 12 3.7 11.4l7.2-1Z"/>', [[12, 18], [20, 18]]],
};
const currentSvg = ([, body, eyes, back = '', front = '']) => back + `<g class="bot-body">${body}</g>`
  + eyes.map(([x, y, s = 1]) => `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/>`).join('') + front;

// A: one body for everyone; only the headpiece and hue change.
const pebbleEyes = '<ellipse class="av-ink" cx="12.5" cy="20" rx="1.7" ry="2.5"/><ellipse class="av-ink" cx="19.5" cy="20" rx="1.7" ry="2.5"/>';
const pebble = (back, front = '') => () => `${back}<rect class="av-main" x="5" y="11" width="22" height="19" rx="8"/>${front}${pebbleEyes}`;
const pebbles = [
  ['Bun', 0, pebble('<rect class="av-main" x="8.5" y="1" width="5.5" height="15" rx="2.75" transform="rotate(-10 11.25 15)"/><rect class="av-main" x="18" y="1" width="5.5" height="15" rx="2.75" transform="rotate(10 20.75 15)"/><rect class="av-light" x="10" y="3.5" width="2.5" height="8" rx="1.25" transform="rotate(-10 11.25 15)"/><rect class="av-light" x="19.5" y="3.5" width="2.5" height="8" rx="1.25" transform="rotate(10 20.75 15)"/>')],
  ['Bao', 35, pebble('<circle class="av-main" cx="8" cy="11" r="4"/><circle class="av-main" cx="24" cy="11" r="4"/><circle class="av-deep" cx="8" cy="10.4" r="1.7"/><circle class="av-deep" cx="24" cy="10.4" r="1.7"/>')],
  ['Miso', 65, pebble('<path class="av-main av-round" d="M7 16 8 4.5 15 11.5ZM25 16 24 4.5 17 11.5Z"/><path class="av-deep" d="M9.4 10.8 9.8 7.6 12.3 10.3ZM22.6 10.8 22.2 7.6 19.7 10.3Z"/>')],
  ['Sol', 92, pebble('<path class="av-stroke-deep" d="M16 8.5V3.5M10.2 10.2 7.6 5.6M21.8 10.2l2.6-4.6M6 14.2 2.4 12.4M26 14.2l3.6-1.8"/>'), .8],
  ['Sprout', 130, pebble('<path class="av-stroke" d="M16 12V7.5"/><path class="av-deep" d="M16 8.5C11.5 8.5 9 6 9.3 2.6 13.5 2.4 16 4.6 16 8.5Z"/><path class="av-light" d="M16 9c0-4 2.6-6.4 6.8-6.3.2 3.6-2.6 6.4-6.8 6.3Z"/>')],
  ['Jelly', 170, pebble('<path class="av-stroke" d="M10.5 28q-1.6 2 0 3.6M16 28.5q1.6 2 0 3.5M21.5 28q-1.6 2 0 3.6"/>')],
  ['Comet', 210, pebble('<path class="av-main" d="M12 12.5C11 7.5 14.5 3 21 2.5c-2.2 1.6-3.2 3.6-2.8 6.2 1.2-1.6 3-2.4 5.2-2.2-2.4 1.2-3.6 3-3.6 5.5Z"/>')],
  ['Pip', 245, pebble('<path class="av-stroke" d="M16 12V6.5"/><circle class="av-deep" cx="16" cy="4.5" r="2.8"/>')],
  ['Luna', 275, id => pebble(`<mask id="${id}"><rect width="32" height="32" fill="#fff"/><circle cx="18.6" cy="4.8" r="3.9" fill="#000"/></mask><circle class="av-light" cx="16" cy="6.8" r="4.6" mask="url(#${id})"/>`)()],
  ['Orbit', 305, pebble('', '<ellipse class="av-ring" cx="16" cy="6.5" rx="7.5" ry="2.4" transform="rotate(-8 16 6.5)"/>')],
  ['Stella', 335, pebble('', '<path class="av-light" d="M22.5 8.5c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4Z"/>')],
  ['Puff', 250, pebble('<circle class="av-main" cx="10" cy="12.5" r="4.2"/><circle class="av-main" cx="16.5" cy="10.5" r="5"/><circle class="av-main" cx="22.5" cy="12.8" r="3.8"/>'), undefined, .015],
];

// B: round tokens; a fringe or marking inside the circle carries identity.
const tokenEyes = '<ellipse class="av-ink" cx="12.5" cy="18.5" rx="1.7" ry="2.4"/><ellipse class="av-ink" cx="19.5" cy="18.5" rx="1.7" ry="2.4"/>';
const token = (mark, extra = '') => id => `<clipPath id="${id}"><circle cx="16" cy="16" r="13"/></clipPath><circle class="av-main" cx="16" cy="16" r="13"/><g clip-path="url(#${id})">${mark}</g>${extra}${tokenEyes}`;
const tokens = [
  ['Pip', 0, token('<path class="av-deep" d="M12.5 0h7v10q-3.5 2.4-7 0Z"/>')],
  ['Bo', 35, token('<path class="av-deep" d="M0 0H32V11.5H0Z"/>')],
  ['Miso', 65, token('<path class="av-deep" d="M0 0H32V12C25 9 19 10 13 15 11 11 5 10 0 13Z"/>')],
  ['Stella', 92, token('<path class="av-light" d="M21.5 4.5c.6 3 1.5 3.9 4.5 4.5-3 .6-3.9 1.5-4.5 4.5-.6-3-1.5-3.9-4.5-4.5 3-.6 3.9-1.5 4.5-4.5Z"/>'), .8],
  ['Sprout', 130, token('<path class="av-deep" d="M16 12C12 12 9.5 9 10 5c4 0 6 3 6 7Zm0 0c0-4 2.5-7 6.5-7 .5 4-2.5 7-6.5 7Z"/>')],
  ['Jelly', 170, token('<path class="av-deep" d="M0 0H32V11q-2.667 3.5-5.333 0t-5.333 0-5.333 0-5.334 0-5.333 0-5.333 0Z"/>')],
  ['Comet', 210, token('<path class="av-deep" d="M0 0H32V11l-2.667 3-2.667-3-2.666 3-2.667-3-2.667 3-2.666-3-2.667 3-2.667-3-2.666 3-2.667-3-2.667 3L0 11Z"/>')],
  ['Pom', 245, token('<path class="av-deep" d="M3 13C3 6 9 2.5 16 2.5S29 6 29 13Z"/><path class="av-light" d="M3 10.5h26v3H3Z"/>', '<circle class="av-light" cx="16" cy="2.6" r="2.6"/>')],
  ['Luna', 275, token('<rect class="av-deep" width="32" height="32"/><circle class="av-main" cx="11.5" cy="16" r="13"/>')],
  ['Orbit', 305, token('<path class="av-deep" d="M0 22.5 32 15v4.5L0 27Z"/><path class="av-light" d="M0 29 32 21.5v1.5L0 30.5Z"/>')],
  ['Puff', 335, token('<path class="av-deep" d="M32 0V10a4 4 0 0 1-8 0 4 4 0 0 1-8 0 4 4 0 0 1-8 0 4 4 0 0 1-8 0V0Z"/>')],
  ['Mochi', 250, token('<ellipse class="av-blush" cx="9" cy="22.5" rx="2.6" ry="1.6"/><ellipse class="av-blush" cx="23" cy="22.5" rx="2.6" ry="1.6"/>'), undefined, .015],
];

// C: the logo's geometry and three colours; body and headpiece swap colours.
const logo = { c: '#f09082', b: '#4d9abf', g: '#f1be58' };
const blockEyes = '<rect class="av-ink" x="10.4" y="18.6" width="2.6" height="3.8" rx=".6"/><rect class="av-ink" x="19" y="18.6" width="2.6" height="3.8" rx=".6"/>';
const block = (head, colours) => () => `<g style="fill:${logo[colours[1]]}">${head}</g><rect style="fill:${logo[colours[0]]}" x="5" y="12" width="22" height="18" rx="2"/>${blockEyes}`;
const blocks = [
  ['Arch', 'cb', '<path d="M6 12a10 10 0 0 1 20 0Z"/>'],
  ['Tuck', 'bg', '<path d="M5 12V3a9 9 0 0 1 9 9Z"/>'],
  ['Flip', 'gc', '<path d="M27 12V3a9 9 0 0 0-9 9Z"/>'],
  ['Peak', 'bc', '<path d="M5 12 16 2.5 27 12Z"/>'],
  ['Ears', 'gb', '<path d="M6.5 5h6v7h-6ZM19.5 5h6v7h-6Z"/>'],
  ['Stair', 'cg', '<path d="M5 4h9v4h13v4H5Z"/>'],
  ['Tee', 'cb', '<path d="M14 6h4v6h-4ZM10 2h12v4H10Z"/>'],
  ['Duo', 'bg', '<path d="M6 12a5 5 0 0 1 10 0ZM16 12a5 5 0 0 1 10 0Z"/>'],
  ['Slope', 'gc', '<path d="M5 12 27 3.5V12Z"/>'],
  ['Bobble', 'bc', '<circle cx="16" cy="7" r="5"/>'],
  ['Brim', 'gb', '<path d="M3 8.5h26V12H3ZM9 4.5h14v4H9Z"/>'],
  ['Nook', 'cg', '<path d="M27 15a7.5 7.5 0 0 1 0 15Z"/>'],
].map(([name, colours, head]) => [name, 0, block(head, colours)]);

const sets = [
  { key: 'now', name: 'Now · current cast', description: 'Today’s characters. Different shapes, sizes and colours.', cast: Object.keys(current).map(kind => [current[kind][0], kind]) },
  { key: 'pebbles', name: 'A · Pebbles', description: 'One body for everyone. Ears, leaves and hats tell them apart.', cast: pebbles },
  { key: 'tokens', name: 'B · Tokens', description: 'Round, like profile pictures. A fringe or mark inside each circle.', cast: tokens },
  { key: 'blocks', name: 'C · Blocks', description: 'Built from the Pi Remote logo’s shapes and three colours.', cast: blocks },
];
const rowSamples = [
  ['Fix mobile session reconnect handling', 'Working'],
  ['Prototype animation icons in session list', 'Working'],
  ['Investigate saved session recovery', 'Needs input'],
  ['Compress video with FFmpeg without quality loss', 'Ready'],
  ['Review promotional exclusion logic', 'Ready'],
  ['Check agent-desktop visibility', 'Ready'],
];
let set = sets.find(item => item.key === new URL(location.href).searchParams.get('set')) || sets[1];
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function avatar(target, index, size) {
  const entry = target.cast[index], node = el('span', undefined, 'av');
  node.style.setProperty('--size', `${size}px`); node.setAttribute('role', 'img'); node.setAttribute('aria-label', entry[0]);
  if (target.key === 'now') {
    node.classList.add('bot'); node.dataset.kind = entry[1];
    node.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${currentSvg(current[entry[1]])}</svg>`;
    return node;
  }
  const [, hue, draw, lightness, chroma] = entry;
  node.style.setProperty('--h', hue);
  if (lightness) node.style.setProperty('--l', lightness), node.style.setProperty('--ld', lightness - .16);
  if (chroma !== undefined) node.style.setProperty('--c', chroma);
  node.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${draw(`av-${++uid}`)}</svg>`;
  return node;
}
function render() {
  $('page').dataset.set = set.key;
  $('hero').replaceChildren(...[0, 2, 8, 10].map(index => avatar(set, index, 64)));
  $('cast').replaceChildren(...set.cast.map((entry, index) => {
    const figure = el('figure', undefined, 'cast-item'); figure.append(avatar(set, index, 32), el('figcaption', entry[0])); return figure;
  }));
  $('rows').replaceChildren(...rowSamples.map(([title, status], index) => {
    const row = el('div', undefined, 'row'), text = el('div');
    text.append(el('strong', title), el('small', `${status} · pi-remote`));
    row.append(avatar(set, (index * 5 + 1) % set.cast.length, 32), text); return row;
  }));
  $('compare').replaceChildren(...sets.map(item => {
    const button = el('button', undefined, 'compare-set'); button.type = 'button';
    button.setAttribute('aria-pressed', String(item === set)); button.setAttribute('aria-label', `Show ${item.name}`);
    const grid = el('span', undefined, 'compare-grid'); grid.append(...item.cast.map((_, index) => avatar(item, index, 26)));
    button.append(el('span', item.name, 'compare-name'), grid);
    button.addEventListener('click', () => { set = item; render(); scrollTo({ top: 0, behavior: 'smooth' }); });
    return button;
  }));
  $('label').textContent = set.name; $('description').textContent = set.description;
  const url = new URL(location.href); url.searchParams.set('set', set.key); history.replaceState(null, '', url);
}
function cycle(direction) { set = sets[(sets.indexOf(set) + direction + sets.length) % sets.length]; render(); }
$('previous').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
function syncTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Preview light theme' : 'Preview dark theme';
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#100d10' : '#f2f3f0';
}
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); });
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); cycle(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); cycle(-1); }
});
syncTheme(); render();
