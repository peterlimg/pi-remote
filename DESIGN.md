# Pi Remote interface

The production reference is `web/index.html` with `web/style.css`. This record describes that existing language, not approval of an orchestration layout.

## Typography and controls

Use the platform system sans for interface text and the existing monospace stack for paths, code, and measurements. Primary content is larger than metadata. Keep touch targets at least 44 pixels. Reuse existing SVG stroke conventions and native focus behavior.

## Themes

Use the production custom properties for text, muted text, backgrounds, panels, lines, selection, accent, and warnings. Follow the device's light/dark preference until the user chooses a mode with the sun/moon toggle. Remember that choice in the browser, including on the login screen. Keep status meaning readable without color alone.

## Composer

The production composer is an invariant in the coordinator study. Copy its exact markup and load the production stylesheet without overriding its subtree. Session identity and recipient information belong outside it. Attachments, drafts, model settings, and Stop belong to the selected session.

## Codemode work log

Codemode activity uses Sol's connected work-log layout. Show each run's status and recorded duration, reveal output before the script, and preserve disclosure state during streaming. A leading script comment supplies the run title; otherwise use a numbered JavaScript run. Do not infer executed inner tools or successful checks from source code.

## Coordinator study boundary

The workspace exploration lives only at `/coordinator-prototype.html`. Its route-specific direction contract is `.impeccable/surfaces/web-coordinator-prototype-html.md`. The current study compares a plain worker list, inline details, and a coordinator/worker session tree above the composer. The coordinator is the only recipient of human input in this study. It presents questions, relays instructions, and confirms their destination in the main conversation. Worker logs are read-only and retain an explicit return to the coordinator. Earlier worker-window studies remain in Git. The study's data is simulated and does not establish production capabilities or design acceptance.
