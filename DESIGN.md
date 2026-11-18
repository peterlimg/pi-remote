# Pi Remote interface

The production reference is `web/index.html` with `web/style.css`. This record describes that existing language, not approval of an orchestration layout.

## Typography and controls

Use the platform system sans for interface text and the existing monospace stack for paths, code, and measurements. Primary content is larger than metadata. Keep touch targets at least 44 pixels. Reuse existing SVG stroke conventions and native focus behavior.

## Themes

Use the production custom properties for text, muted text, backgrounds, panels, lines, selection, accent, and warnings. Follow the device's light/dark preference until the user chooses a mode with the sun/moon toggle. Remember that choice in the browser, including on the login screen. Keep status meaning readable without color alone.

## Floating chrome

Every floating control and surface uses the rim-lit glass material: a light tint over a 12px backdrop blur, a subtle diagonal sheen, and one thin outline without inset rim highlights. This covers the header controls, composer, go-to-bottom button, session search, menus, popovers, bottom sheets, dialogs, toasts, the Workers row and the image viewer controls. Controls inside the composer use a light glass fill without extra outlines. Selected and pressed states use the glass fill rather than solid panel colours. The thread scrolls beneath the header and the composer dock and stays sharp up to each control; it fades out only below the composer. The Workers sheet uses a near-opaque theme background for reading, with glass only on its circular header controls. Only the QR camera sheet stays black.

## Diagrams

Mermaid diagrams use flat shapes, thin warm borders, muted blue group backgrounds, and high-contrast connectors. Match the app's light/dark mode and system typography. Preserve author-defined state colors rather than inventing status meanings. No gradients, glow, or drop shadows. Show a bounded loading placeholder instead of raw source, retain finished diagram nodes across unrelated updates, and keep source available behind its disclosure. The existing image viewer owns zoom and pan.

## Sessions sidebar

On tablets, desktops and landscape phones at least 568px wide, show Sessions and the conversation side by side. Keep the sidebar up to 320px wide, with a divider and a circular collapse control at its top right. Selecting a session leaves the sidebar open. Swipe right across the conversation to open Sessions, or left to collapse it. Keep session-row swipes for pinning and closing. Collapse it to give the chat the full width; never dim or disable the conversation. Respect reduced motion and keep narrow portrait phones on list/back navigation.

## Composer

The production composer is an invariant in the coordinator study. Copy its exact markup and load the production stylesheet without overriding its subtree. Session identity and recipient information belong outside it. Attachments, drafts, model settings, and Stop belong to the selected session.

## Codemode work log

Codemode activity uses Sol's connected work-log layout. Keep Codemode in the group heading only. Each run uses one visible line for its action, status icon, and recorded duration, with the status name retained for screen readers. Reveal output before the script and preserve disclosure state during streaming. A leading script comment supplies the run title; otherwise use short action labels for literal tool references, such as Read files or Run commands. Ignore strings, comments, and regex literals, and use a neutral numbered Run when no supported reference is available. These labels describe script intent, not executed inner calls or successful checks.

## Coordinator interaction

Any ordinary session coordinates workers when asked, without setup, a separate conversation, or reduced parent permissions. Preserve its identity, history, model, and tools. The user selected pane D: a narrow, centered Workers control below the session dots and above the composer shows small worker slots and opens an inset floating bottom sheet, then a compact roster and read-only worker logs. Each worker has a subtly darker, recessed row background with 16px corners, a single thin glass-edge outline without shadows, and an 8px gap to the next row. Use regular-weight 15px titles and quieter 12px statuses. Horizontal 8×4px rounded slots avoid the missing-character appearance of upright boxes. Filled slots mean running; outlines mean not running. Use the lowercase label "workers" on a 16px line, with the slots and shallow chevron lowered 1px to align with the lettering rather than the line box. Show up to eight slots, running first, with a +N overflow count. Keep the full status summary accessible and the attention marker visible. The sheet has rounded corners on all sides, an 8px minimum gap from the screen edges with safe-area clearance, and a centered heading. Close sits on the left of the roster; in a log, Back takes the left position and Close sits on the right. Keep their visible circles small and quiet at 32px within 44px tap targets, aligned with the row inset. Hide the redundant idle subtitle so the roster title and close control share one centered line. The pane keeps the same fixed height for the roster and worker logs: 52% of the viewport, capped at 640px and constrained to the available space. Short lists leave open space below the compact rows; long lists and logs scroll inside without resizing the pane. The sheet rises from below and pulls down to dismiss; short or cancelled pulls snap back, and a scrolled log keeps native scrolling. Keep text and controls opaque. All instructions and replies remain in the main conversation. Inspect one worker alongside the live parent without changing the selected session, composer, draft, attachments, or main reading position. Preserve the direct, read-only worker view for explicit session search.

## Coordinator study boundary

The workspace exploration lives only at `/coordinator-prototype.html`. Its route-specific direction contract is `.impeccable/surfaces/web-coordinator-prototype-html.md`. The study compares a plain worker list, inline details, and a coordinator/worker session tree above the composer. The original stack D working-answer study was rejected and remains isolated. It is distinct from the selected pane D bottom sheet. That older study explores cited source logs, inline decisions, and immutable revisions. Incoming findings wait for an explicit display update rather than rewriting text while it is being read. The coordinator is the only recipient of human input in this study. It presents questions, relays instructions, and confirms their destination in the main conversation. Worker logs are read-only and retain an explicit return to the coordinator. Earlier worker-window studies remain in Git. The study's data is simulated and does not establish production capabilities or design acceptance.
