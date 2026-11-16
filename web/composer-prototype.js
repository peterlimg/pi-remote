// Three isolated composer studies, switchable via ?variant=A|B|C. No transport or persistence.
import markdownit from '/markdown-it.mjs';
const $ = id => document.getElementById(id);
const study = document.querySelector('.study');
const markdown = markdownit({ html: false, breaks: true }).disable('image');
const sample = 'Build the first version of the expanded composer.\n\n## Keep it small\n- Preserve the existing quick-message input\n- Add a full-screen draft and Markdown preview\n- Keep `/` for Pi commands\n\nVerify with:\n```sh\nnpm run test:browser -- test/browser/composer.spec.mjs\n```';
const variants = [
  { key: 'A', name: 'Inline tools', description: 'Quick formatting without leaving the chat.', title: 'Your draft', note: 'Stay in the conversation.' },
  { key: 'B', name: 'Writing sheet', description: 'More room for a detailed instruction.', title: 'Room to write', note: 'One draft. Back to chat whenever you like.' },
  { key: 'C', name: 'Live preview', description: 'Edit the source. See how it reads.', title: 'Write and check', note: 'Markdown stays the source of truth.' },
];
let variant = variants.find(item => item.key === new URL(location.href).searchParams.get('variant')) || variants[0];
let preview = false, tools = false, collapsed = false;
$('draft').value = sample;
function updateDraft() {
  const rendered = markdown.render($('draft').value);
  $('inline-preview').innerHTML = rendered;
  $('live-preview').innerHTML = rendered;
  $('send').disabled = !$('draft').value.trim();
}
function render() {
  study.dataset.variant = variant.key;
  study.classList.toggle('collapsed', collapsed);
  $('variant-label').textContent = `${variant.key} · ${variant.name}`;
  $('variant-description').textContent = variant.description;
  $('writing-title').textContent = variant.title;
  $('writing-note').textContent = variant.note;
  $('collapse').hidden = variant.key !== 'B' || collapsed;
  $('expand').hidden = variant.key !== 'B' || !collapsed;
  $('draft').hidden = preview;
  $('inline-preview').hidden = !preview;
  $('write-tab').setAttribute('aria-pressed', String(!preview));
  $('preview-tab').setAttribute('aria-pressed', String(preview));
  document.querySelector('.preview-pane').hidden = variant.key !== 'C';
  $('formatting').hidden = preview || (variant.key === 'A' || collapsed) && !tools;
  $('format-toggle').setAttribute('aria-expanded', String(tools));
  $('format-toggle').setAttribute('aria-label', tools ? 'Hide formatting' : 'Show formatting');
  const url = new URL(location.href); url.searchParams.set('variant', variant.key); history.replaceState(null, '', url);
  updateDraft();
}
function cycle(direction) {
  variant = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length];
  preview = false; collapsed = false; tools = false;
  render();
  $('feedback').textContent = 'Same draft, different layout. Nothing is sent or saved.';
}
$('previous').onclick = () => cycle(-1);
$('next').onclick = () => cycle(1);
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); }
});
$('write-tab').onclick = () => { preview = false; render(); $('draft').focus(); };
$('preview-tab').onclick = () => { preview = true; render(); };
$('format-toggle').onclick = () => { tools = !tools; preview = false; render(); };
$('collapse').onclick = () => { collapsed = true; preview = false; render(); $('expand').focus(); };
$('expand').onclick = () => { collapsed = false; render(); $('draft').focus(); };
$('draft').addEventListener('input', updateDraft);
for (const button of document.querySelectorAll('[data-format]')) {
  button.onmousedown = event => event.preventDefault();
  button.onclick = () => {
    const input = $('draft'), start = input.selectionStart, end = input.selectionEnd;
    const selected = input.value.slice(start, end);
    const formats = {
      bold: ['**', selected || 'important', '**'],
      list: ['\n', (selected || 'New requirement').split('\n').map(line => '- ' + line).join('\n'), '\n'],
      code: ['\n```\n', selected || 'npm run check', '\n```\n'],
      quote: ['\n', (selected || 'Context to include').split('\n').map(line => '> ' + line).join('\n'), '\n'],
      link: ['[', selected || 'reference', '](https://example.com)'],
    };
    const [before, text, after] = formats[button.dataset.format];
    input.setRangeText(before + text + after, start, end, 'end');
    input.focus(); input.setSelectionRange(start + before.length, start + before.length + text.length);
    updateDraft();
    $('feedback').textContent = 'Formatting inserted as Markdown. Nothing sent.';
  };
}
$('reset').onclick = () => {
  $('draft').value = sample; $('sample-sent').hidden = true; updateDraft();
  $('feedback').textContent = 'Sample draft restored. Nothing sent.';
};
$('send').onclick = () => {
  $('sample-sent').innerHTML = markdown.render($('draft').value);
  $('sample-sent').classList.add('rendered'); $('sample-sent').hidden = false;
  $('feedback').textContent = 'Simulated send only. Your draft is kept. No agent was contacted.';
};
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
$('theme').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
};
function viewport() { document.documentElement.style.setProperty('--study-height', `${window.visualViewport?.height || window.innerHeight}px`); }
window.visualViewport?.addEventListener('resize', viewport);
window.addEventListener('resize', viewport);
viewport(); render();
