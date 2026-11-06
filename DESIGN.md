# Pi Remote interface

The production reference is `web/index.html` with `web/style.css`. This record describes that existing language, not approval of an orchestration layout.

## Typography and controls

Use the platform system sans for interface text and the existing monospace stack for paths, code, and measurements. Primary content is larger than metadata. Keep touch targets at least 44 pixels. Reuse existing SVG stroke conventions and native focus behavior.

## Themes

Use the production custom properties for text, muted text, backgrounds, panels, lines, selection, accent, and warnings. Follow the device's light/dark preference until the user chooses a mode with the sun/moon toggle. Remember that choice in the browser, including on the login screen. Keep status meaning readable without color alone.

## Diagrams

Mermaid diagrams use flat shapes, thin warm borders, muted blue group backgrounds, and high-contrast connectors. Match the app's light/dark mode and system typography. Preserve author-defined state colors rather than inventing status meanings. No gradients, glow, or drop shadows. Show a bounded loading placeholder instead of raw source, retain finished diagram nodes across unrelated updates, and keep source available behind its disclosure. The existing image viewer owns zoom and pan.

## Composer

The production composer is an invariant in the coordinator study. Copy its exact markup and load the production stylesheet without overriding its subtree. Session identity and recipient information belong outside it. Attachments, drafts, model settings, and Stop belong to the selected session.

## Codemode work log

Codemode activity uses Sol's connected work-log layout. Show each run's status and recorded duration, reveal output before the script, and preserve disclosure state during streaming. A leading script comment supplies the run title; otherwise use a numbered JavaScript run. Do not infer executed inner tools or successful checks from source code.

## Coordinator interaction

Any ordinary session coordinates workers when asked, without setup, a separate conversation, or reduced parent permissions. Preserve its identity, history, model, and tools. The user selected C for production: a collapsible coordinator/worker tree immediately above the composer, visible once workers exist. All instructions and replies remain in the main coordinator conversation. Worker logs and task details are read-only, retain the same tree, and offer an explicit return. Keep sibling states current during inspection. The existing composer remains unchanged for normal and coordinator sessions; worker inspection hides it.

## Coordinator study boundary

The workspace exploration lives only at `/coordinator-prototype.html`. Its route-specific direction contract is `.impeccable/surfaces/web-coordinator-prototype-html.md`. The study compares a plain worker list, inline details, and a coordinator/worker session tree above the composer. Variant D explores a working answer with cited source logs, inline decisions, and immutable revisions. Incoming findings wait for an explicit display update rather than rewriting text while it is being read. The coordinator is the only recipient of human input in this study. It presents questions, relays instructions, and confirms their destination in the main conversation. Worker logs are read-only and retain an explicit return to the coordinator. Earlier worker-window studies remain in Git. The study's data is simulated and does not establish production capabilities or design acceptance.
