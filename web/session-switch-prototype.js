// Throwaway gesture prototype with sample sessions, listed in sidebar order (newest activity first).
const sessions = [
  ['Fix webhook retry backoff', 'backend-go', 'waiting', '2m', 'Retries hammer the provider after an outage.', ['Backoff now doubles up to 5 minutes with jitter.', 'Should the cap be configurable per provider?']],
  ['Add swipe navigation to image viewer', 'pi-remote', 'working', 'now', 'Let me swipe between images in the viewer.', ['Working on the gesture threshold so vertical scroll still closes the viewer.']],
  ['Draft onboarding KB for deploys', 'onboarding', 'idle', '18m', 'Write a KB page about how deploys work.', ['Drafted KB-12 with the release flow, rollback steps, and who to ask.']],
  ['Show image position in viewer', 'pi-remote', 'idle', '34m', 'Show "2 of 5" in the image viewer and preload neighbours.', ['The header now shows the position, and the next and previous images load in the background.', 'Pushed as e9538cd.']],
  ['Hide image zoom buttons on phones', 'pi-remote', 'idle', '1h', 'The zoom buttons are useless on a phone, hide them.', ['Phones pinch and double-tap instead, so the buttons are hidden under 700px.', 'Wider screens still show them, since a mouse can\'t pinch.']],
  ['Review PR #8 error wrappers', 'backend-go', 'idle', '2h', 'Review backend-go PR #8.', ['Two findings: a validation error leaks the SQL constraint name, and one handler skips the public error wrapper.']],
  ['Keep home-indicator inset', 'pi-remote', 'idle', '3h', 'The composer jumps when the keyboard closes.', ['The inset now stays until the keyboard actually opens.']],
  ['Research Agent SDK handoff', 'pi-remote', 'idle', '5h', 'Research how the Agent SDK hands off writing.', ['Notes are in docs/research/claude-agent-sdk-writing-handoff.md.']],
  ['Tidy Linear triage labels', 'ops', 'idle', 'Yesterday', 'Merge duplicate triage labels.', ['Merged 6 duplicate labels into 3.']],
  ['Make a launch video', 'brag', 'idle', '2d', 'Brag about pi-remote.', ['Rendered a 24-second video with share copy.']]
].map(([title, project, status, age, prompt, reply]) => ({ title, project, status, age, prompt, reply }));
const variants = [
  { key: 'A', name: 'Title carousel + menu', description: 'Swipe the title · hold for a nearby list', swipe: 'title', hold: 'menu' },
  { key: 'B', name: 'Title carousel + scrub', description: 'Hold, then slide down or up without lifting', swipe: 'title', hold: 'scrub' },
  { key: 'C', name: 'Page swipe + cards', description: 'Swipe moves the whole chat · hold for cards', swipe: 'page', hold: 'cards' }
];
const $ = id => document.getElementById(id);
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const statusText = item => ({ working: 'Working', waiting: 'Needs reply' })[item.status] || item.age;
const dot = item => `<span class="status-dot" data-status="${item.status}"></span>`;
const check = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const pill = $('pill'), strip = $('title-strip'), pages = $('pages');
let index = 3, variant, gesture, busy = false, quietUntil = 0;
// The finger lifting after a hold can land as a click on the list that just opened.
const quiet = () => performance.now() < quietUntil;

// iOS Safari lacks navigator.vibrate; a switch input supplies click-triggered feedback.
function haptic() {
  if (navigator.vibrate?.(10)) return;
  const label = document.createElement('label'); label.hidden = true;
  const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', '');
  label.append(input); document.body.append(label); label.click(); label.remove();
}
const slot = item => item ? `<h1>${escape(item.title)}</h1><p>${escape(item.project)}</p>` : '';
const page = item => item ? `<article class="message user"><div class="message-text">${escape(item.prompt)}</div></article>
  <article class="message assistant"><div class="message-text">${item.reply.map(text => `<p>${escape(text)}</p>`).join('')}</div></article>` : '';

function render(center = index) {
  const around = [center - 1, center, center + 1].map(i => sessions[i]);
  strip.innerHTML = around.map(item => `<div class="title-slot">${slot(item)}</div>`).join('');
  pages.innerHTML = around.map(item => `<section class="page">${page(item)}</section>`).join('');
  pill.setAttribute('aria-label', `${sessions[center].title}, ${center + 1} of ${sessions.length}. Swipe to switch sessions, hold for nearby sessions.`);
  $('position').textContent = `${center + 1} of ${sessions.length}`;
  offset(0);
}
const pageMode = () => variant.swipe === 'page';
const travel = () => pageMode() ? pages.parentElement.clientWidth : strip.parentElement.clientWidth;

function offset(dx, animate = false) {
  strip.classList.toggle('animating', animate); pages.classList.toggle('animating', animate);
  const ratio = pageMode() ? strip.parentElement.clientWidth / pages.parentElement.clientWidth : 1;
  strip.style.transform = `translateX(calc(-100% / 3 + ${dx * ratio}px))`;
  pages.style.transform = `translateX(calc(-100% / 3 + ${pageMode() ? dx : 0}px))`;
  pages.style.opacity = pageMode() ? 1 : 1 - Math.min(Math.abs(dx) / travel(), 1) * .6;
}
function enter() { pages.classList.remove('enter'); void pages.offsetWidth; pages.classList.add('enter'); }
function jump(to) { if (to === index) return render(); index = to; render(); haptic(); if (!pageMode()) enter(); }
function go(direction) {
  if (busy || !sessions[index + direction]) return offset(0, true);
  busy = true; offset(-direction * travel(), true);
  setTimeout(() => { busy = false; jump(index + direction); }, 220);
}

// Nearby list: a tap menu for A and a press-and-slide scrubber for B.
const nearby = $('nearby'), list = $('nearby-list');
const span = 4;
const near = () => sessions.map((item, i) => i).filter(i => Math.abs(i - index) <= span);
function openNearby(scrubbing) {
  list.innerHTML = near().map(i => `<button type="button" role="menuitem" data-index="${i}" ${i === index ? 'aria-current="true"' : ''}>${dot(sessions[i])}<span class="row-text"><strong>${escape(sessions[i].title)}</strong><small>${escape(sessions[i].project)} · ${statusText(sessions[i])}</small></span>${i === index ? check : ''}</button>`).join('');
  nearby.classList.toggle('scrubbing', scrubbing); nearby.hidden = false;
  if (scrubbing) highlight(index);
}
function closeNearby() { nearby.hidden = true; pill.classList.remove('held'); }
function highlight(target) {
  for (const row of list.children) row.classList.toggle('active', +row.dataset.index === target);
  render(target); // live preview behind the list
}
list.addEventListener('click', event => {
  if (quiet()) return;
  const row = event.target.closest('[data-index]');
  if (row) { closeNearby(); jump(+row.dataset.index); }
});
$('nearby-backdrop').addEventListener('click', () => { if (!quiet()) { closeNearby(); render(); } });

// Cards sheet for C.
const cards = $('cards');
function openCards() {
  $('card-row').innerHTML = near().map(i => `<button type="button" data-index="${i}" ${i === index ? 'aria-current="true"' : ''}><small>${dot(sessions[i])}${escape(sessions[i].project)} · ${statusText(sessions[i])}</small><strong>${escape(sessions[i].title)}</strong><p>${escape(sessions[i].reply.at(-1))}</p></button>`).join('');
  cards.showModal();
  cards.querySelector('[aria-current]').scrollIntoView({ inline: 'center', block: 'nearest' });
}
cards.addEventListener('close', () => pill.classList.remove('held'));
cards.addEventListener('click', event => {
  if (quiet()) return;
  if (event.target === cards) return cards.close();
  const card = event.target.closest('[data-index]');
  if (card) { cards.close(); jump(+card.dataset.index); }
});
$('cards-done').addEventListener('click', () => cards.close());

// One pointer stream decides between swipe, hold, and (in B) scrub.
function hold() {
  if (!gesture) return;
  haptic(); pill.classList.add('held');
  if (variant.hold === 'scrub') { gesture.mode = 'scrub'; gesture.target = index; openNearby(true); return; }
  gesture.mode = 'held';
  variant.hold === 'menu' ? openNearby(false) : openCards();
}
pill.addEventListener('pointerdown', event => {
  if (gesture || busy || event.button) return;
  pill.setPointerCapture(event.pointerId);
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, mode: 'pending', samples: [], timer: setTimeout(hold, 450) };
});
pill.addEventListener('pointermove', event => {
  if (event.pointerId !== gesture?.id) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (gesture.mode === 'scrub') {
    const rows = near(), target = Math.min(rows.at(-1), Math.max(rows[0], index + Math.round(dy / 52)));
    if (Math.abs(dy) > 10) gesture.moved = true;
    if (target !== gesture.target) { gesture.target = target; haptic(); highlight(target); }
    return;
  }
  if (gesture.mode === 'pending' && Math.hypot(dx, dy) > 8) {
    clearTimeout(gesture.timer);
    gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'none';
  }
  if (gesture.mode !== 'swipe') return;
  gesture.dx = sessions[index + (dx < 0 ? 1 : -1)] ? dx : dx / 3; // rubber band at the ends
  gesture.samples = [...gesture.samples, { x: event.clientX, t: event.timeStamp }].filter(sample => event.timeStamp - sample.t < 100);
  offset(gesture.dx);
});
function release(event, cancelled) {
  if (event.pointerId !== gesture?.id) return;
  clearTimeout(gesture.timer);
  const ended = gesture; gesture = null;
  if (ended.mode === 'held' || ended.mode === 'scrub') quietUntil = performance.now() + 400;
  if (ended.mode === 'scrub') {
    if (cancelled || ended.target === index && ended.moved) { closeNearby(); return render(); }
    if (ended.target !== index) { closeNearby(); jump(ended.target); }
    else nearby.classList.remove('scrubbing'); // held without sliding: leave the list open for taps
    return;
  }
  if (ended.mode !== 'swipe') return;
  const direction = ended.dx < 0 ? 1 : -1;
  const [first, last] = [ended.samples[0], ended.samples.at(-1)];
  const velocity = first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
  const flicked = -velocity * direction > .3;
  if (!cancelled && (Math.abs(ended.dx) > travel() * .35 || flicked)) go(direction);
  else offset(0, true);
}
pill.addEventListener('pointerup', event => release(event, false));
pill.addEventListener('pointercancel', event => release(event, true));
pill.addEventListener('contextmenu', event => event.preventDefault());
pill.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); go(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); variant.hold === 'cards' ? openCards() : openNearby(false); }
});

function setVariant(key) {
  variant = variants.find(item => item.key === key) || variants[0];
  $('variant-label').textContent = `${variant.key} · ${variant.name}`;
  $('variant-description').textContent = variant.description;
  $('hint').textContent = variant.swipe === 'page' ? 'Swipe the title to flip chats' : 'Swipe the title to switch';
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  closeNearby(); render();
}
function cycle(direction) { setVariant(variants[(variants.indexOf(variant) + direction + variants.length) % variants.length].key); }
$('previous-variant').addEventListener('click', () => cycle(-1));
$('next-variant').addEventListener('click', () => cycle(1));
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, [contenteditable]') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  cycle(event.key === 'ArrowRight' ? 1 : -1);
});
setVariant(new URLSearchParams(location.search).get('variant'));
