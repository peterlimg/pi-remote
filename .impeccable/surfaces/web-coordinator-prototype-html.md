---
version: 1
slug: "web-coordinator-prototype-html"
primary_target: "web/coordinator-prototype.html"
related_targets: ["web/coordinator-prototype.css", "web/coordinator-prototype.js"]
---

# Stacked worker list comparisons

Operate mode. Isolated, throwaway UI study using sample data. No production conversation or backend changes.

Compare three structures immediately above the unchanged production composer:

- A: a full-width, always-visible worker list with direct conversation navigation.
- B: all worker names remain listed, with an inline question or result below the rows.
- C: a coordinator/worker session tree that remains visible when changing recipients.

Use Pi Remote's typography, themes, hairlines, and touch targets. No worker cards, tinted tiles, pill containers, or clipped one-line name strips. Preserve the exact production composer markup and load its stylesheet without prototype overrides.

The floating A/B/C switcher is prototype tooling, not a proposed product control. All actions are local samples. A rendered variation or passing browser check is not user approval.

The rejected worker-window study is preserved in Git at `6f3d0ee`.
