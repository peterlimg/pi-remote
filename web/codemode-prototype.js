// Throwaway: three codemode-detail layouts on this sample route, selected with ?variant=purpose|recap|source.
// Titles and tool references are authored sample data, not inferred execution events.
const runs = [
  {
    id: 'read', title: 'Inspect the session row', context: 'Read · app.js + style.css', duration: '87ms',
    references: [['read', 'web/app.js'], ['read', 'web/style.css']],
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
    references: [['ffgrep', 'working · web/style.css']],
    output: 'web/style.css\n.session-icon[data-status=working]\n.session-working',
    script: `// Find the status styles
text(await tools.ffgrep({
  pattern: "working",
  path: "web/style.css"
}));`
  },
  {
    id: 'check', title: 'Check the session list', context: 'Command · focused browser check', duration: '13.1s',
    references: [['bash', 'npx playwright test test/browser/sessions.spec.mjs --grep "working"']],
    output: '1 passed (13.1s)\nSession list shows the working indicator.',
    script: `// Check the session list
text(await tools.bash({
  command: 'npx playwright test test/browser/sessions.spec.mjs --grep "working"'
}));`
  }
];
const phases = {
  done: { title: 'Checked the working indicator', overview: '3 complete', result: '1 browser check passed', elapsed: '13.3s elapsed' },
  working: { title: 'Checking the working indicator', overview: '2 complete · 1 running', result: 'Browser check is running', elapsed: 'Still running' },
  error: { title: 'Browser check needs attention', overview: '2 complete · 1 failed', result: '1 browser check failed', elapsed: '13.3s elapsed' },
  empty: { title: 'No activity yet', overview: 'No runs', result: 'No scripts have run in this sample.', elapsed: '' }
};
const statusNames = { done: 'Complete', working: 'Running', error: 'Failed' };
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

function renderRun(run, state, source = false) {
  const status = run.id === 'check' ? state : 'done';
  const label = statusNames[status];
  const output = status === 'working' ? 'Browser check started.\nNo final result yet.' : status === 'error'
    ? 'Expected the working indicator to remain visible.\n1 failed. Exit code 1.' : run.output;
  const references = source ? `<div class="cm-references"><p>Referenced in script</p><ul>${run.references.map(([tool, target]) => `<li><code>${tool}</code><span>${escapeHtml(target)}</span></li>`).join('')}</ul></div>` : '';
  const evidence = `<pre class="cm-output">${escapeHtml(output)}</pre>`;
  return `<details class="cm-run" data-run="${run.id}" data-status="${status}" ${source && run.id === 'read' || status === 'error' ? 'open' : ''}>
    <summary class="cm-run-toggle">
      <span class="cm-marker">${icon(status === 'done' ? 'check' : status)}<span class="sr-only">${label}: </span></span>
      <span class="cm-heading"><span class="cm-run-title">${run.title}</span><span class="cm-meta">${source ? `JavaScript · ${run.references.length} source ${run.references.length === 1 ? 'reference' : 'references'}` : run.context}</span></span>
      <span class="cm-time">${status === 'working' ? 'Running' : run.duration}</span>${icon('chevron', 'cm-chevron')}
    </summary>
    <div class="cm-run-body">
      ${references}
      ${source ? `<details class="cm-evidence"><summary>Output ${icon('chevron', 'cm-chevron')}</summary>${evidence}</details>` : `<p class="cm-output-label">Output</p>${evidence}`}
      ${status === 'error' ? '<p class="cm-recovery">Read the failed assertion before rerunning.</p>' : ''}
      <details class="cm-script"><summary>Script <span>JavaScript</span>${icon('chevron', 'cm-chevron')}</summary><pre><code>${escapeHtml(run.script)}</code></pre></details>
    </div>
  </details>`;
}

function activity(state, source = false) {
  const phase = phases[state];
  return `<details class="cm-activity" open>
    <summary class="cm-activity-toggle">${icon('code')}<span class="cm-heading"><span class="cm-title">${source ? 'Under the hood' : 'Work log'}</span><span class="cm-meta">${phase.overview}${phase.elapsed ? ` · ${phase.elapsed}` : ''}</span></span>${icon('chevron', 'cm-chevron')}</summary>
    ${source && state !== 'empty' ? '<p class="cm-source-note">Tool references from the script, not an execution trace.</p>' : ''}
    ${state === 'empty' ? '<p class="cm-empty">No scripts or output to inspect.</p>' : runs.map(run => renderRun(run, state, source)).join('')}
  </details>`;
}

function purpose(state) {
  return activity(state);
}

function recap(state) {
  const phase = phases[state];
  return `<section class="cm-digest" aria-label="Activity recap">
    <div class="cm-recap-heading"><span class="cm-marker">${icon(state === 'done' ? 'check' : state === 'empty' ? 'code' : state)}</span><h2>${phase.title}</h2></div>
    <p class="cm-recap-result">${phase.result}</p>
    ${state === 'empty' ? '' : `<details class="cm-activity cm-recap-steps" ${state === 'error' ? 'open' : ''}>
      <summary class="cm-recap-toggle"><span>See 3 steps</span><span class="cm-meta">${phase.elapsed}</span>${icon('chevron', 'cm-chevron')}</summary>
      ${runs.map(run => renderRun(run, state)).join('')}
    </details>`}
  </section>`;
}

function source(state) {
  return activity(state, true);
}

const variants = [
  { key: 'purpose', name: 'A · Purpose first', render: purpose, description: 'Useful titles and one line of context. Tap a step for output, then Script for code.' },
  { key: 'recap', name: 'B · Quiet recap', render: recap, description: 'One result in the conversation. Open the steps only when you need them.' },
  { key: 'source', name: 'C · Script outline', render: source, description: 'See referenced tools and their targets. These are source references, not recorded inner-tool events.' }
];

function render() {
  const params = new URLSearchParams(location.search);
  index = Math.max(0, variants.findIndex(item => item.key === params.get('variant')));
  selector.value = ['done', 'working', 'error', 'empty'].includes(params.get('state')) ? params.get('state') : 'done';
  const variant = variants[index], state = selector.value;
  root.innerHTML = `<section class="cm-detail cm-${variant.key}" data-state="${state}">
    <article class="cm-message cm-user" aria-label="Sample user message"><p>Can the working status show more detail without getting in the way?</p></article>
    <article class="cm-message" aria-label="Sample Pi reply"><p>I'll inspect the session row and check how the working indicator is displayed.</p></article>
    ${variant.render(state)}
    <p class="cm-sample-note">Sample activity. Nothing is executing.</p>
  </section>`;
  root.scrollTop = 0;
  const label = document.querySelector('#variant-label');
  label.replaceChildren(document.createTextNode(variant.name));
  const hint = document.createElement('small');
  hint.textContent = `${index + 1} of ${variants.length} · Compare layouts`;
  label.append(hint);
  document.querySelector('#variant-description').textContent = variant.description;
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
