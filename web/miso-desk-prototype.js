// Throwaway: Miso ranks what needs you and keeps the rest quiet. Sample data only; nothing talks to the host.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// Copied from app.js sessionKinds/botSvg so the prototype uses the production artwork and moods.
const kinds = {
  miso: ['<rect x="5" y="10" width="22" height="19" rx="8"/>', [[12, 19], [20, 19]],
    '<path class="character-cat-tail" d="M24 26c10 1 8-10 3-7"/><g class="character-cat-ear"><path class="bot-body" d="M6 14 5 3Q7 1 13 10Z"/></g><g class="character-cat-ear character-cat-ear-right"><path class="bot-body" d="m19 10 6-8q3 1 1 12Z"/></g>'],
  mochi: ['<path d="M16 10C8 10 2 16 2 23c0 5 6 7 14 7s14-2 14-7c0-7-6-13-14-13Z"/>', [[11.5, 21], [20.5, 21]], ''],
  bun: ['<circle cx="16" cy="20" r="10"/>', [[12, 20], [20, 20]], '<g class="character-ear"><rect class="bot-body" x="8" y="2" width="5" height="13" rx="2.5"/></g><g class="character-ear character-ear-right"><rect class="bot-body" x="19" y="4" width="5" height="11" rx="2.5"/></g>'],
  sprout: ['<rect x="4" y="10" width="24" height="19" rx="9"/>', [[12, 19], [20, 19]],
    '<path class="bot-stalk" d="M16 11V6"/><path class="bot-body character-leaf character-leaf-left" d="M16 7C10 7 7 4 8 1c5 0 8 2 8 6Z"/><path class="bot-accent character-leaf character-leaf-right" d="M16 8c0-5 3-7 8-7 0 4-3 7-8 7Z"/>'],
  zig: ['<path d="M16 5q2 0 4 4l8 15q2 5-3 5H7q-5 0-3-5l8-15q2-4 4-4Z"/>', [[12, 21], [20, 21]],
    '<g class="character-zig-foot"><rect class="bot-body" x="7" y="26" width="7" height="5" rx="2"/></g><g class="character-zig-foot character-zig-foot-right"><rect class="bot-body" x="18" y="26" width="7" height="5" rx="2"/></g>'],
};
function bot(kind, mood = 'idle', size = 28) {
  const [body, eyes, back] = kinds[kind];
  const face = eyes.map(([x, y]) => `<ellipse class="bot-eye" cx="${x}" cy="${y}" rx="2.1" ry="2.9"/><circle class="bot-shine" cx="${x + .7}" cy="${y - 1.1}" r=".7"/>`).join('');
  const badge = mood === 'waiting' ? '<g class="bot-badge"><circle cx="27" cy="5" r="4.5"/><path d="M27 2.8v2.6M27 7.3v.1"/></g>' : '';
  const node = el('span', '', 'bot personality-bot'); node.dataset.kind = kind; node.dataset.mood = mood;
  node.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g class="bot-figure">${back}<g class="bot-body">${body}</g><g class="bot-eyes"><g class="bot-look">${face}</g></g></g>${badge}</svg>`;
  return node;
}

// Shaped like the real check-ins of 14 Nov: 21 finished turns from 6 sessions, zero host questions.
// Every ask below was buried at the end of a "finished" reply.
const sessions = {
  aws: { kind: 'zig', short: 'AWS sign-in', title: 'Run AWS SSO login in next-frontend', goal: 'login' },
  swipe: { kind: 'bun', short: 'Miso screen', title: 'Review cat avatar bot concept', goal: 'miso' },
  glass: { kind: 'mochi', short: 'Glass UI', title: 'Check glass-like UI of Claude Code', goal: 'glass' },
  icons: { kind: 'sprout', short: 'Session icons', title: 'Prototype animation icons in session panel', goal: 'icons' },
  miso: { kind: 'miso', short: 'Miso', title: 'Miso noticed', goal: 'ci' },
};
const goals = {
  login: 'Sign in to next-frontend',
  miso: 'Make Miso worth opening',
  glass: 'Glass look like Claude',
  ci: 'Keep pi-remote CI green',
  icons: 'Animated session icons',
};
const minutesLeft = () => Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
const initialAsks = () => [
  { id: 'aws', s: 'aws', score: 100, ask: 'Finish AWS sign-in before the link expires',
    why: () => minutesLeft() ? `Link expires in ${minutesLeft()} min` : 'Link expired. Miso asked for a new one',
    detail: 'Tap a field in the live page, type in the bottom box, press Enter, then tell it you’re done.',
    brief: [['Your ', 'aws', ' link expires in ', () => `${minutesLeft()} minutes`, '. Finish signing in, then tell it you’re done.']],
    actions: [{ label: 'Open sign-in', primary: true, keep: true, result: 'Prototype: opens the private sign-in page.' }, { label: 'I’m done', result: 'Sent “done” to AWS sign-in.' }] },
  { id: 'build', s: 'swipe', score: 80, ask: 'Build a frozen Miso screen behind the swipe?', why: () => 'Stopped to ask you 40 min ago',
    detail: 'The catch: if Miso changed while you were away, the copy is briefly out of date.',
    brief: [['', 'swipe', ' stopped 40 minutes ago to ask whether to build a frozen Miso screen behind the swipe.']],
    actions: [{ label: 'Build it', primary: true, result: 'Sent “Yes, build it” to Miso screen.' }, { label: 'Not now', result: 'Told Miso screen to hold off.' }] },
  { id: 'glass', s: 'glass', score: 60, ask: 'Real lens effect, or the lighter CSS look?', why: () => 'It recommends the lens effect',
    detail: 'The lens effect matches Claude but needs native work. The lighter CSS is a quick change without the bending.',
    brief: [['', 'glass', ' needs a pick: the real lens effect (its recommendation) or the quicker CSS look.']],
    actions: [{ label: 'Lens effect', primary: true, result: 'Sent “Go with the lens effect” to Glass UI.' }, { label: 'Lighter CSS', result: 'Sent “Use the lighter CSS” to Glass UI.' }] },
  { id: 'ci', s: 'miso', score: 40, ask: 'CI has failed on the last 16 pushes to pi-remote', why: () => '3 sessions pushed past it since Nov 12',
    detail: 'Draft for a new session: fix conversation-overflow, fast-mode and the unloaded-session composer spec, then push and report.',
    brief: [['CI has been red for 16 pushes across 3 sessions. I can start one to fix it.']],
    actions: [{ label: 'Start a fix session', primary: true, result: 'Started “Fix pi-remote CI”. Miso will report back.' }, { label: 'Ignore', result: 'Miso won’t raise CI again unless it changes.' }] },
  { id: 'phone', s: 'miso', score: 30, ask: 'Try 4 changes on your iPhone', why: () => 'Collected from 3 replies that said “not checked on a phone”',
    checks: [['swipe', 'Swipe back to Miso in the Home Screen app'], ['swipe', 'Blue dot clears after you read a session'],
      ['glass', 'New-session sheet uses the glass style'], ['glass', 'Glass blur looks right in Safari']],
    brief: [['Four changes were never tried on a phone. I merged them into one checklist.']] },
];
const initialQuiet = () => [
  { s: 'swipe', count: 6, line: 'Pushed 3 fixes: back to Miso, no list flash, unread dot.' },
  { s: 'glass', count: 4, line: 'Hit a rate limit at 12:51, recovered on its own by 2:05.' },
  { s: 'aws', count: 2, line: 'Opened the live sign-in page.' },
  { s: 'icons', count: 1, line: 'Saved the icons handoff. No repo changes.' },
];
const simulations = [
  { quiet: { s: 'glass', line: 'Restyled menus and sheets in both themes.' }, toast: 'Glass UI finished a turn. Nothing for you in it, so Miso kept it quiet.' },
  { ask: { id: 'motion', s: 'icons', score: 70, fresh: true, ask: 'Ship the Bounce or the Calm icon motion?', why: () => 'New · it can’t continue without a pick',
    brief: [['', 'icons', ' just asked: ship the Bounce or the Calm motion?']],
    actions: [{ label: 'Bounce', primary: true, result: 'Sent “Bounce” to Session icons.' }, { label: 'Calm', result: 'Sent “Calm” to Session icons.' }] },
    toast: 'Session icons asked something. Miso ranked it above the glass choice.' },
];
const notes = {
  desk: 'Miso picks the one thing worth doing now, then two more. Everything else waits behind a count, and finished work collapses to a single line per session.',
  brief: 'Miso writes a short note, like a chief of staff: the two things that need you, then what it is holding back and why. Answer inside the sentence.',
  goals: 'Grouped by what you are trying to get done, not by session. Each goal says where it stands and its single next step.',
};
let variant, asks, quiet, resolved, checked, simStep, expiresAt, toastTimer, undo;

const ranked = () => asks.filter(item => !resolved.has(item.id)).sort((a, b) => b.score - a.score);
// Only time-critical or blocking asks earn the top slot; the rest never interrupt.
const urgent = item => item.score >= 80;
function tiers() {
  const list = ranked(), now = list[0] && urgent(list[0]) ? list[0] : undefined, rest = now ? list.slice(1) : list;
  return { now, next: rest.slice(0, 2), later: rest.slice(2) };
}

function toast(text, restore) {
  $('toast-text').textContent = text; $('toast').hidden = false;
  undo = restore; $('toast-undo').hidden = !restore;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; undo = undefined; }, 3200);
}
function resolve(item, action) {
  if (action.keep) return toast(action.result);
  resolved.set(item.id, action.result);
  toast(action.result, () => { resolved.delete(item.id); render(); });
  render();
}
function actionBar(item, small = false) {
  const bar = el('div', '', small ? 'actions small' : 'actions');
  for (const action of item.actions || []) {
    const button = el('button', action.label, action.primary ? 'act primary' : 'act'); button.type = 'button';
    button.addEventListener('click', () => resolve(item, action));
    bar.append(button);
  }
  return bar;
}
// Phone checks report back to the session that made the change.
function checklist(item) {
  const list = el('ul', '', 'checks');
  for (const [s, text] of item.checks) {
    const key = item.id + text, li = el('li'), state = checked.get(key);
    li.append(bot(sessions[s].kind, 'idle', 20), el('span', text, 'check-text'));
    if (state) li.append(el('span', state === 'works' ? 'Works' : 'Reported', 'check-state'));
    else for (const [label, value, mark] of [['Works', 'works', '✓'], ['Broken', 'broken', '✕']]) {
      const button = el('button', mark, 'act mark'); button.type = 'button';
      button.setAttribute('aria-label', `${label}: ${text}`); button.title = label;
      button.addEventListener('click', () => {
        checked.set(key, value);
        if (value === 'broken') toast(`Miso will tell ${sessions[s].short} and ask what you saw.`);
        if (item.checks.every(([, other]) => checked.has(item.id + other))) resolved.set(item.id, 'All 4 checked.');
        render();
      });
      li.append(button);
    }
    list.append(li);
  }
  return list;
}
const meta = item => { const p = el('p', '', 'meta'); p.append(el('span', sessions[item.s].short, 'meta-name'), el('span', item.why(), item.score >= 100 ? 'meta-why hot' : 'meta-why')); return p; };

// The top card animates only when a different ask takes the slot, never on a refresh.
let shownNow;
function nowCard(item) {
  const card = el('article', '', item.id !== shownNow && shownNow !== undefined ? 'now arriving' : 'now');
  shownNow = item.id;
  const head = el('div', '', 'now-head');
  head.append(bot(sessions[item.s].kind, 'waiting', 32), meta(item));
  card.append(head, el('h2', item.ask, 'now-ask'));
  if (item.detail) card.append(el('p', item.detail, 'now-detail'));
  card.append(item.checks ? checklist(item) : actionBar(item));
  return card;
}
function askRow(item) {
  const row = el('article', '', 'row' + (item.fresh ? ' fresh' : ''));
  const body = el('div', '', 'row-body');
  body.append(el('h3', item.ask, 'row-ask'), meta(item));
  if (item.checks) body.append(checklist(item));
  else if (item.id === 'ci') { body.append(el('p', item.detail, 'row-detail')); body.append(actionBar(item, true)); }
  else body.append(actionBar(item, true));
  row.append(bot(sessions[item.s].kind, item.checks || item.s === 'miso' ? 'idle' : 'waiting'), body);
  return row;
}
const quietCount = () => quiet.reduce((sum, item) => sum + item.count, 0);
function quietFold(title) {
  const fold = el('details', '', 'fold quiet');
  const summary = el('summary'); summary.append(el('span', title || 'Handled quietly'), el('span', `${quietCount()} updates · ${new Set(quiet.map(item => item.s)).size} sessions`, 'fold-count'));
  fold.append(summary);
  for (const item of quiet) {
    const line = el('p', '', 'quiet-line'); line.append(bot(sessions[item.s].kind, 'idle', 20), el('b', sessions[item.s].short), el('span', item.line));
    fold.append(line);
  }
  return fold;
}
function laterFold(items) {
  const fold = el('details', '', 'fold');
  const summary = el('summary'); summary.append(el('span', `${items.length} more can wait`), el('span', items.map(item => sessions[item.s].short === 'Miso' ? (item.checks ? 'Phone checks' : 'CI') : sessions[item.s].short).join(', '), 'fold-count'));
  fold.append(summary, ...items.map(askRow));
  return fold;
}
function doneList() {
  const done = asks.filter(item => resolved.has(item.id));
  if (!done.length) return [];
  const list = el('div', '', 'done');
  for (const item of done) list.append(el('p', `✓ ${resolved.get(item.id)}`, 'done-line'));
  return [list];
}
function clear() {
  const box = el('div', '', 'clear');
  box.append(bot('miso', 'idle', 44), el('h2', 'Nothing needs you right now'), el('p', 'I’ll only interrupt for a question, a deadline or something going wrong.'));
  return box;
}

const views = {
  desk() {
    const { now, next, later } = tiers(), out = [];
    out.push(now ? nowCard(now) : next.length ? el('p', 'Nothing urgent. When you have a minute:', 'calm') : clear());
    if (next.length) { const section = el('section', '', 'next'); section.append(...next.map(askRow)); out.push(section); }
    if (later.length) out.push(laterFold(later));
    out.push(...doneList(), quietFold());
    return out;
  },
  brief() {
    const { now, next, later } = tiers(), top = [now, ...next].filter(Boolean).slice(0, 2), held = [...[now, ...next].filter(Boolean).slice(2), ...later];
    const note = el('article', '', 'brief');
    note.append(el('p', `Since you looked at 9:40 · ${quietCount() + asks.length} updates`, 'brief-time'));
    if (!top.length) note.append(clear());
    else note.append(el('p', top.length === 1 ? 'One thing needs you.' : 'Two things need you.', 'brief-lead'));
    for (const item of top) {
      const p = el('p', '', 'brief-line' + (item.fresh ? ' fresh' : ''));
      for (const part of item.brief[0]) p.append(sessions[part] ? chip(item.s) : typeof part === 'function' ? el('b', part()) : part);
      note.append(p, item.checks ? checklist(item) : actionBar(item, true));
    }
    for (const item of asks.filter(item => resolved.has(item.id))) note.append(el('p', resolved.get(item.id), 'brief-line done-line'));
    if (held.length) {
      const fold = el('details', '', 'fold');
      const names = held.map(item => item.checks ? 'a phone checklist' : item.id === 'ci' ? 'red CI' : item.id === 'glass' ? 'a glass style pick' : `a ${sessions[item.s].short} question`);
      const summary = el('summary'); summary.append(el('span', `I’m holding ${held.length} that can wait: ${names.join(', ')}.`, 'brief-held'));
      fold.append(summary, ...held.map(askRow));
      note.append(fold);
    }
    note.append(quietFold('Everything else went fine'));
    return [note];
  },
  goals() {
    const byGoal = new Map(Object.keys(goals).map(goal => [goal, { asks: [], quiet: [] }]));
    for (const item of ranked()) byGoal.get(item.s === 'miso' ? (item.checks ? 'miso' : 'ci') : sessions[item.s].goal).asks.push(item);
    for (const item of quiet) byGoal.get(sessions[item.s].goal).quiet.push(item);
    const order = [...byGoal].sort(([, a], [, b]) => (b.asks[0]?.score ?? -1) - (a.asks[0]?.score ?? -1));
    return order.map(([goal, { asks: open, quiet: done }]) => {
      const card = el('article', '', 'goal'), first = open[0];
      const state = first ? (urgent(first) ? 'Waiting on you' : 'Needs a decision soon') : 'Moving on its own';
      card.dataset.state = first ? (urgent(first) ? 'now' : 'soon') : 'fine';
      const head = el('div', '', 'goal-head'), faces = el('span', '', 'goal-faces');
      for (const s of new Set([...open, ...done].map(item => item.s))) faces.append(bot(sessions[s].kind, open.some(item => item.s === s && urgent(item)) ? 'waiting' : 'idle', 22));
      head.append(el('h2', goals[goal]), faces);
      card.append(head, el('p', first ? `${state} · ${first.why()}` : `${state}${done.length ? ` · ${done.map(item => item.line.replace(/\.$/, '')).join('; ')}` : ''}`, 'goal-state'));
      if (first) {
        const step = el('div', '', 'goal-step'); step.append(el('p', `Next: ${first.ask}`, 'goal-next'), first.checks ? checklist(first) : actionBar(first, true));
        card.append(step);
        if (open.length > 1) card.append(el('p', `+${open.length - 1} more in this goal`, 'goal-more'));
      }
      return card;
    });
  },
};
function chip(s) {
  const button = el('button', '', 'chip'); button.type = 'button';
  button.append(bot(sessions[s].kind, 'idle', 18), el('span', sessions[s].short));
  button.addEventListener('click', () => toast(`Prototype: opens “${sessions[s].title}”.`));
  return button;
}

function render() {
  for (const tab of document.querySelectorAll('[role=tab]')) tab.setAttribute('aria-selected', String(tab.dataset.variant === variant));
  $('variant-note').textContent = notes[variant];
  const open = new Set([...document.querySelectorAll('#view details[open]')].map(node => node.className + node.querySelector('summary').textContent.slice(0, 12)));
  $('view').replaceChildren(...views[variant]());
  for (const node of document.querySelectorAll('#view details')) if (open.has(node.className + node.querySelector('summary').textContent.slice(0, 12))) node.open = true;
  // The header counts only what is urgent, so it agrees with every view.
  const hot = ranked().filter(urgent).length;
  $('top-sub').textContent = hot ? `${hot} urgent` : ranked().length ? 'Nothing urgent' : 'All clear';
  $('top-bot').replaceChildren(bot('miso', hot ? 'waiting' : 'idle', 32));
  $('simulate').disabled = simStep >= simulations.length;
}
function restart() {
  asks = initialAsks(); quiet = initialQuiet(); resolved = new Map(); checked = new Map(); simStep = 0;
  expiresAt = Date.now() + 11 * 60000; shownNow = undefined;
  render();
}

for (const tab of document.querySelectorAll('[role=tab]')) tab.addEventListener('click', () => {
  variant = tab.dataset.variant; history.replaceState(null, '', `?variant=${variant}`); render();
});
$('simulate').addEventListener('click', () => {
  const step = simulations[simStep++];
  if (step.quiet) {
    const existing = quiet.find(item => item.s === step.quiet.s);
    if (existing) { existing.count++; existing.line = step.quiet.line; } else quiet.push({ ...step.quiet, count: 1 });
  }
  if (step.ask) asks.push(step.ask);
  toast(step.toast); render();
});
$('restart').addEventListener('click', restart);
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
$('theme').addEventListener('click', () => { dark = !dark; document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; });
$('toast-undo').addEventListener('click', () => { undo?.(); $('toast').hidden = true; });
$('composer').addEventListener('submit', event => { event.preventDefault(); $('input').value = ''; toast('Prototype: Miso answers above the composer, then the answer folds away.'); });
setInterval(render, 30000); // keeps the sign-in countdown honest

variant = new URLSearchParams(location.search).get('variant');
if (!notes[variant]) variant = 'desk';
restart();
