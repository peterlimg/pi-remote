---
version: 1
slug: "web-coordinator-prototype-html"
primary_target: "web/coordinator-prototype.html"
related_targets: ["web/coordinator-prototype.css", "web/coordinator-prototype.js"]
---

# Stacked worker list comparisons

Operate mode. Isolated, throwaway UI study using sample data. No production conversation or backend changes.

Compare three structures immediately above the unchanged production composer:

- A: a full-width worker list opening read-only logs.
- B: all expanded worker names remain listed, with inline status details and a return to the main input.
- C: a coordinator/worker tree distinguishing the main conversation from read-only worker logs.

The coordinator is the only recipient of human input. It raises questions, summarizes reports, relays instructions, and confirms the affected worker in the main conversation. Workers are optional inspection views with no composer, direct replies, or direct Stop. Preserve the coordinator draft and attachments while inspecting logs. Sample instruction handling is canned UI behavior, not a model or permission boundary.

Each stack collapses into a 44px Workers row with working, question, and result counts. Native disclosure controls support touch and keyboard. Collapsing changes only navigation visibility, not the viewed log, coordinator draft, attachments, or worker activity. Keep the disclosure choice while switching variants or sessions in the page, without persisting it.

Use Pi Remote's typography, themes, hairlines, and touch targets. No worker cards, tinted tiles, pill containers, or clipped one-line name strips. Preserve the exact production composer markup and load its stylesheet without prototype overrides.

The floating A/B/C switcher is prototype tooling, not a proposed product control. All actions are local samples. A rendered variation or passing browser check is not user approval.

The rejected worker-window study is preserved in Git at `6f3d0ee`.
