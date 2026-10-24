// Throwaway comparison on the existing app route. All conversations and changes are synthetic.
import { demoToken, demoKey, demoSessions } from './ui-style-prototype-data.js';
const root = document.documentElement;
const design = root.dataset.design;
const params = new URLSearchParams(location.search);
let original = params.get('variant') === 'original';
let dark = params.get('theme') ? params.get('theme') === 'dark' : design === 'floating' || matchMedia('(prefers-color-scheme: dark)').matches;
localStorage.setItem('pi-remote-token', demoToken);
localStorage.setItem('pi-remote-key', demoKey);
const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const name = design === 'sage' ? 'A · Sage cards' : 'B · Floating workspace';
const descriptions = {
  sage: 'Project filters · inset session cards · softer sheets',
  floating: 'Floating header · compact active cards · layered sheets'
};
const banner = make('header', undefined, 'prototype-banner');
const identity = make('div');
identity.append(make('strong', name), make('span', 'Design preview · Sample data only'));
const theme = make('button', undefined, 'prototype-theme'); theme.type = 'button';
const themeIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
theme.innerHTML = themeIcon;
banner.append(identity, theme); document.body.append(banner);
const filters = make('nav', undefined, 'prototype-filters prototype-extra');
filters.setAttribute('aria-label', 'Filter sessions by project');
// shortcut: chip counts describe the seeded sample; derive live counts before promoting the prototype.
const sampleSessions = demoSessions();
for (const project of ['', 'pi-remote', 'storefront', 'docs']) {
  const count = project ? sampleSessions.filter(item => item.cwd.endsWith('/' + project)).length : sampleSessions.length;
  const button = make('button', undefined, 'prototype-filter'); button.type = 'button'; button.dataset.project = project;
  button.setAttribute('aria-pressed', String(!project));
  button.append(make('span', project || 'All'), make('span', String(count), 'prototype-filter-count'));
  button.addEventListener('click', () => {
    for (const sibling of filters.children) sibling.setAttribute('aria-pressed', String(sibling === button));
    $('search').value = project; $('search').dispatchEvent(new Event('input', { bubbles: true }));
  });
  filters.append(button);
}
document.querySelector('.brand').after(filters);
const switcher = make('nav', undefined, 'prototype-switcher');
switcher.setAttribute('aria-label', 'Compare with the current design');
const previous = make('button', undefined); previous.type = 'button'; previous.setAttribute('aria-label', 'Previous design');
previous.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';
const switchLabel = make('button', undefined, 'prototype-compare'); switchLabel.type = 'button';
const label = make('strong'), detail = make('span'); label.setAttribute('aria-live', 'polite');
switchLabel.append(label, detail);
const next = make('button', undefined); next.type = 'button'; next.setAttribute('aria-label', 'Next design');
next.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>';
switcher.append(previous, switchLabel, next); document.body.append(switcher);
function apply() {
  root.dataset.variant = original ? 'original' : design;
  root.dataset.theme = dark ? 'dark' : 'light';
  theme.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  for (const node of document.querySelectorAll('.prototype-extra')) node.hidden = original;
  label.textContent = original ? 'Original · current Pi Remote' : name;
  detail.textContent = original ? 'Tap to return to the prototype' : descriptions[design];
  const url = new URL(location.href); url.searchParams.set('variant', original ? 'original' : design); url.searchParams.set('theme', dark ? 'dark' : 'light');
  history.replaceState(history.state, '', url);
}
function cycle() { original = !original; apply(); }
for (const button of [previous, switchLabel, next]) button.addEventListener('click', cycle);
theme.addEventListener('click', () => { dark = !dark; apply(); });
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(); }
});
// Keep filter selection honest when the app's existing search controls clear or change the query.
$('search').addEventListener('input', () => {
  for (const button of filters.children) button.setAttribute('aria-pressed', String(button.dataset.project === $('search').value));
});
const tabs = make('nav', undefined, 'prototype-settings-tabs prototype-extra');
tabs.setAttribute('aria-label', 'Model settings sections');
for (const [label, control, panel] of [['Model', 'model', 'Choose a model'], ['Effort', 'reasoning-control', 'Choose reasoning effort']]) {
  const button = make('button', label); button.type = 'button'; button.setAttribute('aria-label', label + ' tab');
  button.addEventListener('click', () => { if ($('settings-picker').getAttribute('aria-label') !== panel) $(control).click(); });
  tabs.append(button);
  new MutationObserver(() => button.setAttribute('aria-pressed', String($('settings-picker').getAttribute('aria-label') === panel)))
    .observe($('settings-picker'), { attributes: true, attributeFilter: ['aria-label'] });
}
$('settings-picker').prepend(tabs);
apply();
await import('./app.js');
