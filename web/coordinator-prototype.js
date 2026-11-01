// Throwaway, synthetic state only. No production app, transport, files or storage.
const $ = id => document.getElementById(id);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const copyIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const action = (name, task, label, className = 'quiet') => `<button type="button" class="${className}" data-action="${name}" data-task="${task.id}" aria-label="${escape(task.name + ': ' + label)}">${escape(label)}</button>`;
const labels = { running: 'Running', question: 'Needs your choice', result: 'Report ready', stopped: 'Stopped · outcome unknown' };
const initialTasks = () => [
  { id: 'login', name: 'Login copy', state: 'question', scope: 'Simplify login labels. Ask before changing saved data.', detail: 'Change the saved-login format? Existing users could be signed out.', inspected: false },
  { id: 'touch', name: 'Touch targets', state: 'result', scope: 'Review target sizes; report findings without editing.', detail: 'Sample measurements: image close is 32 × 32 px; session menu is 36 × 36 px. Increase both tap targets to 44 × 44 px.', inspected: false },
  { id: 'navigation', name: 'Navigation', state: 'running', scope: 'Check back navigation without changing the existing controls.', detail: 'Comparing the back gesture with vertical scrolling. No findings yet.', inspected: false }
];
let tasks, variant, working = false, attached = false;
const feedback = text => { $('sample-feedback').textContent = text; };
function message(role, text, quote) {
  const article = document.createElement('article');
  article.className = `message ${role}`; article.setAttribute('aria-label', role === 'user' ? 'You' : 'Pi');
  const body = document.createElement('div'); body.className = 'message-text';
  if (quote) { const block = document.createElement('blockquote'); block.textContent = quote; body.append(block); }
  if (role === 'assistant') { const p = document.createElement('p'); p.textContent = text; body.append(p); }
  else body.append(document.createTextNode(text));
  article.append(body);
  if (role === 'assistant') {
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'quiet copy-message';
    copy.setAttribute('aria-label', 'Copy message'); copy.title = 'Copy message'; copy.innerHTML = copyIcon;
    // Keep the sample self-contained, including clipboard actions.
    copy.onclick = () => feedback('Sample copy only. Clipboard unchanged.'); article.append(copy);
  }
  $('agent-activity').before(article);
  return article;
}
function taskBody(task) {
  if (task.inspected) return `<p class="hint">Read-only sample activity</p><div class="coordinator-task-trace"><p class="hint">Coordinator assignment</p><p>${escape(task.scope)}</p><p class="hint">${escape(task.name)} report</p><p>${escape(task.detail)}</p></div>${action('back', task, 'Back to task')}`;
  if (task.confirmStop) return `<p>Stop ${escape(task.name)} only? Partial work will be unverified. Other tasks continue.</p><div class="coordinator-task-actions">${action('stop-cancel', task, 'Keep running')}${action('stop', task, `Stop ${task.name} only`, 'quiet coordinator-stop')}</div>`;
  return `<p>${escape(task.detail)}</p>
    ${task.state === 'result' ? '<p class="hint">Reported, not independently verified. Nothing changed.</p>' : ''}
    ${task.state === 'question' ? `<div class="coordinator-task-decisions">${action('keep', task, 'Keep saved format', 'quiet coordinator-choice')}${action('allow', task, 'Allow format change', 'quiet coordinator-choice')}</div>` : ''}
    <div class="coordinator-task-actions">${action('inspect', task, 'Inspect')}${action('follow', task, task.state === 'result' ? 'Review with coordinator' : 'Discuss')}${['running', 'question'].includes(task.state) ? action('stop-review', task, `Stop ${task.name}…`, 'quiet coordinator-stop') : ''}</div>`;
}
function taskList(group) {
  return tasks.map(task => `<details class="coordinator-task" name="${group}" data-task="${task.id}" data-state="${task.state}"><summary><span class="coordinator-task-name">${escape(task.name)}</span><span class="coordinator-task-state">${labels[task.state]}</span></summary><div class="coordinator-task-body">${taskBody(task)}</div></details>`).join('');
}
function updateTask(task) {
  for (const node of document.querySelectorAll(`.coordinator-task[data-task="${task.id}"]`)) {
    node.dataset.state = task.state; node.querySelector('.coordinator-task-state').textContent = labels[task.state];
    node.querySelector('.coordinator-task-body').innerHTML = taskBody(task);
  }
  updateActivityLabel();
}
function updateActivityLabel() {
  const pending = tasks.filter(task => task.state === 'question').length;
  $('inline-activity-label').textContent = `${tasks.length} tasks · ${pending ? '1 needs your choice' : 'view activity'}`;
  $('header-activity').textContent = `${tasks.length} tasks`;
  $('header-activity').setAttribute('aria-label', `View ${tasks.length} delegated tasks${pending ? ', 1 needs your choice' : ''}`);
}
function setVariant(value) {
  const top = $('transcript').scrollTop;
  variant = value === 'B' ? 'B' : 'A';
  const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url);
  $('inline-activity').hidden = variant !== 'A'; $('header-activity').hidden = variant !== 'B';
  $('prototype-tools').innerHTML = `Prototype<span>${variant}</span>`;
  $('prototype-tools').setAttribute('aria-label', `Coordinator prototype ${variant} · synthetic data`);
  document.querySelector(`input[name="variant"][value="${variant}"]`).checked = true;
  $('transcript').scrollTop = top;
}
function resizePrompt() {
  const input = $('prompt'), top = input.scrollTop;
  input.style.height = 'auto'; input.style.height = `${input.value ? input.scrollHeight : 0}px`; input.scrollTop = top;
}
function updateControls() {
  const hasDraft = !!$('prompt').value.trim() || attached;
  $('abort').hidden = !working || hasDraft; $('send').hidden = working && !hasDraft;
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands';
  $('status').textContent = working ? 'working' : 'idle'; $('status').dataset.status = $('status').textContent;
  $('agent-activity').hidden = !working;
  $('sample-working').checked = working;
  resizePrompt();
}
function initialize() {
  tasks = initialTasks(); working = false; attached = false;
  for (const node of $('transcript').querySelectorAll('.message')) node.remove();
  message('user', 'Review the mobile navigation and login flow. Keep the existing controls.');
  const handoff = message('assistant', 'I’ll check Navigation, Login copy, and Touch targets in parallel. I’ll bring the findings back here.');
  handoff.querySelector('.copy-message').insertAdjacentHTML('beforebegin', '<details id="inline-activity" class="coordinator-activity"><summary><span id="inline-activity-label"></span></summary><div class="coordinator-task-list">' + taskList('inline-tasks') + '</div></details>');
  message('assistant', 'The touch-target review is ready. Login copy needs your choice; Navigation is still running.');
  $('sheet-tasks').innerHTML = taskList('sheet-tasks');
  $('prompt').value = ''; $('attachments').replaceChildren(); $('attachments').hidden = true;
  $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false');
  $('sample-footer').checked = true; $('status-line').hidden = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  setVariant(variant); updateActivityLabel(); updateControls(); $('transcript').scrollTop = 0;
}

// Normal runtime sample values on the unmodified production subtree.
$('composer').hidden = false;
$('title').textContent = 'Review mobile flow'; $('project-name').textContent = 'mobile'; $('project-name').hidden = false;
$('project').textContent = '/sample/mobile'; $('session-pin').hidden = false;
$('title-kind').innerHTML = '<span class="heading-kind bot" data-kind="review" data-mood="idle" role="img" aria-label="Review" title="Review"><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><g class="bot-figure"><g class="bot-body"><rect x="4" y="7" width="24" height="21" rx="7"/></g><g class="bot-eyes"><g class="bot-look"><ellipse class="bot-eye" cx="11.5" cy="17" rx="2.1" ry="2.9"/><circle class="bot-shine" cx="12.2" cy="15.9" r="0.7"/><ellipse class="bot-eye" cx="20.5" cy="17" rx="2.1" ry="2.9"/><circle class="bot-shine" cx="21.2" cy="15.9" r="0.7"/></g></g><g class="bot-frame"><circle cx="11.5" cy="17" r="4.6"/><circle cx="20.5" cy="17" r="4.6"/></g></g></svg></span>';
$('heading-strip').querySelector('.heading-slot:not([data-side])').insertAdjacentHTML('beforeend', '<button id="header-activity" class="coordinator-header-activity" type="button" aria-haspopup="dialog" aria-controls="activity-sheet" hidden>3 tasks</button>');
$('sessions').innerHTML = '<button type="button" class="session active" aria-current="true"><span class="session-indicators"></span><div class="session-body"><div class="session-top"><strong>Review mobile flow</strong></div><div class="session-meta"><span class="session-project"><span class="session-project-name">mobile</span></span></div></div></button>';
const sessionIcon = $('title-kind').firstElementChild.cloneNode(true); sessionIcon.classList.replace('heading-kind', 'session-icon');
$('sessions').querySelector('.session-indicators').append(sessionIcon);
$('list-page').textContent = ''; $('connection').hidden = true;
$('model').hidden = false; $('model-name').textContent = 'GPT-6.1 Sol';
$('model').title = 'Switch model: GPT-6.1 Sol'; $('model').setAttribute('aria-label', $('model').title);
$('reasoning-control').hidden = false; $('reasoning-value').textContent = 'XHigh'; $('reasoning-control').title = 'Change reasoning effort: Extra high';
$('usage-meter').hidden = false; $('usage-meter').dataset.level = 'normal'; $('usage-meter').title = '12% of context used'; $('usage-meter').setAttribute('aria-label', 'Usage: 12% of context used'); $('usage-arc').setAttribute('stroke-dasharray', '12 100');
$('composer-connection').title = 'Computer connected'; $('composer-connection').setAttribute('aria-label', 'Computer connected'); $('composer-connection-text').textContent = 'Computer connected';
$('composer-send-status').textContent = 'Sending…'; $('resume').disabled = true;
$('status-line').innerHTML = '<span data-level="normal">12%/200k</span>';

$('header-activity').onclick = () => { $('activity-sheet').showModal(); };
$('activity-close').onclick = () => $('activity-sheet').close();
$('prototype-options').addEventListener('change', event => {
  if (event.target.name === 'variant') setVariant(event.target.value);
  if (event.target.id === 'sample-working') { working = event.target.checked; updateControls(); }
  if (event.target.id === 'sample-footer') $('status-line').hidden = !event.target.checked;
});
$('reset-sample').onclick = () => { initialize(); feedback('Sample reset.'); };
window.addEventListener('popstate', () => setVariant(new URL(location.href).searchParams.get('variant')));
$('back').onclick = () => { $('app').classList.remove('viewing'); };
$('sessions').onclick = () => $('app').classList.add('viewing');
for (const id of ['logout', 'new-session', 'session-pin', 'session-icon-open', 'search-open']) $(id).onclick = () => feedback('Sample only. No session or account changes.');

// Delegation never changes the composer's recipient or its Send/Stop state.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const task = tasks.find(item => item.id === button.dataset.task); if (!task) return;
  const operation = button.dataset.action, row = button.closest('.coordinator-task');
  const scrollers = [$('transcript'), $('sheet-tasks')];
  const positions = operation === 'back' ? task.returnScroll : scrollers.map(node => node.scrollTop);
  if (operation === 'inspect') { task.returnScroll = positions; task.inspected = true; }
  if (operation === 'back') task.inspected = false;
  if (operation === 'stop-review' || operation === 'stop-cancel') task.confirmStop = operation === 'stop-review';
  if (operation === 'keep' || operation === 'allow') {
    if (task.state !== 'question') return;
    task.state = 'running';
    task.detail = operation === 'keep' ? 'Labels only. Saved-login format stays unchanged.' : 'Format change explicitly allowed for Login copy in this sample.';
    message('assistant', `Login copy: ${task.detail}`); feedback(`Login copy: ${task.detail}`);
  }
  if (operation === 'stop') {
    task.state = 'stopped'; task.confirmStop = false; task.detail = 'Stopped before a final report. Partial changes are unknown; nothing was rolled back.';
    message('assistant', `${task.name} is stopped in this sample. Its partial work is unverified. Other tasks continue.`);
    feedback(`${task.name} stopped. Outcome unknown.`);
  }
  if (operation === 'follow') {
    message('user', 'Please review this task’s latest update.', `${task.name}: ${task.detail}`);
    message('assistant', `I’ll keep the follow-up scoped to ${task.name}. It does not approve any permission request.`);
    $('activity-sheet').close(); $('transcript').scrollTop = $('transcript').scrollHeight;
    $('transcript').focus({ preventScroll: true }); return;
  }
  updateTask(task);
  scrollers.forEach((node, index) => { node.scrollTop = positions[index]; });
  const next = { inspect: 'back', back: 'inspect', 'stop-review': 'stop-cancel', 'stop-cancel': 'stop-review' }[operation];
  (next ? row.querySelector(`[data-action="${next}"]`) : row.querySelector('summary')).focus({ preventScroll: true });
});
document.addEventListener('click', event => {
  if (!event.target.closest('#inline-activity > summary')) return;
  const top = $('transcript').scrollTop;
  requestAnimationFrame(() => { $('transcript').scrollTop = top; });
});
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('composer').onsubmit = event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text && !attached) return;
  if (text === '/model') { openSettings('model'); return; }
  if (text.startsWith('/')) { feedback('Sample command only. Nothing was executed.'); return; }
  message('user', text || 'Sample image attached.'); message('assistant', 'I’ve kept that with this review. The delegated tasks are unchanged.');
  $('prompt').value = ''; attached = false; $('attachments').hidden = true; $('attachments').replaceChildren();
  closeCommands(); updateControls(); $('transcript').scrollTop = $('transcript').scrollHeight;
};
$('abort').onclick = () => { working = false; updateControls(); message('assistant', 'This coordinator turn is stopped in the sample. Delegated tasks are unchanged.'); };
function closeCommands() { $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false'); }
function openCommands() {
  $('command-menu').hidden = false; $('prompt').setAttribute('aria-expanded', 'true'); $('commands').setAttribute('aria-expanded', 'true');
  $('command-options').innerHTML = '<button type="button" class="command-option" role="option" aria-selected="false"><strong>/model</strong><span>Choose a model</span></button>';
  $('command-help').textContent = 'Sample command. No agent runs.';
  $('command-options').firstElementChild.onclick = () => { $('prompt').value = '/model'; closeCommands(); updateControls(); $('prompt').focus(); };
}
$('commands').onclick = () => $('command-menu').hidden ? openCommands() : closeCommands();
$('prompt').oninput = () => { updateControls(); if ($('prompt').value.startsWith('/')) openCommands(); else closeCommands(); };
$('prompt').onkeydown = event => { if (event.key === 'Escape') closeCommands(); };
function openSettings(kind) {
  closeCommands(); const usage = kind === 'usage', effort = kind === 'effort';
  $('settings-picker').hidden = false; $('model-search').hidden = usage || effort; $('picker-title').hidden = !usage && !effort;
  $('picker-title').textContent = usage ? 'Usage' : 'Reasoning effort';
  $('picker-help').textContent = 'Sample values only.';
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
$('attachment-add').onclick = () => {
  attached = true; $('attachments').hidden = false;
  $('attachments').innerHTML = '<div class="attachment"><img src="/icon.svg" alt="Sample attachment"><button type="button" aria-label="Remove sample image">×</button></div>';
  $('attachments').querySelector('button').onclick = () => { attached = false; $('attachments').hidden = true; $('attachments').replaceChildren(); updateControls(); };
  $('sample-attachment').close(); updateControls();
};
$('scroll-bottom').onclick = () => { $('transcript').scrollTop = $('transcript').scrollHeight; };
$('transcript').onscroll = () => { $('scroll-bottom').hidden = $('transcript').scrollHeight - $('transcript').clientHeight - $('transcript').scrollTop < 40; };
new ResizeObserver(resizePrompt).observe($('prompt'));
variant = new URL(location.href).searchParams.get('variant'); initialize();
