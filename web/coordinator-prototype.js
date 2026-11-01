// Synthetic, in-memory UI only. This module intentionally has no app or transport imports.
const variants = [
  { key: 'A', name: 'Conversation first', description: 'Task updates live in the thread' },
  { key: 'B', name: 'Attention first', description: 'Decisions and results before the chat' },
  { key: 'C', name: 'Task strip', description: 'Keep the chat; pull one task into focus' }
];
const $ = id => document.getElementById(id);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const chevron = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const statusLabel = task => ({ running: 'Running', question: 'Needs permission', result: 'Result ready', stopped: 'Stopped · unverified' })[task.status];
const status = task => `<span class="task-status" data-status="${task.status}"><i aria-hidden="true"></i>${statusLabel(task)}</span>`;
const action = (name, id, label, classes = 'text-action') => `<button type="button" class="${classes}" data-action="${name}" data-task="${id}">${label}</button>`;
function initialState() {
  return {
    tasks: [
      { id: 'A', short: 'Navigation', title: 'Fix mobile navigation', status: 'running',
        summary: 'Tracing the back gesture on iPhone.',
        detail: 'Comparing swipe thresholds with vertical scrolling. No result has been reported yet.',
        scope: 'Inspect and adjust mobile navigation. Do not publish.', tool: 'read · web/app.js', replies: [] },
      { id: 'B', short: 'Login', title: 'Simplify login', status: 'question', permission: 'pending',
        summary: 'May I change the saved-login format?',
        detail: 'This could sign existing users out. I can keep the format and only change the labels instead.',
        scope: 'Improve login copy. Ask before changing saved data.', tool: 'read · web/pairing.js', replies: [] },
      { id: 'C', short: 'Touch targets', title: 'Review touch targets', status: 'result',
        summary: 'Two controls need larger tap targets.',
        detail: 'The image close button and session menu are smaller than 44 × 44 px in this synthetic review.',
        scope: 'Review touch target sizes. Report findings; do not edit.', tool: 'read · web/style.css', replies: [] },
      { id: 'D', short: 'Reconnect', title: 'Check reconnect behavior', status: 'stopped',
        summary: 'Stopped before a final report.',
        detail: 'The sample session went quiet. Partial changes and completion are unknown; this is not a successful result.',
        scope: 'Inspect reconnect behavior. Do not replay uncertain actions.', tool: 'Sample trace unavailable', replies: [] }
    ],
    events: [], drafts: {}, target: 'coordinator', selected: 'B', tab: 'attention', view: 'coordinator', activeTask: null
  };
}
let state = initialState(), variant, decision;
const taskById = id => state.tasks.find(task => task.id === id);
const needsAttention = () => state.tasks.filter(task => task.status === 'question' || task.status === 'result' && !task.reviewed).length;
const announce = text => { $('demo-feedback').textContent = text; };

function taskActions(task, compact = false) {
  return `<div class="task-actions">${action('reply', task.id, `Reply to ${task.id}`, 'reply-action')}
    ${task.permission === 'pending' ? action('permission', task.id, 'Review permission', 'permission-action') : ''}
    ${compact ? action('open', task.id, 'Details ' + chevron) : action('session', task.id, 'Sample session') + (['running', 'question'].includes(task.status) ? action('stop', task.id, `Stop Task ${task.id}`, 'text-action stop-action') : '')}</div>`;
}
function taskUpdate(task) {
  return `<article class="task-update ${task.status === 'question' ? 'question-update' : ''}" data-task-id="${task.id}">
    <div class="task-meta">${action('open', task.id, `Task ${task.id} · ${escape(task.short)}`)}${status(task)}</div>
    <p>${escape(task.summary)}</p>
    ${task.status === 'question' ? `<p class="supporting">${escape(task.detail)}</p>${taskActions(task, true)}` :
      task.status === 'result' ? `<p class="supporting">Worker-reported, not verified.</p>${action('open', task.id, 'Read result ' + chevron)}` :
        action('open', task.id, (task.status === 'stopped' ? 'Inspect uncertain work ' : 'View task ') + chevron)}
  </article>`;
}
function eventMarkup(event) {
  if (event.kind === 'task') return taskUpdate(taskById(event.task));
  return `<article class="chat-message ${event.role === 'user' ? 'user-message' : 'coordinator-message'}">${event.target ? `<div class="message-recipient">${escape(event.target)}</div>` : ''}<p>${escape(event.text)}</p></article>`;
}
function conversation(inlineTasks = false) {
  return `<section class="conversation-scroll scroll-region" aria-label="Coordinator conversation" tabindex="0">
    <article class="chat-message user-message"><p>Fix navigation and simplify login in parallel.</p></article>
    <article class="chat-message coordinator-message"><span class="speaker">Coordinator</span><p>I’ll keep them separate. You can keep talking here while each task runs.</p></article>
    ${inlineTasks ? state.tasks.slice(0, 4).map(taskUpdate).join('') : `<p class="conversation-context">${variant.key === 'B' ? 'Questions and reports stay in Needs you.' : 'Select a task above to see its latest update.'}</p>`}
    ${state.events.map(eventMarkup).join('')}
  </section>`;
}
function variantA() {
  return `<div class="layout-conversation"><div class="activity-summary" aria-label="Sample task overview">${state.tasks.filter(task => task.status === 'running').length} running <span>·</span> ${state.tasks.filter(task => task.status === 'question').length} question <span>·</span> ${state.tasks.filter(task => task.status === 'result').length} result <span>·</span> ${state.tasks.filter(task => task.status === 'stopped').length} unverified</div>${conversation(true)}</div>`;
}
function taskRow(task) {
  return `<button type="button" class="task-row" data-action="open" data-task="${task.id}" data-task-id="${task.id}"><span><strong>Task ${task.id} · ${escape(task.short)}</strong><small>${escape(task.summary)}</small></span><span>${status(task)}${chevron}</span></button>`;
}
function attentionQueue() {
  const questions = state.tasks.filter(task => task.status === 'question');
  const results = state.tasks.filter(task => task.status === 'result' && !task.reviewed);
  return `<section class="attention-scroll scroll-region" aria-label="Task attention queue" tabindex="0">
    <h2 class="view-title">${questions.length ? 'A decision is waiting' : 'No decisions waiting'}</h2>
    ${questions.length ? questions.map(task => `<article class="attention-question" data-task-id="${task.id}">
      <div class="task-meta">${action('open', task.id, `Task ${task.id} · ${escape(task.short)}`)}${status(task)}</div>
      <h3>${escape(task.summary)}</h3><p>${escape(task.detail)}</p>${taskActions(task, true)}
      <p class="permission-note">Nothing is approved until you explicitly choose.</p>
    </article>`).join('') : '<p class="supporting">You can leave a new request with the coordinator.</p>'}
    <section class="ready-results"><h2>Ready to review${results.length ? ` <span>${results.length}</span>` : ''}</h2>
      ${results.length ? results.map(task => `<article data-task-id="${task.id}"><div class="task-meta"><span>Task ${task.id} · ${escape(task.short)}</span>${status(task)}</div><h3>${escape(task.summary)}</h3><p class="supporting">Worker-reported result · not independently verified.</p>${action('open', task.id, 'Read result ' + chevron)}</article>`).join('') : '<p class="supporting">No unread sample results.</p>'}
    </section>
    <section class="elsewhere"><h2>Other tasks</h2>${state.tasks.filter(task => task.status !== 'question' && (task.status !== 'result' || task.reviewed)).map(taskRow).join('')}</section>
  </section>`;
}
function variantB() {
  return `<div class="layout-attention"><nav class="attention-tabs" aria-label="Coordinator views"><button type="button" data-action="attention" aria-pressed="${state.tab === 'attention'}">Needs you <span>${needsAttention()}</span></button><button type="button" data-action="conversation" aria-pressed="${state.tab === 'conversation'}">Conversation</button></nav>${state.tab === 'attention' ? attentionQueue() : conversation()}</div>`;
}
function variantC() {
  const selected = taskById(state.selected);
  return `<div class="layout-strip"><nav class="task-strip" aria-label="Select a sample task">${state.tasks.map(task => `<button type="button" data-action="select" data-task="${task.id}" data-task-id="${task.id}" aria-pressed="${task.id === state.selected}"><strong>${task.id} · ${escape(task.short)}</strong>${status(task)}</button>`).join('')}</nav>
    ${conversation()}
    ${selected ? `<section class="selected-task" aria-label="Selected task ${selected.id}"><header><h2>Task ${selected.id} · ${escape(selected.title)}</h2>${action('collapse', selected.id, 'Hide', 'text-action')}</header><p>${escape(selected.summary)}</p>${selected.permission === 'pending' ? '<p class="permission-note">Replying does not grant permission.</p>' : `<p class="supporting">${selected.status === 'result' ? 'Worker-reported result · not verified.' : selected.status === 'stopped' ? 'Outcome unknown. Inspect before continuing.' : 'Other tasks continue independently.'}</p>`}${taskActions(selected, true)}</section>` : ''}
  </div>`;
}
function taskDetail(task) {
  return `<section class="task-detail scroll-region" aria-label="Task ${task.id} details" tabindex="0">
    <div class="detail-context"><span>Task ${task.id} · Worker ${task.id}</span>${status(task)}</div>
    <h2 class="view-title" tabindex="-1">${escape(task.title)}</h2>
    <p class="task-scope">${escape(task.scope)}</p>
    <section class="latest-report"><h3>${task.status === 'question' ? 'Permission needed' : task.status === 'result' ? 'Reported result' : task.status === 'stopped' ? 'Outcome unknown' : 'Latest update'}</h3><p class="report-summary">${escape(task.summary)}</p><p>${escape(task.detail)}</p>
      ${task.status === 'result' ? '<ul class="result-findings"><li>Image close: 32 × 32 px</li><li>Session menu: 36 × 36 px</li><li>Recommendation: at least 44 × 44 px</li></ul><p class="supporting">Synthetic measurements, not a real audit. Nothing has been changed or independently verified.</p>' : ''}
      ${task.permission === 'pending' ? '<p class="permission-note">A text reply leaves this permission unanswered.</p>' : ''}
      ${taskActions(task)}
      ${task.status === 'result' ? action('reviewed', task.id, task.reviewed ? 'Marked as read' : 'Mark result as read') : ''}
    </section>
    <section class="task-replies"><h3>Replies to Task ${task.id}</h3>${task.replies.length ? task.replies.map(reply => `<article class="task-reply"><span>You → Worker ${task.id}</span><p>${escape(reply)}</p></article>`).join('') : '<p class="supporting">No replies in this demo yet.</p>'}</section>
    <p class="local-only">Sample task state only. No files, agents, or real sessions are connected.</p>
  </section>`;
}
function sampleSession(task) {
  return `<section class="sample-session scroll-region" aria-label="Sample session for Task ${task.id}" tabindex="0">
    <h2 class="view-title" tabindex="-1">Worker ${task.id} · sample session</h2>
    <p class="session-notice">Read-only synthetic transcript. Not a live connection.</p>
    <div class="session-identity"><strong>Task ${task.id} · ${escape(task.title)}</strong>${status(task)}<code>sample-worker-${task.id.toLowerCase()}</code></div>
    <article class="chat-message user-message"><div class="message-recipient">Coordinator → Worker ${task.id}</div><p>${escape(task.scope)}</p></article>
    ${task.id !== 'D' ? `<details class="sample-tool"><summary>Sample trace: ${escape(task.tool)}</summary><pre>Illustrative file inspection only.
No filesystem was read by this prototype.</pre></details>` : '<p class="supporting">No final trace is available in this sample.</p>'}
    <article class="chat-message coordinator-message"><span class="speaker">Worker ${task.id}</span><p>${escape(task.summary)}</p><p>${escape(task.detail)}</p></article>
    ${task.replies.map(reply => `<article class="chat-message user-message"><div class="message-recipient">You → Worker ${task.id}</div><p>${escape(reply)}</p></article>`).join('')}
    ${action('return', task.id, 'Return to coordinator ' + chevron, 'return-action')}
  </section>`;
}
function render({ focus = false, bottom = false, keepPosition = false } = {}) {
  const previousPosition = keepPosition ? document.querySelector('.conversation-scroll')?.scrollTop : 0;
  const task = taskById(state.activeTask);
  $('prototype-view').dataset.variant = variant.key;
  $('prototype-view').innerHTML = state.view === 'session' ? sampleSession(task) : state.view === 'task' ? taskDetail(task) : ({ A: variantA, B: variantB, C: variantC })[variant.key]();
  $('return-coordinator').hidden = state.view === 'coordinator';
  $('variant-label').textContent = `${variant.key} · ${variant.name}`;
  $('variant-description').textContent = variant.description;
  const recipient = taskById(state.target);
  $('message-form').hidden = state.view === 'session' || state.view === 'task' && !recipient;
  $('message-form').classList.toggle('task-targeted', Boolean(recipient));
  $('composer-target').textContent = recipient ? `To Task ${recipient.id} · ${recipient.short} only` : 'To Coordinator · new request';
  $('cancel-reply').hidden = !recipient;
  $('message-input').placeholder = recipient ? `Reply to Worker ${recipient.id}…` : 'Ask for something else…';
  $('message-input').value = state.drafts[state.target] || '';
  $('send-message').firstChild.textContent = recipient ? 'Reply' : 'Send';
  $('composer-note').textContent = recipient?.permission === 'pending' ? 'Demo reply only. Permission stays unanswered.' : recipient?.status === 'stopped' ? 'Demo reply only. This task will stay stopped.' : 'Demo only. No agents run; nothing is sent or saved.';
  $('send-message').disabled = !$('message-input').value.trim();
  if (focus) (document.querySelector('.view-title[tabindex]') || document.querySelector('.scroll-region')).focus({ preventScroll: true });
  const thread = document.querySelector('.conversation-scroll');
  if (thread) thread.scrollTop = bottom ? thread.scrollHeight : previousPosition || 0;
  if (bottom && state.view === 'task') {
    const detail = document.querySelector('.task-detail');
    detail.scrollTop = detail.scrollHeight;
  }
}
function returnToCoordinator() {
  state.view = 'coordinator'; state.activeTask = null; state.target = 'coordinator';
  render({ focus: true });
}
function openDecision(kind, task) {
  decision = { kind, taskId: task.id };
  $('decision-title').textContent = kind === 'stop' ? `Stop Task ${task.id} only?` : `Allow Task ${task.id} to change saved login?`;
  $('decision-description').textContent = kind === 'stop' ? `${task.title} will be marked stopped and unverified. Other tasks and the coordinator are unaffected.` : 'Changing the saved-login format could sign existing users out. Choose explicitly; a reply or closing this dialog does not approve it.';
  $('decision-actions').innerHTML = `<button type="button" class="text-action" data-decision="cancel" autofocus>Cancel</button>${kind === 'stop' ? `<button type="button" class="stop-confirm" data-decision="stop">Stop Task ${task.id} in demo</button>` : '<button type="button" class="keep-format" data-decision="deny">Keep saved format</button><button type="button" data-decision="allow">Allow change in demo</button>'}`;
  $('task-decision').showModal();
}
$('task-decision').addEventListener('click', event => {
  const choice = event.target.closest('[data-decision]')?.dataset.decision;
  if (!choice) return;
  const task = taskById(decision.taskId);
  $('task-decision').close();
  if (choice === 'cancel') return;
  let text;
  if (choice === 'stop') {
    task.status = 'stopped'; task.permission = undefined;
    task.summary = 'Stopped in this demo. Partial work is unverified.';
    task.detail = 'No completion report was received. Nothing was rolled back, resumed, or verified.';
    text = `Task ${task.id} marked stopped in the demo. Other tasks were not changed.`;
  } else {
    task.permission = choice === 'allow' ? 'allowed' : 'denied'; task.status = 'running';
    task.summary = choice === 'allow' ? 'Format change explicitly allowed in this demo.' : 'Saved format stays unchanged. Continuing with labels only.';
    task.detail = 'This is a sample decision, not an actual permission or worker acknowledgement. No saved login data was changed.';
    text = `Task ${task.id}: ${choice === 'allow' ? 'you explicitly allowed the format change' : 'you declined the format change'} (demo only).`;
  }
  state.events.push({ role: 'assistant', text });
  announce(text); render({ focus: true });
});
$('task-decision').addEventListener('close', () => { decision = null; });
$('prototype-view').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const task = taskById(button.dataset.task);
  switch (button.dataset.action) {
    case 'open': state.activeTask = task.id; state.view = 'task'; state.target = 'coordinator'; render({ focus: true }); break;
    case 'select': state.selected = task.id; render({ keepPosition: true }); document.querySelector(`.task-strip [data-task="${task.id}"]`).focus(); break;
    case 'collapse': state.selected = null; render({ keepPosition: true }); document.querySelector('.task-strip button').focus(); break;
    case 'reply':
      state.target = task.id; state.selected = task.id; state.tab = 'conversation'; render({ keepPosition: true });
      $('message-input').focus(); announce(`Reply goes only to Task ${task.id}, Worker ${task.id}.`); break;
    case 'session': state.activeTask = task.id; state.view = 'session'; render({ focus: true }); break;
    case 'stop': openDecision('stop', task); break;
    case 'permission': openDecision('permission', task); break;
    case 'reviewed': task.reviewed = true; announce(`Task ${task.id} result marked as read, not verified.`); render({ focus: true }); break;
    case 'attention': state.tab = 'attention'; state.target = 'coordinator'; render(); document.querySelector('[data-action="attention"]').focus(); break;
    case 'conversation': state.tab = 'conversation'; render(); document.querySelector('[data-action="conversation"]').focus(); break;
    case 'return': returnToCoordinator(); break;
  }
});
$('message-input').addEventListener('input', event => {
  state.drafts[state.target] = event.target.value;
  $('send-message').disabled = !event.target.value.trim();
});
$('message-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('message-input').value.trim();
  if (!text) return;
  const task = taskById(state.target);
  state.events.push({ role: 'user', target: task ? `You → Task ${task.id} · ${task.short}` : 'You → Coordinator', text });
  state.drafts[state.target] = '';
  if (task) {
    task.replies.push(text);
    const note = task.permission === 'pending' ? 'Permission is still unanswered.' : task.status === 'stopped' ? 'It stays stopped; nothing was resumed.' : 'No actual worker received it.';
    const acknowledgement = `Sample reply recorded for Task ${task.id} only. ${note}`;
    state.events.push({ role: 'assistant', text: acknowledgement }); announce(acknowledgement);
  } else {
    const id = String(state.tasks.length + 1);
    const newTask = { id, short: 'New request', title: text, status: 'running', summary: 'New request added to the demo.',
      detail: 'This represents an independent background task. No real worker was started and no progress is being simulated.',
      scope: text, tool: 'No sample trace yet', replies: [] };
    state.tasks.push(newTask);
    state.events.push({ role: 'assistant', text: `In this demo, Task ${id} takes that request. The other tasks keep their own state; no real agent was started.` }, { kind: 'task', task: id });
    announce(`Sample Task ${id} added. Other tasks unchanged.`);
  }
  state.tab = 'conversation'; render({ bottom: true });
});
$('return-coordinator').addEventListener('click', returnToCoordinator);
$('cancel-reply').addEventListener('click', () => { state.target = 'coordinator'; render({ keepPosition: true }); if (!$('message-form').hidden) $('message-input').focus(); });
$('reset-demo').addEventListener('click', () => { state = initialState(); render(); announce('Demo reset. All sample tasks and drafts restored to their initial state.'); });
function setVariant(key) {
  variant = variants.find(item => item.key === key) || variants[0];
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  state.view = 'coordinator'; state.activeTask = null; state.target = 'coordinator'; state.tab = 'attention';
  render();
}
function cycleVariant(direction) {
  setVariant(variants[(variants.indexOf(variant) + direction + variants.length) % variants.length].key);
  announce(`${variant.name}. In-memory sample task state kept.`);
}
$('previous-variant').addEventListener('click', () => cycleVariant(-1));
$('next-variant').addEventListener('click', () => cycleVariant(1));
addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || $('task-decision').open || event.target.closest('input, textarea, select, [contenteditable]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycleVariant(event.key === 'ArrowLeft' ? -1 : 1); }
});
addEventListener('popstate', () => setVariant(new URLSearchParams(location.search).get('variant')));
setVariant(new URLSearchParams(location.search).get('variant'));
