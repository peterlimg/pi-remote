import { mount as mountSol } from './codemode-sol-prototype.js';
import { mount as mountAstra } from './codemode-astra-prototype.js';

// Shared read-only study chrome. Each model owns only its transcript and codemode UI.
const variants = [
  { key: 'sol', name: 'Sol 6.1 · Max', mount: mountSol },
  { key: 'astra', name: 'Astra 6 · High', mount: mountAstra }
];
const root = document.querySelector('#study-thread');
const selector = document.querySelector('#sample-state');
let index = 0;

function render() {
  const params = new URLSearchParams(location.search);
  index = Math.max(0, variants.findIndex(item => item.key === params.get('variant')));
  selector.value = ['done', 'working', 'error', 'empty'].includes(params.get('state')) ? params.get('state') : 'done';
  const variant = variants[index];
  root.replaceChildren();
  variant.mount(root, { state: selector.value });
  root.scrollTop = 0;
  document.body.dataset.model = variant.key;
  const label = document.querySelector('#variant-label');
  label.replaceChildren(document.createTextNode(variant.name));
  const hint = document.createElement('small');
  hint.textContent = `Independent design · ${index + 1} of ${variants.length}`;
  label.append(hint);
  document.querySelector('#variant-description').textContent = 'Same sample runs. No tools are executing.';
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

// Preserve production composer markup/styles; it is intentionally inert.
document.querySelector('#composer').hidden = false;
document.querySelector('#prompt').placeholder = 'Type / for commands';
document.querySelector('#model-name').textContent = 'GPT-6.1 Sol';
document.querySelector('#reasoning-value').textContent = 'Max';
for (const id of ['model', 'reasoning-control', 'fast-mode', 'usage-meter']) document.getElementById(id).hidden = false;
document.querySelector('#abort').hidden = true;
render();
