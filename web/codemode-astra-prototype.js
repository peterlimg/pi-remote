// Thesis: a readable work ledger, not a tool counter; keep intent visible and evidence one tap away.
const runs = [
  {
    title: 'Read the icon components', tool: 'tools.read ×2', duration: '840ms',
    script: `const files = await Promise.all([
  tools.read({ path: "web/app.js", offset: 930, limit: 90 }),
  tools.read({ path: "web/style.css", offset: 220, limit: 60 })
]);
files.forEach(file => console.log(file));`,
    output: 'Read session icon selection and rendering.\nManual icons and custom emoji are stored by session ID.'
  },
  {
    title: 'Update session defaults', tool: 'tools.edit ×2', duration: '1.2s',
    script: `await tools.edit({
  path: "web/app.js",
  oldText: "characterFor(session.title)",
  newText: "characterFor(session.id)"
});
await tools.edit({
  path: "web/app.js",
  oldText: "return defaultCharacter(session);",
  newText: "return savedIcon ?? defaultCharacter(session);"
});`,
    output: 'Applied 2 edits.\nDefault character uses session.id.\nSaved icons and emoji keep precedence.'
  },
  {
    title: 'Check icon behavior', tool: 'tools.bash', duration: '3m45s',
    script: `const result = await tools.bash({
  command: 'node --test --test-name-pattern="session icon"'
});
console.log(result);`,
    output: 'PASS  Same ID keeps its character after rename\nPASS  Manual icon overrides the default\nPASS  Custom emoji is preserved\n3 passed · exit 0'
  },
  {
    title: 'Review the changes', tool: 'tools.bash · git diff', duration: '1.1s',
    script: `const result = await tools.bash({
  command: "git diff -- web/app.js"
});
console.log(result);`,
    output: '- characterFor(session.title)\n+ characterFor(session.id)\n\n- return defaultCharacter(session);\n+ return savedIcon ?? defaultCharacter(session);'
  },
  {
    title: 'Run focused browser checks', tool: 'tools.bash', duration: '6m40s',
    script: `const result = await tools.bash({
  command: 'npx playwright test --grep "session icons"'
});
console.log(result);`,
    output: 'PASS  Default character survives rename\nPASS  Manual icon survives rename\nPASS  Custom emoji survives rename\nPASS  Default is restored after reset\nPASS  New session gets a default\n5 passed · exit 0'
  }
];

const failure = 'Expected the default character to stay the same after rename. 1 failed, 4 passed.';

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function icon(kind) {
  const paths = {
    done: '<path d="m4 8 3 3 5-6"/>',
    working: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    error: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5v4M8 11v.5"/>',
    chevron: '<path d="m6 3 5 5-5 5"/>'
  };
  return `<svg class="cm-astra-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}

function renderRun(run, index, state) {
  const status = index === runs.length - 1 && state !== 'done' ? state : 'done';
  const label = { done: 'Complete', working: 'Running', error: 'Failed' }[status];
  const output = status === 'error' ? failure : status === 'working'
    ? '4 checks passed.\nChecking that the default character stays the same after rename…\n\nProcess has not exited. No final result yet.' : run.output;
  return `<li class="cm-astra-item">
    <details class="cm-astra-run" data-run="${index + 1}" data-status="${status}" ${status !== 'done' ? 'open' : ''}>
      <summary class="cm-astra-run-summary">
        <span class="cm-astra-state-icon">${icon(status)}</span>
        <span class="cm-astra-run-copy">
          <span class="cm-astra-run-title">${escapeHTML(run.title)}</span>
          <span class="cm-astra-run-meta"><span class="cm-astra-tool">${escapeHTML(run.tool)}</span><span class="cm-astra-run-status ${status === 'done' ? 'cm-astra-sr-only' : ''}">${label}</span></span>
        </span>
        <span class="cm-astra-duration">${status === 'working' ? '6m40s' : run.duration}${status === 'working' ? '<span class="cm-astra-elapsed">elapsed</span>' : ''}</span>
        <span class="cm-astra-chevron">${icon('chevron')}</span>
      </summary>
      <div class="cm-astra-evidence">
        <div class="cm-astra-output-heading"><h3 class="cm-astra-evidence-title">${status === 'working' ? 'Latest output' : 'Output'}</h3><span class="cm-astra-exit">${status === 'working' ? 'Still running' : status === 'error' ? 'Exit 1' : 'Exit 0'}</span></div>
        <pre class="cm-astra-output">${escapeHTML(output)}</pre>
        ${status === 'error' ? '<p class="cm-astra-recovery">Inspect the rename assertion before rerunning the browser checks. This sample does not execute retries.</p>' : ''}
        <details class="cm-astra-script">
          <summary class="cm-astra-script-summary"><span>View script</span><span class="cm-astra-chevron">${icon('chevron')}</span></summary>
          <pre class="cm-astra-code"><code>${escapeHTML(run.script)}</code></pre>
        </details>
      </div>
    </details>
  </li>`;
}

export function mount(root, { state }) {
  const empty = state === 'empty';
  const statusText = { done: '5 runs complete', working: '4 complete · 1 running', error: '4 complete · 1 failed', empty: 'No runs yet' }[state];
  root.innerHTML = `<section class="cm-astra" data-state="${state}" aria-label="Sample conversation with codemode activity">
    <p class="cm-astra-message">I'll tie default characters to session IDs so renaming won't reshuffle them, while retaining manual icons and emoji.</p>
    ${empty ? `<section class="cm-astra-empty" aria-label="codemode activity">
      <h2 class="cm-astra-heading">Session defaults</h2>
      <p class="cm-astra-meta">codemode · ${statusText}</p>
      <p class="cm-astra-empty-copy">Scripts and their results will appear here when a run starts.</p>
    </section>` : `<details class="cm-astra-ledger" open>
      <summary class="cm-astra-ledger-summary">
        <span class="cm-astra-ledger-copy">
          <span class="cm-astra-heading">Session defaults</span>
          <span class="cm-astra-meta">codemode · ${statusText}</span>
          ${state === 'done' ? '<span class="cm-astra-wall-time"><span class="cm-astra-duration">10m28s</span> wall time</span>' : ''}
        </span>
        <span class="cm-astra-chevron">${icon('chevron')}</span>
      </summary>
      <ol class="cm-astra-runs" aria-label="Five illustrative codemode runs">${runs.map((run, index) => renderRun(run, index, state)).join('')}</ol>
      <p class="cm-astra-ledger-note">${state === 'done' ? 'Wall time includes overlapping runs.' : state === 'working' ? 'Browser checks are still running. Durations are a fixed sample.' : 'Browser checks need attention. Open the failed run for details.'}</p>
    </details>`}
    <p class="cm-astra-message">The defaults are stable across renames. I'll finish the focused browser checks before updating the phone.</p>
  </section>`;
}
