// Throwaway UI fixtures, not session attribution or a Git client.
const icons = {
  branch: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 7.5v9M18 9.5a7 7 0 0 1-7 7H6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  diff: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M14 3v8m-4-4h8M7 16h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  warning: '<path d="m12 3 10 18H2ZM12 9v5m0 3v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const files = [
  { name: 'web/app.js', kind: 'M', state: 'Uncommitted', hunk: '@@ -42,3 +42,7 @@', lines: [
    [' ', 'function navigateBack() {'], ['-', '  history.back();'],
    ['+', '  if (canGoBack()) {'], ['+', '    history.back();'], ['+', '  } else {'], ['+', '    showSessions();'], ['+', '  }'], [' ', '}']
  ] },
  { name: 'web/style.css', kind: 'M', state: 'Uncommitted', hunk: '@@ -18,3 +18,6 @@', lines: [
    [' ', '.session-navigation {'], ['-', '  touch-action: none;'],
    ['+', '  touch-action: pan-y;'], ['+', '  overscroll-behavior: contain;'], ['+', '  padding-inline: 12px;'], ['+', '  min-height: 44px;'], [' ', '}']
  ] },
  { name: 'test/browser/navigation.spec.mjs', kind: 'A', state: 'Committed · a41c8d2', hunk: '@@ -0,0 +1,6 @@', lines: [
    ['+', "test('back opens sessions', async ({ page }) => {"], ['+', "  await page.goto('/');"],
    ['+', '  await openSession(page);'], ['+', "  await page.getByRole('button', { name: 'Show sessions' }).click();"],
    ['+', "  await expect(page.locator('#sessions')).toBeVisible();"], ['+', '});']
  ] }
];
const scenarios = {
  worktree: { project: 'pi-remote', start: '~/workspace/pi-remote', locations: [
    { name: 'mobile-nav', kind: 'Worktree', branch: 'fix/mobile-nav', path: '~/workspace/pi-remote/.worktrees/mobile-nav', scope: 'web/ · test/browser/', files }
  ] },
  project: { project: 'pi-remote', start: '~/workspace/pi-remote', locations: [
    { name: 'pi-remote', kind: 'Current checkout', branch: 'main', path: '~/workspace/pi-remote', scope: 'web/ · test/browser/', files }
  ] },
  nested: { project: 'product', start: '~/workspace/product', locations: [
    { name: 'phone', kind: 'Subdirectory', branch: 'fix/mobile-nav', path: '~/workspace/product/apps/phone', scope: 'apps/phone/ in the product repo', files: [
      { ...files[0], name: 'src/navigation.js' }, { ...files[1], name: 'styles/navigation.css' }
    ] },
    { name: 'navigation-tests', kind: 'Nested repository', branch: 'test/back-navigation', path: '~/workspace/product/tools/navigation-tests', scope: 'Separate Git repository', files: [
      { ...files[2], name: 'browser/navigation.spec.mjs' }
    ] }
  ] },
  empty: { project: 'pi-remote', start: '~/workspace/pi-remote', locations: [] }
};
const navigation = scenarios.worktree.locations[0];
const login = {
  name: 'login-flow', kind: 'Worktree', branch: 'fix/pairing-login', path: '~/workspace/pi-remote/.worktrees/login-flow', scope: 'web/ · test/browser/', files: [
    { name: 'web/app.js', kind: 'M', state: 'Uncommitted', hunk: '@@ -88,3 +88,4 @@', lines: [
      [' ', 'function pair(code) {'], ['-', '  return connect(code);'], ['+', '  const cleanCode = code.trim();'], ['+', '  return connect(cleanCode);'], [' ', '}']
    ] },
    { name: 'web/style.css', kind: 'M', state: 'Uncommitted', hunk: '@@ -24,3 +24,4 @@', lines: [
      [' ', '.pairing-form {'], ['-', '  gap: 8px;'], ['+', '  gap: 12px;'], ['+', '  padding: 16px;'], [' ', '}']
    ] },
    { name: 'test/browser/pairing.spec.mjs', kind: 'A', state: 'Committed · b57de10', hunk: '@@ -0,0 +1,5 @@', lines: [
      ['+', "test('pairing trims spaces', async ({ page }) => {"], ['+', "  await page.goto('/');"], ['+', "  await page.getByLabel('Pairing code').fill(' 123456 ');"], ['+', "  await expect(page.getByRole('button', { name: 'Pair with computer' })).toBeEnabled();"], ['+', '});']
    ] }
  ]
};
scenarios.tasks = { project: 'pi-remote', start: '~/workspace/pi-remote', locations: [navigation, login], tasks: [
  { title: 'Fix mobile navigation', shortTitle: 'Navigation', status: 'Working', locations: [{ ...navigation, files: navigation.files.slice(0, 2) }] },
  { title: 'Improve pairing login', shortTitle: 'Pairing', status: 'Working', locations: [{ ...login, files: login.files.slice(0, 2) }] },
  { title: 'Add regression coverage', shortTitle: 'Tests', status: 'Committed', locations: [{ ...navigation, files: [navigation.files[2]] }, { ...login, files: [login.files[2]] }] }
] };
const variants = [
  { key: 'A', name: 'Changes tab', description: 'A permanent place beside the conversation', render: renderA },
  { key: 'B', name: 'In the conversation', description: 'A task summary opens a review sheet', render: renderB },
  { key: 'C', name: 'Locations first', description: 'Choose where the work actually happened', render: renderC },
  // Round two compares three flat alternatives to the original nested layouts.
  { key: 'D', name: 'Focused review', description: 'One task, one location label, no nesting', render: renderD },
  { key: 'E', name: 'Chat + changes', description: 'Keep the conversation above the review', render: renderE },
  { key: 'F', name: 'File browser', description: 'Choose a file, then read its diff', render: renderF }
];
const view = document.querySelector('#prototype-view');
const sheet = document.querySelector('#changes-sheet');
let variant, scenario, conversation = false, locationIndex = null;
let reviewTask, reviewFile, inspectorIndex, worktreeFilter, linkedReviewOpen;
const data = () => scenarios[scenario];
const allFiles = () => data().locations.flatMap(location => location.files);
const reviewTasks = () => data().tasks || (data().locations.length ? [{ title: 'Fix mobile navigation', shortTitle: 'Navigation', status: 'Uncommitted', locations: data().locations }] : []);
const reviewEntries = () => reviewTasks().flatMap((task, taskIndex) => task.locations.flatMap(location => location.files.map(file => ({ task, taskIndex, location, file }))));
const taskEntries = () => reviewEntries().filter(entry => entry.taskIndex === reviewTask);
function resetReview() {
  reviewTask = data().tasks ? 1 : 0; reviewFile = 0; inspectorIndex = null; worktreeFilter = -1; linkedReviewOpen = true;
}
const counts = items => ({ added: items.flatMap(file => file.lines).filter(([type]) => type === '+').length, removed: items.flatMap(file => file.lines).filter(([type]) => type === '-').length });
function stats(items) {
  const { added, removed } = counts(items);
  return `<span class="diff-stats" aria-label="${added} added lines, ${removed} removed lines"><span class="added">+${added}</span><span class="removed">−${removed}</span></span>`;
}
function scopeHeader(location) {
  return `<div class="location-heading">${locationDetails([location])}</div>`;
}
function diffCode(file) {
  return `<div class="code-scroll" tabindex="0" role="region" aria-label="Diff for ${file.name}"><pre><span class="hunk">${file.hunk}</span>${file.lines.map(([type, line]) => `<span class="code-line ${type === '+' ? 'line-added' : type === '-' ? 'line-removed' : ''}"><span class="line-sign">${type}</span>${escape(line)}</span>`).join('')}</pre></div>`;
}
function fileList(items) {
  return `<div class="file-list">${items.map(file => `<details class="file-diff"><summary><span class="file-kind" aria-label="${file.kind === 'A' ? 'Added' : 'Modified'} file">${file.kind}</span><span class="file-info"><span class="file-path">${file.name}</span><span class="file-state">${file.state}</span></span>${stats([file])}<span class="file-chevron">${icon('chevron')}</span></summary><div class="diff-caption">Captured edit <span>${file.state}</span></div>${diffCode(file)}</details>`).join('')}</div>`;
}
function exclusions() {
  return `<div class="exclusions"><details><summary>${icon('check')}<span>Other project changes stay out</span>${icon('chevron')}</summary><div class="excluded-content"><p>These are not counted as this session's work.</p><ul><li><code>README.md</code><span>Changed before this session</span></li><li><code>package.json</code><span>Changed by another session</span></li></ul></div></details>${scenario === 'empty' ? '' : `<details class="shared-edits"><summary>${icon('warning')}<span>1 shared file needs review</span>${icon('chevron')}</summary><div class="excluded-content"><p><code>${data().tasks ? '.worktrees/mobile-nav/web/index.html' : 'web/index.html'}</code> has overlapping edits. We cannot confidently separate who changed which lines.</p><p>No attributed diff available. It is excluded from this session's totals.</p></div></details>`}</div>`;
}
function overview() {
  const items = allFiles();
  return `<div class="changes-overview"><div><h2>Changes in this session</h2><p>${items.length} files · ${data().locations.length} work ${data().locations.length === 1 ? 'location' : 'locations'}</p></div>${stats(items)}</div><p class="scope-note">Captured session edits only. Includes committed work.</p>`;
}
function emptyState() {
  return `<div class="changes-empty">${icon('diff')}<h2>No captured changes yet</h2><p>Edits from this session will appear here, wherever the work happens.</p><p>Existing project changes are not a substitute for session history.</p></div>`;
}
function taskContent() {
  return `<div class="changes-overview"><div><h2>Changes in this session</h2><p>${data().tasks.length} tasks · ${data().locations.length} worktrees</p></div>${stats(allFiles())}</div><p class="scope-note">Choose a task. Each diff stays in its own worktree.</p><div class="task-list">${data().tasks.map(task => {
    const items = task.locations.flatMap(location => location.files);
    return `<details class="task-change"><summary><span class="task-title"><strong>${task.title}</strong>${icon('chevron')}</span><span class="task-meta"><span class="task-status ${task.status === 'Working' ? 'task-working' : ''}">${task.status}</span><span class="worktree-badge">${icon('branch')}${task.locations.length === 1 ? task.locations[0].name : task.locations.length + ' worktrees'}</span><span>${items.length} files</span>${stats(items)}</span></summary><div class="task-files">${task.locations.map(location => `<section class="task-location" aria-label="${task.title} in ${location.name}">${task.locations.length > 1 ? scopeHeader(location) : ''}${fileList(location.files)}</section>`).join('')}</div></details>`;
  }).join('')}</div>${exclusions()}`;
}
function changesContent() {
  if (data().tasks) return taskContent();
  return `${allFiles().length ? overview() + data().locations.map(location => `<section class="location-group" aria-label="Changes in ${location.name}">${scopeHeader(location)}${fileList(location.files)}</section>`).join('') : emptyState()}${exclusions()}`;
}
function composer() {
  return `<div class="demo-composer" aria-label="Sample composer, not connected"><span>Type / for commands</span><div><span class="composer-circle">${icon('plus')}</span><span class="composer-model">GPT-6.1 Sol <span>Max</span></span><span class="composer-slash">/</span><span class="composer-send">${icon('send')}</span></div></div>`;
}
function transcript(withSummary = false) {
  return `<section class="sample-transcript" aria-label="Sample conversation"><div class="sample-user">${data().tasks ? 'Fix navigation and pairing in separate worktrees, then add regression tests.' : 'Make the back gesture return to the session list without losing my place.'}</div><div class="sample-assistant"><p>I'll make the change in <strong>${data().tasks ? 'separate worktrees for navigation and pairing' : scenario === 'worktree' ? 'the mobile-nav worktree' : scenario === 'nested' ? 'the phone app and its test repository' : 'this checkout'}</strong> and leave the other edits alone.</p><p class="sample-tool">${icon('check')} ${data().tasks ? 'Captured task edits from two worktrees' : allFiles().length ? 'Edited navigation and checked the back gesture' : 'Read the navigation code. No edits captured.'}</p><p>${data().tasks ? 'Navigation and pairing are in progress. Regression tests have been committed separately in both worktrees.' : allFiles().length ? 'The back gesture now returns to your sessions. Your conversation stays where you left it.' : 'The project has existing changes, but there is no captured work to attribute to this session.'}</p></div>${withSummary ? `<button class="chat-change-card" type="button" data-action="review"><span class="chat-change-heading">${icon('diff')}<strong>${allFiles().length ? `${allFiles().length} files changed in this session` : 'No captured session edits'}</strong>${icon('chevron')}</span><span class="chat-change-location">${data().locations.map(location => `${location.name} · ${location.kind.toLowerCase()}`).join(' / ') || 'No work location yet'}</span><span class="chat-change-footer"><span>Review changes</span>${stats(allFiles())}</span></button><p class="chat-card-note">Unrelated project edits are not included.</p>` : `<button type="button" class="inline-changes" data-action="changes">${icon('diff')}View this session's ${allFiles().length} changed files${icon('chevron')}</button>`}</section>${composer()}`;
}
function renderA() {
  return `<nav class="session-tabs" aria-label="Session view"><button type="button" data-action="conversation" aria-pressed="${conversation}">Conversation</button><button type="button" data-action="changes" aria-pressed="${!conversation}">Changes <span>${allFiles().length}</span></button></nav>${conversation ? transcript() : `<div class="changes-page">${changesContent()}</div>`}`;
}
function renderB() {
  return `${transcript(true)}<p class="variant-footnote">Changes live with the task that produced them.</p>`;
}
function renderC() {
  if (locationIndex !== null) {
    const location = data().locations[locationIndex];
    return `<div class="locations-page"><button class="text-button location-back" type="button" data-action="locations">${icon('back')}Work locations</button>${scopeHeader(location)}<div class="location-total"><span>${location.files.length} session ${location.files.length === 1 ? 'file' : 'files'}</span>${stats(location.files)}</div>${fileList(location.files)}<p class="scope-note">Paths are relative to this work location. Only captured session edits appear.</p>${exclusions()}</div>`;
  }
  return `<div class="locations-page"><div class="locations-intro"><h2>Where the work happened</h2><p>The session's starting folder is not its change scope.</p></div><div class="starting-location"><span>Session started in</span><code>${data().start}</code></div>${data().locations.length ? `<div class="location-route" aria-label="Actual work locations">${data().locations.map((location, index) => `<button class="work-location" type="button" data-location="${index}"><span class="work-location-icon">${icon('folder')}</span><span class="work-location-body"><span class="work-location-title"><strong>${location.name}</strong><span class="location-kind">${location.kind}</span></span><span class="branch-name">${icon('branch')}${location.branch}</span><code>${location.path}</code><span class="work-location-count">${location.files.length} session ${location.files.length === 1 ? 'file' : 'files'} ${stats(location.files)}</span></span>${icon('chevron')}</button>`).join('')}</div><p class="scope-note">Open a location to review its session edits, including committed files.</p>` : emptyState()}${exclusions()}</div>`;
}
function reviewTabs() {
  return `<nav class="session-tabs review-tabs" aria-label="Session view"><button type="button" data-action="conversation" aria-pressed="${conversation}">Conversation</button><button type="button" data-action="changes" aria-pressed="${!conversation}">Changes <span>${allFiles().length}</span></button></nav>`;
}
function locationDetails(locations) {
  return `<details class="review-location-details"><summary aria-label="Work location details"><span class="worktree-badge">${icon('branch')}<span class="location-name"><strong>${locations.length === 1 ? locations[0].name : locations.length + ' worktrees'}</strong></span>${icon('chevron')}</span></summary><div>${locations.map(location => `<p><strong>${location.name}</strong><span class="location-kind">${location.kind}</span><span class="branch-name">${location.branch}</span><code class="location-path">${location.path}</code><span class="folder-scope">${location.scope}</span></p>`).join('')}</div></details>`;
}
function selectedDiff(entry) {
  return `<section class="compact-diff" aria-label="Selected file diff"><div class="review-diff-state"><span>${entry.file.state}</span>${stats([entry.file])}</div>${diffCode(entry.file)}</section>`;
}
function renderD() {
  const task = reviewTasks()[reviewTask], entries = taskEntries();
  if (conversation) return reviewTabs() + transcript();
  if (!task) return reviewTabs() + emptyState();
  return `${reviewTabs()}<div class="focused-review"><div class="review-heading"><select id="review-task" data-review-task aria-label="Review task">${reviewTasks().map((item, index) => `<option value="${index}" ${index === reviewTask ? 'selected' : ''}>${item.title}</option>`).join('')}</select>${locationDetails(task.locations)}</div><div class="review-file-list" aria-label="Task files">${entries.map((entry, index) => `<button type="button" data-review-file="${index}" aria-pressed="${index === reviewFile}"><span>${entry.file.name}${task.locations.length > 1 ? `<small>${entry.location.name}</small>` : ''}</span>${index === reviewFile ? icon('check') : stats([entry.file])}</button>`).join('')}</div>${selectedDiff(entries[reviewFile])}<p class="review-footnote">Session edits only · 1 shared file excluded</p></div>`;
}
function renderE() {
  const entries = taskEntries(), selected = entries[reviewFile];
  return `<div class="linked-workspace"><section class="linked-chat" aria-label="Sample conversation"><div class="sample-user">Keep each task separate so I can review its changes.</div><p>${selected ? `Captured edits for <strong>${selected.task.title}</strong>. Other tasks stay separate.` : 'No session edits have been captured yet.'}</p></section>${linkedReviewOpen ? `<section class="inline-review" aria-label="Changes beside the conversation"><header><h2>Session changes</h2><button class="icon-button" type="button" data-action="toggle-linked" aria-label="Hide changes">${icon('close')}</button></header>${selected ? `<div class="review-task-strip" aria-label="Review task">${reviewTasks().map((task, index) => `<button type="button" data-review-task="${index}" aria-pressed="${index === reviewTask}">${task.shortTitle}</button>`).join('')}</div><div class="inline-file-picker"><select data-review-file aria-label="File to review">${entries.map((entry, index) => `<option value="${index}" ${index === reviewFile ? 'selected' : ''}>${reviewTasks()[reviewTask].locations.length > 1 ? entry.location.name + ' / ' : ''}${entry.file.name}</option>`).join('')}</select>${locationDetails([selected.location])}</div><div class="inline-code">${selectedDiff(selected)}</div>` : emptyState()}</section>` : `<button type="button" class="reopen-review" data-action="toggle-linked">${icon('diff')}Review ${allFiles().length} session files${icon('chevron')}</button>`}<div class="linked-composer"><label class="sr-only" for="sample-message">Sample message, not connected</label><input id="sample-message" readonly placeholder="Message this session…"><span aria-hidden="true">${icon('send')}</span></div></div>`;
}
function renderF() {
  const entries = reviewEntries();
  if (conversation) return reviewTabs() + transcript();
  if (!entries.length) return reviewTabs() + emptyState();
  if (inspectorIndex !== null) {
    const entry = entries[inspectorIndex];
    return `${reviewTabs()}<div class="file-inspector"><button type="button" class="text-button" data-action="file-list">${icon('back')}Back to files</button><h2>${entry.file.name}</h2><div class="inspector-context"><span class="inspector-task">${entry.task.title}</span>${locationDetails([entry.location])}</div>${selectedDiff(entry)}</div>`;
  }
  return `${reviewTabs()}<div class="file-browser"><div class="browser-heading"><h2>Session files</h2><select data-worktree-filter aria-label="Filter worktrees"><option value="-1">All worktrees</option>${data().locations.map((location, index) => `<option value="${index}" ${worktreeFilter === index ? 'selected' : ''}>${location.name}</option>`).join('')}</select></div>${data().locations.filter((location, index) => worktreeFilter === -1 || worktreeFilter === index).map(location => `<section class="browser-location" aria-label="Files in ${location.name}"><h3><span class="worktree-badge">${icon('branch')}${location.name}</span></h3>${entries.map((entry, index) => entry.location.path === location.path ? `<button type="button" class="browser-file" data-inspect-file="${index}"><span><strong>${entry.file.name}</strong><small>${entry.task.shortTitle} · ${entry.file.state}</small></span>${stats([entry.file])}${icon('chevron')}</button>` : '').join('')}</section>`).join('')}</div>`;
}
function render() {
  const current = variants.find(item => item.key === variant);
  document.querySelector('#variant-label').textContent = `${current.key} · ${current.name}`;
  document.querySelector('#variant-description').textContent = current.description;
  document.querySelector('#prototype-project').textContent = data().project;
  document.querySelector('.conversation-heading h1').textContent = data().tasks ? 'Polish the mobile experience' : 'Fix mobile navigation';
  document.querySelector('#scenario').value = scenario;
  document.querySelector('#scope-locations').innerHTML = data().locations.map(location => `<p><strong>${location.name}</strong><span>${location.branch}</span><code>${location.path}</code></p>`).join('');
  view.dataset.variant = variant;
  document.body.dataset.reviewRound = 'DEF'.includes(variant) ? 'compact' : 'initial';
  view.innerHTML = current.render();
  view.scrollTop = 0;
  document.querySelector('#sheet-content').innerHTML = changesContent();
}
function readURL() {
  const params = new URLSearchParams(location.search);
  variant = variants.some(item => item.key === params.get('variant')) ? params.get('variant') : 'A';
  scenario = Object.hasOwn(scenarios, params.get('scenario')) ? params.get('scenario') : 'worktree';
  conversation = false; locationIndex = null; resetReview();
  render();
}
function updateURL() {
  const url = new URL(location.href);
  url.searchParams.set('variant', variant); url.searchParams.set('scenario', scenario);
  history.replaceState(null, '', url);
}
function cycle(direction) {
  const options = 'DEF'.includes(variant) ? variants.slice(3) : variants.slice(0, 3);
  const index = options.findIndex(item => item.key === variant);
  variant = options[(index + direction + options.length) % options.length].key;
  conversation = false; locationIndex = null; resetReview();
  updateURL(); render(); window.scrollTo(0, 0);
}
document.querySelector('#previous-variant').addEventListener('click', () => cycle(-1));
document.querySelector('#next-variant').addEventListener('click', () => cycle(1));
document.querySelector('#scenario').addEventListener('change', event => {
  scenario = event.target.value; locationIndex = null; resetReview(); updateURL(); render();
});
document.querySelector('#scope-info').addEventListener('click', event => {
  const explanation = document.querySelector('#scope-explanation');
  explanation.hidden = !explanation.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!explanation.hidden));
});
document.querySelector('#close-sheet').addEventListener('click', () => sheet.close());
view.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.action === 'review') { sheet.showModal(); return; }
  if (button.dataset.action === 'conversation') conversation = true;
  if (button.dataset.action === 'changes') conversation = false;
  if (button.dataset.action === 'locations') locationIndex = null;
  if (button.hasAttribute('data-location')) locationIndex = Number(button.dataset.location);
  if (button.hasAttribute('data-review-task')) { reviewTask = Number(button.dataset.reviewTask); reviewFile = 0; }
  if (button.hasAttribute('data-review-file')) reviewFile = Number(button.dataset.reviewFile);
  if (button.hasAttribute('data-inspect-file')) inspectorIndex = Number(button.dataset.inspectFile);
  if (button.dataset.action === 'file-list') inspectorIndex = null;
  if (button.dataset.action === 'toggle-linked') linkedReviewOpen = !linkedReviewOpen;
  render();
  if (button.dataset.action === 'conversation' || button.dataset.action === 'changes') view.querySelector(`[data-action="${button.dataset.action}"]`).focus({ preventScroll: true });
  if (button.hasAttribute('data-location')) view.querySelector('.location-back').focus({ preventScroll: true });
  if (button.dataset.action === 'locations') view.querySelector('[data-location]')?.focus({ preventScroll: true });
  for (const name of ['review-task', 'review-file']) {
    if (button.hasAttribute('data-' + name)) view.querySelector(`[data-${name}="${button.getAttribute('data-' + name)}"]`)?.focus({ preventScroll: true });
  }
  if (button.hasAttribute('data-inspect-file')) view.querySelector('[data-action="file-list"]').focus({ preventScroll: true });
  if (button.dataset.action === 'file-list') view.querySelector('[data-inspect-file]')?.focus({ preventScroll: true });
  if (button.dataset.action === 'toggle-linked') view.querySelector('[data-action="toggle-linked"]').focus({ preventScroll: true });
});
view.addEventListener('change', event => {
  if (event.target.matches('select[data-review-task]')) { reviewTask = Number(event.target.value); reviewFile = 0; }
  else if (event.target.matches('select[data-review-file]')) reviewFile = Number(event.target.value);
  else if (event.target.matches('select[data-worktree-filter]')) worktreeFilter = Number(event.target.value);
  else return;
  const selector = event.target.matches('[data-review-task]') ? 'select[data-review-task]' : event.target.matches('[data-review-file]') ? 'select[data-review-file]' : 'select[data-worktree-filter]';
  render(); view.querySelector(selector)?.focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || sheet.open || event.target.closest('input, textarea, select, [contenteditable], .code-scroll')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); }
});
window.addEventListener('popstate', readURL);
readURL();
