// Throwaway: one-line activity summaries, selected with ?variant=purpose|recap|source.
// Labels and results are authored sample data, not inferred execution events.
const runs = [
  {
    id: 'read', title: 'Inspect the session row', context: 'Read · app.js + style.css', duration: '87ms',
    output: 'web/app.js\nSession rows include a title and a working indicator.\n\nweb/style.css\nThe indicator sits beside the session title.',
    script: `// Inspect the session row
const files = await Promise.all([
  tools.read({ path: "web/app.js" }),
  tools.read({ path: "web/style.css" })
]);
files.forEach(text);`
  },
  {
    id: 'search', title: 'Find the status styles', context: 'Search · working indicator', duration: '87ms',
    output: 'web/style.css\n.session-icon[data-status=working]\n.session-working',
    script: `// Find the status styles
text(await tools.ffgrep({
  pattern: "working",
  path: "web/style.css"
}));`
  },
  {
    id: 'check', title: 'Check the session list', context: 'Command · focused browser check', duration: '13.1s',
    output: '1 passed (13.1s)\nSession list shows the working indicator.',
    script: `// Check the session list
text(await tools.bash({
  command: 'npx playwright test test/browser/sessions.spec.mjs --grep "working"'
}));`
  }
];
const phases = {
  done: { purpose: 'Read · search · check', recap: '3 steps complete', source: 'Checked session list', duration: '13.3s' },
  working: { purpose: 'Read · search · checking', recap: '2 complete, 1 running', source: 'Checking session list', duration: '' },
  error: { purpose: 'Read · search · check failed', recap: '2 complete, 1 failed', source: 'Session check failed', duration: '13.3s' },
  empty: { purpose: 'No activity yet', recap: 'No activity yet', source: 'No activity yet', duration: '' }
};
const statusNames = { done: 'Complete', working: 'Running', error: 'Failed', empty: 'No runs' };
const variants = [
  { key: 'purpose', name: 'A · Action words' },
  { key: 'recap', name: 'B · Count only' },
  { key: 'source', name: 'C · Latest step' }
];
const root = document.querySelector('#study-thread');
const selector = document.querySelector('#sample-state');
let index = 0;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function icon(name, className = '') {
  const paths = {
    check: '<path d="m5 12 4 4L19 6"/>',
    working: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>'
  };
  return `<svg class="cm-icon ${className}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function renderRun(run, state) {
  const status = run.id === 'check' ? state : 'done';
  const output = status === 'working' ? 'Browser check started.\nNo final result yet.' : status === 'error'
    ? 'Expected the working indicator to remain visible.\n1 failed. Exit code 1.' : run.output;
  return `<details class="cm-run" data-run="${run.id}" data-status="${status}">
    <summary class="cm-run-toggle">
      <span class="cm-marker">${icon(status === 'done' ? 'check' : status)}<span class="sr-only">${statusNames[status]}: </span></span>
      <span class="cm-title">${run.title}</span>
      <span class="cm-time">${status === 'done' ? run.duration : statusNames[status]}</span>${icon('chevron', 'cm-chevron')}
    </summary>
    <div class="cm-run-body">
      <p class="cm-context">${run.context}</p>
      <p class="cm-output-label">Output</p><pre class="cm-output">${escapeHtml(output)}</pre>
      <details class="cm-script"><summary>Script <span>JavaScript</span>${icon('chevron', 'cm-chevron')}</summary><pre><code>${escapeHtml(run.script)}</code></pre></details>
    </div>
  </details>`;
}

function activity(state, variant) {
  const phase = phases[state];
  const meta = state === 'empty' ? '' : variant === 'source' ? '+2' : variant === 'recap' ? phase.duration : '';
  return `<details class="cm-activity">
    <summary class="cm-activity-toggle">
      <span class="cm-marker">${icon(state === 'done' ? 'check' : state === 'empty' ? 'code' : state)}<span class="sr-only">${statusNames[state]}: </span></span>
      <span class="cm-title">Codemode · ${phase[variant]}</span>
      <span class="cm-total" ${meta === '+2' ? 'aria-label="2 earlier steps"' : ''}>${meta}</span>${icon('chevron', 'cm-chevron')}
    </summary>
    ${state === 'empty' ? '<p class="cm-empty">No scripts or output to inspect.</p>' : runs.map(run => renderRun(run, state)).join('')}
  </details>`;
}

function render() {
  const params = new URLSearchParams(location.search);
  index = Math.max(0, variants.findIndex(item => item.key === params.get('variant')));
  selector.value = ['done', 'working', 'error', 'empty'].includes(params.get('state')) ? params.get('state') : 'done';
  const variant = variants[index], state = selector.value;
  root.innerHTML = `<section class="cm-detail cm-${variant.key}" data-state="${state}">
    <article class="cm-message cm-user" aria-label="Sample user message"><p>Can the working status show more detail without getting in the way?</p></article>
    <article class="cm-message" aria-label="Sample Pi reply"><p>I'll inspect the session row and check how the working indicator is displayed.</p></article>
    ${activity(state, variant.key)}
  </section>`;
  root.scrollTop = 0;
  document.querySelector('#variant-label').textContent = variant.name;
}

function update(key, value) {
  const url = new URL(location.href);
  url.searchParams.set(key, value);
  history.replaceState(null, '', url);
  render();
}

function cycle(direction) {
  update('variant', variants[(index + direction + variants.length) % variants.length].key);
}

document.querySelector('#previous-variant').addEventListener('click', () => cycle(-1));
document.querySelector('#next-variant').addEventListener('click', () => cycle(1));
selector.addEventListener('change', () => update('state', selector.value));
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.target.closest('input, textarea, select, [contenteditable], dialog, [popover]') ||
      document.querySelector('dialog[open], [popover]:popover-open')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    cycle(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
window.addEventListener('popstate', render);

// Keep the production composer unchanged and disconnected.
document.querySelector('#composer').hidden = false;
document.querySelector('#prompt').placeholder = 'Message Pi while it works…';
document.querySelector('#model-name').textContent = 'GPT-6.1 Sol';
document.querySelector('#reasoning-value').textContent = 'Max';
for (const id of ['model', 'reasoning-control', 'fast-mode', 'usage-meter']) document.getElementById(id).hidden = false;
document.querySelector('#send').hidden = true;
render();
