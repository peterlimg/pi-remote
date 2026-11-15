// One-mascot study for session avatars. Static samples only; no app transport or storage.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
// Built on a 32-unit grid: a wide head over two short legs, like a soft π. Every session shares this drawing.
const eyes = [[12.3, 14.6], [19.7, 14.6]];
const mascotSvg = '<svg viewBox="0 0 32 32" aria-hidden="true"><g class="m-fig">'
  + '<g class="m-leg m-leg-l"><rect class="m-fill" x="9.6" y="19" width="4.2" height="8" rx="2.1"/><ellipse class="m-fill" cx="10.6" cy="27.4" rx="3" ry="1.6"/></g>'
  + '<g class="m-leg m-leg-r"><rect class="m-fill" x="18.2" y="19" width="4.2" height="8" rx="2.1"/><ellipse class="m-fill" cx="21.4" cy="27.4" rx="3" ry="1.6"/></g>'
  + '<g class="m-head"><path class="m-fill" d="M9 5h14c3.4 0 5.6 3 5 6.3l-1 5.6c-.8 4-3.6 6.6-7.6 6.6h-6.8c-4 0-6.8-2.6-7.6-6.6l-1-5.6C3.4 8 5.6 5 9 5Z"/>'
  + '<g class="m-face"><g class="m-look">'
  + `<g class="m-open">${eyes.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.9" ry="2.7"/>`).join('')}</g>`
  + `<g class="m-happy">${eyes.map(([x, y]) => `<path d="M${x - 2} ${y + 1}q2-3 4 0"/>`).join('')}</g>`
  + `<g class="m-shut">${eyes.map(([x, y]) => `<path d="M${x - 2} ${y}h4"/>`).join('')}</g>`
  + '</g></g></g></g>'
  + '<g class="m-badge m-wait"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>'
  + '<g class="m-badge m-unread"><circle cx="27" cy="5" r="4"/></g></svg>';
// Hand-picked, not evenly spaced hues; each has its own light and dark value.
const colours = [
  ['Coral', '#e4705c', '#f2907f'], ['Sky', '#3f8cc0', '#6db0dc'], ['Honey', '#d99a26', '#f2c063'], ['Sage', '#5f9a5c', '#8dc489'],
  ['Lilac', '#8f72c4', '#b59de2'], ['Lagoon', '#2f9c93', '#5cc3b8'], ['Rose', '#d0647f', '#ec93ad'], ['Slate', '#687789', '#9eabba'],
];
const labels = { ready: 'Ready', starting: 'Starting', working: 'Working', waiting: 'Needs input', settled: 'New reply', offline: 'Offline' };
const timeline = [['ready', 2600], ['starting', 600], ['working', 5000], ['waiting', 3600], ['starting', 600], ['working', 3000], ['settled', 3400]];
const rowSamples = [
  [0, 'working', 'Fix mobile session reconnect handling'],
  [1, 'working', 'Prototype animation icons in session list'],
  [2, 'waiting', 'Investigate saved session recovery'],
  [3, 'working', 'Compress video with FFmpeg without quality loss'],
  [4, 'settled', 'Review promotional exclusion logic'],
  [5, 'ready', 'Check agent-desktop visibility'],
  [6, 'ready', 'Review X post for Pi Remote improvements'],
  [7, 'offline', 'Fix model selection issue'],
];
let colour = 0, state = 'ready', playing = true, paused = false, step = 0, timer;
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function mascot(index, size, phase = 0) {
  const node = el('span', undefined, 'mascot');
  const [name, light, dark] = colours[index];
  node.style.setProperty('--fill', `light-dark(${light}, ${dark})`); node.style.setProperty('--size', `${size}px`);
  // Spread phases so neighbouring rows do not move in lockstep.
  node.style.setProperty('--t', `${-phase}s`); node.style.setProperty('--blink', `${-phase * 2.3}s`);
  node.dataset.colour = name; node.setAttribute('role', 'img'); node.innerHTML = mascotSvg;
  return node;
}
function applyState(node, next) {
  node.dataset.state = next;
  node.setAttribute('aria-label', `${node.dataset.colour} Pi, ${labels[next]}`);
}
function setState(next) {
  state = next;
  for (const node of document.querySelectorAll('[data-follow]')) applyState(node, next);
  $('stage-state').textContent = labels[next];
  for (const button of $('states').querySelectorAll('[data-state]')) button.setAttribute('aria-pressed', String(button.dataset.state === next || (next === 'starting' && button.dataset.state === 'working')));
}
function tick() {
  clearTimeout(timer);
  if (!playing || paused) return;
  const [next, duration] = timeline[step];
  setState(next); step = (step + 1) % timeline.length;
  timer = setTimeout(tick, duration);
}
function choose(next) {
  playing = false; $('play').setAttribute('aria-pressed', 'false'); clearTimeout(timer);
  // Work always starts with the acknowledgement so it can be judged.
  if (next === 'working' && state !== 'working') { setState('starting'); timer = setTimeout(() => setState('working'), 600); }
  else setState(next);
}
function render() {
  $('stage').replaceChildren(...[96, 32, 20].map(size => { const node = mascot(colour, size); node.dataset.follow = ''; return node; }));
  $('swatches').replaceChildren(...colours.map(([name], index) => {
    const button = el('button', undefined, 'swatch'); button.type = 'button';
    button.setAttribute('aria-pressed', String(index === colour)); button.setAttribute('aria-label', `Show ${name}`);
    const node = mascot(index, 32, index * .37); node.dataset.follow = '';
    button.append(node, el('span', name));
    button.addEventListener('click', () => { colour = index; render(); });
    return button;
  }));
  $('rows').replaceChildren(...rowSamples.map(([index, rowState, title], order) => {
    const row = el('div', undefined, 'row'), node = mascot(index, 32, order * .53 + .2), text = el('div');
    applyState(node, rowState);
    text.append(el('strong', title), el('small', `${labels[rowState]} · pi-remote`));
    row.append(node, text); return row;
  }));
  setState(state);
}
$('states').addEventListener('click', event => {
  const button = event.target.closest('[data-state]'); if (button) choose(button.dataset.state);
});
$('play').addEventListener('click', () => {
  playing = !playing; $('play').setAttribute('aria-pressed', String(playing));
  if (playing) { step = 0; tick(); } else clearTimeout(timer);
});
function syncMotion() {
  document.documentElement.classList.toggle('paused', paused || document.hidden);
  $('motion').setAttribute('aria-pressed', String(paused)); $('motion').textContent = paused ? 'Resume motion' : 'Pause motion';
}
$('motion').addEventListener('click', () => { paused = !paused; syncMotion(); tick(); });
document.addEventListener('visibilitychange', syncMotion);
function syncTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Preview light theme' : 'Preview dark theme';
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#100d10' : '#f2f3f0';
}
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); });
syncTheme(); syncMotion(); render(); tick();
