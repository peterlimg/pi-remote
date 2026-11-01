// Interactive orchestration UI over simulated milestones. No agents, transport or storage.
const $ = id => document.getElementById(id);
const copyIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const scenes = [
  { title: 'A coordinator, two workers', caption: 'Open a worker session. Everything here is simulated.', messages: [
    { role: 'user', text: 'Check the back gesture and simplify the login copy. Keep the existing controls.' },
    { text: 'I’ve started two worker sessions and will coordinate them here.', kind: 'handoff' }
  ] },
  { title: 'Keep the conversation moving', caption: 'The jobs continue while you discuss something else.', messages: [
    { role: 'user', text: 'For the first release, should we lead with QR pairing?' },
    { text: 'Yes. Lead with QR pairing and keep private-link login as the fallback. The two reviews can continue without holding up this discussion.' }
  ] },
  { title: 'A choice that cannot be guessed', caption: 'A blocking choice arrives here, without replacing your draft.', messages: [
    { text: 'Login copy needs a decision before it continues.', kind: 'question' }
  ] },
  { title: 'Answer, then stop only one job', caption: 'The login choice and Navigation stop are separate actions.', messages: [
    { role: 'user', text: 'Keep the saved format. Just simplify the copy.' },
    { text: 'Login copy will keep the saved format. Existing links will remain valid.' },
    { role: 'user', text: 'Stop the Navigation investigation for now.' },
    { text: 'Navigation is stopped. Its partial findings are unverified. Login copy continues, and the QR-first release plan is unchanged.' }
  ] },
  { title: 'Return to one useful briefing', caption: 'Twenty minutes later. Review the outcome, not worker history.', messages: [
    { text: '', kind: 'briefing' }
  ] },
  { title: 'Correct the result in context', caption: 'The correction stays with Login copy, in the same conversation.', messages: [
    { role: 'user', text: 'Keep “Private login link” as the label. Shorten only the placeholder.' },
    { text: 'I’ll keep that label and change only the placeholder. The saved format is unchanged; Navigation stays stopped.', kind: 'correction' }
  ] }
];
let scene = 0, attached = false, selected = 'coordinator', workerOverrides = {}, loginChoice = false;
const sessions = {
  coordinator: { name: 'Mobile release', role: 'Coordinator', scope: 'Coordinate Navigation and Login copy.', draft: '', attached: false, scroll: 0, messages: [] },
  navigation: { name: 'Navigation', role: 'Worker', scope: 'Investigate the back gesture. Keep the existing controls.', draft: '', attached: false, scroll: 0, messages: [] },
  login: { name: 'Login copy', role: 'Worker', scope: 'Simplify sign-in wording. Ask before changing saved-link storage.', draft: '', attached: false, scroll: 0, messages: [] }
};
const stateLabels = { working: 'Working', waiting: 'Needs a decision', stopped: 'Stopped · unverified', ready: 'Report delivered' };
const feedback = text => { $('sample-feedback').textContent = text; };
function addMessage({ role = 'assistant', text, kind, route }, current = false) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  article.setAttribute('aria-label', role === 'user' ? 'You' : 'Pi');
  if (current) article.dataset.currentScene = '';
  const body = document.createElement('div'); body.className = 'message-text';
  if (route) { const receipt = document.createElement('p'); receipt.className = 'routing-receipt'; receipt.textContent = route; body.append(receipt); }
  if (text) { const p = document.createElement('p'); p.textContent = text; body.append(p); }
  if (kind === 'handoff') body.insertAdjacentHTML('beforeend', '<section class="delegation-block" aria-label="Coordinator and worker sessions"><h2>Worker sessions</h2><p class="delegation-owner">Assigned by Mobile release · Coordinator</p><div class="delegation-workers">' + workerLinks() + '</div></section>');
  if (kind === 'question') {
    body.insertAdjacentHTML('beforeend', routingReceipt('Question routed') + '<div class="story-question" data-question-state="' + (loginChoice ? 'answered' : 'open') + '"><strong>Should Login copy change the saved-link format?</strong><p>That could sign existing users out. I recommend keeping the format and shortening only the wording.</p>' + (loginChoice ? '<p class="hint">Coordinator → Login copy: keep the saved format.</p>' : workerState('login') === 'stopped' ? '<p class="hint">This worker is stopped. No permission was granted.</p>' : '<div class="story-actions"><button type="button" data-story-action="keep">Keep saved format</button><button type="button" class="quiet" data-story-action="discuss">Discuss the change</button></div>') + '</div>');
  }
  if (kind === 'briefing') {
    body.insertAdjacentHTML('beforeend', '<div class="story-return">Since you were away</div>' + routingReceipt('Report delivered') + '<section class="story-briefing"><h2>Login wording is ready to review.</h2><p>The proposal shortens the sign-in wording. Saved-link storage is outside its scope.</p>' + result(false) + '<p class="story-stopped"><strong>Navigation is stopped.</strong> No gesture fix was verified.</p><p>The QR-first release plan is unchanged.</p></section>');
  }
  if (kind === 'correction') body.insertAdjacentHTML('beforeend', routingReceipt('Revision routed', true) + result(true));
  if (kind === 'worker-result') body.insertAdjacentHTML('beforeend', result(scene >= 5));
  article.append(body);
  if (role === 'assistant') {
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'quiet copy-message';
    copy.setAttribute('aria-label', 'Copy message'); copy.title = 'Copy message'; copy.innerHTML = copyIcon;
    copy.onclick = () => feedback('Storyboard copy only. Clipboard unchanged.'); article.append(copy);
  }
  $('agent-activity').before(article);
  return article;
}
function result(corrected) {
  return '<figure class="story-result"><figcaption>web/index.html · illustrative diff</figcaption><pre><code>' +
    (corrected ? '' : '<span class="removed">- label: Private login link</span><span class="added">+ label: Private link from your computer</span>') +
    '<span class="removed">- placeholder: Paste the private link from your computer</span><span class="added">+ placeholder: ' +
    (corrected ? 'Paste your private link' : 'Paste your private login link') +
    '</span></code></pre></figure><p class="story-result-note">Not applied or verified.</p><details class="story-source"><summary>Scope and verification</summary><p>Only the login label and placeholder are shown. Saved-link storage, authentication and the composer are outside this proposal. A real implementation would need its own validation.</p></details>';
}
function workerState(id) {
  return workerOverrides[id] || (id === 'navigation' ? scene >= 3 ? 'stopped' : 'working' : scene >= 4 ? 'ready' : scene === 2 && !loginChoice ? 'waiting' : 'working');
}
function workerLinks() {
  return ['navigation', 'login'].map(id => '<button type="button" class="worker-link" data-open-session="' + id + '" aria-label="Open ' + sessions[id].name + ' worker session"><span><strong>' + sessions[id].name + '</strong><small>Worker session · own context</small></span><span class="worker-state" data-state="' + workerState(id) + '">' + stateLabels[workerState(id)] + '</span></button>').join('');
}
function routingReceipt(label, toWorker = false) {
  const worker = '<button type="button" class="quiet" data-open-session="login" aria-label="Open Login copy worker session">Login copy · Worker</button>';
  const route = toWorker ? '<span>Mobile release · Coordinator →</span>' + worker : worker + '<span>→ Mobile release · Coordinator</span>';
  return '<div class="routing-receipt" role="group" aria-label="' + label + '">' + route + '<span>' + label + '</span></div>';
}
function renderSessions() {
  const row = id => '<button type="button" class="session' + (selected === id ? ' active' : '') + '" data-session="' + id + '"' + (selected === id ? ' aria-current="true"' : '') + '><span class="session-indicators"><span class="session-state-dot" data-state="' + (id === 'coordinator' ? 'idle' : workerState(id)) + '" aria-hidden="true"></span></span><div class="session-body"><div class="session-top"><strong>' + sessions[id].name + '</strong></div><div class="session-meta"><span class="session-role">' + sessions[id].role + (id === 'coordinator' ? ' · 2 worker sessions' : ' · ' + stateLabels[workerState(id)]) + '</span></div></div></button>';
  $('sessions').innerHTML = row('coordinator') + '<div class="worker-sessions" role="group" aria-label="Workers coordinated by Mobile release">' + row('navigation') + row('login') + '</div>';
  for (const node of document.querySelectorAll('.delegation-workers')) node.innerHTML = workerLinks();
}
function renderWorker() {
  const worker = sessions[selected], state = workerState(selected);
  const origin = document.createElement('section'); origin.className = 'worker-origin'; origin.setAttribute('aria-label', 'Worker session ownership');
  origin.innerHTML = '<button type="button" class="quiet" data-open-session="coordinator">Return to Mobile release · Coordinator</button><p>' + worker.name + ' · Worker session · ' + stateLabels[state] + '</p><p class="worker-context">Separate transcript and worktree: <code>/sample/pi-remote/.worktrees/' + selected + '</code></p>';
  $('agent-activity').before(origin);
  addMessage({ role: 'user', route: 'Mobile release · Coordinator → ' + worker.name + ' · Worker', text: worker.scope });
  if (selected === 'login' && scene >= 3) addMessage({ role: 'user', route: 'Coordinator → Login copy', text: 'Keep the saved format. Just simplify the copy.' });
  if (selected === 'login' && scene >= 5) addMessage({ role: 'user', route: 'Coordinator → Login copy', text: 'Keep the Private login link label. Shorten only the placeholder.' });
  if (state === 'stopped') addMessage({ text: 'This worker is stopped. Partial findings are unverified; nothing has been replayed.' });
  else if (selected === 'login' && state === 'waiting') {
    addMessage({ text: 'Changing the saved-link format could sign people out. I sent that decision to the coordinator; this worker is waiting.' });
    const link = document.createElement('button'); link.type = 'button'; link.className = 'quiet'; link.dataset.openSession = 'coordinator'; link.textContent = 'Open the question in the coordinator'; $('agent-activity').before(link); link.classList.add('worker-question-link');
  } else if (selected === 'login' && state === 'ready') addMessage({ text: 'Login wording is ready. The report was delivered to Mobile release for review.', kind: 'worker-result' });
  else addMessage({ text: selected === 'navigation' ? 'Comparing back-gesture handling with vertical scrolling. No result has been reported.' : 'Reviewing the sign-in labels without changing the saved-link format.' });
}
function renderView({ restore = false } = {}) {
  const ui = sessions[selected], transcript = $('transcript');
  for (const node of transcript.querySelectorAll('.message, .worker-origin, .worker-question-link')) node.remove();
  if (selected === 'coordinator') {
    for (let i = 0; i <= scene; i++) for (const message of scenes[i].messages) addMessage(message, i === scene);
  } else renderWorker();
  for (const message of ui.messages) addMessage(message);
  $('title').textContent = ui.name;
  $('project').textContent = selected === 'coordinator' ? '/sample/pi-remote' : '/sample/pi-remote/.worktrees/' + selected;
  $('prompt').value = ui.draft; attached = ui.attached; renderAttachment(); renderSessions(); updateControls();
  transcript.scrollTop = restore ? ui.scroll : 0;
  if (!restore && selected === 'coordinator' && scene > 0) {
    const anchor = transcript.querySelector('[data-current-scene]');
    transcript.scrollTop = anchor.getBoundingClientRect().top - document.querySelector('.conversation-header').getBoundingClientRect().bottom - 16;
  }
  updateScrollButton();
}
function selectSession(id) {
  if (!Object.hasOwn(sessions, id) || id === selected) return;
  const ui = sessions[selected]; ui.draft = $('prompt').value; ui.attached = attached; ui.scroll = $('transcript').scrollTop;
  selected = id; closeCommands(); $('app').classList.add('viewing'); renderView({ restore: true });
  const url = new URL(location.href); if (id === 'coordinator') url.searchParams.delete('session'); else url.searchParams.set('session', id); history.replaceState(null, '', url);
  feedback('Selected ' + sessions[id].name + ' · ' + sessions[id].role + '. Messages and Stop apply only to this session.');
}
function readScene() {
  const value = Number(new URL(location.href).searchParams.get('scene'));
  return Number.isInteger(value) && value >= 1 && value <= scenes.length ? value - 1 : 0;
}
function showScene(index) {
  sessions[selected].draft = $('prompt').value; sessions[selected].attached = attached;
  scene = Math.max(0, Math.min(scenes.length - 1, index)); selected = 'coordinator'; workerOverrides = {}; loginChoice = scene >= 3;
  for (const ui of Object.values(sessions)) { ui.messages = []; ui.scroll = 0; }
  const url = new URL(location.href); url.searchParams.delete('variant'); url.searchParams.delete('session'); url.searchParams.set('scene', scene + 1); history.replaceState(null, '', url);
  $('story-position').textContent = `Orchestration · ${scene + 1} of ${scenes.length}`;
  $('story-title').textContent = scenes[scene].title;
  $('story-caption').textContent = scenes[scene].caption;
  $('story-previous').disabled = scene === 0;
  $('story-next').querySelector('span').textContent = scene === scenes.length - 1 ? 'Restart' : 'Next';
  $('story-next').setAttribute('aria-label', scene === scenes.length - 1 ? 'Restart storyboard' : 'Next scene');
  for (const button of $('story-scenes').querySelectorAll('button')) {
    if (Number(button.dataset.scene) === scene) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  renderView();
  feedback(`Scene ${scene + 1} of ${scenes.length}: ${scenes[scene].title}. Illustrative, not a live session.`);
}
$('story-scenes').innerHTML = scenes.map((item, index) => `<li><button type="button" class="quiet" data-scene="${index}"><span>${index + 1}</span>${item.title}</button></li>`).join('');
$('story-scenes').onclick = event => {
  const button = event.target.closest('[data-scene]'); if (!button) return;
  $('story-index').hidePopover(); showScene(Number(button.dataset.scene));
};
$('story-previous').onclick = () => showScene(scene - 1);
$('story-next').onclick = () => showScene(scene === scenes.length - 1 ? 0 : scene + 1);
window.addEventListener('popstate', () => showScene(readScene()));
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable], dialog') || document.querySelector('dialog[open], :popover-open')) return;
  if (event.key === 'ArrowRight' && scene < scenes.length - 1) { event.preventDefault(); showScene(scene + 1); }
  if (event.key === 'ArrowLeft' && scene > 0) { event.preventDefault(); showScene(scene - 1); }
});
$('transcript').addEventListener('click', event => {
  const session = event.target.closest('[data-open-session]')?.dataset.openSession;
  if (session) { selectSession(session); return; }
  const action = event.target.closest('[data-story-action]')?.dataset.storyAction;
  if (action === 'keep' && selected === 'coordinator' && workerState('login') === 'waiting') {
    loginChoice = true; workerOverrides.login = 'working';
    sessions.login.messages.push({ role: 'user', route: 'Coordinator → Login copy', text: 'Keep the saved format. Just simplify the copy.' });
    const question = event.target.closest('.story-question');
    question.dataset.questionState = 'answered';
    question.querySelector('.story-actions').replaceWith(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Coordinator → Login copy: saved format kept. ' + (workerState('navigation') === 'working' ? 'Navigation continues.' : 'Navigation remains stopped.') }));
    renderSessions(); feedback('Decision delivered only to the Login copy worker session.');
  }
  if (action === 'discuss') {
    addMessage({ text: 'A format change could invalidate saved links. In this story, we keep the format and review only the wording. No permission has been granted.' });
    $('transcript').scrollTop = $('transcript').scrollHeight;
  }
});
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
  const working = selected !== 'coordinator' && workerState(selected) === 'working', hasDraft = !!$('prompt').value.trim() || attached;
  $('abort').hidden = !working || hasDraft; $('send').hidden = working && !hasDraft; $('agent-activity').hidden = !working;
  $('activity-label').textContent = sessions[selected].name + ' is working in its own session';
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands'; $('status').textContent = working ? 'working' : 'idle'; resizePrompt(); updateScrollButton();
}
// Normal runtime sample values; the production composer subtree and its stylesheet are unchanged.
$('composer').hidden = false;
$('title').textContent = 'Mobile release'; $('project-name').textContent = 'pi-remote'; $('project-name').hidden = false;
$('project').textContent = '/sample/pi-remote';
renderSessions();
$('list-page').textContent = ''; $('connection').hidden = true;
$('model').hidden = false; $('model-name').textContent = 'GPT-6.1 Sol';
$('model').title = 'Switch model: GPT-6.1 Sol'; $('model').setAttribute('aria-label', $('model').title);
$('reasoning-control').hidden = false; $('reasoning-value').textContent = 'XHigh'; $('reasoning-control').title = 'Change reasoning effort: Extra high';
$('usage-meter').hidden = false; $('usage-meter').dataset.level = 'normal'; $('usage-meter').title = '12% of context used'; $('usage-meter').setAttribute('aria-label', 'Usage: 12% of context used'); $('usage-arc').setAttribute('stroke-dasharray', '12 100');
$('status-line').hidden = false; $('status-line').innerHTML = '<span data-level="normal">12%/200k</span>';
$('back').onclick = () => $('app').classList.remove('viewing');
$('sessions').onclick = event => {
  const id = event.target.closest('[data-session]')?.dataset.session;
  if (id === selected) $('app').classList.add('viewing'); else if (id) selectSession(id);
};
for (const id of ['logout', 'new-session', 'session-pin', 'session-icon-open', 'search-open']) $(id).onclick = () => feedback('Storyboard only. No session or account changes.');
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('composer').onsubmit = event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text && !attached) return;
  if (text === '/model') { openSettings('model'); return; }
  if (text.startsWith('/')) { feedback('Storyboard command only. Nothing executed.'); return; }
  const user = { role: 'user', text: text || 'Sample image attached.', route: selected === 'coordinator' ? undefined : 'You → ' + sessions[selected].name + ' · Worker' };
  const reply = { text: selected === 'coordinator' ? 'That message stays with the coordinator in this prototype. It has not approved a permission or changed a worker.' : 'Instruction received only by ' + sessions[selected].name + ' in this sample. It has not been applied by a real agent.' };
  sessions[selected].messages.push(user, reply); addMessage(user); addMessage(reply);
  sessions[selected].draft = ''; sessions[selected].attached = false;
  $('prompt').value = ''; attached = false; renderAttachment();
  closeCommands(); updateControls(); $('transcript').scrollTop = $('transcript').scrollHeight;
};
$('abort').onclick = () => {
  if (selected === 'coordinator' || workerState(selected) !== 'working') return;
  workerOverrides[selected] = 'stopped'; sessions[selected].scroll = $('transcript').scrollTop;
  sessions[selected].messages.push({ text: 'This worker is stopped. Its partial findings are unverified. The coordinator and other worker are unchanged.' });
  renderView({ restore: true }); feedback('Stopped only ' + sessions[selected].name + ' in this sample.');
};
function closeCommands() { $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false'); }
function openCommands() {
  $('command-menu').hidden = false; $('prompt').setAttribute('aria-expanded', 'true'); $('commands').setAttribute('aria-expanded', 'true');
  $('command-options').innerHTML = '<button type="button" class="command-option" role="option" aria-selected="false"><strong>/model</strong><span>Choose a model</span></button>';
  $('command-help').textContent = 'Storyboard command. No agent runs.';
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
  $('picker-options').innerHTML = usage ? '<div class="usage-details"><h3>Current context</h3><p>12% used · 24,000 / 200,000 tokens</p></div>' : `<button type="button" class="picker-option" aria-pressed="true"><span class="picker-option-label">${effort ? 'Extra high' : 'GPT-6.1 Sol'}</span></button>`;
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
  $('transcript').scrollTop = $('transcript').scrollHeight;
  $('transcript').focus({ preventScroll: true });
  updateScrollButton();
};
$('transcript').onscroll = updateScrollButton;
let promptWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width === promptWidth) return;
  promptWidth = entry.contentRect.width; resizePrompt(); updateScrollButton();
}).observe($('prompt'));
const requestedSession = new URL(location.href).searchParams.get('session');
showScene(readScene());
if (requestedSession && Object.hasOwn(sessions, requestedSession)) selectSession(requestedSession);
