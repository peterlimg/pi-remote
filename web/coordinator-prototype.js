// Visual study only. Sessions, messages and Stop are local samples, never real commands.
const $ = id => document.getElementById(id);
const feedback = text => { $('sample-feedback').textContent = text; };
const sessions = {
  coordinator: { name: 'Mobile release', state: 'idle', draft: '', attached: false, scroll: 0, messages: [
    { role: 'user', text: 'Review the back gesture, simplify the login wording, and check the phone layout. Keep the existing controls.' },
    { text: 'I’ve split the review across three independent sessions. Navigation is working; Login copy has a question; Checks has returned its notes.' }
  ] },
  navigation: { name: 'Navigation', state: 'working', draft: '', attached: false, scroll: 0, messages: [
    { role: 'user', route: 'Mobile release → Navigation', text: 'Check the back gesture without changing the existing controls.' },
    { text: 'I’m tracing how the edge gesture interacts with vertical scrolling. No result has been returned yet.' }
  ] },
  login: { name: 'Login copy', state: 'waiting', draft: '', attached: false, scroll: 0, messages: [
    { role: 'user', route: 'Mobile release → Login copy', text: 'Simplify the sign-in wording. Keep saved links compatible.' },
    { route: 'Question sent to Mobile release', text: 'Keep "Private login link" as the field label? I can shorten the placeholder to "Paste your private link" without changing the saved format.' }
  ] },
  checks: { name: 'Checks', state: 'returned', draft: '', attached: false, scroll: 0, messages: [] }
};
const labels = { working: 'Working', waiting: 'Needs answer', returned: 'Returned', stopped: 'Stopped' };
const requested = new URL(location.href).searchParams.get('session');
let selected = Object.hasOwn(sessions, requested) ? requested : 'coordinator', attached = false;
const workerState = id => sessions[id].state;

function addMessage({ role = 'assistant', text, route }) {
  const article = document.createElement('article');
  article.className = 'message ' + role; article.setAttribute('aria-label', role === 'user' ? 'You' : sessions[selected].name);
  const body = document.createElement('div'); body.className = 'message-text';
  if (route) { const source = document.createElement('p'); source.className = 'message-route'; source.textContent = route; body.append(source); }
  const content = document.createElement('p'); content.textContent = text; body.append(content); article.append(body);
  $('agent-activity').before(article);
}
function addReport() {
  const report = document.createElement('article'); report.className = 'review-document'; report.setAttribute('aria-label', 'Returned viewport review');
  report.innerHTML = '<p>viewport-review.md</p><h2>Phone layout review</h2><p>Keep the controls familiar. Check the interaction between the back gesture, vertical scrolling, and the keyboard before changing navigation.</p><h3>Review points</h3><ul><li>Keep every composer action available at phone width.</li><li>Distinguish a vertical scroll from an edge gesture.</li><li>Check the keyboard-open case on an iPhone.</li></ul><p class="review-note">Illustrative report from Checks to Mobile release. This is not an executed test result.</p>';
  $('agent-activity').before(report);
}
function renderTeam() {
  for (const button of document.querySelectorAll('.worker-window')) {
    const id = button.dataset.session;
    button.dataset.state = workerState(id);
    button.querySelector('.worker-status span').textContent = labels[workerState(id)];
    if (id === selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
function renderView({ restore = true } = {}) {
  const ui = sessions[selected], worker = selected !== 'coordinator';
  for (const node of $('transcript').querySelectorAll('.message, .review-document')) node.remove();
  if (selected === 'checks') addReport();
  for (const message of ui.messages) addMessage(message);
  $('title').textContent = ui.name;
  $('workspace-subtitle').textContent = worker ? 'Worker of Mobile release · Sample' : 'Coordinator · Sample workspace';
  $('workspace-back').setAttribute('aria-label', worker ? 'Return to Mobile release coordinator' : 'Back to Pi Remote');
  $('thread-title').textContent = worker ? 'Worker conversation' : 'Conversation';
  $('thread-recipient').textContent = 'To ' + ui.name;
  $('app').classList.toggle('worker-focused', worker);
  const room = $('sessions').querySelector('button');
  if (worker) room.removeAttribute('aria-current'); else room.setAttribute('aria-current', 'page');
  $('prompt').value = ui.draft; attached = ui.attached;
  renderAttachment(); renderTeam(); updateControls();
  $('transcript').scrollTop = restore ? ui.scroll : $('transcript').scrollHeight;
  const url = new URL(location.href);
  url.searchParams.delete('scene'); url.searchParams.delete('variant'); url.searchParams.set('study', 'workspace');
  if (worker) url.searchParams.set('session', selected); else url.searchParams.delete('session');
  history.replaceState(null, '', url);
}
function selectSession(id, reply = false) {
  if (!Object.hasOwn(sessions, id)) return;
  if (id !== selected) {
    const ui = sessions[selected]; ui.draft = $('prompt').value; ui.attached = attached; ui.scroll = $('transcript').scrollTop;
    closeCommands(); if ($('settings-dialog').open) $('settings-dialog').close();
    $('prompt').blur(); selected = id; renderView();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $('transcript').animate(
      [{ opacity: .75, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  }
  if (reply) $('prompt').focus({ preventScroll: true });
  else $('transcript').focus({ preventScroll: true });
  feedback('Selected ' + sessions[selected].name + '. Messages and Stop apply only to this sample session.');
  updateViewport();
}
function resizePrompt() {
  const input = $('prompt');
  if (!input.clientWidth) return;
  const top = input.scrollTop;
  input.style.height = 'auto'; input.style.height = `${input.value ? input.scrollHeight : 0}px`; input.scrollTop = top;
}
function updateScrollButton() {
  const box = $('transcript');
  $('scroll-bottom').hidden = box.scrollHeight - box.clientHeight - box.scrollTop < 100;
}
function updateControls() {
  const working = workerState(selected) === 'working', hasDraft = !!$('prompt').value.trim() || attached;
  $('abort').hidden = !working || hasDraft; $('send').hidden = working && !hasDraft;
  $('agent-activity').hidden = !working; $('activity-label').textContent = sessions[selected].name + ' is working';
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands';
  $('status').textContent = working ? 'working' : 'idle';
  resizePrompt(); updateScrollButton();
}
function updateViewport() {
  const viewport = window.visualViewport, height = viewport?.height || innerHeight;
  document.documentElement.style.setProperty('--viewport-height', height + 'px');
  document.documentElement.style.setProperty('--viewport-top', (viewport?.offsetTop || 0) + 'px');
  document.documentElement.toggleAttribute('data-keyboard', innerHeight - height > 120);
  $('app').classList.toggle('is-compact', height < 650 && innerWidth <= 1100);
  resizePrompt(); updateScrollButton();
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-session]');
  if (button) selectSession(button.dataset.session, button.hasAttribute('data-reply'));
});
$('workspace-back').onclick = () => selected === 'coordinator' ? location.assign('/') : selectSession('coordinator');
function selectQueue(id, focus = false) {
  $('prompt').blur();
  for (const name of ['question', 'returned']) {
    const active = name === id;
    $(name + '-tab').setAttribute('aria-selected', String(active));
    $(name + '-tab').tabIndex = active ? 0 : -1;
    $(name + '-panel').hidden = !active;
  }
  if (focus) $(id + '-tab').focus();
}
for (const name of ['question', 'returned']) {
  $(name + '-tab').onclick = () => selectQueue(name);
  $(name + '-tab').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectQueue(event.key === 'Home' ? 'question' : event.key === 'End' ? 'returned' : name === 'question' ? 'returned' : 'question', true);
  };
}
$('composer').hidden = false;
$('model').hidden = false; $('model-name').textContent = 'GPT-6.1 Sol';
$('model').title = 'Switch model: GPT-6.1 Sol'; $('model').setAttribute('aria-label', $('model').title);
$('reasoning-control').hidden = false; $('reasoning-value').textContent = 'Max'; $('reasoning-control').title = 'Change reasoning effort: Max';
$('usage-meter').hidden = false; $('usage-meter').dataset.level = 'normal'; $('usage-meter').title = '12% of context used';
$('usage-meter').setAttribute('aria-label', 'Usage: 12% of context used'); $('usage-arc').setAttribute('stroke-dasharray', '12 100');
$('status-line').hidden = false; $('status-line').innerHTML = '<span data-level="normal">12%/200k</span>';
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('composer').onsubmit = event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text && !attached) return;
  if (text === '/model') { openSettings('model'); return; }
  if (text.startsWith('/')) { feedback('Design study command only. Nothing executed.'); return; }
  const user = { role: 'user', text: text || 'Sample image attached.' };
  const reply = { text: 'Sample message received by ' + sessions[selected].name + ' only. No real agent ran.' };
  sessions[selected].messages.push(user, reply); addMessage(user); addMessage(reply);
  sessions[selected].draft = ''; sessions[selected].attached = false;
  $('prompt').value = ''; attached = false; renderAttachment(); closeCommands(); updateControls();
  $('transcript').scrollTop = $('transcript').scrollHeight;
};
$('abort').onclick = () => {
  if (selected === 'coordinator' || workerState(selected) !== 'working') return;
  sessions[selected].state = 'stopped';
  sessions[selected].messages.push({ text: 'Only Navigation is stopped in this sample. Its partial findings are unverified. The coordinator and the other workers are unchanged.' });
  renderView(); feedback('Stopped only Navigation in this sample. No real agent was affected.');
};
function closeCommands() { $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false'); }
function openCommands() {
  $('command-menu').hidden = false; $('prompt').setAttribute('aria-expanded', 'true'); $('commands').setAttribute('aria-expanded', 'true');
  $('command-options').innerHTML = '<button type="button" class="command-option" role="option" aria-selected="false"><strong>/model</strong><span>Choose a model</span></button>';
  $('command-help').textContent = 'Design study command. No agent runs.';
  $('command-options').firstElementChild.onclick = () => { $('prompt').value = '/model'; closeCommands(); updateControls(); $('prompt').focus(); };
}
$('commands').onclick = () => $('command-menu').hidden ? openCommands() : closeCommands();
$('prompt').oninput = () => { sessions[selected].draft = $('prompt').value; updateControls(); if ($('prompt').value.startsWith('/')) openCommands(); else closeCommands(); };
$('prompt').onkeydown = event => { if (event.key === 'Escape') closeCommands(); };
function openSettings(kind) {
  closeCommands(); const usage = kind === 'usage', effort = kind === 'effort';
  $('settings-picker').hidden = false; $('model-search').hidden = usage || effort; $('picker-title').hidden = !usage && !effort;
  $('picker-title').textContent = usage ? 'Usage' : 'Reasoning effort'; $('picker-help').textContent = 'Illustrative values only.';
  $('settings-picker').setAttribute('aria-label', usage ? 'Usage' : effort ? 'Choose reasoning effort' : 'Choose a model');
  $('settings-dialog').setAttribute('aria-label', usage ? 'Usage' : 'Model settings');
  $('picker-options').innerHTML = usage ? '<div class="usage-details"><h3>Current context</h3><p>12% used · 24,000 / 200,000 tokens</p></div>' : `<button type="button" class="picker-option" aria-pressed="true"><span class="picker-option-label">${effort ? 'Max' : 'GPT-6.1 Sol'}</span></button>`;
  $('settings-dialog').toggleAttribute('data-sheet', innerWidth <= 700);
  $(usage ? 'usage-meter' : effort ? 'reasoning-control' : 'model').setAttribute('aria-expanded', 'true');
  if (innerWidth <= 700) $('settings-dialog').showModal(); else $('settings-dialog').show();
  $('picker-options').querySelector('button')?.addEventListener('click', () => $('settings-dialog').close());
}
$('model').onclick = () => openSettings('model'); $('reasoning-control').onclick = () => openSettings('effort');
$('usage-meter').onclick = () => openSettings('usage'); $('status-line').onclick = () => openSettings('usage');
$('picker-cancel').onclick = () => $('settings-dialog').close();
$('settings-dialog').onclose = () => { $('settings-picker').hidden = true; for (const id of ['model', 'reasoning-control', 'usage-meter']) $(id).setAttribute('aria-expanded', 'false'); };
$('attach').onclick = () => $('sample-attachment').showModal();
$('attachment-close').onclick = () => $('sample-attachment').close();
function renderAttachment() {
  $('attachments').replaceChildren(); $('attachments').hidden = !attached;
  if (!attached) return;
  $('attachments').innerHTML = '<div class="attachment"><img src="/icon.svg" alt="Sample attachment"><button type="button" aria-label="Remove sample image">×</button></div>';
  $('attachments').querySelector('button').onclick = () => { attached = false; sessions[selected].attached = false; renderAttachment(); updateControls(); };
}
$('attachment-add').onclick = () => {
  attached = true; sessions[selected].attached = true; renderAttachment();
  $('sample-attachment').close(); updateControls();
};

$('scroll-bottom').onclick = () => {
  // Blur can expand the receiving tray, so measure the thread after moving focus.
  $('transcript').focus({ preventScroll: true }); $('transcript').scrollTop = $('transcript').scrollHeight; updateScrollButton();
};
$('transcript').onscroll = updateScrollButton;
let promptWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width === promptWidth) return;
  promptWidth = entry.contentRect.width; resizePrompt(); updateScrollButton();
}).observe($('prompt'));
addEventListener('resize', updateViewport);
visualViewport?.addEventListener('resize', updateViewport);
visualViewport?.addEventListener('scroll', updateViewport);
$('prompt').addEventListener('focus', updateViewport);
$('prompt').addEventListener('blur', updateViewport);
renderView({ restore: false }); updateViewport();
