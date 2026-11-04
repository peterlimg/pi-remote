// Three UI-only worker stacks on this prototype route, selected with ?variant=A|B|C.
const $ = id => document.getElementById(id);
const variants = {
  A: { name: 'Plain list', description: 'A full-width worker list. Tap a worker to inspect its read-only log. All input stays in the coordinator.' },
  B: { name: 'Inline details', description: 'Inspect worker status without leaving the main conversation. Questions and instructions go through the coordinator.' },
  C: { name: 'Session tree', description: 'Keep the main conversation and its read-only worker logs together. The coordinator is the only recipient of user input.' }
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
const labels = { working: 'Working', waiting: 'Needs answer', reported: 'Result ready', stopped: 'Stopped' };
const params = new URL(location.href).searchParams;
let variant = Object.hasOwn(variants, params.get('variant')) ? params.get('variant') : 'A';
let selected = Object.hasOwn(sessions, params.get('session')) ? params.get('session') : 'coordinator';
let preview = innerHeight >= 600 ? 'recovery' : undefined, attached = false;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const feedback = text => { $('sample-feedback').textContent = text; surfaceState(); };
function surfaceState() {
  $('prototype-state').textContent = JSON.stringify({ variant, selected, recipient: 'coordinator', preview, expanded: $('worker-stack').open, sessions }, null, 2);
}
function updateURL() {
  const url = new URL(location.href); url.searchParams.set('study', 'stacks'); url.searchParams.set('variant', variant); url.searchParams.delete('scene');
  if (selected === 'coordinator') url.searchParams.delete('session'); else url.searchParams.set('session', selected);
  history.replaceState(null, '', url);
}
function row(id, mode = 'open') {
  const ui = sessions[id], button = el('button', undefined, 'stack-row');
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
  $('worker-stack-content').replaceChildren(({ A: VariantA, B: VariantB, C: VariantC })[variant]());
  const summary = [];
  for (const [state, label] of [['working', 'working'], ['waiting', 'needs answer'], ['reported', 'ready']]) {
    const count = workers.filter(id => sessions[id].state === state).length;
    if (count) summary.push(count + ' ' + label);
  }
  $('worker-stack-summary').textContent = summary.join(' · ') || 'No active work';
  $('app').dataset.variant = variant;
  $('variant-label').textContent = 'Prototype ' + variant + ' · ' + variants[variant].name;
  $('variant-description').textContent = variants[variant].description;
  updateURL(); surfaceState();
}
function addMessage(message) {
  const article = el('article', undefined, 'message ' + (message.role || 'assistant'));
  article.setAttribute('aria-label', message.role === 'user' ? 'You' : message.role === 'coordinator' ? 'Mobile review coordinator' : sessions[selected].name);
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
  for (const node of $('transcript').querySelectorAll('.message')) node.remove();
  for (const message of sessions[selected].messages) addMessage(message);
  $('title').textContent = sessions[selected].name;
  $('study-subtitle').textContent = selected === 'coordinator' ? 'Coordinator · Sample' : 'Worker log · Read-only';
  $('study-back').setAttribute('aria-label', selected === 'coordinator' ? 'Back to Pi Remote' : 'Return to Mobile review coordinator');
  $('composer').hidden = selected !== 'coordinator'; $('status-line').hidden = selected !== 'coordinator';
  $('worker-inspection').hidden = selected === 'coordinator';
  $('prompt').value = sessions.coordinator.draft; attached = sessions.coordinator.attached;
  renderAttachment(); renderDock(); updateControls(); $('stack-dock').scrollTop = 0; $('transcript').scrollTop = $('transcript').scrollHeight;
}
function selectSession(id, focusInput = false) {
  if (selected === 'coordinator') { sessions.coordinator.draft = $('prompt').value; sessions.coordinator.attached = attached; }
  closeCommands(); if ($('settings-dialog').open) $('settings-dialog').close();
  $('prompt').blur(); selected = id; renderSelected();
  (focusInput && id === 'coordinator' ? $('prompt') : $('transcript')).focus({ preventScroll: true });
  feedback(id === 'coordinator' ? 'Main conversation. All instructions go to Mobile review.' : 'Read-only ' + sessions[id].name + ' log. Give instructions in the main conversation.');
}
function switchVariant(direction) {
  const keys = Object.keys(variants); variant = keys[(keys.indexOf(variant) + direction + keys.length) % keys.length];
  renderDock(); feedback('Prototype ' + variant + ': ' + variants[variant].description);
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
$('worker-stack').ontoggle = surfaceState;
$('study-back').onclick = () => selected === 'coordinator' ? location.assign('/') : selectSession('coordinator');
$('variant-prev').onclick = () => switchVariant(-1); $('variant-next').onclick = () => switchVariant(1);
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
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
  $('agent-activity').hidden = sessions[selected].state !== 'working'; $('activity-label').textContent = sessions[selected].name + ' is working';
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
