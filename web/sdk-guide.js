const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const toggle = document.querySelector('#motion-toggle');
const figures = [...document.querySelectorAll('[data-motion]')];
const visible = new Set();
let paused = false;
let branchAnimations = [];

function refreshMotion() {
  const stopped = paused || reducedMotion.matches || document.hidden;
  toggle.disabled = reducedMotion.matches;
  toggle.setAttribute('aria-pressed', String(paused || reducedMotion.matches));
  toggle.querySelector('span').textContent = reducedMotion.matches ? 'Reduced motion' : paused ? 'Play motion' : 'Pause motion';
  for (const figure of figures) {
    const playing = !stopped && visible.has(figure);
    figure.dataset.playing = String(playing);
    for (const svg of figure.querySelectorAll('svg')) {
      const shown = svg.getBoundingClientRect().width > 0;
      if (playing && shown) {
        if (!svg.dataset.started) {
          svg.querySelectorAll('animateMotion').forEach(animation => animation.beginElement?.());
          svg.dataset.started = 'true';
          if (svg.querySelector('animateMotion')) figure.dataset.motionStarted = 'true';
        }
        svg.unpauseAnimations?.();
      } else svg.pauseAnimations?.();
    }
  }
  if (reducedMotion.matches) {
    branchAnimations.forEach(animation => animation.cancel());
    branchAnimations = [];
  }
  const branchPlaying = !stopped && visible.has(document.querySelector('.branch-figure'));
  for (const animation of branchAnimations) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    if (branchPlaying) animation.play(); else animation.pause();
  }
}

const operations = {
  compact: {
    title: 'A shorter working context',
    description: "Pi writes a summary and keeps the selected recent history. A fresh SDK context receives that projection; the original audit remains. SDK-native automatic compaction stays disabled.",
    owner: 'Same conversation A', projection: 'Pi summary + kept history',
    desktop: 'M190 78C190 215 500 215 810 215', mobile: 'M55 72C55 210 150 210 270 210'
  },
  clone: {
    title: 'A copy of the completed tip',
    description: "A new Pi chat receives the full selected branch and its own owner-bound receipt. Its first SDK turn opens an independent native context, not the parent's query.",
    owner: 'A becomes a new B', projection: 'Complete selected branch',
    desktop: 'M190 78H810V215', mobile: 'M55 72H305V165Q305 210 270 210'
  },
  fork: {
    title: 'Fork before later work',
    description: 'The new chat receives the selected earlier path, not the later private value. The selected user message returns for editing rather than being submitted automatically.',
    owner: 'A becomes a new B', projection: 'Earlier fact + matched results',
    desktop: 'M190 78H500C590 78 580 215 690 215H810', mobile: 'M55 72H180C240 72 90 210 180 210H270'
  },
  tree: {
    title: 'Another path in the same file',
    description: 'Pi changes the active path after validating both sides. The next SDK turn starts fresh. Returning also creates a fresh native context. An optional Pi summary deliberately carries abandoned information.',
    owner: 'Same conversation A', projection: 'Selected path + optional summary',
    desktop: 'M190 78H500C610 78 610 215 810 215', mobile: 'M55 72H180C270 72 130 210 270 210'
  }
};

const branch = document.querySelector('.branch-figure');
branch.setAttribute('data-motion', '');
figures.push(branch);
const operationSwitch = branch.querySelector('.operation-switch');
operationSwitch.hidden = false;
operationSwitch.addEventListener('click', event => {
  const button = event.target.closest('button[data-operation]');
  if (!button || !Object.hasOwn(operations, button.dataset.operation)) return;
  const key = button.dataset.operation, operation = operations[key];
  branch.dataset.operation = key;
  operationSwitch.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('#operation-title').textContent = operation.title;
  document.querySelector('#operation-description').textContent = operation.description;
  document.querySelector('#operation-owner').textContent = operation.owner;
  branch.querySelectorAll('[data-branch-field="projection"]').forEach(label => { label.textContent = operation.projection; });
  branchAnimations.forEach(animation => animation.cancel());
  branchAnimations = [];
  branch.querySelectorAll('[data-branch-path]').forEach(path => {
    path.setAttribute('d', operation[path.dataset.branchPath]);
    if (!reducedMotion.matches && !paused && !document.hidden) {
      const length = path.getTotalLength();
      branchAnimations.push(path.animate([{ strokeDasharray: String(length), strokeDashoffset: length }, { strokeDasharray: String(length), strokeDashoffset: 0 }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' }));
    }
  });
  refreshMotion();
});

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); });
  refreshMotion();
}, { threshold: .12 });
figures.forEach(figure => observer.observe(figure));
toggle.hidden = false;
toggle.addEventListener('click', () => { paused = !paused; refreshMotion(); });
reducedMotion.addEventListener('change', refreshMotion);
document.addEventListener('visibilitychange', refreshMotion);
window.addEventListener('resize', refreshMotion);
document.documentElement.classList.add('motion-ready');
refreshMotion();
