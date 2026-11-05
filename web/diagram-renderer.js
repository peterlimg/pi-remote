// This document runs with scripts but without same-origin access or network connections.
// shortcut: tiny omits mindmaps, architecture and math; use full Mermaid when those are needed.
window.addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'render-diagram') return;
  const { id, source, dark } = event.data;
  if (!Number.isSafeInteger(id) || typeof source !== 'string') return;
  const container = document.getElementById('diagram');
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: 50000, maxEdges: 500,
      theme: dark ? 'dark' : 'default', fontFamily: 'Arial, sans-serif',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'htmlLabels', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'theme', 'fontFamily'] });
    const { svg } = await mermaid.render('diagram-' + id, source, container);
    parent.postMessage({ type: 'diagram-result', id, svg }, '*');
  } catch {
    parent.postMessage({ type: 'diagram-result', id }, '*');
  } finally { container.replaceChildren(); }
});
parent.postMessage({ type: 'diagram-ready' }, '*');
