---
version: 1
slug: "web-coordinator-prototype-html"
primary_target: "web/coordinator-prototype.html"
related_targets: ["web/coordinator-prototype.css", "web/coordinator-prototype.js"]
---

# Coordinator interaction studies

Operate mode. Isolated, throwaway UI study using sample data. No production conversation or backend changes.

A, B and C compare worker navigation immediately above the unchanged production composer:

- A: a full-width worker list opening read-only logs.
- B: all expanded worker names remain listed, with inline status details and a return to the main input.
- C: a coordinator/worker tree distinguishing the main conversation from read-only worker logs.
- D: a working answer with source citations, an inline product decision, and immutable revision history. Sources collapse into a stacked list above the composer. Changes opens a read-only history popover.

The coordinator is the only recipient of human input. It raises questions, summarizes reports, relays instructions, and confirms the affected worker in the main conversation. Workers are optional inspection views with no composer, direct replies, or direct Stop. Preserve the coordinator draft and attachments while inspecting logs. Sample instruction handling is canned UI behavior, not a model or permission boundary.

Each stack collapses into a 44px Workers row with working, question, and result counts. Native disclosure controls support touch and keyboard. Collapsing changes only navigation visibility, not the viewed log, coordinator draft, attachments, or worker activity. Keep the disclosure choice while switching variants or sessions in the page, without persisting it.

Use Pi Remote's typography, themes, hairlines, and touch targets. No worker cards, tinted tiles, pill containers, or clipped one-line name strips. Preserve the exact production composer markup and load its stylesheet without prototype overrides.

D is a pinned exploration of the user's working-answer direction, not approval of its finished UI. User instructions create a new revision and mark scope-dependent evidence for rechecking. Incoming sample evidence does not rewrite the answer or move the current paragraph; it waits behind New findings. Explicit review reveals the revised answer. Returning from a source log restores the coordinator draft, attachments, and reading position. This study has separate in-memory source fixtures and no production routing.

The floating A/B/C/D switcher is prototype tooling, not a proposed product control. All actions are local samples. A rendered variation or passing browser check is not user approval.

## Right-side worker panes

A separate `study=panes` comparison uses the same route, stylesheet, and exact composer node. The original `study=stacks` A–D remain unchanged. The supplied screenshot identifies the large worker tree as the area to reconsider.

- Pane A, Tree + drawer: retain the production tree; tapping a worker slides in its read-only log without changing the main conversation.
- Pane B, Workers drawer: one compact Workers row opens a right-side roster, then a worker log with a back-to-roster control.
- Pane C, Pinned inspector: one Workers row opens the last log with worker tabs. At 1100px and above it reserves a right column beside the interactive conversation; on phones it becomes a modal drawer.

Pane B is the user's preferred drawer layout. Keep the conversation stationary and slide the pane in from the right, without a left-edge flash. The full-screen overlay must not scroll when focus enters the moving pane.

Use native dialog focus, Escape, explicit close/return, and background dismissal. Keep prototype comparison controls reachable while inspecting. Preserve the main draft, sample attachment, and reading position. Names wrap; lists and log sections are unboxed. Pane reveal respects reduced motion. Short screens scroll inside the pane and retain its return control. No worker inputs, direct Stop, or synthetic prompt routing. Sample reports are illustrative, not executed reviews. These proposals do not change the selected production C layout.

The rejected worker-window study is preserved in Git at `6f3d0ee`.
