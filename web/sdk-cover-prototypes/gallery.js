// PROTOTYPE ONLY: this gallery is not part of the production article or app.
const keys = ['A', 'B', 'C'];
const names = { A: 'A. Assembly', B: 'B. Overprint', C: 'C. Signal print' };
const requested = new URLSearchParams(location.search).get('variant');
const variant = keys.includes(requested) ? requested : 'all';
document.body.classList.toggle('single', variant !== 'all');
for (const figure of document.querySelectorAll('[data-cover]')) figure.hidden = variant !== 'all' && figure.dataset.cover !== variant;
document.querySelector('#selection').textContent = names[variant] || 'All three';
for (const link of document.querySelectorAll('[data-step]')) {
  const delta = Number(link.dataset.step);
  const index = variant === 'all' ? (delta > 0 ? 0 : 2) : (keys.indexOf(variant) + delta + keys.length) % keys.length;
  link.href = `?variant=${keys[index]}`;
}
document.addEventListener('keydown', event => {
  if (event.target.closest('input,textarea,select,[contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  const delta = event.key === 'ArrowLeft' ? '-1' : event.key === 'ArrowRight' ? '1' : null;
  if (delta) { event.preventDefault(); location.href = document.querySelector(`[data-step="${delta}"]`).href; }
});
