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
  { key: 'focused', name: 'D · Character motion', description: 'Miso, Luna, redesigned Orbit and Comet in session rows.' },
];
const comparisons = [
  ['miso', 'A focused glance and turn. Ears and tail follow.'],
  ['luna', 'Eyes follow the mote before the crescent swings after it.'],
  ['orbit', 'Redesigned planet, with a ring and moon passing behind and in front.'],
  ['comet', 'Looks ahead, draws back, then dashes. The tail catches up.'],
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
  wakePresence();
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
// One authored timeline per character: phase, x, y, roll, face turn, vertical scale.
const presenceTracks = {
  slingshot: { period: 3.2, frames: [
    // beat, moon turns, disc tilt, body lean, body drop, gaze, smile
    [0, .05, -12, 0, 0, 1, .8],
    [.26, .36, -10, -.5, 0, -.7, 0],
    [.45, .49, -28, -1.8, 1.6, -1, 0],
    [.54, .50, -31, -2, 1.8, .65, .2],
    [.64, .72, 9, 1.3, -1.4, 1, .15],
    [.79, .95, -7, .7, -.6, 1, .9],
    [1, 1.05, -12, 0, 0, 1, .8],
  ] },
  miso: { period: 5.6, center: [16, 19], radius: 10, frames: [
    [0, 0, 0, -4, -.35, 1], [.12, .4, -.8, 3, .4, 1.02],
    [.26, .7, .5, 6, .7, .97], [.4, -.4, -.5, -5, -.65, 1.01],
    [.57, 0, 0, -2, -.3, 1], [.65, -.5, .5, -6, -.6, .97],
    [.73, .8, -1.2, 5, 2.4, 1.03], [.83, .3, -.5, 2, 5.7, 1.01],
    [1, 0, 0, -4, Math.PI * 2 - .35, 1],
  ] },
  luna: { period: 4.2, center: [10, 20.5], radius: 6, frames: [
    [0, -1, .5, -16, -.18, 1], [.15, -1, 0, -12, .25, 1],
    [.3, .8, -2, 15, .4, 1.02], [.4, 1.3, -1, 22, .3, 1],
    [.55, .5, -.3, 8, -.25, 1], [.72, -1, -1.5, -19, -.4, 1.02],
    [.84, -1.2, .2, -22, -.3, .99], [1, -1, .5, -16, -.18, 1],
  ] },
  orbit: { period: 5.2, center: [16, 13.5], radius: 9, frames: [
    [0, 0, 0, -3, -.3, 1], [.2, 0, -1, 3, .5, 1],
    [.4, 0, .5, 5, .8, .99], [.53, 0, 0, -4, .3, 1],
    [.62, 0, -.8, -6, -.4, 1], [.73, 0, -1.5, 4, 2.7, 1.02],
    [.84, 0, -.5, 2, 5.8, 1], [1, 0, 0, -3, Math.PI * 2 - .3, 1],
  ] },
  comet: { period: 3.6, center: [19, 14], radius: 9, frames: [
    [0, -.5, .5, -3, -.2, 1], [.12, -1.5, 1, -8, .5, .96],
    [.23, 2.8, -3, 9, 1.1, 1.04], [.36, 1.2, -1.5, 3, .65, 1],
    [.48, -.6, .6, -5, -.3, .97], [.61, 2, -2.3, 7, .9, 1.03],
    [.76, .8, -1, 1, .4, 1], [1, -.5, .5, -3, -.2, 1],
  ] },
};
let presenceRigs = [], presenceFrame = 0, presenceLast = 0, presenceId = 0;
const mix = (a, b, t) => a + (b - a) * t;
function presencePose(kind, time) {
  const { period, frames } = presenceTracks[kind], phase = ((time % period) + period) % period / period;
  const end = frames.findIndex(frame => frame[0] > phase), a = frames[end - 1], b = frames[end];
  const t = (phase - a[0]) / (b[0] - a[0]), eased = t * t * (3 - 2 * t);
  return a.slice(1).map((value, index) => mix(value, b[index + 1], eased));
}
function presenceBot(kind, moving = true, offset = 0) {
  const node = bot(kind, 32, 0, 'presence-bot');
  node.dataset.state = moving ? 'working' : 'ready';
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${characters[kind][0]}, ${moving ? 'working study' : 'at rest'}`);
  const original = characters[kind];
  const body = kind === 'orbit' ? '<circle cx="16" cy="15.5" r="9.5"/>' : original[1];
  const eyes = kind === 'orbit' ? [[12.5, 13.5], [19.5, 13.5]] : original[2];
  const id = `presence-clip-${++presenceId}`;
  const ring = front => `<g class="presence-ring ${front ? 'presence-ring-front' : 'presence-ring-back'}"><path class="presence-ring-gap"/><path class="presence-ring-ink"/></g>`;
  node.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><clipPath id="${id}">${body}</clipPath></defs><g class="bot-figure">`
    + (kind === 'orbit' ? ring(false) + '<circle class="presence-moon presence-moon-back" r="1.8"/>' : original[3] || '')
    + `<g class="bot-body">${body}</g><g clip-path="url(#${id})" class="presence-face">`
    + eyes.map(([x, y, s = 1]) => `<g class="presence-eye"><ellipse class="bot-eye" cx="${x}" cy="${y}" rx="${2.1 * s}" ry="${2.9 * s}"/></g>`).join('') + '</g>'
    + (kind === 'orbit' ? ring(true) + '<circle class="presence-moon presence-moon-front" r="1.8"/>' : original[4] || '')
    + (kind === 'luna' ? '<path class="presence-trail"/>' + original[5] : '')
    + (kind === 'comet' ? signatureParts.comet : '') + '</g></svg>';
  const rig = { node, kind, moving, time: offset, eyes, parts: {} };
  for (const selector of ['.bot-figure', '.character-cat-tail', '.character-cat-ear', '.character-cat-ear-right',
    '.character-comet-tail', '.character-moon-mote', '.presence-trail', '.m-speed',
    '.presence-ring-back', '.presence-ring-front', '.presence-moon-back', '.presence-moon-front'])
    rig.parts[selector] = node.querySelector(selector);
  rig.eyeNodes = [...node.querySelectorAll('.presence-eye')];
  presenceRigs.push(rig); drawPresence(rig, false);
  return node;
}
function drawPresence(rig, animate) {
  if (rig.study === 'orbit-c') return drawDiscMoon(rig, animate);
  if (rig.study === 'celestial') return drawCelestial(rig, animate);
  if (rig.kind === 'miso-study') return drawMiso(rig, animate);
  const { kind, parts, eyes, eyeNodes } = rig, time = rig.time;
  const pose = animate ? presencePose(kind, time) : [0, 0, 0, 0, 1];
  const [x, y, roll, turn, scale] = pose, lag = animate ? presencePose(kind, time - .12) : pose;
  const [cx, cy] = presenceTracks[kind].center;
  const transform = (selector, value) => parts[selector]?.setAttribute('transform', value);
  // The face leads; ears, tail and the body resolve the same gesture a little later.
  const moteAngle = time / presenceTracks.luna.period * Math.PI * 2;
  const faceTurn = animate ? kind === 'luna' ? .22 + .16 * Math.cos(moteAngle) : presencePose(kind, time + .1)[3] : 0;
  const beat = animate ? Math.sin(time * Math.PI * 3.2) : 0;
  transform('.bot-figure', `translate(${x} ${y + (kind === 'miso' ? .35 * beat : 0)}) rotate(${roll} ${cx} ${cy}) translate(${cx} ${cy}) scale(1 ${scale}) translate(${-cx} ${-cy})`);
  const blinkPhase = (time + .3) % 4.1;
  const lid = animate && blinkPhase < .15 ? 1 - .86 * Math.sin(blinkPhase / .15 * Math.PI) : 1;
  for (let i = 0; i < eyes.length; i++) {
    const [ex, ey] = eyes[i], radius = presenceTracks[kind].radius;
    const angle = Math.asin(Math.max(-.95, Math.min(.95, (ex - cx) / radius)));
    const facing = Math.cos(angle + faceTurn), width = Math.max(.06, facing / Math.cos(angle));
    const lookY = animate ? (kind === 'comet' ? -1.1 * Math.sin(turn) : kind === 'luna' ? -1 + .5 * Math.sin(moteAngle) : .5 * beat) : 0;
    eyeNodes[i].setAttribute('transform', `translate(${cx + radius * Math.sin(angle + faceTurn)} ${ey + lookY}) scale(${width} ${lid}) translate(${-ex} ${-ey})`);
    eyeNodes[i].setAttribute('opacity', facing > .05 ? '1' : '0');
  }
  if (kind === 'miso') {
    transform('.character-cat-tail', `rotate(${animate ? -14 * Math.sin(lag[3]) - 8 * beat : 0} 24 26)`);
    transform('.character-cat-ear', `rotate(${animate ? -lag[2] * 1.4 : 0} 9 12)`);
    transform('.character-cat-ear-right', `rotate(${animate ? -lag[2] * .85 : 0} 23 12)`);
  } else if (kind === 'luna') {
    const angle = animate ? time / presenceTracks.luna.period * Math.PI * 2 : -.5;
    const mote = a => [23 + 5 * Math.cos(a), 10 + 6 * Math.sin(a)];
    const [mx, my] = mote(angle), [tx, ty] = mote(angle - .8), [qx, qy] = mote(angle - .4);
    transform('.character-moon-mote', `translate(${mx - 25} ${my - 11}) rotate(${animate ? roll * -1.4 : 0} 25 11)`);
    parts['.presence-trail'].setAttribute('d', `M${tx} ${ty} Q${qx} ${qy} ${mx} ${my}`);
    parts['.presence-trail'].setAttribute('opacity', animate ? String(.25 + .35 * Math.max(0, Math.sin(angle))) : '0');
  } else if (kind === 'comet') {
    const thrust = animate ? Math.max(0, x - lag[0]) : 0;
    transform('.character-comet-tail', `rotate(${(lag[2] - roll) * 1.5} 19 14) translate(19 14) scale(${1 + thrust * .12} ${1 + thrust * .18}) translate(-19 -14)`);
    transform('.m-speed', `translate(${-thrust * .4} ${thrust * .4})`);
    parts['.m-speed'].setAttribute('opacity', String(Math.min(.8, thrust)));
  } else if (kind === 'orbit') {
    const angle = animate ? time / presenceTracks.orbit.period * Math.PI * 2 : .4;
    const tilt = -26 + (animate ? 8 * Math.sin(angle) : 0), ry = 5.3 + (animate ? .8 * Math.sin(angle) : 0);
    for (const front of [false, true]) {
      const ring = parts[front ? '.presence-ring-front' : '.presence-ring-back'];
      ring.setAttribute('transform', `rotate(${tilt} 16 18)`);
      for (const path of ring.children) path.setAttribute('d', `M1.7 18 A14.3 ${ry} 0 0 ${front ? 0 : 1} 30.3 18`);
    }
    const mx = 14.3 * Math.cos(angle), my = ry * Math.sin(angle), rad = tilt * Math.PI / 180;
    for (const front of [false, true]) {
      const moon = parts[front ? '.presence-moon-front' : '.presence-moon-back'];
      moon.setAttribute('cx', String(16 + mx * Math.cos(rad) - my * Math.sin(rad)));
      moon.setAttribute('cy', String(18 + mx * Math.sin(rad) + my * Math.cos(rad)));
      moon.setAttribute('opacity', (Math.sin(angle) >= 0) === front ? '1' : '0');
    }
  }
}
function runPresence(now) {
  presenceFrame = 0;
  const active = presenceRigs.filter(rig => rig.moving && rig.node.classList.contains('in-view'));
  if (paused || document.hidden || reducedMotion.matches || !active.length) { presenceLast = 0; return; }
  const dt = presenceLast ? Math.min((now - presenceLast) / 1000, .05) : 0; presenceLast = now;
  for (const rig of active) { rig.time += dt; drawPresence(rig, true); }
  presenceFrame = requestAnimationFrame(runPresence);
}
function wakePresence() {
  if (reducedMotion.matches) for (const rig of presenceRigs) drawPresence(rig, false);
  if (!presenceFrame && presenceRigs.length) presenceFrame = requestAnimationFrame(runPresence);
}
function renderComparison() {
  presenceRigs = [];
  const list = el('section', undefined, 'presence-list'); list.id = 'presence-sessions';
  list.setAttribute('aria-label', 'Sample session list');
  list.append(el('h2', 'Working together · 32px', 'section-title'));
  const titles = ['Refine the mobile composer', 'Check reconnect handling', 'Review the session history', 'Trace a slow response'];
  comparisons.forEach(([kind], index) => {
    const row = el('div', undefined, 'session'); row.dataset.kind = kind;
    const body = el('div', undefined, 'session-body');
    body.append(el('strong', titles[index]), el('small', `${characters[kind][0]} · Working · pi-remote`));
    row.append(presenceBot(kind, true, index * .63), body); list.append(row);
  });
  const rest = el('div', undefined, 'session'), restBody = el('div', undefined, 'session-body');
  restBody.append(el('strong', 'Saved design notes'), el('small', 'Miso · Idle · pi-remote'));
  rest.append(presenceBot('miso', false), restBody); list.append(rest);
  const reference = el('div', undefined, 'session'), referenceBody = el('div', undefined, 'session-body');
  const idea = bot('idea', 32, 0); idea.dataset.state = 'working'; idea.dataset.mood = 'working';
  idea.setAttribute('role', 'img'); idea.setAttribute('aria-label', 'Idea, unchanged working reference');
  referenceBody.append(el('strong', 'Idea · unchanged reference'), el('small', 'Working · existing motion'));
  reference.append(idea, referenceBody); list.append(reference);
  const details = el('details', undefined, 'presence-comparisons');
  details.append(el('summary', 'Compare current, revised and resting'));
  for (const [kind, description] of comparisons) {
    const section = el('section', undefined, 'motion-comparison'); section.setAttribute('aria-label', characters[kind][0]);
    section.append(el('h2', characters[kind][0]), el('p', description));
    const columns = el('div', undefined, 'comparison-columns');
    for (const [variant, label] of [['current', 'Current'], ['revised', 'Revised'], ['rest', 'At rest']]) {
      const figure = el('figure'); figure.dataset.variant = variant;
      const node = variant === 'current' ? bot(kind, 32, 0) : presenceBot(kind, variant !== 'rest');
      node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${characters[kind][0]}, ${label.toLowerCase()}`);
      if (variant === 'current') { node.dataset.state = 'working'; node.dataset.mood = 'working'; }
      figure.append(el('figcaption', label), node); columns.append(figure);
    }
    section.append(columns); details.append(section);
  }
  $('comparison').replaceChildren(list, details);
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
    ? 'Four characters, one session list. Orbit has new artwork; Miso, Luna and Comet keep theirs. Sample activity only.'
    : "Eight of the characters run through one session's lifecycle. Switch motion sets below. Sample data only.";
  if (comparing) { clearTimeout(timer); renderComparison(); }
  else { $('comparison').replaceChildren(); presenceRigs = []; }
  const controls = document.querySelector('.preview-controls');
  page.insertBefore(controls, comparing ? $('comparison') : $('comparison-note'));
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
  wakePresence();
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
    const status = el('span', 'working', 'session-state'); status.dataset.status = 'working';
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
    if (working) { const status = el('span', 'working', 'session-state'); status.dataset.status = 'working'; meta.append(status); }
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
function misoDrawing(moving, size = 32) {
  const node = el('span', undefined, 'bot m-bot presence-bot miso-redraw');
  node.dataset.kind = 'miso'; node.dataset.state = moving ? 'working' : 'ready';
  node.style.setProperty('--size', `${size}px`);
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `Redrawn Miso, ${moving ? 'working' : 'idle'}`);
  node.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true">'
    + '<path data-part="tail" class="miso-tail"/><path class="bot-accent" d="M7 20Q16 15 25 20L25 27Q24 30 16 30Q8 30 7 27Z"/>'
    + '<g data-part="head"><path data-part="outline" class="bot-body"/>'
    + '<path data-part="earLeft" class="miso-inner-ear"/><path data-part="earRight" class="miso-inner-ear"/>'
    + '<path data-part="eyeLeft" class="bot-eye"/><path data-part="eyeRight" class="bot-eye"/>'
    + '<path data-part="nose" class="bot-eye"/><path data-part="mouth" class="miso-mouth"/></g>'
    + '<ellipse data-part="pawLeft" class="miso-paw"/><ellipse data-part="pawRight" class="miso-paw"/>'
    + '<path data-part="contactLeft" class="miso-contact" d="M7 31h7"/><path data-part="contactRight" class="miso-contact" d="M18 31h7"/></svg>';
  const rig = { node, kind: 'miso-study', moving, time: 0,
    parts: Object.fromEntries([...node.querySelectorAll('[data-part]')].map(part => [part.dataset.part, part])) };
  presenceRigs.push(rig); drawMiso(rig, false);
  return node;
}
function drawMiso({ parts, time }, animate) {
  const smooth = (start, end, value) => { const t = Math.max(0, Math.min(1, (value - start) / (end - start))); return t * t * (3 - 2 * t); };
  const cycle = time % 4.8, beat = time / .6 * Math.PI * 2;
  const lookUp = animate ? smooth(3.65, 4, cycle) * (1 - smooth(4.35, 4.8, cycle)) : 1;
  const focus = animate ? 1 - lookUp : 0;
  const leftLift = Math.max(0, Math.sin(beat)) * 4.4 * focus;
  const rightLift = Math.max(0, -Math.sin(beat)) * 4.4 * focus;
  const lean = (leftLift - rightLift) * .22, press = focus * Math.abs(Math.cos(beat));
  const cheek = .8 * press, foldLeft = 1.3 * focus + rightLift * .3, foldRight = 1.3 * focus + leftLift * .3;
  const gaze = animate ? -1.2 * lookUp : 0;
  parts.head.setAttribute('transform', `translate(${lean} ${1.3 * focus + .35 * press}) rotate(${-lean * 3} 16 22)`);
  parts.outline.setAttribute('d', `M4 14 Q3 10 ${4 - foldLeft} ${4 + foldLeft}
    Q4 1 7 3 L12 7.5 Q16 6 20 7.5 L25 3 Q28 1 28 4
    L${28 + foldRight} ${11 + foldRight} Q29 13 28 16
    L${30 + cheek} 19 Q30 20 27.5 20.5 L29 22
    Q26 ${25 + cheek} 16 ${25 + cheek} Q6 ${25 + cheek} 3 22
    L4.5 20.5 Q2 20 2 19Z`);
  parts.earLeft.setAttribute('d', `M5.7 ${4.7 + foldLeft} 10 8.5 5.6 9.5Z`);
  parts.earRight.setAttribute('d', `M26.3 ${4.7 + foldRight} 22 8.5 26.4 9.5Z`);
  const blinkPhase = (time + .1) % 3.2;
  const blink = animate && blinkPhase < .13 ? Math.sin(blinkPhase / .13 * Math.PI) : 0;
  const openness = (.36 + .64 * lookUp) * (1 - .94 * blink);
  for (const [eye, x, side] of [[parts.eyeLeft, 10.5, 1], [parts.eyeRight, 21.5, -1]]) {
    const cx = x + gaze, top = 16.5 - 3.2 * openness, bottom = 16.5 + 2.2 * openness;
    eye.setAttribute('d', `M${cx - 2.3} ${top - .45 * side * focus}
      Q${cx} ${top - .7 * lookUp} ${cx + 2.3} ${top + .45 * side * focus}
      L${cx + 2.3} 16.5 C${cx + 2.3} ${bottom + 1} ${cx - 2.3} ${bottom + 1} ${cx - 2.3} 16.5Z`);
  }
  parts.nose.setAttribute('d', `M${15.1 + gaze} 20.1Q${16 + gaze} 19.6 ${16.9 + gaze} 20.1L${16 + gaze} 21Z`);
  parts.mouth.setAttribute('d', `M${13.8 + gaze} 21.6Q${15 + gaze} ${22.5 - focus * .4} ${16 + gaze} 21Q${17 + gaze} ${22.5 - focus * .4} ${18.2 + gaze} 21.6`);
  const tailLift = animate ? 1.8 * Math.sin(beat - .8) * focus : 0;
  parts.tail.setAttribute('d', `M24 27C32 30 33 ${19 - tailLift} 28 ${18 - tailLift}Q25 ${18 - tailLift} 26 21`);
  for (const [paw, contact, x, lift] of [
    [parts.pawLeft, parts.contactLeft, 10.5, leftLift], [parts.pawRight, parts.contactRight, 21.5, rightLift],
  ]) {
    const down = 1 - Math.min(1, lift / 1.5);
    paw.setAttribute('cx', String(x - lean * .25));
    paw.setAttribute('cy', String(28.1 - lift));
    paw.setAttribute('rx', String(3.2 + .8 * down));
    paw.setAttribute('ry', String(2.6 - .6 * down));
    contact.setAttribute('opacity', String(animate ? down * focus * .65 : 0));
  }
}
function misoStudy() {
  const page = $('page'); page.classList.add('miso-study'); page.dataset.set = 'focused';
  document.title = 'Miso drawing study · Pi Remote';
  document.querySelector('h1').textContent = 'Miso, redrawn';
  document.querySelector('.lede').textContent = 'Round cheeks, folding ears and working paws. A new drawing, not another wobble.';
  $('lifecycle-study').hidden = true; document.querySelector('.switcher').hidden = true;
  $('comparison').hidden = false; $('comparison-note').hidden = false; $('replay').hidden = false;
  page.insertBefore(document.querySelector('.preview-controls'), $('comparison'));
  function renderMiso() {
    presenceRigs = [];
    const drawing = el('section', undefined, 'miso-drawing');
    drawing.setAttribute('aria-label', 'Enlarged drawing');
    drawing.append(el('h2', 'Drawing study · 96px', 'section-title'));
    const poses = el('div', undefined, 'miso-poses');
    for (const [moving, label] of [[true, 'Working'], [false, 'Idle']]) {
      const figure = el('figure'); figure.append(misoDrawing(moving, 96), el('figcaption', label)); poses.append(figure);
    }
    drawing.append(poses);
    const list = el('section', undefined, 'presence-list'); list.id = 'miso-sessions';
    list.setAttribute('aria-label', 'Session size comparison');
    list.append(el('h2', 'In the session list · 32px', 'section-title'));
    for (const variant of ['current', 'working', 'idle']) {
      const row = el('div', undefined, 'session'); row.dataset.variant = variant;
      const icon = variant === 'current' ? bot('miso', 32, 0) : misoDrawing(variant === 'working');
      if (variant === 'current') {
        icon.dataset.mood = 'working'; icon.dataset.state = 'working';
        icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', 'Current Miso, working');
      }
      const body = el('div', undefined, 'session-body');
      body.append(el('strong', 'Refine the mobile composer'),
        el('small', variant === 'current' ? 'Current drawing · Working' : `New drawing · ${variant === 'idle' ? 'Idle' : 'Working'}`));
      row.append(icon, body); list.append(row);
    }
    $('comparison').replaceChildren(drawing, list);
    visibleBots.disconnect();
    for (const node of page.querySelectorAll('.m-bot')) visibleBots.observe(node);
  }
  $('replay').onclick = () => { paused = false; renderMiso(); syncMotion(); };
  $('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); };
  $('motion').onclick = () => { paused = !paused; syncMotion(); };
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  renderMiso(); syncTheme(); syncMotion();
}

function celestialBot(kind, moving = true, size = 32, offset = 0) {
  const node = el('span', undefined, 'bot m-bot presence-bot celestial-bot');
  node.dataset.kind = kind; node.dataset.state = moving ? 'working' : 'ready';
  node.style.setProperty('--size', `${size}px`);
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${characters[kind][0]}, ${moving ? 'working study' : 'idle study'}`);
  const id = `celestial-body-${++presenceId}`;
  const body = characters[kind][1];
  const moon = front => `<circle class="presence-moon presence-moon-${front ? 'front' : 'back'}" r="2.1"/>`;
  node.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><clipPath id="${id}-clip"><use href="#${id}"/></clipPath></defs><g data-part="pose">`
    + (kind === 'comet' ? characters.comet[3] : kind === 'orbit' ? moon(false) : '')
    + `<g class="bot-body">${body}</g><g clip-path="url(#${id}-clip)"><ellipse class="bot-eye"/><ellipse class="bot-eye"/></g>`
    + (kind === 'orbit' ? moon(true) : kind === 'comet' && moving ? signatureParts.comet : '') + '</g></svg>';
  const rig = { node, kind, study: 'celestial', moving, time: offset,
    pose: node.querySelector('[data-part=pose]'), body: node.querySelector('.bot-body > :first-child'),
    eyes: [...node.querySelectorAll('.bot-eye')], tails: [...node.querySelectorAll('.character-comet-tail path')],
    moons: [...node.querySelectorAll('.presence-moon')], streak: node.querySelector('.m-speed') };
  rig.body.id = id;
  presenceRigs.push(rig); drawCelestial(rig, false);
  return node;
}
function drawCelestial(rig, animate) {
  const { kind, time, pose, body, eyes, tails, moons, streak } = rig;
  const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  let positions, eyeWidth = 2.1, eyeHeight = 2.9;
  if (kind === 'luna') {
    const phase = time % 2.8 / 2.8;
    const curl = animate ? smooth(phase / .42) * (1 - smooth((phase - .54) / .46)) : 0;
    const inner = 13 + curl * 8.5;
    body.setAttribute('d', `M25 3C17 1 8 4 4 12C0 22 7 30 16 30C22 30 27 27 30 22C${20 + curl * 5} 26 ${inner} 20 ${inner} 12C${inner} 7 ${18 + curl * 6} 3 25 3Z`);
    pose.setAttribute('transform', `rotate(${animate ? -12 + 30 * curl : 0} 16 17)`);
    positions = [[7.5 + curl * 4, 20 - curl * 3], [12.5 + curl * 6, 21 - curl * 3]];
    eyeWidth = 1.89; eyeHeight = 2.61 * (1 - curl * .35);
  } else if (kind === 'comet') {
    const phase = time % 1.9 / 1.9;
    const fold = animate ? smooth(phase / .32) * (1 - smooth((phase - .32) / .18)) : 0;
    const dash = animate ? smooth((phase - .32) / .18) * (1 - smooth((phase - .55) / .45)) : 0;
    pose.setAttribute('transform', `translate(${dash * 2 - fold} ${fold - dash * 2}) rotate(${fold * -8 + dash * 6} 19 14)`);
    tails[0].setAttribute('d', `M16 17Q${8 + fold * 9} ${18 + fold * 5} ${3 + fold * 12 - dash} ${29 - fold * 4}Q${14 + fold * 8} 28 22 21Z`);
    tails[1].setAttribute('d', `M13 14Q${6 + fold * 6} ${16 + fold * 5} ${2 + fold * 10} ${23 + fold * 3}Q${10 + fold * 8} 23 18 19Z`);
    tails[2].setAttribute('d', `M20 20Q${15 + fold * 8} 28 ${9 + fold * 12} ${31 - fold * 4}Q${10 + fold * 10} 24 16 18Z`);
    positions = [[16 + dash, 13 - dash], [23 + dash, 13 - dash]];
    eyeHeight = 2.9 - dash * 1.5;
    streak?.setAttribute('opacity', animate ? String(.3 + .7 * dash) : '0');
    streak?.setAttribute('transform', `translate(${2 - 5 * dash} ${-2 + 5 * dash})`);
  } else if (kind === 'orbit') {
    const phase = animate ? time / 2.6 * Math.PI * 2 : .3;
    const x = 13 * Math.cos(phase), y = 5.5 * Math.sin(phase), tilt = -28 * Math.PI / 180;
    moons.forEach((moon, index) => {
      moon.setAttribute('cx', String(16 + x * Math.cos(tilt) - y * Math.sin(tilt)));
      moon.setAttribute('cy', String(16 + x * Math.sin(tilt) + y * Math.cos(tilt)));
      moon.setAttribute('opacity', (Math.sin(phase) >= 0) === (index === 1) ? '1' : '0');
    });
    const glance = animate ? .9 * Math.cos(phase) : 0;
    positions = [[12 + glance, 13], [20 + glance, 13]];
  }
  const blinkPhase = time % 4.7;
  const blink = animate && blinkPhase > 4.5 ? 1 - .9 * Math.sin((blinkPhase - 4.5) / .2 * Math.PI) : 1;
  eyes.forEach((eye, index) => {
    eye.setAttribute('cx', String(positions[index][0])); eye.setAttribute('cy', String(positions[index][1]));
    eye.setAttribute('rx', String(eyeWidth)); eye.setAttribute('ry', String(eyeHeight * blink));
    eye.setAttribute('opacity', '1');
  });
}
function celestialStudy() {
  const page = $('page'); page.dataset.set = 'focused';
  document.title = 'Luna, Comet and Orbit · Pi Remote';
  document.querySelector('h1').textContent = 'Luna, Comet & Orbit';
  document.querySelector('.lede').textContent = 'Comet keeps its working streaks. Orbit has one small moon, with no ring or drawn track. Sample activity only.';
  $('lifecycle-study').hidden = true; document.querySelector('.switcher').hidden = true;
  $('comparison').hidden = false; $('comparison-note').hidden = false; $('replay').hidden = false;
  page.insertBefore(document.querySelector('.preview-controls'), $('comparison'));
  function renderCelestial() {
    presenceRigs = [];
    const list = el('section', undefined, 'presence-list'); list.id = 'celestial-sessions';
    list.setAttribute('aria-label', 'Sample session list');
    list.append(el('h2', 'Working together · 32px', 'section-title'));
    for (const [kind, title, moving] of [
      ['luna', 'Check reconnect handling', true], ['comet', 'Trace a slow response', true],
      ['orbit', 'Review the session history', true], ['luna', 'Saved design notes', false],
    ]) {
      const row = el('div', undefined, 'session'), content = el('div', undefined, 'session-body');
      content.append(el('strong', title), el('small', `${characters[kind][0]} · ${moving ? 'Working' : 'Idle'} · pi-remote`));
      row.append(celestialBot(kind, moving, 32, kind === 'comet' ? .3 : 0), content); list.append(row);
    }
    const details = el('details', undefined, 'presence-comparisons');
    details.append(el('summary', 'Larger view · compare at 64px'));
    for (const [kind, description] of [
      ['luna', 'The crescent curls inward, then opens again.'],
      ['comet', 'The tail unfolds into the dash, with working streaks alongside.'],
      ['orbit', 'One small moon travels in front of the planet, disappears behind it, then returns. No visible track.'],
    ]) {
      const section = el('section', undefined, 'motion-comparison');
      section.setAttribute('aria-label', characters[kind][0]);
      section.append(el('h2', characters[kind][0]), el('p', description));
      const columns = el('div', undefined, 'comparison-columns');
      for (const [variant, label] of [['current', 'Current'], ['revised', 'Study'], ['rest', 'Idle']]) {
        const figure = el('figure'); figure.dataset.variant = variant;
        const icon = variant === 'current' ? bot(kind, 64, 0) : celestialBot(kind, variant === 'revised', 64);
        if (variant === 'current') {
          icon.dataset.mood = 'working'; icon.dataset.state = 'working';
          icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', `${characters[kind][0]}, current working motion`);
        }
        figure.append(el('figcaption', label), icon); columns.append(figure);
      }
      section.append(columns); details.append(section);
    }
    $('comparison').replaceChildren(list, details);
    visibleBots.disconnect();
    for (const node of page.querySelectorAll('.m-bot')) visibleBots.observe(node);
  }
  $('replay').onclick = () => { paused = false; renderCelestial(); syncMotion(); };
  $('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); };
  $('motion').onclick = () => { paused = !paused; syncMotion(); };
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  renderCelestial(); syncTheme(); syncMotion();
}

function drawDiscMoon({ time, eyes, moons, body }, animate) {
  const [turns, tilt, lean, drop, gaze, smile] = animate
    ? presencePose('slingshot', time) : [.05, -12, 0, 0, 0, 0];
  const phase = turns * Math.PI * 2;
  body.setAttribute('transform', `translate(${lean} ${drop}) rotate(${lean * 5} 16 14)`);
  const x = Math.cos(phase), depth = Math.sin(phase);
  for (const [i, moon] of moons.entries()) {
    moon.parentNode.setAttribute('transform', `rotate(${tilt} 16 18)`);
    moon.setAttribute('cx', 16 + 13.4 * x);
    moon.setAttribute('cy', 18 + 4 * depth);
    moon.setAttribute('opacity', Number((i === 1) === (depth >= 0)));
  }
  for (const [i, eye] of eyes.entries()) {
    eye.setAttribute('transform', `translate(${12.5 + 7 * i + gaze} ${12.7 + .55 * depth})`);
    const halfWidth = 1.9 + .35 * smile, lowerCurve = 3.6 - 5.2 * smile;
    eye.setAttribute('d', `M${-halfWidth} 0C${-halfWidth} -3.6 ${halfWidth} -3.6 ${halfWidth} 0C${halfWidth} ${lowerCurve} ${-halfWidth} ${lowerCurve} ${-halfWidth} 0Z`);
  }
}

function orbitRingStudy(working = false) {
  const page = $('page'); page.dataset.set = 'focused';
  document.title = 'Orbit ring designs · Pi Remote';
  document.querySelector('h1').textContent = 'Orbit ring designs';
  document.querySelector('.lede').textContent = 'C has a broad lavender disc below the face. A and B are unchanged.';
  $('lifecycle-study').hidden = true; document.querySelector('.switcher').hidden = true;
  $('comparison').hidden = false; $('comparison-note').hidden = false;
  $('motion').hidden = true; $('replay').hidden = true;
  page.insertBefore(document.querySelector('.preview-controls'), $('comparison'));
  const face = (x, y, radius) => `<circle class="bot-body" cx="${x}" cy="${y}" r="${radius}"/><ellipse class="bot-eye" cx="${x - 3.5}" cy="${y - 1.3}" rx="1.9" ry="2.7"/><ellipse class="bot-eye" cx="${x + 3.5}" cy="${y - 1.3}" rx="1.9" ry="2.7"/>`;
  const designs = [
    { key: 'A', name: 'Open arc', description: 'A thin ring, open on one side.',
      svg: '<g transform="rotate(-24 16 17)"><path class="ring-design-line" d="M2 17A14 5.5 0 0 1 28.5 14.5"/></g>'
        + face(16, 15.5, 9.4)
        + '<g transform="rotate(-24 16 17)"><path class="ring-design-line ring-design-front" d="M2 17A14 5.5 0 0 0 28.5 19.5"/></g>' },
    { key: 'B', name: 'Upright', description: 'A tall ring around one side.',
      svg: '<g transform="rotate(-63 17 16)"><path class="ring-design-line" d="M3 16A14 5.4 0 0 1 31 16"/></g>'
        + face(14, 17.5, 9.4)
        + '<g transform="rotate(-63 17 16)"><path class="ring-design-line ring-design-front" d="M3 16A14 5.4 0 0 0 31 16"/></g>' },
    { key: 'C', name: 'Wide disc', description: 'A wide, flat lavender ring.',
      svg: '<g transform="rotate(-12 16 18)"><path class="ring-design-disc" d="M0 18A16 5.3 0 0 1 32 18H27A11 2.3 0 0 0 5 18Z"/></g>'
        + face(16, 14, 7)
        + '<g transform="rotate(-12 16 18)"><path class="ring-design-disc" d="M0 18A16 5.3 0 0 0 32 18H27A11 2.3 0 0 1 5 18Z"/></g>' }
  ];
  function icon(design, size) {
    const node = el('span', undefined, 'bot m-bot ring-design');
    node.dataset.kind = 'orbit'; node.dataset.design = design.key;
    node.style.setProperty('--size', `${size}px`);
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', `Orbit ${design.key}, ${design.name.toLowerCase()}`);
    node.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${design.svg}</svg>`;
    return node;
  }
  if (working) {
    document.title = 'Orbit C in motion · Pi Remote';
    document.querySelector('h1').textContent = 'Orbit C in motion';
    document.querySelector('.lede').textContent = 'Slingshot: Orbit dips its disc to catch the moon, looks ahead, then flicks the moon around the far side.';
    const pair = el('section', undefined, 'ring-options orbit-pair');
    pair.setAttribute('aria-label', 'Working and idle at 32px');
    for (const label of ['Working', 'Idle']) {
      const figure = el('figure'), node = icon(designs[2], 32);
      node.setAttribute('aria-label', `Orbit C, ${label.toLowerCase()}`);
      if (label === 'Working') {
        const moons = [...node.querySelectorAll('svg > g')].map(layer => {
          const moon = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          moon.setAttribute('class', 'disc-moon'); moon.setAttribute('r', '2.2');
          layer.append(moon); return moon;
        });
        const eyes = [...node.querySelectorAll('.bot-eye')].map(oval => {
          const eye = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          eye.setAttribute('class', 'bot-eye'); oval.replaceWith(eye); return eye;
        });
        const planet = node.querySelector('.bot-body');
        const body = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        planet.before(body); body.append(planet, ...eyes);
        const rig = { study: 'orbit-c', node, moving: true, time: 0, moons, eyes, body };
        presenceRigs.push(rig); drawDiscMoon(rig, false); visibleBots.observe(node);
      }
      figure.append(node, el('figcaption', label)); pair.append(figure);
    }
    $('comparison').replaceChildren(el('h2', 'Session size · 32px', 'section-title'), pair);
    const back = el('a', 'Compare the still designs'); back.href = '?study=orbit-rings';
    $('comparison-note').replaceChildren(document.createTextNode('Preview only. '), back);
    $('motion').hidden = false; $('motion').onclick = () => { paused = !paused; syncMotion(); };
    $('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); };
    reducedMotion.addEventListener('change', syncMotion); document.addEventListener('visibilitychange', syncMotion);
    syncTheme(); syncMotion(); return;
  }
  const options = el('section', undefined, 'ring-options'); options.setAttribute('aria-label', 'Enlarged ring designs');
  for (const design of designs) {
    const figure = el('figure'), caption = el('figcaption');
    caption.append(el('strong', `${design.key} · ${design.name}`), el('small', design.description));
    figure.append(icon(design, 80), caption); options.append(figure);
  }
  const list = el('section', undefined, 'presence-list'); list.id = 'ring-design-sessions';
  list.setAttribute('aria-label', 'Designs at session size');
  list.append(el('h2', 'In the family · 32px', 'section-title'));
  const row = (node, title, label) => {
    const item = el('div', undefined, 'session'), content = el('div', undefined, 'session-body');
    content.append(el('strong', title), el('small', label)); item.append(node, content); list.append(item);
  };
  const reference = kind => {
    const node = bot(kind, 32, 0);
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${characters[kind][0]}, unchanged reference`);
    return node;
  };
  row(reference('luna'), 'Check reconnect handling', 'Luna · Unchanged reference');
  for (const design of designs) row(icon(design, 32), 'Review the session history', `${design.key} · ${design.name}`);
  row(reference('comet'), 'Trace a slow response', 'Comet · Unchanged reference');
  $('comparison').replaceChildren(options, list);
  const back = el('a', 'Back to the motion preview'); back.href = '?study=celestial';
  $('comparison-note').replaceChildren(document.createTextNode('Designs only. Live avatars and the motion preview are unchanged. '), back);
  $('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; syncTheme(); };
  syncTheme();
}

if (new URL(location.href).searchParams.get('study') === 'shimmer') shimmerStudy();
else if (new URL(location.href).searchParams.get('study') === 'miso') misoStudy();
else if (new URL(location.href).searchParams.get('study') === 'celestial') celestialStudy();
else if (new URL(location.href).searchParams.get('study') === 'orbit-c') orbitRingStudy(true);
else if (new URL(location.href).searchParams.get('study') === 'orbit-rings') orbitRingStudy();
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
