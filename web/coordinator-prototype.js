// Separate studies share this static route without touching live chat.
if (new URL(location.href).searchParams.get('study') === 'launchers') {
  const content = document.getElementById('worker-launcher-study').content.cloneNode(true);
  content.querySelector('#launcher-composer-slot').replaceWith(document.getElementById('composer'));
  document.body.replaceChildren(content);
  document.body.dataset.study = 'launchers';
  WorkerLauncherStudy();
} else if (new URL(location.href).searchParams.get('study') === 'panes') {
  const content = document.getElementById('worker-pane-study').content.cloneNode(true);
  content.querySelector('#pane-composer-slot').replaceWith(document.getElementById('composer'));
  document.body.replaceChildren(content);
  document.body.dataset.study = 'panes';
  WorkerPaneStudy();
} else {
// UI-only coordinator studies on this route, selected with ?variant=A|B|C|D.
const $ = id => document.getElementById(id);
const variants = {
  A: { name: 'Plain list', description: 'A full-width worker list. Tap a worker to inspect its read-only log. All input stays in the coordinator.' },
  B: { name: 'Inline details', description: 'Inspect worker status without leaving the main conversation. Questions and instructions go through the coordinator.' },
  C: { name: 'Session tree', description: 'Keep the main conversation and its read-only worker logs together. The coordinator is the only recipient of user input.' },
  D: { name: 'Working answer', description: 'A versioned working answer with source citations. New worker findings wait for you to review them; instructions stay with the coordinator.' }
};
const sessions = {
  coordinator: { name: 'Mobile review', state: 'idle', draft: '', attached: false, messages: [
    { role: 'user', text: 'Trace phone messaging and restart recovery. Review the findings before changing anything.' },
    { text: 'Messaging is tracing the send path. Layout review returned notes to keep worker names visible and preserve the composer. I will review those findings here.', actions: ['Stop Messaging'] },
    { text: 'Recovery needs a choice before it can continue. Should it check browser reload or host restart first?', question: true, actions: ['Browser reload first', 'Host restart first'] }
  ] },
  messaging: { name: 'Messaging', state: 'working', detail: 'Following Send through the phone, host, and Pi session.', messages: [
    { role: 'coordinator', route: 'Assignment from Mobile review', text: 'Trace how a phone message reaches Pi. Return file references. Read-only.' },
    { text: 'I’m following the request from the composer through the host. No final findings have been returned yet.' }
  ] },
  recovery: { name: 'Recovery', state: 'waiting', detail: 'Should I check browser reload or host restart first?', messages: [
    { role: 'coordinator', route: 'Assignment from Mobile review', text: 'Ask which recovery path to investigate, then wait for my answer.' },
    { route: 'Question sent to Mobile review', text: 'Should I check browser reload or host restart first?' }
  ] },
  review: { name: 'Layout review', state: 'reported', detail: 'Sample notes are ready for review. Keep worker names visible and preserve the existing composer.', messages: [
    { route: 'Result returned to Mobile review', text: 'Sample layout-review.md: show ownership, keep names readable, and leave the composer intact. These are illustrative notes, not an executed review.' }
  ] }
};
// Canned sample instructions demonstrate the UI, not natural-language routing.
const instructions = new Map([
  ['browser reload first', { worker: 'recovery', state: 'working', detail: 'Checking browser reload first, as chosen in the main conversation.', receipt: 'I relayed your choice to Recovery: browser reload first. Other workers are unchanged.' }],
  ['host restart first', { worker: 'recovery', state: 'working', detail: 'Checking host restart first, as chosen in the main conversation.', receipt: 'I relayed your choice to Recovery: host restart first. Other workers are unchanged.' }],
  ['stop messaging', { worker: 'messaging', state: 'stopped', detail: 'Stopped by the coordinator at your request.', receipt: 'I stopped Messaging at your request. Recovery and Layout review are unchanged.' }]
]);
const workers = ['messaging', 'recovery', 'review'];
const labels = { working: 'Working', waiting: 'Needs answer', reported: 'Result ready', stopped: 'Stopped', completed: 'Reviewed' };
const params = new URL(location.href).searchParams;
let variant = Object.hasOwn(variants, params.get('variant')) ? params.get('variant') : 'A';
let selected = Object.hasOwn(sessions, params.get('session')) ? params.get('session') : 'coordinator';
let preview = innerHeight >= 600 ? 'recovery' : undefined, attached = false;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const feedback = text => { $('sample-feedback').textContent = text; surfaceState(); };
const workingAnswer = {
  visited: false, safari: false, choice: null, checked: false, pending: null, scroll: 0, receipt: '', revisions: [],
  sources: {
    messaging: { name: 'Messaging', state: 'working', messages: [
      { role: 'coordinator', route: 'Assignment from Mobile review', text: 'Trace send and reconnect delivery. Return evidence without changing files.' },
      { text: 'Sample trace: the initial message reached the host. Reconnect delivery is still being checked.' }
    ] },
    recovery: { name: 'Recovery', state: 'waiting', messages: [
      { role: 'coordinator', route: 'Assignment from Mobile review', text: 'Investigate draft recovery. Escalate product decisions, not investigation order.' },
      { route: 'Decision raised with Mobile review', text: 'Should drafts stay on this phone or follow the user across devices?' }
    ] },
    review: { name: 'Layout review', state: 'reported', messages: [
      { text: 'Sample notes: preserve the existing composer, keep sources inspectable, and do not replace text while the user is reading.' }
    ] }
  }
};
function answerSnapshot(reason, instruction = '') {
  const delivery = workingAnswer.checked
    ? workingAnswer.safari ? 'The Safari sample trace reaches Pi after reconnect. Delivery passed the simulated check.' : 'The sample trace reaches Pi after reconnect. Delivery passed the simulated check.'
    : workingAnswer.safari ? 'Earlier delivery evidence was not Safari-specific. It needs rechecking before I can rely on it here.' : 'The sample send trace reaches the host. Reconnect delivery is still being checked.';
  const recovery = workingAnswer.choice
    ? workingAnswer.choice === 'local' ? 'Drafts should stay on this phone. Recovery is checking reload behavior against that decision.' : 'Drafts should follow you across devices. Recovery is investigating the privacy and recovery trade-offs.'
    : 'Reload recovery remains unverified. One product decision affects the proposed solution.';
  workingAnswer.revisions.push({ number: workingAnswer.revisions.length + 1, reason, instruction,
    scope: workingAnswer.safari ? 'Safari only · Read-only' : 'Mobile flow · Read-only',
    delivery, recovery, choice: workingAnswer.choice, receipt: workingAnswer.receipt });
}
answerSnapshot('Working draft', 'Review mobile message delivery and draft recovery. Return findings without changing files.');
function sessionFor(id) { return variant === 'D' && id !== 'coordinator' ? workingAnswer.sources[id] : sessions[id]; }
function VariantD() {
  const snapshot = workingAnswer.revisions.at(-1), article = el('article', undefined, 'answer-document');
  article.setAttribute('aria-label', 'Working answer');
  const heading = el('h2', 'Mobile login review'); heading.id = 'answer-heading';
  article.append(heading, el('p', 'Revision ' + snapshot.number + ' · ' + snapshot.scope, 'answer-meta'));
  for (const [id, text] of [['messaging', snapshot.delivery], ['recovery', snapshot.recovery]]) {
    const section = el('section', undefined, 'answer-finding'), finding = el('p', text);
    finding.id = 'answer-' + id;
    const source = el('button', sessionFor(id).name, 'quiet answer-citation');
    source.type = 'button'; source.dataset.session = id; source.setAttribute('aria-label', 'Inspect ' + sessionFor(id).name + ' source');
    section.append(finding, source); article.append(section);
  }
  if (!snapshot.choice) {
    const decision = el('section', undefined, 'answer-decision');
    decision.setAttribute('aria-label', 'Decision for you');
    decision.append(el('h3', 'One decision'), el('p', 'Should drafts stay on this phone or follow you across devices?'));
    const actions = el('div', undefined, 'coordinator-actions');
    for (const text of ['Keep on phone', 'Across devices']) {
      const button = el('button', text, 'quiet'); button.type = 'button'; button.dataset.instruction = text; actions.append(button);
    }
    decision.append(actions); article.append(decision);
  }
  if (snapshot.receipt) {
    const receipt = el('p', snapshot.receipt, 'answer-receipt'); receipt.id = 'answer-receipt'; receipt.setAttribute('role', 'status'); article.append(receipt);
  }
  return article;
}
function queueAnswerFinding() {
  if (workingAnswer.pending || workingAnswer.checked) { feedback('This sample finding is already available or reviewed. Change the scope to try a recheck.'); return; }
  const source = workingAnswer.sources.messaging;
  if (source.state === 'stopped') { feedback('Messaging is stopped. No new sample report was accepted.'); return; }
  source.state = 'completed';
  source.messages.push({ text: workingAnswer.safari ? 'Sample report: the Safari reconnect trace reaches Pi.' : 'Sample report: the reconnect trace reaches Pi.' },
    { role: 'coordinator', route: 'Reviewed by Mobile review', text: 'Evidence accepted for the current scope. An answer revision is ready when the reader chooses to review it.' });
  workingAnswer.pending = { safari: workingAnswer.safari };
  renderDock(); updateControls(); feedback('New sample findings are waiting. The answer and your reading position have not been replaced.');
}
function reviewAnswerFinding() {
  if (!workingAnswer.pending) return;
  workingAnswer.checked = true; workingAnswer.pending = null; workingAnswer.scroll = 0;
  workingAnswer.receipt = 'I reviewed the Messaging report and updated the delivery finding. Recovery is unchanged.';
  answerSnapshot('Delivery finding reviewed');
  if (selected !== 'coordinator') selectSession('coordinator'); else renderSelected();
}
function steerWorkingAnswer(text) {
  const command = text.toLowerCase().replace(/[.!?]+$/, '');
  let reason = 'Instruction received';
  if (command === 'ignore desktop. focus on safari' || command === 'focus on safari') {
    const changed = !workingAnswer.safari, discarded = changed && !!workingAnswer.pending;
    reason = changed ? 'Scope changed to Safari' : 'Safari scope confirmed';
    if (changed) {
      workingAnswer.safari = true; workingAnswer.checked = false; workingAnswer.pending = null;
      workingAnswer.sources.messaging.state = 'working';
      workingAnswer.sources.messaging.messages.push({ role: 'coordinator', route: 'Instruction from Mobile review', text: 'Ignore desktop. Recheck the delivery evidence for Safari only.' });
      workingAnswer.sources.recovery.messages.push({ role: 'coordinator', route: 'Instruction from Mobile review', text: 'Focus the recovery investigation on Safari. Existing product decisions still apply.' });
    }
    workingAnswer.receipt = changed ? 'I redirected Messaging and Recovery to Safari. Delivery evidence must be checked for this scope.' + (discarded ? ' Older queued findings were set aside.' : '') : 'Safari remains the scope. Current findings and queued evidence are unchanged.';
  } else if (command === 'keep on phone' || command === 'across devices') {
    reason = 'Draft recovery decision';
    workingAnswer.choice = command === 'keep on phone' ? 'local' : 'synced';
    workingAnswer.sources.recovery.state = 'working';
    workingAnswer.sources.recovery.messages.push({ role: 'coordinator', route: 'Instruction from Mobile review', text });
    workingAnswer.receipt = 'I relayed your draft recovery decision to Recovery. Messaging and Layout review are unchanged.';
  } else if (command === 'stop messaging') {
    reason = 'Messaging stopped';
    workingAnswer.sources.messaging.state = 'stopped';
    workingAnswer.sources.messaging.messages.push({ role: 'coordinator', route: 'Instruction from Mobile review', text });
    workingAnswer.receipt = 'I stopped Messaging at your request. Recovery and Layout review are unchanged.';
  } else {
    workingAnswer.receipt = 'Instruction recorded in the main session. This sample only routes the labeled decisions, “Ignore desktop. Focus on Safari.”, and “Stop Messaging”. No other worker action was inferred.';
  }
  answerSnapshot(reason, text);
  $('prompt').value = ''; sessions.coordinator.draft = ''; attached = false; sessions.coordinator.attached = false;
  workingAnswer.scroll = 0; closeCommands(); renderSelected();
}
function renderAnswerHistory() {
  $('answer-history-list').replaceChildren();
  for (const revision of workingAnswer.revisions.toReversed()) {
    const detail = el('details'), summary = el('summary', 'Revision ' + revision.number + ' · ' + revision.reason);
    detail.append(summary, el('p', revision.scope, 'answer-meta'));
    if (revision.instruction) detail.append(el('p', 'Your instruction: ' + revision.instruction, 'answer-history-instruction'));
    detail.append(el('p', revision.delivery), el('p', revision.recovery));
    if (!revision.choice) detail.append(el('p', 'Open decision: keep drafts on this phone or follow you across devices?'));
    if (revision.receipt) detail.append(el('p', revision.receipt));
    $('answer-history-list').append(detail);
  }
}

function surfaceState() {
  $('prototype-state').textContent = JSON.stringify({ variant, selected, recipient: 'coordinator', preview, expanded: $('worker-stack').open, sessions, workingAnswer: variant === 'D' ? workingAnswer : undefined }, null, 2);
}
function updateURL() {
  const url = new URL(location.href); url.searchParams.set('study', 'stacks'); url.searchParams.set('variant', variant); url.searchParams.delete('scene');
  if (selected === 'coordinator') url.searchParams.delete('session'); else url.searchParams.set('session', selected);
  history.replaceState(null, '', url);
}
function row(id, mode = 'open') {
  const ui = sessionFor(id), button = el('button', undefined, 'stack-row');
  button.type = 'button'; button.dataset.state = ui.state;
  button.setAttribute('aria-label', id === 'coordinator' ? 'Return to Mobile review main conversation' : (mode === 'preview' ? 'Inspect ' + ui.name : 'View ' + ui.name + ' log') + ', ' + labels[ui.state]);
  if (id === selected) button.setAttribute('aria-current', 'page');
  if (mode === 'preview') { button.dataset.preview = id; button.setAttribute('aria-expanded', String(preview === id && selected === 'coordinator')); }
  else button.dataset.session = id;
  button.append(el('span', ui.name, 'stack-name'));
  const status = el('span', undefined, 'stack-state');
  if (id !== 'coordinator') { const dot = el('i'); dot.setAttribute('aria-hidden', 'true'); status.append(dot); }
  status.append(el('span', id === 'coordinator' ? 'Main conversation' : labels[ui.state])); button.append(status);
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('viewBox', '0 0 24 24'); arrow.setAttribute('width', '16'); arrow.setAttribute('height', '16');
  arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', 'currentColor'); arrow.setAttribute('stroke-width', '1.8');
  arrow.setAttribute('stroke-linecap', 'round'); arrow.setAttribute('stroke-linejoin', 'round'); arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<path d="m9 5 7 7-7 7"/>'; button.append(arrow);
  return button;
}
function VariantA() {
  const node = el('div', undefined, 'plain-stack');
  for (const id of workers) node.append(row(id));
  return node;
}
function VariantB() {
  const node = el('div', undefined, 'details-stack');
  for (const id of workers) node.append(row(id, selected === 'coordinator' ? 'preview' : 'open'));
  if (preview && selected === 'coordinator') {
    const ui = sessions[preview], detail = el('section', undefined, 'stack-detail');
    detail.setAttribute('aria-label', ui.name + ' details');
    detail.append(el('h3', ui.name + (ui.state === 'waiting' ? ' · Question for coordinator' : ui.state === 'reported' ? ' returned' : ' status')), el('p', ui.detail));
    const actions = el('div', undefined, 'stack-detail-actions');
    const open = el('button', 'View ' + ui.name + ' log', 'quiet'); open.type = 'button'; open.dataset.session = preview;
    if (ui.state === 'waiting') {
      const answer = el('button', 'Answer in main chat', 'quiet'); answer.type = 'button';
      answer.dataset.session = 'coordinator'; answer.dataset.focusInput = ''; actions.append(answer);
    }
    const close = el('button', 'Close details', 'quiet'); close.type = 'button';
    close.onclick = () => { preview = undefined; renderDock(); feedback('Closed the sample detail. Worker names remain visible.'); };
    actions.append(open, close); detail.append(actions); node.append(detail);
  }
  return node;
}
function VariantC() {
  const node = el('div', undefined, 'session-tree'), parent = row('coordinator');
  parent.classList.add('stack-tree-root'); node.append(parent);
  const children = el('div', undefined, 'stack-tree-children');
  for (const id of workers) children.append(row(id));
  node.append(children); return node;
}
function renderDock() {
  if (variant === 'D' && !workingAnswer.visited) { $('worker-stack').open = false; workingAnswer.visited = true; }
  $('worker-stack-content').replaceChildren(({ A: VariantA, B: VariantB, C: VariantC, D: VariantA })[variant]());
  document.querySelector('.stack-summary-title').textContent = variant === 'D' ? 'Sources · 3' : 'Workers · 3';
  $('answer-changes').hidden = variant !== 'D'; $('answer-demo-tools').hidden = variant !== 'D';
  $('answer-new-findings').hidden = variant !== 'D' || !workingAnswer.pending;
  const summary = [];
  for (const [state, label] of [['working', 'working'], ['waiting', 'needs answer'], ['reported', 'ready']]) {
    const count = workers.filter(id => sessionFor(id).state === state).length;
    if (count) summary.push(count + ' ' + label);
  }
  $('worker-stack-summary').textContent = variant === 'D' ? workingAnswer.choice ? 'Read-only logs' : '1 needs you' : summary.join(' · ') || 'No active work';
  $('app').dataset.variant = variant;
  $('variant-label').textContent = 'Prototype ' + variant + ' · ' + variants[variant].name;
  $('variant-description').textContent = variants[variant].description;
  updateURL(); surfaceState();
}
function addMessage(message) {
  const article = el('article', undefined, 'message ' + (message.role || 'assistant'));
  article.setAttribute('aria-label', message.role === 'user' ? 'You' : message.role === 'coordinator' ? 'Mobile review coordinator' : sessionFor(selected).name);
  const body = el('div', undefined, 'message-text');
  if (message.route) body.append(el('p', message.route, 'stack-route'));
  body.append(el('p', message.text));
  if (selected === 'coordinator' && message.actions && (!message.question || sessions.recovery.state === 'waiting')) {
    const actions = el('div', undefined, 'coordinator-actions');
    for (const text of message.actions) {
      if (text === 'Stop Messaging' && sessions.messaging.state === 'stopped') continue;
      const button = el('button', text, 'quiet'); button.type = 'button'; button.dataset.instruction = text; actions.append(button);
    }
    body.append(actions);
  }
  article.append(body); $('agent-activity').before(article);
}
function renderSelected() {
  for (const node of $('transcript').querySelectorAll('.message, .answer-document')) node.remove();
  if (variant === 'D' && selected === 'coordinator') $('agent-activity').before(VariantD());
  else for (const message of sessionFor(selected).messages) addMessage(message);
  $('title').textContent = sessionFor(selected).name;
  $('study-subtitle').textContent = selected === 'coordinator' ? variant === 'D' ? 'Working answer · Sample' : 'Coordinator · Sample' : 'Worker log · Read-only';
  $('study-back').setAttribute('aria-label', selected === 'coordinator' ? 'Back to Pi Remote' : 'Return to Mobile review coordinator');
  $('composer').hidden = selected !== 'coordinator'; $('status-line').hidden = selected !== 'coordinator';
  $('worker-inspection').hidden = selected === 'coordinator';
  $('prompt').value = sessions.coordinator.draft; attached = sessions.coordinator.attached;
  renderAttachment(); renderDock(); updateControls(); $('stack-dock').scrollTop = 0; $('transcript').scrollTop = variant === 'D' && selected === 'coordinator' ? workingAnswer.scroll : $('transcript').scrollHeight;
}
function selectSession(id, focusInput = false) {
  if (selected === 'coordinator') {
    sessions.coordinator.draft = $('prompt').value; sessions.coordinator.attached = attached;
    if (variant === 'D') workingAnswer.scroll = $('transcript').scrollTop;
  }
  closeCommands(); if ($('settings-dialog').open) $('settings-dialog').close();
  $('prompt').blur(); selected = id; renderSelected();
  (focusInput && id === 'coordinator' ? $('prompt') : $('transcript')).focus({ preventScroll: true });
  feedback(id === 'coordinator' ? 'Main conversation. All instructions go to Mobile review.' : 'Read-only ' + sessions[id].name + ' log. Give instructions in the main conversation.');
}
function switchVariant(direction) {
  const wasAnswer = variant === 'D';
  if (wasAnswer && selected === 'coordinator') workingAnswer.scroll = $('transcript').scrollTop;
  $('answer-history').hidePopover();
  const keys = Object.keys(variants); variant = keys[(keys.indexOf(variant) + direction + keys.length) % keys.length];
  if (wasAnswer || variant === 'D') renderSelected(); else renderDock();
  feedback('Prototype ' + variant + ': ' + variants[variant].description);
}
document.addEventListener('click', event => {
  const instruction = event.target.closest('[data-instruction]');
  if (instruction && selected === 'coordinator') {
    if ($('prompt').value.trim() || attached) { feedback('Send or clear your current draft before using a sample instruction.'); return; }
    sendToCoordinator(instruction.dataset.instruction); return;
  }
  const previewButton = event.target.closest('[data-preview]');
  if (previewButton) {
    preview = preview === previewButton.dataset.preview ? undefined : previewButton.dataset.preview; renderDock();
    $('stack-dock').querySelector('.stack-detail')?.scrollIntoView({ block: 'nearest' });
    feedback('Inspecting a local sample.'); return;
  }
  const button = event.target.closest('[data-session]');
  if (button) selectSession(button.dataset.session, button.hasAttribute('data-focus-input'));
});
$('answer-sample-update').onclick = () => { $('study-info').hidePopover(); queueAnswerFinding(); };
$('answer-new-findings').onclick = reviewAnswerFinding;
$('answer-changes').onclick = renderAnswerHistory;
$('worker-stack').ontoggle = surfaceState;
$('study-back').onclick = () => selected === 'coordinator' ? location.assign('/') : selectSession('coordinator');
$('variant-prev').onclick = () => switchVariant(-1); $('variant-next').onclick = () => switchVariant(1);
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open], [popover]:popover-open')) return;
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); switchVariant(event.key === 'ArrowLeft' ? -1 : 1); }
});
$('prototype-theme').onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
};
function resizePrompt() {
  const input = $('prompt'); if (!input.clientWidth) return;
  const top = input.scrollTop; input.style.height = 'auto'; input.style.height = (input.value ? input.scrollHeight : 0) + 'px'; input.scrollTop = top;
}
function updateScrollButton() { const box = $('transcript'); $('scroll-bottom').hidden = box.scrollHeight - box.clientHeight - box.scrollTop < 100; }
function updateControls() {
  const working = selected === 'coordinator' && sessions.coordinator.state === 'working', hasDraft = !!$('prompt').value.trim() || attached;
  $('abort').hidden = !working || hasDraft; $('send').hidden = working && !hasDraft;
  $('agent-activity').hidden = sessionFor(selected).state !== 'working'; $('activity-label').textContent = sessionFor(selected).name + ' is working';
  $('prompt').placeholder = working ? 'Message Pi while it works…' : 'Type / for commands';
  $('status').textContent = working ? 'working' : 'idle'; resizePrompt(); updateScrollButton(); surfaceState();
}
function updateViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--viewport-height', (viewport?.height || innerHeight) + 'px');
  document.documentElement.style.setProperty('--viewport-top', (viewport?.offsetTop || 0) + 'px');
  document.documentElement.style.setProperty('--viewport-scale', String(viewport?.scale || 1));
  document.documentElement.toggleAttribute('data-keyboard', !!viewport && Math.max(innerHeight, document.documentElement.clientHeight) - viewport.height * viewport.scale > 150);
  resizePrompt(); updateScrollButton();
}
$('model').hidden = false; $('model-name').textContent = 'GPT-6.1 Sol';
$('model').title = 'Switch model: GPT-6.1 Sol'; $('model').setAttribute('aria-label', $('model').title);
$('reasoning-control').hidden = false; $('reasoning-value').textContent = 'Max';
$('usage-meter').hidden = false; $('usage-meter').dataset.level = 'normal'; $('usage-meter').setAttribute('aria-label', 'Usage: 12% of context used');
$('usage-arc').setAttribute('stroke-dasharray', '12 100');
$('status-line').innerHTML = '<span data-level="normal">12%/200k</span>';
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
function sendToCoordinator(text) {
  if (variant === 'D') { steerWorkingAnswer(text); return; }
  const user = { role: 'user', text: text || 'Sample image attached.' };
  const instruction = instructions.get(text.toLowerCase().replace(/[.!?]+$/, ''));
  let reply = 'Sample instruction received by Mobile review. No worker action was inferred and no real agent ran.';
  if (instruction) {
    const worker = sessions[instruction.worker]; worker.state = instruction.state; worker.detail = instruction.detail;
    worker.messages.push({ role: 'coordinator', route: 'Instruction from Mobile review', text });
    reply = instruction.receipt;
  }
  sessions.coordinator.messages.push(user, { text: reply });
  $('prompt').value = ''; sessions.coordinator.draft = ''; attached = false; sessions.coordinator.attached = false;
  closeCommands(); renderSelected();
}
$('composer').onsubmit = event => {
  event.preventDefault(); if (selected !== 'coordinator') return;
  const text = $('prompt').value.trim(); if (!text && !attached) return;
  if (text === '/model') { openSettings('model'); return; }
  if (text.startsWith('/')) { feedback('Sample command only. Nothing executed.'); return; }
  sendToCoordinator(text);
};
$('abort').onclick = () => feedback('Only the coordinator response would stop. Worker commands belong in the main conversation.');
function closeCommands() { $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false'); }
function openCommands() {
  $('command-menu').hidden = false; $('prompt').setAttribute('aria-expanded', 'true'); $('commands').setAttribute('aria-expanded', 'true');
  $('command-options').innerHTML = '<button type="button" class="command-option" role="option" aria-selected="false"><strong>/model</strong><span>Choose a sample model</span></button>';
  $('command-help').textContent = 'Design study only. No command executes.';
  $('command-options').firstElementChild.onclick = () => { $('prompt').value = '/model'; closeCommands(); updateControls(); $('prompt').focus(); };
}
$('commands').onclick = () => $('command-menu').hidden ? openCommands() : closeCommands();
$('prompt').oninput = () => { sessions.coordinator.draft = $('prompt').value; updateControls(); if ($('prompt').value.startsWith('/')) openCommands(); else closeCommands(); };
$('prompt').onkeydown = event => { if (event.key === 'Escape') closeCommands(); };
function openSettings(kind) {
  closeCommands(); const usage = kind === 'usage', effort = kind === 'effort';
  $('settings-picker').hidden = false; $('model-search').hidden = usage || effort; $('picker-title').hidden = !usage && !effort;
  $('picker-title').textContent = usage ? 'Usage' : 'Reasoning effort'; $('picker-help').textContent = 'Sample values. No model is called.';
  $('settings-picker').setAttribute('aria-label', usage ? 'Usage' : effort ? 'Choose reasoning effort' : 'Choose a model');
  $('settings-dialog').setAttribute('aria-label', usage ? 'Usage' : 'Model settings');
  $('picker-options').innerHTML = usage ? '<div class="usage-details"><h3>Current context</h3><p>12% used · 24,000 / 200,000 tokens</p></div>' : '<button type="button" class="picker-option" aria-pressed="true"><span class="picker-option-label">' + (effort ? 'Max' : 'GPT-6.1 Sol') + '</span></button>';
  $('settings-dialog').toggleAttribute('data-sheet', innerWidth <= 700);
  $(usage ? 'usage-meter' : effort ? 'reasoning-control' : 'model').setAttribute('aria-expanded', 'true');
  if (innerWidth <= 700) $('settings-dialog').showModal(); else $('settings-dialog').show();
  $('picker-options').querySelector('button')?.addEventListener('click', () => $('settings-dialog').close());
}
$('model').onclick = () => openSettings('model'); $('reasoning-control').onclick = () => openSettings('effort');
$('usage-meter').onclick = () => openSettings('usage'); $('status-line').onclick = () => openSettings('usage');
$('picker-cancel').onclick = () => $('settings-dialog').close();
$('settings-dialog').onclose = () => { $('settings-picker').hidden = true; for (const id of ['model', 'reasoning-control', 'usage-meter']) $(id).setAttribute('aria-expanded', 'false'); };
$('attach').onclick = () => $('sample-attachment').showModal(); $('attachment-close').onclick = () => $('sample-attachment').close();
function renderAttachment() {
  $('attachments').replaceChildren(); $('attachments').hidden = !attached; if (!attached) return;
  $('attachments').innerHTML = '<div class="attachment"><img src="/icon.svg" alt="Sample attachment"><button type="button" aria-label="Remove sample image">×</button></div>';
  $('attachments').querySelector('button').onclick = () => { attached = false; sessions.coordinator.attached = false; renderAttachment(); updateControls(); };
}
$('attachment-add').onclick = () => { attached = true; sessions.coordinator.attached = true; renderAttachment(); $('sample-attachment').close(); updateControls(); };
$('scroll-bottom').onclick = () => { $('transcript').focus({ preventScroll: true }); $('transcript').scrollTop = $('transcript').scrollHeight; updateScrollButton(); };
$('transcript').onscroll = updateScrollButton;
new ResizeObserver(([{ target }]) => {
  const height = target.getBoundingClientRect().height;
  document.querySelector('main').style.setProperty('--coordinator-height', (height ? height + parseFloat(getComputedStyle(target).marginBottom) : 0) + 'px');
}).observe($('stack-dock'));
let promptWidth = 0;
new ResizeObserver(([entry]) => { if (entry.contentRect.width !== promptWidth) { promptWidth = entry.contentRect.width; resizePrompt(); updateScrollButton(); } }).observe($('prompt'));
addEventListener('resize', updateViewport); visualViewport?.addEventListener('resize', updateViewport); visualViewport?.addEventListener('scroll', updateViewport);
renderSelected(); updateViewport();

}

function WorkerPaneStudy() {
// Four UI-only worker-pane studies. No transport, storage, model calls, or real files.
const $ = id => document.getElementById(id);
const variants = {
  A: { name: 'Tree + drawer', description: 'Keep the current worker tree. Tapping a worker slides its read-only log over the conversation from the right. Close it to return to the same place.' },
  B: { name: 'Workers drawer', description: 'Replace the whole tree with one Workers row. It opens a right-side worker list; tap a worker to read its log. The main conversation gets the space back.' },
  C: { name: 'Pinned inspector', description: 'Open the last worker directly and switch logs with tabs. On a wide screen the inspector stays beside an interactive main conversation; on a phone it slides over it.' },
  D: { name: 'Bottom sheet', description: 'One Workers row opens a translucent sheet from the bottom. Inspect a worker, return to the list, or pull the sheet down to close. The conversation stays in place.' }
};
const workers = {
  messaging: { name: 'Messaging', state: 'reported', label: 'Result ready', detail: 'Phone-to-Pi trace and a delivery caveat.', log: `
    <section><h3>Assignment from the main conversation</h3><p>Trace how phone messages reach Pi. Report one concrete risk with file references. Read-only investigation.</p></section>
    <details><summary>Sample activity · read 3 files</summary><ol><li><code>web/app.js</code><br>Follow the composer submission.</li><li><code>src/client-channel.mjs</code><br>Follow the authenticated command.</li><li><code>extension/index.ts</code><br>Follow delivery into Pi.</li></ol></details>
    <section><h3>Sample report</h3><p>The example path is the phone composer, the host's authenticated channel, and the selected Pi session.</p><p>A delivery acknowledgement does not mean the investigation has finished. The main conversation should distinguish accepted input from a reviewed result.</p><p class="sample-label">Illustrative content for comparing the pane. This is not a new code review or an executed trace.</p></section>` },
  recovery: { name: 'Recovery', state: 'stopped', label: 'Stopped', detail: 'Stopped by the coordinator. No final report.', log: `
    <section><h3>Assignment from the main conversation</h3><p>Trace what happens after a host restart. Report one concrete risk with file references.</p></section>
    <details><summary>Sample activity · read 2 files</summary><ol><li><code>src/service.mjs</code><br>Look for session restoration.</li><li><code>src/coordinator.mjs</code><br>Look for uncertain task delivery.</li></ol></details>
    <section><h3>Stopped by the coordinator</h3><p>The main conversation requested that Recovery stop. Messaging was left unchanged.</p><p>No completed report is available. The partial activity above is not proof that restart recovery passed.</p><p class="sample-label">Sample state only. Opening or closing this pane does not start or stop any worker.</p></section>` }
};
const params = new URL(location.href).searchParams;
let variant = Object.hasOwn(variants, params.get('variant')) ? params.get('variant') : 'A';
let selected = Object.hasOwn(workers, params.get('pane')) ? params.get('pane') : null;
let lastWorker = selected || 'messaging', attached = false, returnWorker = 'messaging';
const positions = { messaging: 0, recovery: 0 };
const pane = $('worker-pane'), controls = $('prototype-controls'), surface = pane.querySelector('.pane-surface');
let swipe, swipeAnimation;
const wide = matchMedia('(min-width: 1100px)');
const arrow = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const modal = () => variant !== 'C' || !wide.matches;
const roster = () => variant === 'B' || variant === 'D';
const translatePane = distance => 'translate' + (variant === 'D' ? 'Y' : 'X') + '(' + distance + 'px)';
const feedback = text => { $('sample-feedback').textContent = text; surfaceState(); };
function surfaceState() {
  $('prototype-state').textContent = JSON.stringify({ variant, paneOpen: pane.open, presentation: variant === 'D' ? 'bottom sheet' : modal() ? 'drawer' : 'split',
    inspectedWorker: selected, recipient: 'main conversation', draft: $('prompt').value, sampleAttachment: attached,
    workers: Object.fromEntries(Object.entries(workers).map(([id, worker]) => [id, { name: worker.name, state: worker.state }])) }, null, 2);
}
function updateURL() {
  const url = new URL(location.href);
  url.searchParams.set('study', 'panes'); url.searchParams.set('variant', variant);
  if (pane.open) url.searchParams.set('pane', selected || 'workers'); else url.searchParams.delete('pane');
  history.replaceState(null, '', url);
  surfaceState();
}
function savePosition() { if (pane.open && selected) positions[selected] = $('pane-scroll').scrollTop; }
function resetPaneSwipe() {
  swipe = undefined; swipeAnimation?.cancel(); swipeAnimation = undefined; surface.style.transform = '';
}
function releasePaneSwipe(dismiss) {
  const drag = swipe; swipe = undefined;
  if (!drag?.dragging) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { resetPaneSwipe(); if (dismiss) closePane(); return; }
  const exit = variant === 'D' ? pane.clientHeight - surface.offsetTop : surface.offsetWidth;
  const end = dismiss ? Math.max(exit, drag.distance) : 0;
  const animation = surface.animate({ transform: [translatePane(drag.distance), translatePane(end)] },
    { duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' });
  swipeAnimation = animation;
  animation.finished.then(() => { if (swipeAnimation === animation) { if (dismiss) closePane(); else resetPaneSwipe(); } }, () => {});
}
surface.addEventListener('touchstart', event => {
  if (!pane.open || !modal() || swipeAnimation || event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1) return;
  if (variant === 'D' && $('pane-scroll').contains(event.target) && $('pane-scroll').scrollTop > 0) return;
  const touch = event.touches[0];
  swipe = { x: touch.clientX, y: touch.clientY, distance: 0, dragging: false };
}, { passive: true });
surface.addEventListener('touchmove', event => {
  if (!swipe) return;
  if (event.touches.length !== 1) { releasePaneSwipe(false); return; }
  const dx = event.touches[0].clientX - swipe.x, dy = event.touches[0].clientY - swipe.y;
  const distance = variant === 'D' ? dy : dx, cross = variant === 'D' ? dx : dy;
  if (!swipe.dragging) {
    if (distance < -12 || Math.abs(cross) > 12 && Math.abs(cross) >= Math.abs(distance)) { swipe = undefined; return; }
    if (distance < 12 || distance < Math.abs(cross) * 1.25) return;
    swipe.dragging = true;
    surface.getAnimations().forEach(animation => animation.cancel());
  }
  event.preventDefault();
  swipe.distance = Math.max(0, distance); surface.style.transform = translatePane(swipe.distance);
}, { passive: false });
surface.addEventListener('touchend', event => {
  if (!swipe?.dragging) { swipe = undefined; return; }
  event.preventDefault();
  const size = variant === 'D' ? surface.offsetHeight : surface.offsetWidth;
  releasePaneSwipe(swipe.distance > Math.min(100, size / 4));
}, { passive: false });
surface.addEventListener('touchcancel', () => releasePaneSwipe(false));
function renderEntrypoint() {
  document.body.dataset.variant = variant;
  document.body.dataset.paneOpen = String(pane.open);
  $('coordinator-context').hidden = variant !== 'A';
  $('workers-open').hidden = variant === 'A';
  $('workers-open').setAttribute('aria-expanded', String(pane.open));
  $('variant-label').textContent = variant + ' · ' + variants[variant].name;
  $('variant-description').textContent = variants[variant].description;
  for (const button of $('coordinator-worker-links').children) button.setAttribute('aria-expanded', String(pane.open && selected === button.dataset.worker));
}
function renderPane() {
  const worker = workers[selected];
  $('pane-title').textContent = worker ? worker.name : 'Workers';
  $('pane-subtitle').textContent = worker ? worker.label + ' · Sample worker' : '2 workers in this conversation';
  $('pane-back').hidden = !roster() || !worker;
  $('worker-tabs').hidden = variant !== 'C';
  $('pane-return').firstChild.textContent = modal() ? 'Back to main conversation' : 'Continue in main conversation';
  const content = $('pane-content');
  content.setAttribute('role', variant === 'C' ? 'tabpanel' : 'region');
  content.setAttribute('aria-label', worker ? worker.name + ' log' : 'Worker list');
  if (!worker) {
    content.innerHTML = '<p class="pane-roster-note">Inspect their work here. Keep all instructions in the main conversation.</p><ul class="pane-roster"></ul>';
    for (const [id, item] of Object.entries(workers)) {
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'pane-worker-row'; button.dataset.worker = id;
      button.setAttribute('aria-label', item.name + ', ' + item.label);
      button.innerHTML = '<span><strong>' + item.name + '</strong><small>' + item.label + '</small><small>' + item.detail + '</small></span>' + arrow;
      row.append(button); content.querySelector('ul').append(row);
    }
  } else content.innerHTML = '<article class="worker-log" aria-label="' + worker.name + ' sample log">' + worker.log + '</article>';
  for (const button of $('worker-tabs').children) {
    const active = button.dataset.worker === selected;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  }
  $('pane-scroll').setAttribute('aria-label', worker ? worker.name + ' worker log' : 'Worker list');
  requestAnimationFrame(() => { $('pane-scroll').scrollTop = selected ? positions[selected] : 0; });
}
function showPane() {
  resetPaneSwipe();
  controls.querySelector('[popover]')?.hidePopover();
  pane.setAttribute('aria-modal', String(modal()));
  pane.append(controls);
  modal() ? pane.showModal() : pane.show();
  renderEntrypoint(); renderPane(); updateURL();
  $('pane-close').focus({ preventScroll: true });
}
function openPane(id) {
  savePosition();
  selected = id;
  if (id) { lastWorker = id; returnWorker = id; }
  if (!pane.open) showPane();
  else { renderEntrypoint(); renderPane(); updateURL(); }
}
function closePane() {
  if (!pane.open) return;
  resetPaneSwipe(); savePosition(); $('study-info').hidePopover();
  pane.close(); document.body.append(controls);
  renderEntrypoint(); updateURL();
  const target = variant === 'A' ? $('coordinator-worker-links').querySelector('[data-worker="' + returnWorker + '"]') : $('workers-open');
  target.focus({ preventScroll: true });
}
function setVariant(next) {
  const opened = pane.open;
  savePosition(); $('study-info').hidePopover(); resetPaneSwipe();
  if (opened) pane.close();
  variant = next;
  if (!roster() && !selected) selected = lastWorker;
  if (opened) showPane(); else { renderEntrypoint(); updateURL(); }
}
function cycle(step) { const keys = Object.keys(variants); setVariant(keys[(keys.indexOf(variant) + step + keys.length) % keys.length]); }
for (const [id, worker] of Object.entries(workers)) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'coordinator-worker'; button.dataset.worker = id; button.dataset.state = worker.state;
  button.setAttribute('aria-label', worker.name + ', ' + worker.label);
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'worker-pane');
  button.innerHTML = '<strong>' + worker.name + '</strong><span class="coordinator-worker-state"><i aria-hidden="true"></i>' + worker.label + '</span>' + arrow;
  $('coordinator-worker-links').append(button);
  const tab = document.createElement('button');
  tab.type = 'button'; tab.role = 'tab'; tab.dataset.worker = id; tab.setAttribute('aria-controls', 'pane-content');
  tab.textContent = worker.name; $('worker-tabs').append(tab);
}
$('coordinator-worker-links').addEventListener('click', event => { const id = event.target.closest('[data-worker]')?.dataset.worker; if (id) openPane(id); });
$('pane-content').addEventListener('click', event => { const id = event.target.closest('[data-worker]')?.dataset.worker; if (id) { openPane(id); $('pane-title').focus({ preventScroll: true }); } });
$('worker-tabs').addEventListener('click', event => { const id = event.target.closest('[data-worker]')?.dataset.worker; if (id) openPane(id); });
$('worker-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const ids = Object.keys(workers), current = event.target.closest('[data-worker]')?.dataset.worker || selected;
  const id = ids[(ids.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
  openPane(id); $('worker-tabs').querySelector('[data-worker="' + id + '"]').focus();
});
$('workers-open').addEventListener('click', () => openPane(roster() ? null : lastWorker));
$('pane-back').addEventListener('click', () => { openPane(null); $('pane-content').querySelector('button').focus(); });
$('pane-close').addEventListener('click', closePane);
$('pane-dismiss').addEventListener('click', closePane);
pane.addEventListener('cancel', event => { event.preventDefault(); closePane(); });
$('pane-return').addEventListener('click', () => { if (modal()) closePane(); else $('prompt').focus(); });
for (const id of ['main-session', 'coordinator-owner']) $(id).addEventListener('click', () => { closePane(); $('prompt').focus(); });
$('variant-prev').addEventListener('click', () => cycle(-1));
$('variant-next').addEventListener('click', () => cycle(1));
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable], [role=tablist]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
});
wide.addEventListener('change', () => { if (pane.open) { savePosition(); resetPaneSwipe(); pane.close(); showPane(); } });
$('prototype-theme').addEventListener('click', () => {
  const root = document.documentElement, dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark'; surfaceState();
});
$('composer').hidden = false;
for (const id of ['model', 'reasoning-control', 'usage-meter', 'fast-mode', 'status-line']) $(id).hidden = false;
$('abort').hidden = true;
$('model-name').textContent = 'GPT-6.1 Sol'; $('reasoning-value').textContent = 'Max';
$('usage-meter').setAttribute('aria-label', 'Sample context usage: 4 percent');
$('usage-arc').setAttribute('stroke-dasharray', '4 100');
$('status-line').innerHTML = '<span>CH96%</span><span>$0.14</span><span>4%/500k</span>';
$('send').disabled = true;
$('prompt').addEventListener('input', () => { $('send').disabled = !$('prompt').value.trim() && !attached; surfaceState(); });
$('composer').addEventListener('submit', event => { event.preventDefault(); feedback('Preview only. Your draft has not been sent.'); $('study-info').showPopover(); });
for (const id of ['model', 'reasoning-control', 'usage-meter', 'commands', 'status-line']) $(id).addEventListener('click', () => $('study-info').showPopover());
$('attach').addEventListener('click', () => $('sample-attachment').showModal());
$('attachment-close').addEventListener('click', () => $('sample-attachment').close());
$('attachment-add').addEventListener('click', () => {
  attached = true; $('sample-attachment').close();
  const item = document.createElement('div'); item.className = 'attachment';
  const image = document.createElement('img'); image.alt = 'Sample image, not uploaded';
  image.src = '/icon.svg';
  const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove sample attachment');
  remove.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
  remove.addEventListener('click', () => { attached = false; $('attachments').replaceChildren(); $('attachments').hidden = true; $('send').disabled = !$('prompt').value.trim(); surfaceState(); });
  item.append(image, remove); $('attachments').replaceChildren(item); $('attachments').hidden = false; $('send').disabled = false; surfaceState();
});
renderEntrypoint();
if (params.has('pane')) { if (!roster() && !selected) selected = lastWorker; showPane(); } else updateURL();
requestAnimationFrame(() => { $('transcript').scrollTop = $('transcript').scrollHeight; });

}

function WorkerLauncherStudy() {
// UI-only fixtures. No transport, storage, instruction routing or real worker actions.
const $ = id => document.getElementById(id);
const variants = {
  A: { name: 'Contextual row', description: 'Hide the entire 53px row, separator and gap only when every task is handled. History stays in Session details → Workers. Starting, working, stopping, queued, recovering, questions, unreviewed results and uncertainty keep the current row.' },
  B: { name: 'Header-owned access', description: 'No footer in any state. The existing Session details trigger owns Workers, count and status, and keeps its menu cue. The title truncates first. Opening Workers costs two taps: Session details, then Workers (and another tap to inspect a log).' },
  C: { name: 'Minimal text', description: 'Always keep one narrow, borderless Workers/status action on its own 44px line. Remove only the 1px separator and 8px gap: about 9px saved, not the whole row. Idle history remains one tap away.' }
};
const fixtures = {
  integrated: { state: 'completed', handled: true, integration: 'applied', label: 'Integrated', summary: 'No active work', reply: 'The worker’s task is integrated. No active work remains; its history is still available in Workers.' },
  starting: { state: 'starting', label: 'Starting', summary: '1 starting', reply: 'The sample worker is starting. Its assignment is not settled yet.' },
  working: { state: 'working', label: 'Working', summary: '1 working', reply: 'The sample worker is reviewing the phone layout. Keep talking here while it works.' },
  stopping: { state: 'stopping', label: 'Stopping', summary: '1 stopping', reply: 'The sample worker is stopping. It has not confirmed that it stopped yet.' },
  waiting: { state: 'waiting', label: 'Needs answer', summary: '1 needs answer', reply: 'The sample worker needs a choice: should idle history remain one tap away? Answer in this conversation, not in the log.' },
  reported: { state: 'reported', label: 'Result ready · unreviewed', summary: '1 result ready', reply: 'The sample worker returned a result. It has not been reviewed or integrated; zero running workers does not mean everything is handled.' },
  unknown: { state: 'unknown', label: 'Needs inspection', summary: '1 needs inspection', reply: 'The sample worker’s state is uncertain. Inspect it from the main conversation before repeating an action.' },
  queued: { state: 'queued', label: 'Queued', summary: '1 queued', reply: 'The sample assignment is queued. It is unresolved even though no worker is running.' },
  recovering: { state: 'recovering', recovery: 'checking', label: 'Recovering', summary: '1 recovering', reply: 'The sample assignment is recovering. Its saved state is still being checked.' },
  blocked: { state: 'stopped', recovery: 'blocked', label: 'Recovery blocked', summary: 'Recovery blocked', reply: 'The sample worker is stopped, but recovery is blocked. It still needs attention in the main conversation.' },
  delivery: { state: 'completed', handled: true, integration: 'applied', delivery: 'unknown', label: 'Delivery uncertain', summary: 'Delivery uncertain', reply: 'The sample task is integrated, but a delivery warning is unresolved. Inspect before repeating an action.' }
};
const states = { idle: ['integrated'], working: ['working', 'starting', 'stopping'], answer: ['waiting'], result: ['reported'], uncertain: ['unknown', 'queued', 'recovering', 'blocked', 'delivery'] };
const params = new URL(location.href).searchParams;
let variant = Object.hasOwn(variants, params.get('variant')) ? params.get('variant') : 'A';
let state = Object.hasOwn(states, params.get('state')) ? params.get('state') : 'idle';
let condition = states[state].includes(params.get('condition')) ? params.get('condition') : states[state][0];
let parentWorking = params.get('parent') === 'working', attached = false, inspecting = params.get('pane') === 'review';
let returnFocus, drag, dragAnimation;
const pane = $('coordinator-sheet'), surface = pane.querySelector('.coordinator-sheet'), controls = $('launcher-controls');
const menu = document.querySelector('.session-info'), logs = new Map(), positions = new Map();
const task = () => ({ handled: false, recovery: 'idle', delivery: 'confirmed', ...fixtures[condition] });
// Explicitly require settlement, not merely zero running workers. Unknown states fail open.
const needsLauncher = item => !['completed', 'stopped'].includes(item.state) || !item.handled || item.recovery !== 'idle' || item.delivery !== 'confirmed';
const feedback = text => { $('sample-feedback').textContent = text; };
const node = (tag, text, className) => { const result = document.createElement(tag); if (text) result.textContent = text; if (className) result.className = className; return result; };
if (['light', 'dark'].includes(params.get('theme'))) document.documentElement.dataset.theme = params.get('theme');
function syncURL() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ study: 'launchers', variant, state, condition })) url.searchParams.set(key, value);
  for (const key of ['session', 'scene']) url.searchParams.delete(key);
  if (pane.open) url.searchParams.set('pane', inspecting ? 'review' : 'workers'); else url.searchParams.delete('pane');
  if (parentWorking) url.searchParams.set('parent', 'working'); else url.searchParams.delete('parent');
  if (document.documentElement.dataset.theme) url.searchParams.set('theme', document.documentElement.dataset.theme);
  history.replaceState(null, '', url);
  for (const link of document.querySelectorAll('[data-launcher-variant]')) {
    const target = new URL(url); target.searchParams.set('variant', link.dataset.launcherVariant); link.href = target.href;
  }
}
function syncLauncherHeight() {
  const box = $('coordinator-context');
  const height = box.hidden ? 0 : box.getBoundingClientRect().height + parseFloat(getComputedStyle(box).marginBottom);
  document.querySelector('#app > main').style.setProperty('--coordinator-height', height + 'px');
}
function savePosition() { if (pane.open) positions.set(inspecting ? condition : 'roster', $('coordinator-scroll').scrollTop); }
function sampleLog() {
  if (logs.has(condition)) return logs.get(condition);
  const item = task(), log = node('div');
  const details = node('details', undefined, 'coordinator-log-detail');
  details.append(node('summary', 'Task details'), node('h3', 'Assignment'), node('p', 'Review worker access above the phone composer. Preserve the composer and read-only worker logs.'), node('h3', 'Status'), node('p', item.label));
  if (condition === 'waiting') details.append(node('h3', 'Question for the main conversation'), node('p', 'Should idle history remain one tap away?'));
  if (item.recovery !== 'idle' || item.delivery === 'unknown') details.append(node('p', 'Unresolved ' + (item.delivery === 'unknown' ? 'delivery warning' : 'recovery') + '. Ask in the main conversation before repeating work.', 'coordinator-task-warning'));
  if (condition === 'integrated' || condition === 'reported') details.append(node('h3', condition === 'reported' ? 'Returned result · unreviewed' : 'Reviewed result'), node('p', condition === 'reported' ? 'Sample layout notes have returned, but no review or integration has happened.' : 'Sample layout notes were reviewed and the task’s changes are integrated.'));
  log.append(details, node('p', 'Instruction to worker · from the main conversation', 'coordinator-instruction-label'));
  const instruction = node('article', undefined, 'message assistant'), body = node('div', 'Read-only layout review. Keep human input in the main conversation.', 'message-text');
  instruction.setAttribute('aria-label', 'Instruction to worker'); instruction.append(body); log.append(instruction);
  const activity = node('details', undefined, 'coordinator-log-detail');
  activity.append(node('summary', 'Illustrative activity · read · web/style.css'), node('p', 'Sample output, not an executed tool call.'), node('pre', 'Launcher: 44px target + 1px separator + 8px gap.\nSession-navigation strip: separate 28px absolute target.'));
  const report = node('article', undefined, 'message assistant'), text = node('div', undefined, 'message-text');
  report.setAttribute('aria-label', 'Pi'); text.append(node('p', item.reply), node('p', 'Illustrative worker log. No investigation is running and no files have been changed.')); report.append(text); log.append(activity, report);
  logs.set(condition, log); return log;
}
function renderSheet() {
  const item = task();
  $('coordinator-title').textContent = inspecting ? 'Review compact worker access above the phone composer' : 'Workers';
  $('coordinator-subtitle').textContent = inspecting ? item.label : '1 worker · ' + item.summary;
  $('coordinator-subtitle').dataset.state = inspecting ? item.state : '';
  $('coordinator-log-back').hidden = !inspecting; $('coordinator-task-list').hidden = inspecting; $('coordinator-log').hidden = !inspecting;
  if (inspecting) $('coordinator-log').replaceChildren(sampleLog());
  else {
    const row = node('div'); row.setAttribute('role', 'listitem');
    const button = node('button', undefined, 'coordinator-worker'); button.type = 'button'; button.dataset.state = item.state;
    button.setAttribute('aria-label', 'Review compact worker access above the phone composer, ' + item.label);
    const name = node('span'); name.append(node('strong', 'Review compact worker access above the phone composer'), node('small', item.label));
    button.append(name, $('coordinator-open').querySelector('svg').cloneNode(true)); row.append(button);
    button.addEventListener('click', event => {
      savePosition(); inspecting = true; renderSheet(); syncURL();
      $(event.detail === 0 ? 'coordinator-log-back' : 'coordinator-sheet').focus({ preventScroll: true });
    });
    $('coordinator-task-list').replaceChildren(row);
  }
  $('coordinator-scroll').scrollTop = positions.get(inspecting ? condition : 'roster') || 0;
}
function updateComposer() {
  const hasDraft = !!$('prompt').value.trim() || attached;
  $('send').disabled = !hasDraft; $('send').hidden = parentWorking && !hasDraft; $('abort').hidden = !parentWorking || hasDraft;
  $('prompt').placeholder = parentWorking ? 'Message Pi while it works…' : 'Type / for commands';
  $('status').textContent = parentWorking ? 'working' : 'idle'; $('launcher-parent-working').checked = parentWorking;
}
function render() {
  const item = task(), position = $('transcript').scrollTop;
  $('app').dataset.launcher = variant;
  $('coordinator-context').hidden = variant === 'B' || variant === 'A' && !needsLauncher(item);
  $('coordinator-open').setAttribute('aria-expanded', String(pane.open));
  $('coordinator-worker-summary').textContent = item.summary;
  $('launcher-header-copy').hidden = variant !== 'B'; $('launcher-header-status').textContent = item.summary;
  $('launcher-header-status').dataset.attention = String(['answer', 'result', 'uncertain'].includes(state));
  $('launcher-details').setAttribute('aria-label', variant === 'B' ? 'Session details, Workers · 1, ' + item.summary : 'Session details');
  $('launcher-menu-status').textContent = item.label;
  $('launcher-sample-reply').textContent = item.reply;
  $('launcher-label').textContent = variant + ' · ' + variants[variant].name;
  $('launcher-description').textContent = variants[variant].description;
  $('launcher-measure').textContent = variant === 'C' ? '44px line · saves ≈9px' : variant === 'B' ? 'No footer · saves ≈53px · 2 taps to Workers' : needsLauncher(item) ? 'Unresolved: current 53px row · no saving' : 'Settled: no row · saves ≈53px';
  $('launcher-state').value = state;
  $('launcher-condition').replaceChildren(...states[state].map(key => { const option = node('option', fixtures[key].label); option.value = key; return option; }));
  $('launcher-condition').value = condition;
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('launcher-theme').setAttribute('aria-pressed', String(dark)); $('launcher-theme').setAttribute('aria-label', 'Dark mode');
  $('launcher-theme').title = 'Switch to ' + (dark ? 'light' : 'dark') + ' mode';
  syncLauncherHeight(); updateComposer(); if (pane.open) renderSheet(); syncURL();
  $('transcript').scrollTop = position;
  if (!pane.open && $('coordinator-context').hidden && document.activeElement === $('coordinator-open')) $('launcher-details').focus({ preventScroll: true });
}
function setVariant(next) { savePosition(); $('launcher-info').hidePopover(); variant = next; render(); }
function cycle(step) { const keys = Object.keys(variants); setVariant(keys[(keys.indexOf(variant) + step + keys.length) % keys.length]); }
function openSheet(fromMenu = false) {
  if (pane.open) return;
  menu.open = false; $('launcher-info').hidePopover(); resetDrag();
  returnFocus = fromMenu ? $('launcher-details') : $('coordinator-open'); inspecting = false;
  pane.append(controls); renderSheet(); pane.showModal(); render(); pane.focus({ preventScroll: true });
}
function closeSheet() { savePosition(); pane.close(); }
pane.addEventListener('close', () => {
  resetDrag(); $('launcher-info').hidePopover(); document.body.append(controls); render();
  (returnFocus?.checkVisibility() ? returnFocus : $('launcher-details')).focus({ preventScroll: true });
});
pane.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
pane.addEventListener('click', event => { if (event.target === pane) closeSheet(); });
$('coordinator-open').onclick = () => openSheet(); $('coordinator-tasks').onclick = () => openSheet(true);
$('coordinator-done').onclick = closeSheet;
$('coordinator-log-back').onclick = event => {
  savePosition(); inspecting = false; renderSheet(); syncURL();
  (event.detail === 0 ? $('coordinator-task-list').querySelector('button') : pane).focus({ preventScroll: true });
};
$('launcher-prev').onclick = () => cycle(-1); $('launcher-next').onclick = () => cycle(1);
$('launcher-state').onchange = () => { savePosition(); state = $('launcher-state').value; condition = states[state][0]; render(); };
$('launcher-condition').onchange = () => { savePosition(); condition = $('launcher-condition').value; render(); };
$('launcher-parent-working').onchange = () => { parentWorking = $('launcher-parent-working').checked; updateComposer(); syncURL(); };
$('launcher-theme').onclick = () => { document.documentElement.dataset.theme = $('launcher-theme').getAttribute('aria-pressed') === 'true' ? 'light' : 'dark'; render(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
for (const link of document.querySelectorAll('[data-launcher-variant]')) link.onclick = event => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); setVariant(link.dataset.launcherVariant); $('launcher-options').focus({ preventScroll: true });
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.open) { event.preventDefault(); menu.open = false; $('launcher-details').focus({ preventScroll: true }); return; }
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('[popover]:popover-open, #settings-dialog[open], #sample-attachment[open]')) return;
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
});
document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
for (const id of ['session-pin', 'session-close', 'session-icon-open', 'back']) $(id).onclick = () => { menu.open = false; feedback('UI-only: the sample session has not changed.'); };
function resetDrag() { drag = undefined; dragAnimation?.cancel(); dragAnimation = undefined; surface.style.transform = ''; }
function releaseDrag(dismiss) {
  const current = drag; drag = undefined;
  if (!current?.dragging) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { resetDrag(); if (dismiss) closeSheet(); return; }
  const end = dismiss ? Math.max(surface.offsetHeight, current.distance) : 0;
  const animation = surface.animate({ transform: [`translateY(${current.distance}px)`, `translateY(${end}px)`] }, { duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' });
  dragAnimation = animation;
  animation.finished.then(() => { if (dragAnimation === animation) { if (dismiss) closeSheet(); else resetDrag(); } }, () => {});
}
surface.addEventListener('touchstart', event => {
  if (dragAnimation || event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1 || $('coordinator-scroll').contains(event.target) && $('coordinator-scroll').scrollTop > 0) return;
  const touch = event.touches[0]; drag = { x: touch.clientX, y: touch.clientY, distance: 0, dragging: false };
}, { passive: true });
surface.addEventListener('touchmove', event => {
  if (!drag) return;
  if (event.touches.length !== 1) { releaseDrag(false); return; }
  const dx = event.touches[0].clientX - drag.x, dy = event.touches[0].clientY - drag.y;
  if (!drag.dragging) {
    if (dy < -12 || Math.abs(dx) > 12 && Math.abs(dx) >= Math.abs(dy)) { drag = undefined; return; }
    if (dy < 12 || dy < Math.abs(dx) * 1.25) return;
    drag.dragging = true; surface.getAnimations().forEach(animation => animation.cancel());
  }
  event.preventDefault(); drag.distance = Math.max(0, dy); surface.style.transform = `translateY(${drag.distance}px)`;
}, { passive: false });
surface.addEventListener('touchend', event => { if (!drag?.dragging) { drag = undefined; return; } event.preventDefault(); releaseDrag(drag.distance > Math.min(100, surface.offsetHeight / 4)); }, { passive: false });
surface.addEventListener('touchcancel', () => releaseDrag(false));
// The single production form stays mounted. Only local sample control behavior is wired.
$('composer').hidden = false;
for (const id of ['model', 'reasoning-control', 'usage-meter', 'fast-mode', 'status-line']) $(id).hidden = false;
$('model-name').textContent = 'GPT-6.1 Sol'; $('reasoning-value').textContent = 'Max';
$('model').setAttribute('aria-label', 'Switch sample model: GPT-6.1 Sol');
$('usage-meter').setAttribute('aria-label', 'Sample context usage: 4 percent'); $('usage-arc').setAttribute('stroke-dasharray', '4 100');
$('status-line').innerHTML = '<span>CH96%</span><span>$0.14</span><span>4%/500k</span>';
$('prompt').addEventListener('input', updateComposer);
$('composer').onsubmit = event => { event.preventDefault(); feedback('UI-only: draft and attachment kept. No message was sent or routed.'); };
$('abort').onclick = () => { parentWorking = false; updateComposer(); syncURL(); feedback('Sample main response is idle. No real work was stopped.'); };
function closeCommands() { $('command-menu').hidden = true; for (const id of ['prompt', 'commands']) $(id).setAttribute('aria-expanded', 'false'); }
$('commands').onclick = () => {
  if (!$('command-menu').hidden) { closeCommands(); return; }
  $('command-menu').hidden = false; for (const id of ['prompt', 'commands']) $(id).setAttribute('aria-expanded', 'true');
  const option = node('button', '/model · Sample model settings', 'command-option'); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.onclick = () => openSettings('model');
  $('command-options').replaceChildren(option); $('command-help').textContent = 'UI-only sample. Nothing executes.';
};
$('prompt').addEventListener('keydown', event => { if (event.key === 'Escape') closeCommands(); });
function openSettings(kind) {
  closeCommands(); const usage = kind === 'usage', effort = kind === 'effort';
  $('settings-picker').hidden = false; $('model-search').hidden = usage || effort; $('picker-title').hidden = !usage && !effort;
  $('picker-title').textContent = usage ? 'Sample usage' : 'Reasoning effort'; $('picker-help').textContent = 'Sample values only. No model calls or settings changes.';
  $('settings-dialog').setAttribute('aria-label', usage ? 'Sample usage' : 'Sample model settings');
  const option = node(usage ? 'p' : 'button', usage ? '4% used · 20,000 / 500,000 tokens' : effort ? 'Max' : 'GPT-6.1 Sol', usage ? 'hint' : 'picker-option');
  if (!usage) { option.type = 'button'; option.setAttribute('aria-pressed', 'true'); option.onclick = () => $('settings-dialog').close(); }
  $('picker-options').replaceChildren(option); $('settings-dialog').toggleAttribute('data-sheet', innerWidth <= 700);
  $(usage ? 'usage-meter' : effort ? 'reasoning-control' : 'model').setAttribute('aria-expanded', 'true');
  if (innerWidth <= 700) $('settings-dialog').showModal(); else $('settings-dialog').show();
}
$('model').onclick = () => openSettings('model'); $('reasoning-control').onclick = () => openSettings('effort');
$('usage-meter').onclick = () => openSettings('usage'); $('status-line').onclick = () => openSettings('usage');
$('picker-cancel').onclick = () => $('settings-dialog').close();
$('settings-dialog').onclose = () => { $('settings-picker').hidden = true; for (const id of ['model', 'reasoning-control', 'usage-meter']) $(id).setAttribute('aria-expanded', 'false'); };
$('settings-dialog').onclick = event => { if (event.target === $('settings-dialog')) $('settings-dialog').close(); };
$('attach').onclick = () => $('sample-attachment').showModal(); $('attachment-close').onclick = () => $('sample-attachment').close();
$('attachment-add').onclick = () => {
  attached = true; const item = node('div', undefined, 'attachment'), image = node('img'), remove = node('button', '×');
  image.src = '/icon.svg'; image.alt = 'Sample image, not uploaded'; remove.type = 'button'; remove.setAttribute('aria-label', 'Remove sample attachment');
  remove.onclick = () => { attached = false; $('attachments').replaceChildren(); $('attachments').hidden = true; updateComposer(); };
  item.append(image, remove); $('attachments').replaceChildren(item); $('attachments').hidden = false; $('sample-attachment').close(); updateComposer();
};
$('session-swipe').hidden = false;
$('session-dots').innerHTML = '<div class="session-dots-track"><i></i><i></i><i class="origin"></i><i></i><i></i><b></b></div>';
function updateScrollButton() { const box = $('transcript'); $('scroll-bottom').hidden = box.scrollHeight - box.clientHeight - box.scrollTop < 100; }
$('scroll-bottom').onclick = () => { $('transcript').scrollTop = $('transcript').scrollHeight; updateScrollButton(); };
$('transcript').addEventListener('scroll', updateScrollButton);
function updateViewport() {
  const viewport = window.visualViewport, root = document.documentElement;
  root.style.setProperty('--viewport-height', (viewport?.height || innerHeight) + 'px'); root.style.setProperty('--viewport-top', (viewport?.offsetTop || 0) + 'px');
  root.style.setProperty('--viewport-scale', String(viewport?.scale || 1));
  root.toggleAttribute('data-keyboard', !!viewport && Math.max(innerHeight, root.clientHeight) - viewport.height * viewport.scale > 150);
  syncLauncherHeight(); updateScrollButton();
}
new ResizeObserver(() => { syncLauncherHeight(); updateScrollButton(); }).observe($('coordinator-context'));
addEventListener('resize', updateViewport); visualViewport?.addEventListener('resize', updateViewport); visualViewport?.addEventListener('scroll', updateViewport);
const initialPane = params.has('pane'), initialInspecting = inspecting;
render(); updateViewport();
if (initialPane) { openSheet(variant === 'B' || $('coordinator-context').hidden); if (initialInspecting) { inspecting = true; renderSheet(); syncURL(); } }
requestAnimationFrame(() => { $('transcript').scrollTop = $('transcript').scrollHeight; updateScrollButton(); });
}
