// Compare the shipped glass, a quiet frosted material, and a rim-lit material on real controls.
// Sample data only. Do not load app.js, open a WebSocket, or write browser storage.
const $ = id => document.getElementById(id);
const variants = {
  A: ['A · Current', 'The glass currently on your phone'],
  B: ['B · Quiet', 'Less background bleed; plain inner controls'],
  C: ['C · Rim-lit', 'Clearer glass; one clean, thin outline'],
};
const root = document.documentElement;
root.dataset.theme = 'dark';
function choose(key) {
  root.dataset.variant = key in variants ? key : 'B';
  const [title, note] = variants[root.dataset.variant];
  $('variant-label').textContent = title; $('variant-note').textContent = note;
  const url = new URL(location.href); url.searchParams.set('variant', root.dataset.variant);
  history.replaceState(null, '', url);
}
function step(direction) {
  const keys = Object.keys(variants);
  choose(keys[(keys.indexOf(root.dataset.variant) + direction + keys.length) % keys.length]);
}
choose(new URL(location.href).searchParams.get('variant') || 'B');
$('previous').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('theme').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  $('theme').textContent = root.dataset.theme === 'dark' ? 'Light' : 'Dark';
  document.querySelector('meta[name=theme-color]').content = root.dataset.theme === 'dark' ? '#100d10' : '#fafaf8';
};
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, [contenteditable], [role=slider]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); }
});

try {
  const response = await fetch('/');
  if (!response.ok) throw new Error('Could not load the controls');
  const source = new DOMParser().parseFromString(await response.text(), 'text/html');
  $('preview').append(document.importNode(source.querySelector('main'), true));
  document.body.append(document.importNode(source.getElementById('coordinator-sheet'), true));
  $('empty').hidden = true;
  for (const id of ['transcript', 'composer', 'model', 'reasoning-control', 'usage-meter', 'coordinator-context']) $(id).hidden = false;
  $('title').textContent = 'Review the interface';
  $('project-name').hidden = false; $('project-name').textContent = 'Sample conversation';
  $('model-name').textContent = 'Opus 5.5'; $('reasoning-value').textContent = 'High';
  $('abort').hidden = true; $('send').disabled = true;
  $('prompt').placeholder = 'Message Pi…';
  $('coordinator-worker-count').textContent = '2'; $('coordinator-worker-summary').textContent = '1 working · 1 ready';
  $('back').onclick = () => location.assign('/');
  document.querySelector('.session-details').innerHTML = '<p id="project">/projects/sample</p><button type="button" id="sample-workers">Background tasks</button><button type="button">Pin session</button><button type="button">Close session</button><button type="button">Session icon</button>';
  const paragraphs = [
    '<h2>Keep the conversation readable</h2><p>The header, composer, menu and usage panel should feel related. The message text and controls should stay sharp.</p>',
    '<p>Scroll this sample behind the controls. Look at the composer’s outline, then open <strong>Session details</strong> using the three dots above.</p><p>The light areas behind the glass should soften without making the foreground look cloudy.</p>',
    '<h2>Try the same material everywhere</h2><p>Tap the usage ring, model name or Workers row. Switch between the styles below while a panel is open.</p><p>This is a CSS comparison, not Apple’s native Liquid Glass. No real conversations or account data are loaded.</p>',
  ];
  $('transcript').replaceChildren(...Array.from({ length: 9 }, (_, i) => {
    const article = document.createElement('article'); article.className = 'message assistant';
    const body = document.createElement('div'); body.className = 'message-text'; body.innerHTML = paragraphs[i % paragraphs.length];
    article.append(body); return article;
  }));
  $('scroll-bottom').hidden = false;
  $('scroll-bottom').onclick = () => $('transcript').scrollTo({ top: $('transcript').scrollHeight });
  $('composer').onsubmit = event => { event.preventDefault(); $('study-status').textContent = 'Sample draft only. Nothing was sent.'; };
  $('prompt').oninput = () => { $('send').disabled = !$('prompt').value.trim(); };
  for (const id of ['attach', 'commands']) $(id).onclick = () => { $('study-status').textContent = 'Preview only. Try the usage ring, model, menu or Workers row.'; };
  function showPicker(kind) {
    $('settings-dialog').show(); $('settings-picker').hidden = false;
    $('picker-title').hidden = false; $('picker-title').textContent = kind === 'usage' ? 'Usage' : 'Model';
    $('model-search').hidden = true;
    $('picker-options').innerHTML = kind === 'usage'
      ? '<div class="usage-details"><section><div class="usage-heading"><h3>Current context</h3><strong>36.5% used</strong></div><progress value="36.5" max="100" aria-label="Current context"></progress><p class="hint">365,000 / 1,000,000 tokens</p></section><section><h3>Account limits · sample</h3><div class="usage-limit"><div class="usage-heading"><h4>5-hour limit</h4><strong>83% used</strong></div><progress value="83" max="100" aria-label="5-hour limit"></progress><p class="hint">Resets in 2 hours</p></div><div class="usage-limit"><div class="usage-heading"><h4>Weekly</h4><strong>65% used</strong></div><progress value="65" max="100" aria-label="Weekly limit"></progress></div></section></div>'
      : '<button type="button" class="command-option picker-option" aria-pressed="true">Opus 5.5 · selected</button><button type="button" class="command-option picker-option">Sonnet · sample</button>';
    $('picker-help').textContent = 'Sample data. No account connected.';
  }
  $('usage-meter').onclick = () => showPicker('usage');
  $('model').onclick = $('reasoning-control').onclick = () => showPicker('model');
  $('picker-cancel').onclick = () => $('settings-dialog').close();
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $('settings-dialog').close(); });
  $('coordinator-title').textContent = 'Workers'; $('coordinator-subtitle').textContent = 'Sample tasks';
  $('coordinator-task-list').innerHTML = '<button type="button" class="coordinator-worker"><span><strong>Review the interface</strong><small>Working · sample</small></span></button><button type="button" class="coordinator-worker"><span><strong>Check mobile layout</strong><small>Ready · sample</small></span></button>';
  $('sample-workers').onclick = $('coordinator-open').onclick = () => $('coordinator-sheet').showModal();
  $('coordinator-done').onclick = () => $('coordinator-sheet').close();
  new ResizeObserver(() => {
    root.style.setProperty('--dock-height', `${$('dock').offsetHeight}px`);
    root.style.setProperty('--coordinator-height', `${$('coordinator-context').offsetHeight + 8}px`);
  }).observe($('dock'));
  $('study-status').textContent = 'Sample only · scroll, type, open ⋯ or the usage ring';
  requestAnimationFrame(() => $('transcript').scrollTop = 280);
} catch {
  $('study-status').textContent = 'Preview could not load. Reload to try again.';
}
