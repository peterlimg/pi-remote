// Three UI-only worker stacks on this prototype route, selected with ?variant=A|B|C.
const $ = id => document.getElementById(id);
const variants = {
  A: { name: 'Plain list', description: 'A full-width vertical list. Tap a worker to open its conversation.' },
  B: { name: 'Inline details', description: 'Keep all worker names in the list. Tap one to inspect its question or result below the rows, without leaving the coordinator.' },
  C: { name: 'Session tree', description: 'Keep the coordinator and its child sessions together. The tree stays available while you move between conversations.' }
};
const sessions = {
  coordinator: { name: 'Mobile review', state: 'idle', draft: '', attached: false, messages: [
    { role: 'user', text: 'Trace phone messaging and restart recovery. Review the findings before changing anything.' },
    { text: 'Messaging is following the send path. Recovery needs your choice before continuing. Layout review has returned its notes.' }
  ] },
  messaging: { name: 'Messaging', state: 'working', draft: '', attached: false, detail: 'Following Send through the phone, host, and Pi session.', messages: [
    { role: 'user', route: 'Mobile review → Messaging', text: 'Trace how a phone message reaches Pi. Return file references. Read-only.' },
    { text: 'I’m following the request from the composer through the host. No final findings have been returned yet.' }
  ] },
  recovery: { name: 'Recovery', state: 'waiting', draft: '', attached: false, detail: 'Should I check browser reload or host restart first?', messages: [
    { role: 'user', route: 'Mobile review → Recovery', text: 'Ask which recovery path to investigate, then wait for my answer.' },
    { route: 'Question sent to Mobile review', text: 'Should I check browser reload or host restart first?' }
  ] },
  review: { name: 'Layout review', state: 'reported', draft: '', attached: false, detail: 'Sample notes are ready for review. Keep worker names visible and preserve the existing composer.', messages: [
    { route: 'Result returned to Mobile review', text: 'Sample layout-review.md: show ownership, keep names readable, and leave the composer intact. These are illustrative notes, not an executed review.' }
  ] }
};
const workers = ['messaging', 'recovery', 'review'];
const labels = { working: 'Working', waiting: 'Needs answer', reported: 'Result ready', stopped: 'Stopped' };
const params = new URL(location.href).searchParams;
let variant = Object.hasOwn(variants, params.get('variant')) ? params.get('variant') : 'A';
let selected = Object.hasOwn(sessions, params.get('session')) ? params.get('session') : 'coordinator';
let preview = innerHeight >= 600 ? 'recovery' : undefined, attached = false;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const feedback = text => { $('sample-feedback').textContent = text; surfaceState(); };
function surfaceState() {
  $('prototype-state').textContent = JSON.stringify({ variant, selected, preview, sessions }, null, 2);
}
function updateURL() {
  const url = new URL(location.href); url.searchParams.set('study', 'stacks'); url.searchParams.set('variant', variant); url.searchParams.delete('scene');
  if (selected === 'coordinator') url.searchParams.delete('session'); else url.searchParams.set('session', selected);
  history.replaceState(null, '', url);
}
function row(id, mode = 'open') {
  const ui = sessions[id], button = el('button', undefined, 'stack-row');
  button.type = 'button'; button.dataset.state = ui.state;
  button.setAttribute('aria-label', (mode === 'preview' ? 'Inspect ' : 'Open ') + ui.name + (id === 'coordinator' ? ', coordinator' : ', ' + labels[ui.state]));
  if (id === selected) button.setAttribute('aria-current', 'page');
  if (mode === 'preview') { button.dataset.preview = id; button.setAttribute('aria-expanded', String(preview === id && selected === 'coordinator')); }
  else button.dataset.session = id;
  button.append(el('span', ui.name, 'stack-name'));
  const status = el('span', undefined, 'stack-state');
  if (id !== 'coordinator') { const dot = el('i'); dot.setAttribute('aria-hidden', 'true'); status.append(dot); }
  status.append(el('span', id === 'coordinator' ? 'Coordinator' : labels[ui.state])); button.append(status);
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('viewBox', '0 0 24 24'); arrow.setAttribute('width', '16'); arrow.setAttribute('height', '16');
  arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', 'currentColor'); arrow.setAttribute('stroke-width', '1.8');
  arrow.setAttribute('stroke-linecap', 'round'); arrow.setAttribute('stroke-linejoin', 'round'); arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<path d="m9 5 7 7-7 7"/>'; button.append(arrow);
  return button;
}
function heading(text, meta) {
  const node = el('div', undefined, 'roster-heading'); node.append(el('h2', text), el('span', meta)); return node;
}
function VariantA() {
  const node = el('div', undefined, 'plain-stack');
  node.append(heading('Workers', '3 sessions'));
  for (const id of workers) node.append(row(id));
  return node;
}
function VariantB() {
  const node = el('div', undefined, 'details-stack');
  node.append(heading('Workers', 'Tap to inspect'));
  for (const id of workers) node.append(row(id, selected === 'coordinator' ? 'preview' : 'open'));
  if (preview && selected === 'coordinator') {
    const ui = sessions[preview], detail = el('section', undefined, 'stack-detail');
    detail.setAttribute('aria-label', ui.name + ' details');
    detail.append(el('h3', ui.name + (ui.state === 'waiting' ? ' asks' : ui.state === 'reported' ? ' returned' : ' status')), el('p', ui.detail));
    const actions = el('div', undefined, 'stack-detail-actions');
    const open = el('button', ui.state === 'waiting' ? 'Reply in ' + ui.name : 'Open ' + ui.name, 'quiet'); open.type = 'button'; open.dataset.session = preview;
    if (ui.state === 'waiting') open.dataset.reply = '';
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
  $('stack-dock').replaceChildren(({ A: VariantA, B: VariantB, C: VariantC })[variant]());
  $('app').dataset.variant = variant;
  $('variant-label').textContent = 'Prototype ' + variant + ' · ' + variants[variant].name;
  $('variant-description').textContent = variants[variant].description;
  updateURL(); surfaceState();
}
function addMessage(message) {
  const article = el('article', undefined, 'message ' + (message.role || 'assistant'));
  article.setAttribute('aria-label', message.role === 'user' ? 'You' : sessions[selected].name);
  const body = el('div', undefined, 'message-text');
  if (message.route) body.append(el('p', message.route, 'stack-route'));
  body.append(el('p', message.text)); article.append(body); $('agent-activity').before(article);
}
function renderSelected() {
  for (const node of $('transcript').querySelectorAll('.message')) node.remove();
  for (const message of sessions[selected].messages) addMessage(message);
  $('title').textContent = sessions[selected].name;
  $('study-subtitle').textContent = selected === 'coordinator' ? 'Coordinator · Sample' : 'Mobile review · Worker';
  $('study-back').setAttribute('aria-label', selected === 'coordinator' ? 'Back to Pi Remote' : 'Return to Mobile review coordinator');
  $('prompt').value = sessions[selected].draft; attached = sessions[selected].attached;
  renderAttachment(); renderDock(); updateControls(); $('transcript').scrollTop = $('transcript').scrollHeight;
}
function selectSession(id, reply = false) {
  sessions[selected].draft = $('prompt').value; sessions[selected].attached = attached;
  closeCommands(); if ($('settings-dialog').open) $('settings-dialog').close();
  $('prompt').blur(); selected = id; renderSelected();
  (reply ? $('prompt') : $('transcript')).focus({ preventScroll: true });
  feedback('Selected ' + sessions[id].name + '. Send and Stop affect only this sample session.');
}
function switchVariant(direction) {
  const keys = Object.keys(variants); variant = keys[(keys.indexOf(variant) + direction + keys.length) % keys.length];
  renderDock(); feedback('Prototype ' + variant + ': ' + variants[variant].description);
}
document.addEventListener('click', event => {
  const previewButton = event.target.closest('[data-preview]');
  if (previewButton) {
    preview = preview === previewButton.dataset.preview ? undefined : previewButton.dataset.preview; renderDock();
    $('stack-dock').querySelector('.stack-detail')?.scrollIntoView({ block: 'nearest' });
    feedback('Inspecting a local sample.'); return;
  }
  const button = event.target.closest('[data-session]');
  if (button) selectSession(button.dataset.session, button.hasAttribute('data-reply'));
});
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
  const working = sessions[selected].state === 'working', hasDraft = !!$('prompt').value.trim() || attached;
  $('abort').hidden = !working || hasDraft; $('send').hidden = working && !hasDraft;
  $('agent-activity').hidden = !working; $('activity-label').textContent = sessions[selected].name + ' is working';
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
$('composer').hidden = false;
$('model').hidden = false; $('model-name').textContent = 'GPT-6.1 Sol';
$('model').title = 'Switch model: GPT-6.1 Sol'; $('model').setAttribute('aria-label', $('model').title);
$('reasoning-control').hidden = false; $('reasoning-value').textContent = 'Max';
$('usage-meter').hidden = false; $('usage-meter').dataset.level = 'normal'; $('usage-meter').setAttribute('aria-label', 'Usage: 12% of context used');
$('usage-arc').setAttribute('stroke-dasharray', '12 100');
$('status-line').hidden = false; $('status-line').innerHTML = '<span data-level="normal">12%/200k</span>';
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('composer').onsubmit = event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text && !attached) return;
  if (text === '/model') { openSettings('model'); return; }
  if (text.startsWith('/')) { feedback('Sample command only. Nothing executed.'); return; }
  const user = { role: 'user', text: text || 'Sample image attached.' }, reply = { text: 'Sample message received by ' + sessions[selected].name + ' only. No real agent ran.' };
  sessions[selected].messages.push(user, reply); addMessage(user); addMessage(reply);
  if (selected === 'recovery' && sessions.recovery.state === 'waiting') { sessions.recovery.state = 'working'; sessions.recovery.detail = 'Your sample answer was received. No actual investigation runs.'; }
  $('prompt').value = ''; sessions[selected].draft = ''; attached = false; sessions[selected].attached = false;
  renderAttachment(); closeCommands(); renderDock(); updateControls(); $('transcript').scrollTop = $('transcript').scrollHeight;
};
$('abort').onclick = () => {
  if (selected === 'coordinator' || sessions[selected].state !== 'working') return;
  sessions[selected].state = 'stopped'; sessions[selected].detail = 'Stopped in this sample only.';
  sessions[selected].messages.push({ text: 'Stopped only ' + sessions[selected].name + ' in this sample. Other sessions are unchanged. No real agent was affected.' });
  renderSelected(); feedback('Sample Stop applied only to the selected worker.');
};
function closeCommands() { $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false'); }
function openCommands() {
  $('command-menu').hidden = false; $('prompt').setAttribute('aria-expanded', 'true'); $('commands').setAttribute('aria-expanded', 'true');
  $('command-options').innerHTML = '<button type="button" class="command-option" role="option" aria-selected="false"><strong>/model</strong><span>Choose a sample model</span></button>';
  $('command-help').textContent = 'Design study only. No command executes.';
  $('command-options').firstElementChild.onclick = () => { $('prompt').value = '/model'; closeCommands(); updateControls(); $('prompt').focus(); };
}
$('commands').onclick = () => $('command-menu').hidden ? openCommands() : closeCommands();
$('prompt').oninput = () => { sessions[selected].draft = $('prompt').value; updateControls(); if ($('prompt').value.startsWith('/')) openCommands(); else closeCommands(); };
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
  $('attachments').querySelector('button').onclick = () => { attached = false; sessions[selected].attached = false; renderAttachment(); updateControls(); };
}
$('attachment-add').onclick = () => { attached = true; sessions[selected].attached = true; renderAttachment(); $('sample-attachment').close(); updateControls(); };
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
