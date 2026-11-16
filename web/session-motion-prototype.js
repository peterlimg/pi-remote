// Motion-set studies for session characters. Static samples only; no app transport or storage.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
// Drawings copied from the production catalogue: [name, body, eyes, back, front, working parts].
const characters = {
  idea: ['Idea', '<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<path class="bot-stalk" d="M16 10V6.5"/><circle class="bot-bulb" cx="16" cy="4.5" r="3"/>', '',
    '<path class="bot-rays" d="M16-1.2v-1.6M11.3.6l-1.1-1.1M20.7.6l1.1-1.1M10 4.5H8.4M22 4.5h1.6"/>'],
  luna: ['Luna', '<path d="M25 3C17 1 8 4 4 12C0 22 7 30 16 30C22 30 27 27 30 22C20 26 13 20 13 12C13 7 18 3 25 3Z"/>', [[7.5, 20, .9], [12.5, 21, .9]], '', '',
    '<path class="character-moon-mote" d="M25 7q0 4 4 4-4 0-4 4 0-4-4-4 4 0 4-4Z"/>'],
  miso: ['Miso', '<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]],
    '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><g class="character-cat-ear"><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/></g><g class="character-cat-ear character-cat-ear-right"><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/></g>'],
  jelly: ['Jelly', '<path d="M4 20C4 10 8 4 16 4s12 6 12 16Q22 23 16 21Q10 23 4 20Z"/>', [[12, 15], [20, 15]],
    '<path class="character-tentacle" d="M9 19v5q-4 4 0 7"/><path class="character-tentacle character-tentacle-middle" d="M16 20v6q4 2 0 5"/><path class="character-tentacle character-tentacle-right" d="M23 19v6q-4 2 0 6"/>'],
  sol: ['Sol', '<circle cx="16" cy="17" r="9"/>', [[12, 17], [20, 17]],
    '<g class="character-sun-rays"><path d="M16 2v3M16 29v3M1 17h3M28 17h3M5 6l2 2M25 26l2 2M5 28l2-2M25 8l2-2"/></g>'],
  moss: ['Moss', '<path d="M3 20Q2 9 8 8Q13 6 16 12Q19 6 24 8Q30 9 29 20Q32 30 16 30Q0 30 3 20Z"/>', [[10, 15.5], [22, 15.5]],
    '<g class="character-frog-foot"><ellipse class="bot-body" cx="6" cy="29.5" rx="4" ry="2"/></g><g class="character-frog-foot character-frog-foot-right"><ellipse class="bot-body" cx="26" cy="29.5" rx="4" ry="2"/></g>'],
  orbit: ['Orbit', '<circle cx="16" cy="16" r="10"/>', [[12, 13.5], [20, 13.5]],
    '<g class="character-planet-ring"><ellipse class="character-ring-back" cx="16" cy="17" rx="15" ry="5" transform="rotate(-22 16 17)"/></g>',
    '<g class="character-planet-ring"><path class="character-ring-front" d="M2 22C8 29 28 20 30 12"/></g>'],
  comet: ['Comet', '<circle cx="19" cy="14" r="9.5"/>', [[16, 13], [23, 13]],
    '<g class="character-comet-tail"><path class="bot-accent" d="M16 17Q8 18 3 29Q14 28 22 21Z"/><path class="bot-body" d="M13 14Q6 16 2 23Q10 23 18 19Z"/><path class="bot-body" d="M20 20Q15 28 9 31Q10 24 16 18Z"/></g>'],
  nim: ['Nim', '<ellipse cx="16" cy="19" rx="8" ry="10"/>', [[12.5, 18], [19.5, 18]],
    '<g class="character-wing"><path class="bot-accent" d="M10 18C2 10-1 13 2 21c-3 5 2 8 8 3Z"/></g><g class="character-wing character-wing-right"><path class="bot-accent" d="M22 18c8-8 11-5 8 3 3 5-2 8-8 3Z"/></g><path class="bot-stalk" d="m13 10-2-5m8 5 2-5"/>'],
};
// Extra parts used by Signature and the running-loop comparison.
const signatureParts = {
  orbit: '<g transform="rotate(-22 16 17)"><g class="m-moon-x"><g class="m-moon-y"><circle class="m-moon" cx="16" cy="17" r="1.9"/></g></g></g>',
  comet: '<path class="m-speed" d="M8 4 4 8M5 11l-3 3M28 22l-4 4"/>',
};
const sets = [
  { key: 'current', name: 'Now · shared wobble', description: 'Today. Every working loop is a 3s wobble. Other states barely move.' },
  { key: 'beat', name: 'A · Beat', description: 'One hop-and-land rhythm for everyone. Ears, tails and rings follow through.' },
  { key: 'signature', name: 'B · Signature', description: 'Each does its own thing: Luna rocks, Jelly swims, Comet dashes, Orbit has a moon.' },
  { key: 'quiet', name: 'C · Quiet', description: 'Bodies stay still. Eyes read and a dot circles. Calmest with many sessions.' },
  { key: 'focused', name: 'D · Running loops', description: 'Pulse, flip, swim and orbit beside the unchanged Idea reference.' },
];
const comparisons = [
  ['miso', 'Zoom in and out. One pulse every second.'],
  ['luna', 'Flip, settle briefly, repeat.'],
  ['jelly', 'Continuous squash-and-stretch swimming.'],
  ['orbit', 'Rotating ring with a circling moon.'],
];
const labels = { ready: 'Ready', starting: 'Starting', working: 'Working', waiting: 'Needs input', settled: 'Settles · new reply' };
// Production moods for the comparison set; starting and settle have no motion there.
const currentMoods = { ready: 'idle', starting: 'idle', working: 'working', waiting: 'waiting', settled: 'unread' };
const timeline = [['ready', 2400], ['starting', 650], ['working', 6000], ['waiting', 3600], ['starting', 650], ['working', 3000], ['settled', 3000]];
const rowSamples = [
  ['luna', 'working', 'Fix mobile session reconnect handling'],
  ['miso', 'working', 'Prototype animation icons in session list'],
  ['jelly', 'waiting', 'Investigate saved session recovery'],
  ['sol', 'working', 'Compress video with FFmpeg without quality loss'],
  ['moss', 'settled', 'Review promotional exclusion logic'],
  ['comet', 'working', 'Check agent-desktop visibility'],
  ['orbit', 'ready', 'Review X post for Pi Remote improvements'],
  ['nim', 'ready', 'Fix model selection issue'],
];
let set = sets.find(item => item.key === new URL(location.href).searchParams.get('set')) || sets[1];
let focus = 'luna', state = 'ready', playing = true, paused = false, step = 0, timer;
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Production styles pause bots that are not marked as on-screen.
const visibleBots = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) target.classList.toggle('in-view', isIntersecting);
});

function botSvg(kind) {
  const [, body, eyes, back = '', front = '', work = ''] = characters[kind];
  const open = eyes.map(([x, y, s = 1]) => `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/>`).join('');
  const happy = eyes.map(([x, y, s = 1]) => `<path class="bot-line" d="M${x - 2.4 * s} ${y + 1}q${2.4 * s} -${3.6 * s} ${4.8 * s} 0"/>`).join('');
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><g class="m-dot"><circle cx="16" cy="1.5" r="1.7"/><circle cx="16" cy="1.5" r="1.1" transform="rotate(-28 16 17)"/></g>`
    + `<g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look"><g class="m-eyes-open">${open}</g><g class="m-eyes-happy">${happy}</g></g></g>${front}`
    + `<g class="m-work">${work}</g><g class="m-signature">${signatureParts[kind] || ''}</g></g>`
    + '<g class="bot-badge m-wait"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g><g class="bot-badge m-unread"><circle cx="27" cy="5" r="4"/></g></svg>';
}
function bot(kind, size, phase, className = '') {
  const node = el('span', undefined, `bot m-bot ${kind === 'idea' ? '' : 'personality-bot'} ${className}`.trim());
  node.dataset.kind = kind; node.style.setProperty('--size', `${size}px`);
  // Spread phases so neighbouring rows do not move in lockstep.
  node.style.setProperty('--t', `${-phase}s`); node.style.setProperty('--blink', `${-phase * 1.7}s`);
  node.innerHTML = botSvg(kind); return node;
}
function applyState(node, next) {
  node.dataset.state = next;
  if (set.key === 'current') node.dataset.mood = currentMoods[next]; else delete node.dataset.mood;
  node.setAttribute('aria-label', `${characters[node.dataset.kind][0]}, ${labels[next]}`);
}
function setState(next) {
  state = next;
  for (const node of document.querySelectorAll('[data-follow]')) applyState(node, next);
  $('stage-state').textContent = labels[next];
  for (const button of $('states').querySelectorAll('[data-state]')) button.setAttribute('aria-pressed', String(button.dataset.state === next || (next === 'starting' && button.dataset.state === 'working')));
}
function tick() {
  clearTimeout(timer);
  if (!playing || paused || document.hidden || set.key === 'focused') return;
  const [next, duration] = timeline[step];
  setState(next); step = (step + 1) % timeline.length;
  timer = setTimeout(tick, duration);
}
function choose(next) {
  playing = false; $('play').setAttribute('aria-pressed', 'false'); clearTimeout(timer);
  // Starting always plays before work so the acknowledgement can be judged.
  if (next === 'working' && state !== 'working') { setState('starting'); timer = setTimeout(() => setState('working'), 650); }
  else setState(next);
}
function renderComparison() {
  $('comparison').replaceChildren(...comparisons.map(([kind, description]) => {
    const section = el('section', undefined, 'motion-comparison');
    section.setAttribute('aria-label', characters[kind][0]);
    section.append(el('h2', characters[kind][0]), el('p', description));
    const columns = el('div', undefined, 'comparison-columns');
    for (const [variant, label] of [['current', 'Current'], ['revised', 'Revised'], ['reference', 'Idea reference']]) {
      const figure = el('figure'); figure.dataset.variant = variant;
      const sampleKind = variant === 'reference' ? 'idea' : kind;
      const node = bot(sampleKind, 32, 0);
      node.dataset.state = 'working';
      if (variant !== 'revised') node.dataset.mood = 'working';
      node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${characters[sampleKind][0]}, ${label.toLowerCase()}`);
      figure.append(el('figcaption', label), node); columns.append(figure);
    }
    section.append(columns); return section;
  }));
}
function render() {
  const page = $('page'); page.dataset.set = set.key;
  const comparing = set.key === 'focused';
  $('lifecycle-study').hidden = comparing;
  $('comparison').hidden = !comparing;
  $('comparison-note').hidden = !comparing;
  $('replay').hidden = !comparing;
  document.querySelector('.switcher').hidden = comparing;
  document.querySelector('.preview-header h1').textContent = comparing ? 'Working motion' : 'Motion';
  document.querySelector('.lede').textContent = comparing
    ? 'Which loops clearly say “running”? All at 32px. Idea keeps its live animation as the reference in every row.'
    : "Eight of the characters run through one session's lifecycle. Switch motion sets below. Sample data only.";
  if (comparing) { clearTimeout(timer); renderComparison(); }
  else $('comparison').replaceChildren();
  const stage = $('stage-bot'); stage.dataset.kind = focus; stage.dataset.follow = ''; stage.style.setProperty('--size', '76px'); stage.innerHTML = botSvg(focus);
  $('family').replaceChildren(...Object.keys(characters).filter(kind => kind !== 'idea').map((kind, index) => {
    const button = el('button', undefined, 'family-item'); button.type = 'button';
    button.setAttribute('aria-pressed', String(kind === focus));
    const node = bot(kind, 32, index * .43); node.dataset.follow = '';
    button.append(node, el('span', characters[kind][0]));
    button.addEventListener('click', () => { focus = kind; render(); });
    return button;
  }));
  $('rows').replaceChildren(...rowSamples.map(([kind, rowState, title], index) => {
    const row = el('div', undefined, 'row'), node = bot(kind, 32, index * .71 + .2);
    applyState(node, rowState);
    const text = el('div'); text.append(el('strong', title), el('small', `${labels[rowState].replace(' · new reply', '')} · pi-remote`));
    row.append(node, text); return row;
  }));
  visibleBots.disconnect();
  for (const node of document.querySelectorAll('.m-bot')) visibleBots.observe(node);
  setState(state);
  $('label').textContent = set.name; $('description').textContent = set.description;
  const url = new URL(location.href); url.searchParams.set('set', set.key); history.replaceState(null, '', url);
}
function cycle(direction) { set = sets[(sets.indexOf(set) + direction + sets.length) % sets.length]; render(); tick(); }
function syncMotion() {
  document.documentElement.classList.toggle('paused', paused || document.hidden);
  $('motion').disabled = reducedMotion.matches; $('replay').disabled = reducedMotion.matches;
  $('motion').setAttribute('aria-pressed', String(paused));
  $('motion').textContent = reducedMotion.matches ? 'Reduced motion enabled' : paused ? 'Resume motion' : 'Pause motion';
}
function syncTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Preview light theme' : 'Preview dark theme';
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#100d10' : '#f2f3f0';
}
// Color-only study: keep the same shimmer and session layout while comparing palettes.
function shimmerStudy() {
  const colors = { A: 'Rose', B: 'Lilac', C: 'Coral', D: 'Orchid', E: 'Grass' };
  const page = $('page'); page.classList.add('shimmer-study');
  document.title = 'Working shimmer colors · Pi Remote';
  document.querySelector('h1').textContent = 'Working colors';
  document.querySelector('.lede').textContent = 'Same smooth shimmer, five palettes. Tap a color to see it in the list. Sample sessions only; your live app is unchanged.';
  $('lifecycle-study').hidden = true;
  const comparison = $('comparison'); comparison.hidden = false;
  comparison.setAttribute('aria-label', 'Shimmer color comparison');
  const choices = el('div', undefined, 'shimmer-choices');
  for (const [key, name] of Object.entries(colors)) {
    const button = el('button', undefined, 'shimmer-choice'); button.type = 'button'; button.dataset.color = key;
    button.setAttribute('aria-label', `${key} · ${name}`);
    const status = el('span', 'Working', 'session-state'); status.dataset.status = 'working';
    button.append(el('strong', `${key} · ${name}`), status);
    button.addEventListener('click', () => chooseColor(key)); choices.append(button);
  }
  comparison.append(choices, el('h2', 'In your session list', 'shimmer-list-heading'));
  for (const [kind, title, working] of [
    ['orbit', 'Improve UI/UX space efficiency', true],
    ['moss', 'Add model-independent voice input to composer', true],
    ['miso', 'Review cat avatar bot concept', false],
  ]) {
    const row = el('div', undefined, 'session shimmer-row');
    const icon = bot(kind, 32, 0); icon.setAttribute('aria-hidden', 'true');
    const body = el('div', undefined, 'session-body'), meta = el('div', undefined, 'session-meta');
    if (working) { const status = el('span', 'Working', 'session-state'); status.dataset.status = 'working'; meta.append(status); }
    meta.append(el('span', 'pi-remote'), el('span', working ? 'now' : '1d'));
    body.append(el('strong', title), meta); row.append(icon, body); comparison.append(row);
  }
  function chooseColor(key) {
    page.dataset.color = Object.hasOwn(colors, key) ? key : 'A';
    for (const button of choices.children) button.setAttribute('aria-pressed', String(button.dataset.color === page.dataset.color));
    $('label').textContent = `${page.dataset.color} · ${colors[page.dataset.color]}`;
    $('description').textContent = '1.4s continuous shimmer · no spinner';
    const url = new URL(location.href); url.searchParams.set('variant', page.dataset.color); history.replaceState(null, '', url);
  }
  function stepColor(direction) {
    const keys = Object.keys(colors); chooseColor(keys[(keys.indexOf(page.dataset.color) + direction + keys.length) % keys.length]);
  }
  document.querySelector('.switcher').setAttribute('aria-label', 'Compare shimmer colors');
  $('previous').setAttribute('aria-label', 'Previous color'); $('next').setAttribute('aria-label', 'Next color');
  $('previous').onclick = () => stepColor(-1); $('next').onclick = () => stepColor(1);
  $('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); };
  $('motion').onclick = () => { paused = !paused; syncMotion(); };
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); stepColor(event.key === 'ArrowRight' ? 1 : -1); }
  });
  for (const label of page.querySelectorAll('.session-state')) visibleBots.observe(label);
  chooseColor(new URL(location.href).searchParams.get('variant'));
  syncTheme(); syncMotion();
}
if (new URL(location.href).searchParams.get('study') === 'shimmer') shimmerStudy();
else {
$('replay').addEventListener('click', () => { paused = false; render(); syncMotion(); });
$('previous').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
$('states').addEventListener('click', event => {
  const button = event.target.closest('[data-state]'); if (button) choose(button.dataset.state);
});
$('play').addEventListener('click', () => {
  playing = !playing; $('play').setAttribute('aria-pressed', String(playing));
  if (playing) { step = 0; tick(); } else clearTimeout(timer);
});
reducedMotion.addEventListener('change', syncMotion);
$('motion').addEventListener('click', () => { paused = !paused; syncMotion(); tick(); });
document.addEventListener('visibilitychange', () => { syncMotion(); if (document.hidden) clearTimeout(timer); else tick(); });
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); });
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); cycle(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); cycle(-1); }
});
syncTheme(); syncMotion(); render(); tick();
}
