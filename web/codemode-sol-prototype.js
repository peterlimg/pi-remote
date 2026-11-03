// A readable work log, not a tool counter: show the intent of every run,
// put output one tap away, and keep scripts one level deeper.

const runs = [
  {
    id: 'read',
    title: 'Read the icon components',
    tool: 'tools.read',
    count: 2,
    duration: '840ms',
    result: '2 files',
    output: `web/app.js
Automatic characters are selected from the session title.
Manual icons and emoji are already stored by session ID.

test/browser/session-icons.spec.mjs
Existing coverage includes manual icons and emoji.`,
    script: `const files = await Promise.all([
  tools.read({ path: "web/app.js", offset: 930, limit: 35 }),
  tools.read({ path: "test/browser/session-icons.spec.mjs" })
]);
files.forEach(file => console.log(file));`,
  },
  {
    id: 'edit',
    title: 'Update session defaults',
    tool: 'tools.edit',
    count: 2,
    duration: '1.2s',
    result: '2 edits',
    output: `Applied 2 edits to web/app.js.
Default characters now use the session ID.
Manual icon and emoji selection is unchanged.`,
    script: `await tools.edit({
  path: "web/app.js",
  oldText: "type: autoKind(item)",
  newText: "type: defaultKind(item.id)"
});
await tools.edit({
  path: "web/app.js",
  oldText: "label: sessionKinds[autoKind(item)][0]",
  newText: "label: sessionKinds[defaultKind(item.id)][0]"
});`,
  },
  {
    id: 'behavior',
    title: 'Check icon behavior',
    tool: 'tools.bash',
    duration: '3m45s',
    result: 'Exit 0',
    output: `PASS  default character survives a rename
PASS  manual icon is preserved
PASS  custom emoji is preserved

3 passed (3m45s)`,
    script: `const result = await tools.bash({
  command: "npx playwright test test/browser/session-icons.spec.mjs --grep 'rename|manual|emoji'"
});
console.log(result);`,
  },
  {
    id: 'diff',
    title: 'Review the changes',
    tool: 'tools.bash',
    context: 'git diff',
    duration: '1.1s',
    result: 'Exit 0',
    output: `web/app.js
- type: autoKind(item)
+ type: defaultKind(item.id)

- label: sessionKinds[autoKind(item)][0]
+ label: sessionKinds[defaultKind(item.id)][0]

No whitespace errors.`,
    script: `const result = await tools.bash({
  command: "git diff --check && git diff -- web/app.js"
});
console.log(result);`,
  },
  {
    id: 'browser',
    title: 'Run focused browser checks',
    tool: 'tools.bash',
    duration: '6m40s',
    result: 'Exit 0',
    output: `PASS  default character stays the same after rename
PASS  manual icon survives a rename
PASS  custom emoji survives a rename
PASS  character persists after reload
PASS  session list and heading agree

5 passed (6m40s)`,
    script: `const result = await tools.bash({
  command: "npx playwright test test/browser/session-icons.spec.mjs --grep 'default character'"
});
console.log(result);`,
  },
];

const phases = {
  done: { overview: '5 complete', icon: 'check', label: 'Complete' },
  working: { overview: '4 complete · 1 running', icon: 'clock', label: 'Running' },
  error: { overview: '4 complete · 1 failed', icon: 'error', label: 'Failed' },
  empty: { overview: 'No runs', icon: 'code', label: 'No runs' },
};

const runningOutput = `4 of 5 checks passed.
Checking the default character after rename…

No final result yet.`;
const failedOutput = 'Expected the default character to stay the same after rename. 1 failed, 4 passed.';

function escapeHtml(value) {
  return value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

function icon(name, className = '') {
  const paths = {
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
  };
  return `<svg class="cm-sol-icon ${className}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function renderRun(run, state) {
  const status = run.id === 'browser' ? state : 'done';
  const phase = phases[status];
  const active = status !== 'done';
  const output = status === 'working' ? runningOutput : status === 'error' ? failedOutput : run.output;
  const result = status === 'working' ? 'In progress' : status === 'error' ? 'Exit 1' : run.result;
  return `<details class="cm-sol-run" data-run="${run.id}" data-status="${status}" ${active ? 'open' : ''}>
    <summary class="cm-sol-run-toggle">
      <span class="cm-sol-marker">${icon(phase.icon)}<span class="cm-sol-sr-only">${phase.label}: </span></span>
      <span class="cm-sol-run-heading">
        <span class="cm-sol-run-title">${run.title}</span>
        <span class="cm-sol-run-meta"><code class="cm-sol-tool-name">${run.tool}</code>${run.count ? ` <span class="cm-sol-call-count">×${run.count}</span>` : ''}${run.context ? ` <span aria-hidden="true">·</span> <code class="cm-sol-tool-name">${run.context}</code>` : ''}</span>
      </span>
      <span class="cm-sol-measure">
        <span class="cm-sol-duration">${run.duration}</span>
        ${active ? `<span class="cm-sol-run-state">${phase.label}</span>` : ''}
      </span>
      ${icon('chevron', 'cm-sol-chevron')}
    </summary>
    <div class="cm-sol-run-details">
      <div class="cm-sol-output">
        <div class="cm-sol-output-heading"><span>Output</span><span class="cm-sol-result">${result}</span></div>
        <pre class="cm-sol-output-text">${escapeHtml(output)}</pre>
        ${status === 'error' ? '<p class="cm-sol-recovery">Inspect the rename assertion before rerunning.</p>' : ''}
        ${status === 'working' ? '<p class="cm-sol-snapshot">Static sample · no checks are executing.</p>' : ''}
      </div>
      <details class="cm-sol-script">
        <summary class="cm-sol-script-toggle"><span>Script</span><span class="cm-sol-language">JavaScript excerpt</span>${icon('chevron', 'cm-sol-chevron')}</summary>
        <pre class="cm-sol-script-text"><code>${escapeHtml(run.script)}</code></pre>
      </details>
    </div>
  </details>`;
}

export function mount(root, { state }) {
  const phase = phases[state];
  root.innerHTML = `<section class="cm-sol" data-state="${state}" aria-label="Sample Pi conversation">
    <article class="cm-sol-message" aria-label="Pi">
      <p>I'll tie default characters to session IDs so renaming won't reshuffle them, while retaining manual icons and emoji.</p>
    </article>
    <details class="cm-sol-activity" open aria-label="Sample codemode work log">
      <summary class="cm-sol-activity-toggle">
        <span class="cm-sol-code-mark">${icon('code')}</span>
        <span class="cm-sol-activity-heading">
          <span class="cm-sol-title">Session icon defaults</span>
          <span class="cm-sol-overview">
            <span>codemode</span><span aria-hidden="true">·</span><span class="cm-sol-phase">${phase.overview}</span>
          </span>
          ${state === 'done' || state === 'error' ? '<span class="cm-sol-elapsed"><span class="cm-sol-duration">10m28s</span> elapsed <span class="cm-sol-overlap">· runs can overlap</span></span>' : ''}
        </span>
        ${icon('chevron', 'cm-sol-chevron')}
      </summary>
      ${state === 'empty' ? '<div class="cm-sol-empty"><p>No codemode runs in this sample.</p><p>No scripts or output to inspect.</p></div>' : `<div class="cm-sol-runs">${runs.map(run => renderRun(run, state)).join('')}</div>`}
    </details>
    <article class="cm-sol-message" aria-label="Pi">
      <p>The defaults are stable across renames. I'll finish the focused browser checks before updating the phone.</p>
    </article>
  </section>`;
}
