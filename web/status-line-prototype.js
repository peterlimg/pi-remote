// Throwaway prototype: sample numbers shaped like Pi's get_session_stats plus the latest assistant usage.
const scenarios = {
  warm: { input: 18200, output: 6400, cacheRead: 1420000, cacheWrite: 96000, hit: 97.3, cost: 1.284, context: 38.2, window: 400000 },
  miss: { input: 21000, output: 7100, cacheRead: 1420000, cacheWrite: 251000, hit: 4.1, cost: 2.106, context: 41.0, window: 400000 },
  full: { input: 40100, output: 22800, cacheRead: 8900000, cacheWrite: 380000, hit: 99.1, cost: 6.912, context: 91.4, window: 400000 },
  sub: { input: 18200, output: 6400, cacheRead: 1420000, cacheWrite: 96000, hit: 97.3, cost: 1.284, sub: true, context: 38.2, window: 400000 },
  fresh: undefined,
};

const variants = [
  { key: 'A', name: 'Terminal line', description: 'Pi footer, verbatim, under the composer. Tap for details.' },
  { key: 'B', name: 'Plain words', description: 'Only the three numbers that matter, under the composer.' },
  { key: 'C', name: 'Dual ring', description: 'No new row. Inner ring is cache hit; tap the ring.' },
  { key: 'D', name: 'Header subtitle', description: 'Lives in the title pill, away from the keyboard.' },
  { key: 'E', name: 'Cache bar', description: 'Thin row inside the composer: what the last prompt was made of.' },
];

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let variant = variants.some(v => v.key === params.get('variant')) ? params.get('variant') : 'A';
let scenario = params.get('scenario') in scenarios ? params.get('scenario') : 'warm';

// Same thresholds as Pi's footer formatTokens.
function tokens(count) {
  if (count < 1000) return `${count}`;
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}
const level = s => s.context > 90 ? 'error' : s.context > 70 ? 'warning' : '';
const hitLevel = s => s.hit < 50 ? 'warning' : '';
const cost = (s, digits = 3) => `$${s.cost.toFixed(digits)}${s.sub ? ' (sub)' : ''}`;

function terminalLine(s) {
  return `<span>↑${tokens(s.input)}</span><span>↓${tokens(s.output)}</span><span>R${tokens(s.cacheRead)}</span><span>W${tokens(s.cacheWrite)}</span>` +
    `<span class="${hitLevel(s)}">CH${s.hit.toFixed(1)}%</span><span>${cost(s)}</span><span class="${level(s)}">${s.context.toFixed(1)}%/${tokens(s.window)}</span>`;
}

function ring(s) {
  const arc = (r, pct, cls) => `<circle class="${cls}" cx="12" cy="12" r="${r}" pathLength="100" stroke="currentColor" stroke-dasharray="${pct} 100" transform="rotate(-90 12 12)"/>`;
  const inner = variant === 'C' && s ? `<circle class="usage-track" cx="12" cy="12" r="5"/>${arc(5, s.hit, `cache-arc ${hitLevel(s)}`)}` : '';
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke-width="2.5"><circle class="usage-track" cx="12" cy="12" r="9"/>${s ? arc(9, s.context, level(s)) : ''}${inner}</svg>`;
}

function render() {
  const s = scenarios[scenario], current = variants.find(v => v.key === variant);
  $('variant-label').textContent = `${current.key} · ${current.name}`;
  $('variant-description').textContent = current.description;
  $('scenario').value = scenario;
  document.body.dataset.variant = variant;
  $('above-composer').innerHTML = $('inside-top').innerHTML = $('below-composer').innerHTML = '';
  $('header-sub').textContent = 'pi-remote';
  $('usage-meter').innerHTML = ring(s);
  history.replaceState(null, '', `?variant=${variant}&scenario=${scenario}`);
  if (!s) return;
  if (variant === 'A') $('below-composer').innerHTML = `<button type="button" class="status-line terminal" data-sheet>${terminalLine(s)}</button>`;
  if (variant === 'B') $('below-composer').innerHTML = `<button type="button" class="status-line words" data-sheet>` +
    `<span class="${hitLevel(s)}">${Math.round(s.hit)}% cached</span><span>${cost(s, 2)}</span><span class="${level(s)}">${Math.round(s.context)}% context</span></button>`;
  if (variant === 'D') $('header-sub').innerHTML = `pi-remote · <span class="${hitLevel(s)}">${Math.round(s.hit)}% cached</span> · ${cost(s, 2)}`;
  if (variant === 'E') {
    // Latest prompt split: read from cache, written to cache, uncached input (sample proportions).
    const write = s.hit < 50 ? 100 - s.hit - 2 : Math.max(1, (100 - s.hit) * .7);
    $('inside-top').innerHTML = `<button type="button" class="cache-row" data-sheet aria-label="Cache usage">` +
      `<span class="cache-bar"><i class="read"></i><i class="write"></i><i class="fresh"></i></span>` +
      `<span class="${hitLevel(s)}">${Math.round(s.hit)}% cached</span></button>`;
    document.querySelector('.cache-bar .read').style.width = `${s.hit}%`;
    document.querySelector('.cache-bar .write').style.width = `${write}%`;
  }
}

function sheet() {
  const s = scenarios[scenario];
  $('sheet-content').innerHTML = s ? `
    <div class="sheet-stats">
      <div><small>Cache hit · last turn</small><strong class="${hitLevel(s)}">${s.hit.toFixed(1)}%</strong></div>
      <div><small>Context</small><strong class="${level(s)}">${s.context.toFixed(1)}%</strong><small>of ${tokens(s.window)}</small></div>
      <div><small>${s.sub ? 'Cost (subscription)' : 'Cost'}</small><strong>${cost(s, 2).replace(' (sub)', '')}</strong></div>
    </div>
    <dl>
      <dt>↑ Input</dt><dd>${s.input.toLocaleString()}</dd>
      <dt>↓ Output</dt><dd>${s.output.toLocaleString()}</dd>
      <dt>R Cache read</dt><dd>${s.cacheRead.toLocaleString()}</dd>
      <dt>W Cache write</dt><dd>${s.cacheWrite.toLocaleString()}</dd>
    </dl>
    ${s.hit < 50 ? '<p class="hint warning">The last turn rebuilt the cache. This usually follows a model switch, compaction, or a long idle gap.</p>' : ''}
    <p class="hint">Terminal footer</p><p class="status-line terminal static">${terminalLine(s)}</p>` : '<p class="hint">No usage yet.</p>';
  $('sheet').showModal();
}

$('prev').onclick = () => { variant = variants[(variants.findIndex(v => v.key === variant) + variants.length - 1) % variants.length].key; render(); };
$('next').onclick = () => { variant = variants[(variants.findIndex(v => v.key === variant) + 1) % variants.length].key; render(); };
$('scenario').onchange = event => { scenario = event.target.value; render(); };
$('keyboard').onchange = event => { document.body.dataset.keyboard = event.target.checked; };
$('close-sheet').onclick = () => $('sheet').close();
$('sheet').onclick = event => { if (event.target === $('sheet')) $('sheet').close(); };
document.addEventListener('click', event => {
  if (event.target.closest('[data-sheet]') || (variant === 'C' && event.target.closest('#usage-meter'))) sheet();
});
document.body.dataset.keyboard = 'true';
render();
