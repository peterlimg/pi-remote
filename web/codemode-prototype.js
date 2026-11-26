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
const terminalVariants = [
  { key: 'transcript', name: 'A · Mini terminal' },
  { key: 'excerpt', name: 'B · Result first' },
  { key: 'fold', name: 'C · Margin note' }
];
const terminalStudy = terminalVariants.some(v => v.key === new URLSearchParams(location.search).get('variant'));
const captureVariants = [
  { key: 'terminal', name: 'Reference · Pi terminal' },
  { key: 'compact', name: 'A · Terminal compact' },
  { key: 'calls', name: 'B · Calls first' }
];
const captureStudy = captureVariants.some(v => v.key === new URLSearchParams(location.search).get('variant'));
const choices = captureStudy ? captureVariants : terminalStudy ? terminalVariants : variants;
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

function terminalBlock(state, variant) {
  if (state === 'empty') return '<p class="cm-empty">No codemode runs yet.</p>';
  const script = `// Find the activity renderer
const matches = await tools.ffgrep({
  pattern: 'codemode-tool',
  path: 'web/app.js'
});
text(matches);`;
  const output = state === 'error' ? 'Search failed: file index unavailable.' : state === 'working' ? '' : `web/app.js:2033\n  detail.classList.add('codemode-tool');`;
  const status = state === 'done' ? 'Complete · 87ms' : state === 'error' ? 'Failed · 87ms' : 'Running';
  const details = `<details class="term-details"><summary>Full run</summary><b>Output</b><pre>${output || 'No output yet.'}</pre><b>Script</b><pre>${script}</pre></details>`;
  const head = `<header><strong>codemode</strong><small>${status}</small></header>`;
  const preview = `<pre>${output || 'Waiting for output…'}</pre>`;
  if (variant === 'transcript') return `<section class="term-block term-console">${head}<pre class="term-input"><b>›</b> ffgrep <strong>codemode-tool</strong>\n  web/app.js</pre>${preview}${details}</section>`;
  if (variant === 'excerpt') return `<section class="term-block term-result">${head}<h2>Find the activity renderer</h2>${preview}${details}</section>`;
  return `<details class="term-block term-fold"><summary><span><strong>Find the activity renderer</strong><small>codemode · ${status}</small></span></summary><b>Output</b>${preview}<details class="term-details"><summary>Script</summary><pre>${script}</pre></details></details><p class="term-note">${state === 'done' ? 'web/app.js:2033' : state === 'error' ? output : 'Waiting for output…'}</p>`;
}

function capturedRun(state, variant) {
  const capture = document.getElementById(`capture-${state}`).innerHTML;
  const reference = `<figure class="capture-reference">${capture}<figcaption>Pi 1.6.1 · cropped terminal capture. Scroll sideways for long lines.</figcaption></figure>`;
  if (variant === 'terminal') return reference;
  const working = state === 'working', failed = state === 'error';
  const status = working ? 'Elapsed 3.0s' : 'Took 3.3s';
  const script = `const version = await tools.read({ path: "VERSION" });
const check = await tools.bash({ command: "node check.mjs" });
if (check.exit_code) throw Error(check.output.trim());
text("Version " + version.trim() + ": " + check.output.trim());`;
  const rows = `<ul class="capture-calls">${[
    ['✓', 'Complete', 'read', 'VERSION', '3ms'],
    [working ? '…' : failed ? '✗' : '✓', working ? 'Running' : failed ? 'Failed' : 'Complete', 'bash', 'node check.mjs', working ? 'Running' : '3.3s']
  ].map(([mark, label, tool, args, time]) => `<li><span class="call-mark" aria-hidden="true">${mark}</span><span><span class="sr-only">${label}: </span><strong>${tool}</strong> ${args}</span><small>${time}</small></li>`).join('')}</ul>`;
  const output = working ? '' : `<pre class="capture-output">${failed ? 'Error: Version mismatch' : 'Version 1.2.0: release check passed'}</pre>`;
  const source = `<details class="term-details"><summary>Full script</summary><pre>${escapeHtml(script)}</pre></details>`;
  return `<section class="term-block ${variant === 'compact' ? 'term-console' : 'term-result'}">
    <header><strong>codemode</strong><small>${status}</small></header>
    ${variant === 'compact' ? `<pre class="term-input">${escapeHtml(script.split('\n').slice(0, 2).join('\n'))}</pre>${source}` : ''}
    ${rows}${output}${variant === 'calls' ? source : ''}
  </section><details class="capture-compare"><summary>Compare with Pi terminal</summary>${reference}</details>`;
}

function render() {
  const params = new URLSearchParams(location.search);
  index = Math.max(0, choices.findIndex(item => item.key === params.get('variant')));
  selector.value = ['done', 'working', 'error', 'empty'].includes(params.get('state')) ? params.get('state') : 'done';
  if (captureStudy && !selector.value) selector.value = 'done';
  const variant = choices[index], state = selector.value;
  root.innerHTML = captureStudy ? `<section class="term-thread cm-detail" data-state="${state}">
    <article class="cm-message cm-user"><p>Check the release version.</p></article>
    ${capturedRun(state, variant.key)}
  </section>` : terminalStudy ? `<section class="term-thread cm-detail" data-state="${state}">
    <article class="cm-message cm-user"><p>Where is the codemode row rendered?</p></article>
    <article class="cm-message"><p>I'll look for the class on the tool row.</p></article>
    ${terminalBlock(state, variant.key)}
  </section>` : `<section class="cm-detail cm-${variant.key}" data-state="${state}">
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
  update('variant', choices[(index + direction + choices.length) % choices.length].key);
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

if (captureStudy) {
  document.title = 'Codemode capture · Pi Remote prototypes';
  document.querySelector('.study-title h1').textContent = 'Release version check';
  document.querySelector('.study-tools > span').textContent = 'Prototype · Recorded run';
  selector.querySelector('[value=empty]').remove();
  selector.querySelector('[value=error]').textContent = 'Failed';
  const notes = document.querySelectorAll('#study-info p');
  notes[1].textContent = 'A local fixture requested one fixed script. Pi really read VERSION and ran node check.mjs. The failed recording uses a mismatched version.';
  notes[2].textContent = 'These are saved frames, not a live session. The reference keeps the captured lines and terminal colors. Both phone layouts show the same recorded calls.';
} else if (terminalStudy) {
  document.title = 'Codemode on the phone · Pi Remote prototypes';
  document.querySelector('.study-title h1').textContent = 'Codemode on the phone';
  document.querySelectorAll('#study-info p')[1].textContent = 'Compare the same sample search three ways. The mini terminal abbreviates the script; Full run shows the JavaScript.';
}

// Keep the production composer unchanged and disconnected.
document.querySelector('#composer').hidden = false;
document.querySelector('#prompt').placeholder = 'Message Pi while it works…';
document.querySelector('#model-name').textContent = 'GPT-6.1 Sol';
document.querySelector('#reasoning-value').textContent = 'Max';
for (const id of ['model', 'reasoning-control', 'fast-mode']) document.getElementById(id).hidden = false;
document.querySelector('#send').hidden = true;
render();
