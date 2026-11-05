let renderer, nextId = 0, queue = Promise.resolve();
const pending = new Map(), cache = new Map(), urls = new Map();
function getRenderer() {
  return renderer ||= new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'diagram-renderer'; frame.title = 'Diagram renderer';
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    const fail = () => {
      clearTimeout(timer); window.removeEventListener('message', receive); frame.remove();
      renderer = undefined; reject(new Error('Diagram renderer unavailable'));
    };
    const timer = setTimeout(fail, 30000);
    const receive = event => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'diagram-ready') { clearTimeout(timer); resolve(frame.contentWindow); }
      else if (event.data?.type === 'diagram-result') pending.get(event.data.id)?.(event.data.svg);
    };
    window.addEventListener('message', receive); frame.onerror = fail;
    frame.src = '/diagram-renderer.html'; document.body.append(frame);
  });
}
function diagram(source, dark) {
  const key = JSON.stringify([source, dark]);
  if (!cache.has(key)) {
    const result = queue.then(async () => {
      const target = await getRenderer(), id = ++nextId;
      return new Promise(resolve => {
        const done = svg => { clearTimeout(timer); pending.delete(id); resolve(typeof svg === 'string' ? svg : undefined); };
        const timer = setTimeout(done, 30000);
        pending.set(id, done); target.postMessage({ type: 'render-diagram', id, source, dark }, '*');
      });
    }).catch(() => undefined);
    queue = result; cache.set(key, result);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
export function renderDiagrams(root, openImage, resized) {
  const viewing = document.querySelector('#image-viewer[open] img')?.src;
  for (const [link, url] of urls) if (!link.isConnected && viewing !== url) { URL.revokeObjectURL(url); urls.delete(link); }
  const theme = document.documentElement.dataset.theme;
  const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  for (const code of root.querySelectorAll('.code-block code.language-mermaid')) {
    const pre = code.closest('pre'), status = document.createElement('p');
    status.className = 'diagram-status hint'; status.setAttribute('role', 'status'); status.textContent = 'Rendering diagram…';
    pre.before(status);
    // Let rapid streaming updates settle before asking the renderer to lay out a diagram.
    setTimeout(async () => {
      if (!code.isConnected) return;
      const svg = code.textContent.length <= 50000 && await diagram(code.textContent, dark);
      if (!code.isConnected) return;
      if (!svg) { status.textContent = 'Diagram unavailable. Source shown below.'; return; }
      const link = document.createElement('a'), image = document.createElement('img');
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      link.href = url; link.className = 'mermaid-diagram'; link.setAttribute('aria-label', 'Open diagram');
      image.alt = 'Mermaid diagram'; image.src = url; link.append(image);
      try { await image.decode(); }
      catch { URL.revokeObjectURL(url); status.textContent = 'Diagram unavailable. Source shown below.'; return; }
      if (!code.isConnected) { URL.revokeObjectURL(url); return; }
      link.addEventListener('click', openImage); urls.set(link, url);
      const details = document.createElement('details'), summary = document.createElement('summary');
      details.className = 'diagram-source'; summary.textContent = 'Diagram source'; details.append(summary);
      pre.before(details); details.append(pre); status.replaceWith(link); resized();
    }, 200);
  }
}
