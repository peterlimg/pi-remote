(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let theme;
  try { theme = localStorage.getItem('pi-remote-theme'); } catch {}
  if (theme !== 'light' && theme !== 'dark') theme = undefined;

  function applyTheme() {
    const dark = theme ? theme === 'dark' : system.matches;
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]').content = dark ? '#100d10' : '#fafaf8';
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }
  // Run before the stylesheet so a saved choice is used on the first paint.
  applyTheme();
  system.addEventListener('change', applyTheme);
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage || event.key !== 'pi-remote-theme' && event.key !== null) return;
    theme = ['light', 'dark'].includes(event.newValue) ? event.newValue : undefined;
    applyTheme();
  });
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    for (const button of document.querySelectorAll('.theme-toggle')) button.addEventListener('click', () => {
      theme = (theme ? theme === 'dark' : system.matches) ? 'light' : 'dark';
      try { localStorage.setItem('pi-remote-theme', theme); } catch {}
      applyTheme();
    });
  });
})();
