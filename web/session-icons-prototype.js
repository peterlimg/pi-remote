// Throwaway visual lifecycle model. All runtime events are simulated; no transport or storage.
const $ = id => document.getElementById(id);
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const initial = { runtime: 'idle', phase: 'ready', connection: 'connected', unread: false, outcome: 'unknown', viewing: false };

// Pure model: acknowledgement, runtime evidence, attention and outcome stay separate.
function evolve(state, event) {
  const online = state.connection === 'connected', active = ['working', 'waiting'].includes(state.runtime);
  switch (event) {
    case 'accept': return online && state.phase === 'ready' ? { ...state, phase: 'accepted', outcome: 'unknown' } : state;
    case 'start': return online && state.phase === 'accepted' && state.runtime === 'idle' ? { ...state, runtime: 'working', phase: 'working' } : state;
    case 'ask': return online && state.phase === 'working' ? { ...state, runtime: 'waiting', phase: 'waiting' } : state;
    case 'answer': return online && state.phase === 'waiting' ? { ...state, phase: 'accepted' } : state;
    case 'resume': return online && state.phase === 'accepted' && state.runtime === 'waiting' ? { ...state, runtime: 'working', phase: 'working' } : state;
    case 'settle': return online && active ? { ...state, runtime: 'idle', phase: 'settling', outcome: 'ended' } : state;
    case 'rest': return online && state.phase === 'settling' ? { ...state, phase: 'ready' } : state;
    case 'stop-request': return online && active && state.phase !== 'stopping' ? { ...state, phase: 'stopping' } : state;
    case 'stop-confirm': return online && state.phase === 'stopping' ? { ...state, runtime: 'idle', phase: 'settling', outcome: 'stopped' } : state;
    case 'reply': return online ? { ...state, unread: !state.viewing } : state;
    case 'disconnect': return online ? { ...state, connection: 'offline', phase: 'offline' } : state;
    case 'reconnect': return state.connection === 'offline' ? { ...state, connection: 'checking', phase: 'syncing' } : state;
    case 'snapshot-working': return state.connection !== 'offline' ? { ...state, connection: 'connected', runtime: 'working', phase: 'working' } : state;
    case 'snapshot-idle': return state.connection !== 'offline' ? { ...state, connection: 'connected', runtime: 'idle', phase: 'ready', outcome: 'unknown' } : state;
    case 'open': return { ...state, viewing: true, unread: false };
    case 'back': return state.viewing ? { ...state, viewing: false } : state;
    default: return state;
  }
}
const events = {
  accept: ['Request accepted', 'The computer accepted the request. The working loop has not started.'],
  start: ['Runtime starts', 'Runtime activity is confirmed. The same mark moves beside the title.'],
  ask: ['Agent needs input', 'Activity pauses. The agent needs a response, not more time to keep working.'],
  answer: ['Answer accepted', 'The answer was accepted. Wait for runtime evidence before restarting the working loop.'],
  resume: ['Runtime resumes', 'Runtime activity resumes. The waiting pose returns to the working rhythm.'],
  settle: ['Run ends', 'The run ended. This does not establish success or that its result was reviewed.'],
  rest: ['Return to calm', 'The same mark returns to the detail line. It is available, not disabled or asleep.'],
  'stop-request': ['Stop requested', 'A stop was requested. Keep the last confirmed activity until the runtime acknowledges the stop.'],
  'stop-confirm': ['Runtime confirms stop', 'The runtime confirmed the stop. Any partial work remains unverified; there is no success celebration.'],
  reply: ['A reply arrives', 'A reply arrived while the session list was on screen. Unread is independent of the working motion.'],
  disconnect: ['Connection lost', 'Freeze the last known activity. Losing contact does not prove that the agent stopped.'],
  reconnect: ['Connection returns', 'Connected again, but activity has not been confirmed. The mark stays still.'],
  'snapshot-working': ['Fresh snapshot: working', 'A fresh runtime snapshot confirms that work is still active.'],
  'snapshot-idle': ['Fresh snapshot: idle', 'The agent is idle. Do not infer how the work ended from that state alone.'],
  open: ['Open conversation', 'The sample conversation is open. Unread clears without changing the agent identity or runtime state.'],
  back: ['Back to sessions', 'Reading the reply did not change the runtime state. The same mark returns with the session.'],
};
const scenarios = [
  { id: 'run', name: 'A run starts and settles', steps: ['accept', 'start', 'settle', 'rest'] },
  { id: 'input', name: 'Pause for input, then resume', steps: ['accept', 'start', 'ask', 'answer', 'resume', 'settle', 'rest'] },
  { id: 'stop', name: 'Stop before the work finishes', steps: ['accept', 'start', 'stop-request', 'stop-confirm', 'rest'] },
  { id: 'unread', name: 'A reply arrives while off-screen', steps: ['accept', 'start', 'reply', 'settle', 'rest', 'open', 'back'] },
  { id: 'reconnect', name: 'Lose connection, then reconnect', steps: ['accept', 'start', 'disconnect', 'reconnect', 'snapshot-working', 'settle', 'rest'] },
];
const phaseNames = { ready: 'Ready', accepted: 'Accepted', working: 'Working', waiting: 'Needs input', stopping: 'Stop requested', offline: 'Connection lost', syncing: 'Checking activity' };
const mark = $('presence-mark'), row = $('focus-row'), statusNode = $('focus-status');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let scenario = scenarios[0], state = { ...initial }, history = [], step = 0, manual = false, notice = '';
let playing = false, timer, movement, reduceMotion = false;
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const motionReduced = () => reduceMotion || motionPreference.matches;
const phaseName = () => state.phase === 'settling' ? state.outcome === 'stopped' ? 'Stopped' : 'Run ended' : phaseNames[state.phase];
mark.style.setProperty('--presence-delay', `-${Date.now() % 1400}ms`);
const visibility = new IntersectionObserver(entries => entries.forEach(({ isIntersecting }) => mark.classList.toggle('in-view', isIntersecting)));
visibility.observe(mark);

function renderControls() {
  $('previous').disabled = history.length === 0;
  $('play').textContent = playing ? 'Pause flow' : 'Play flow';
  $('play').setAttribute('aria-pressed', String(playing));
  $('next').textContent = manual ? 'Restart walkthrough' : step < scenario.steps.length ? 'Next: ' + events[scenario.steps[step]][0] : 'Replay walkthrough';
}
function render() {
  const before = mark.getBoundingClientRect();
  movement?.cancel();
  const leading = state.runtime !== 'idle' || state.phase === 'settling';
  $('page').dataset.phase = state.phase;
  $('page').dataset.runtime = state.runtime;
  $('page').dataset.connection = state.connection;
  $('page').dataset.outcome = state.outcome;
  $('scenario').value = scenario.id;
  row.classList.toggle('session-busy', leading);
  row.setAttribute('aria-label', `Open sample conversation: ${row.querySelector('strong').textContent}. ${phaseName()}${state.unread ? ', unread reply' : ''}`);
  mark.dataset.leading = String(leading);
  mark.dataset.runtime = state.runtime;
  mark.dataset.unread = String(state.unread);
  if (mark.dataset.phase !== state.phase) mark.dataset.phase = state.phase;
  mark.setAttribute('aria-label', `Session A, ${phaseName().toLowerCase()}`);
  const target = $(leading ? 'focus-leading' : 'focus-inline');
  if (mark.parentElement !== target) target.append(mark);
  $('focus-inline').hidden = leading;
  $('focus-dot').hidden = leading;
  if (state.unread && !leading) $('focus-dot').dataset.unread = '';
  else delete $('focus-dot').dataset.unread;
  if (state.phase === 'ready') statusNode.remove();
  else {
    statusNode.textContent = phaseName();
    statusNode.dataset.status = state.phase === 'stopping' ? 'working' : state.phase;
    $('focus-meta').prepend(statusNode);
  }
  $('session-view').hidden = state.viewing;
  $('conversation-view').hidden = !state.viewing;
  $('story-step').textContent = manual ? `Manual exploration · ${history.length} events` : `Step ${step + 1} of ${scenario.steps.length + 1} · ${scenario.name}`;
  $('moment').textContent = notice ? 'Event ignored' : phaseName();
  const last = history.at(-1);
  $('event-note').textContent = notice || (last === 'reply' && state.viewing ? 'A reply arrived while you were reading. It does not become unread.' : last ? events[last][1] : 'The agent is available. Its working loop has not started.');
  const fields = {
    Identity: 'Session A', Runtime: state.runtime + (state.connection === 'connected' ? '' : ' (last known)'),
    Presentation: phaseName(), Connection: state.connection === 'connected' ? 'Connected' : state.connection === 'checking' ? 'Checking fresh activity' : 'Offline',
    Unread: state.unread ? 'New reply' : 'Read', Outcome: state.outcome === 'stopped' ? 'Stopped; partial work unverified' : state.outcome === 'ended' ? 'Run ended; result unreviewed' : 'Not inferred',
    Placement: leading ? 'Beside title · 28px' : 'After details · 20px', View: state.viewing ? 'Conversation' : 'Session list',
  };
  $('model-state').replaceChildren(...Object.entries(fields).map(([name, value]) => {
    const field = document.createElement('div'), description = el('dd', value); description.dataset.field = name;
    field.append(el('dt', name), description); return field;
  }));
  // Measure after the explanation reflows, so a longer event note cannot jump the mark.
  const after = mark.getBoundingClientRect();
  if (!motionReduced() && before.width && after.width && (Math.abs(before.x - after.x) > .5 || Math.abs(before.y - after.y) > .5 || before.width !== after.width)) {
    movement = mark.animate([
      { transform: `translate(${before.x - after.x}px, ${before.y - after.y}px) scale(${before.width / after.width})`, transformOrigin: '0 0' },
      { transform: 'none', transformOrigin: '0 0' },
    ], { duration: 360, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }
  const url = new URL(location.href); url.searchParams.delete('variant'); url.searchParams.set('scenario', scenario.id);
  if (manual) url.searchParams.delete('step'); else url.searchParams.set('step', String(step));
  window.history.replaceState(null, '', url);
  renderControls();
}
function stopPlayback() { playing = false; clearTimeout(timer); renderControls(); }
function chooseScenario(id, requestedStep = 0) {
  stopPlayback();
  const found = scenarios.find(item => item.id === id);
  scenario = found || scenarios[0];
  step = found && Number.isInteger(requestedStep) && requestedStep >= 0 && requestedStep <= scenario.steps.length ? requestedStep : 0;
  history = scenario.steps.slice(0, step); state = history.reduce(evolve, { ...initial }); manual = false; notice = ''; render();
}
function dispatch(event, guided = false) {
  const next = evolve(state, event);
  if (next === state) { notice = `${events[event][0]} does not apply to the current state. Nothing changed.`; render(); return; }
  state = next; history.push(event); notice = '';
  if (guided) step++; else manual = true;
  render();
}
function advance(automatic = false) {
  if (!automatic) stopPlayback();
  if (manual || step === scenario.steps.length) { chooseScenario(scenario.id); return; }
  dispatch(scenario.steps[step], true);
  if (step === scenario.steps.length) stopPlayback();
}
function previous() {
  stopPlayback(); if (!history.length) return;
  history.pop(); state = history.reduce(evolve, { ...initial });
  if (!manual) step = Math.max(0, step - 1);
  notice = ''; render();
}
function tick() {
  if (!playing) return;
  advance(true);
  if (playing) timer = setTimeout(tick, 1800);
}
$('scenario').addEventListener('change', () => chooseScenario($('scenario').value));
$('next').addEventListener('click', () => advance());
$('previous').addEventListener('click', previous);
$('play').addEventListener('click', () => {
  if (playing) { stopPlayback(); return; }
  if (manual || step === scenario.steps.length) chooseScenario(scenario.id);
  playing = true; renderControls(); timer = setTimeout(tick, 900);
});
for (const [event, [label]] of Object.entries(events)) {
  const button = el('button', label); button.type = 'button'; button.dataset.event = event;
  button.addEventListener('click', () => { stopPlayback(); dispatch(event); }); $('free-events').append(button);
}
$('focus-row').addEventListener('click', () => { stopPlayback(); dispatch('open'); });
$('back-to-list').addEventListener('click', () => { stopPlayback(); dispatch('back'); });
function renderMotion() {
  document.documentElement.classList.toggle('reduced-motion', motionReduced());
  $('motion').setAttribute('aria-pressed', String(motionReduced()));
  $('motion').disabled = motionPreference.matches;
  if (motionReduced()) movement?.cancel();
}
$('motion').addEventListener('click', () => { reduceMotion = !reduceMotion; renderMotion(); });
motionPreference.addEventListener('change', renderMotion);
function renderTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Preview light theme' : 'Preview dark theme';
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#100d10' : '#fafaf8';
}
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; renderTheme(); });
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('document-hidden', document.hidden);
  if (document.hidden) stopPlayback();
});
window.addEventListener('pagehide', stopPlayback);
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); advance(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
});
renderTheme(); renderMotion();
const url = new URL(location.href);
chooseScenario(url.searchParams.get('scenario'), Number(url.searchParams.get('step')));
