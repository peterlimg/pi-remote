// This document runs with scripts but without same-origin access or network connections.
// shortcut: tiny omits mindmaps, architecture and math; use full Mermaid when those are needed.
window.addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'render-diagram') return;
  const { id, source, dark } = event.data;
  if (!Number.isSafeInteger(id) || typeof source !== 'string') return;
  const container = document.getElementById('diagram');
  const colors = dark
    ? { background: '#100d10', node: '#243a50', group: '#172237', alternate: '#202e43', border: '#b7a575', edge: '#a9b7c9', text: '#edf1f6' }
    : { background: '#fafaf8', node: '#e6eef5', group: '#f0f3f6', alternate: '#e5ebf1', border: '#806b42', edge: '#536577', text: '#182b3a' };
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: 50000, maxEdges: 500,
      theme: 'base', look: 'classic', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      themeVariables: {
        darkMode: dark, background: colors.background,
        primaryColor: colors.node, primaryTextColor: colors.text, primaryBorderColor: colors.border,
        secondaryColor: colors.alternate, secondaryTextColor: colors.text, secondaryBorderColor: colors.border,
        tertiaryColor: colors.group, tertiaryTextColor: colors.text, tertiaryBorderColor: colors.border,
        mainBkg: colors.node, textColor: colors.text, lineColor: colors.edge,
        stateBkg: colors.node, stateBorder: colors.border, stateLabelColor: colors.text,
        compositeBackground: colors.group, compositeTitleBackground: colors.group, altBackground: colors.alternate,
        edgeLabelBackground: colors.background, stateEdgeLabelBackground: colors.background, transitionLabelColor: colors.text,
        noteBkgColor: colors.alternate, noteBorderColor: colors.border, noteTextColor: colors.text,
        specialStateColor: colors.border, innerEndBackground: colors.background,
        useGradient: false, nodeShadow: false, dropShadow: 'none'
      },
      secure: ['secure', 'securityLevel', 'startOnLoad', 'htmlLabels', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'theme', 'fontFamily'] });
    const { svg } = await mermaid.render('diagram-' + id, source, container);
    parent.postMessage({ type: 'diagram-result', id, svg }, '*');
  } catch {
    parent.postMessage({ type: 'diagram-result', id }, '*');
  } finally { container.replaceChildren(); }
});
parent.postMessage({ type: 'diagram-ready' }, '*');
