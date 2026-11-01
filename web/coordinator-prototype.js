// A fixed, illustrative storyboard. No agents, transport, storage or real task state.
const $ = id => document.getElementById(id);
const copyIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const scenes = [
  { title: 'Hand off two jobs', caption: 'Illustrative story. One acknowledgement, no worker selection.', messages: [
    { role: 'user', text: 'Check the back gesture and simplify the login copy. Keep the existing controls.' },
    { text: 'I’ll investigate Navigation and review Login copy separately. I’ll bring decisions and results back here.' }
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
let scene = 0, attached = false;
const feedback = text => { $('sample-feedback').textContent = text; };
function addMessage({ role = 'assistant', text, kind }, current = false) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  article.setAttribute('aria-label', role === 'user' ? 'You' : 'Pi');
  if (current) article.dataset.currentScene = '';
  const body = document.createElement('div'); body.className = 'message-text';
  if (text) { const p = document.createElement('p'); p.textContent = text; body.append(p); }
  if (kind === 'question') {
    body.insertAdjacentHTML('beforeend', '<div class="story-question" data-question-state="' + (scene >= 3 ? 'answered' : 'open') + '"><strong>Should Login copy change the saved-link format?</strong><p>That could sign existing users out. I recommend keeping the format and shortening only the wording.</p>' + (scene >= 3 ? '<p class="hint">Decision recorded in this story: keep the saved format.</p>' : '<div class="story-actions"><button type="button" data-story-action="keep">Keep saved format</button><button type="button" class="quiet" data-story-action="discuss">Discuss the change</button></div>') + '</div>');
  }
  if (kind === 'briefing') {
    body.insertAdjacentHTML('beforeend', '<div class="story-return">Since you were away</div><section class="story-briefing"><h2>Login wording is ready to review.</h2><p>The proposal shortens the sign-in wording. Saved-link storage is outside its scope.</p>' + result(false) + '<p class="story-stopped"><strong>Navigation is stopped.</strong> No gesture fix was verified.</p><p>The QR-first release plan is unchanged.</p></section>');
  }
  if (kind === 'correction') body.insertAdjacentHTML('beforeend', result(true));
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
function readScene() {
  const value = Number(new URL(location.href).searchParams.get('scene'));
  return Number.isInteger(value) && value >= 1 && value <= scenes.length ? value - 1 : 0;
}
function showScene(index) {
  scene = Math.max(0, Math.min(scenes.length - 1, index));
  const url = new URL(location.href); url.searchParams.delete('variant'); url.searchParams.set('scene', scene + 1); history.replaceState(null, '', url);
  for (const node of $('transcript').querySelectorAll('.message')) node.remove();
  for (let i = 0; i <= scene; i++) for (const message of scenes[i].messages) addMessage(message, i === scene);
  $('story-position').textContent = `Storyboard · ${scene + 1} of ${scenes.length}`;
  $('story-title').textContent = scenes[scene].title;
  $('story-caption').textContent = scenes[scene].caption;
  $('story-previous').disabled = scene === 0;
  $('story-next').querySelector('span').textContent = scene === scenes.length - 1 ? 'Restart' : 'Next';
  $('story-next').setAttribute('aria-label', scene === scenes.length - 1 ? 'Restart storyboard' : 'Next scene');
  for (const button of $('story-scenes').querySelectorAll('button')) {
    if (Number(button.dataset.scene) === scene) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  const transcript = $('transcript'), anchor = transcript.querySelector('[data-current-scene]');
  transcript.scrollTop = 0;
  if (scene > 0) transcript.scrollTop = anchor.getBoundingClientRect().top - document.querySelector('.conversation-header').getBoundingClientRect().bottom - 16;
  updateControls();
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
  const action = event.target.closest('[data-story-action]')?.dataset.storyAction;
  if (action === 'keep') {
    const question = event.target.closest('.story-question');
    question.dataset.questionState = 'answered';
    question.querySelector('.story-actions').replaceWith(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Login copy: saved format kept. Navigation continues.' }));
    feedback('Only the Login copy choice is recorded in this scene. Use Next to view the separate Navigation stop.');
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
  $('abort').hidden = true; $('send').hidden = false; $('agent-activity').hidden = true;
  $('prompt').placeholder = 'Type / for commands'; $('status').textContent = 'idle'; resizePrompt(); updateScrollButton();
}
// Normal runtime sample values; the production composer subtree and its stylesheet are unchanged.
$('composer').hidden = false;
$('title').textContent = 'Mobile release'; $('project-name').textContent = 'pi-remote'; $('project-name').hidden = false;
$('project').textContent = '/sample/pi-remote';
$('sessions').innerHTML = '<button type="button" class="session active" aria-current="true"><span class="session-indicators" aria-hidden="true"></span><div class="session-body"><div class="session-top"><strong>Mobile release</strong></div><div class="session-meta"><span class="session-project-name">pi-remote</span></div></div></button>';
$('list-page').textContent = ''; $('connection').hidden = true;
$('model').hidden = false; $('model-name').textContent = 'GPT-6.1 Sol';
$('model').title = 'Switch model: GPT-6.1 Sol'; $('model').setAttribute('aria-label', $('model').title);
$('reasoning-control').hidden = false; $('reasoning-value').textContent = 'XHigh'; $('reasoning-control').title = 'Change reasoning effort: Extra high';
$('usage-meter').hidden = false; $('usage-meter').dataset.level = 'normal'; $('usage-meter').title = '12% of context used'; $('usage-meter').setAttribute('aria-label', 'Usage: 12% of context used'); $('usage-arc').setAttribute('stroke-dasharray', '12 100');
$('status-line').hidden = false; $('status-line').innerHTML = '<span data-level="normal">12%/200k</span>';
$('back').onclick = () => $('app').classList.remove('viewing');
$('sessions').onclick = () => $('app').classList.add('viewing');
for (const id of ['logout', 'new-session', 'session-pin', 'session-icon-open', 'search-open']) $(id).onclick = () => feedback('Storyboard only. No session or account changes.');
$('composer').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('composer').onsubmit = event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text && !attached) return;
  if (text === '/model') { openSettings('model'); return; }
  if (text.startsWith('/')) { feedback('Storyboard command only. Nothing executed.'); return; }
  addMessage({ role: 'user', text: text || 'Sample image attached.' });
  addMessage({ text: 'That message stays with the coordinator in this storyboard. It has not approved a permission, started a job or changed the scripted outcome.' });
  $('prompt').value = ''; attached = false; $('attachments').hidden = true; $('attachments').replaceChildren();
  closeCommands(); updateControls(); $('transcript').scrollTop = $('transcript').scrollHeight;
};
function closeCommands() { $('command-menu').hidden = true; $('prompt').setAttribute('aria-expanded', 'false'); $('commands').setAttribute('aria-expanded', 'false'); }
function openCommands() {
  $('command-menu').hidden = false; $('prompt').setAttribute('aria-expanded', 'true'); $('commands').setAttribute('aria-expanded', 'true');
  $('command-options').innerHTML = '<button type="button" class="command-option" role="option" aria-selected="false"><strong>/model</strong><span>Choose a model</span></button>';
  $('command-help').textContent = 'Storyboard command. No agent runs.';
  $('command-options').firstElementChild.onclick = () => { $('prompt').value = '/model'; closeCommands(); updateControls(); $('prompt').focus(); };
}
$('commands').onclick = () => $('command-menu').hidden ? openCommands() : closeCommands();
$('prompt').oninput = () => { updateControls(); if ($('prompt').value.startsWith('/')) openCommands(); else closeCommands(); };
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
$('attachment-add').onclick = () => {
  attached = true; $('attachments').hidden = false;
  $('attachments').innerHTML = '<div class="attachment"><img src="/icon.svg" alt="Sample attachment"><button type="button" aria-label="Remove sample image">×</button></div>';
  $('attachments').querySelector('button').onclick = () => { attached = false; $('attachments').hidden = true; $('attachments').replaceChildren(); updateControls(); };
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
showScene(readScene());
