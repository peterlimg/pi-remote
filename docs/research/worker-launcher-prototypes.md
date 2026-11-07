# Compact worker access · UI-only study

This comparison is **not approval to change the live interface**. It extends the existing, already-served `/coordinator-prototype.html` route with `study=launchers`. No host changes or new static assets are needed. The existing stacks/panes studies remain separate; the selected pane D bottom sheet is not the rejected stack D working-answer study.

| Variant | Footer cost | Access and trade-off |
| --- | --- | --- |
| A · Contextual row | 0px settled; current 53px otherwise | Hide the whole row/separator/gap only when all tasks are handled. Idle history: Session details → Workers. Unresolved work keeps one-tap access. |
| B · Header-owned access | 0px in every state | Existing Session details trigger shows Workers/count/status and its menu cue. Title truncates before status. Two taps to the Workers sheet; another tap to a log. No fourth header button. |
| C · Minimal text | 44px always | Narrow borderless Workers/status action, no separator or bottom gap. One-tap history. Saves only about 9px. |

The baseline is a 44px action + 1px separator + 8px margin, about 53 CSS px. **The separate 28px absolute session-navigation strip remains in every option.** Hiding the row does not save an additional 28px. No worker interaction is assigned to the dots/swipe/haptic area.

## Open and compare

```sh
npm run prototype:workers
```

Use a free port; do not reuse an unrelated server. Open:

- `/coordinator-prototype.html?study=launchers&variant=A&state=idle`
- `/coordinator-prototype.html?study=launchers&variant=B&state=working`
- `/coordinator-prototype.html?study=launchers&variant=C&state=idle`

Floating prototype controls provide previous/next, the variant name, **Sample state** (idle, working, needs answer, returned result, uncertainty), theme and study notes. All variants reserve the same 132px plus safe-area control region, outside the composer. The visible measurement refers only to the product launcher, not this tooling. Arrow keys cycle variants except in text fields/selects, with modifiers, or while a popover/another dialog owns interaction.

`variant`, `state`, `condition`, optional `theme`, and `pane=workers|review` make views reload/share stable. The study notes contain shareable variant links that also switch locally without losing a draft. Drafts and attachments stay in memory, not across reloads. Nothing uses storage or production APIs.

Under study notes, **Illustrative lifecycle condition** exposes starting/working/stopping, queued/recovering/needs-inspection, blocked recovery, and a completed/integrated task with an unresolved delivery warning. A retains the launcher for every one of these, plus needs-answer and unreviewed returned results. Settlement requires a handled terminal task, idle recovery, and confirmed delivery; unknown states fail open. Zero running workers alone is never the condition for hiding it.

## Invariants and limits

The single composer form is byte-identical to current `web/index.html`, moved into this template once, and styled by production `style.css`. No launcher CSS targets it or its descendants. It remains mounted through all variant/state/sheet navigation, preserving drafts and the local sample attachment. Model/reasoning/usage, commands, attachment and Stop controls demonstrate local sample behavior only. The independent sample main-response checkbox exposes Stop without pretending that a working worker makes the parent busy. Send keeps the draft and does not produce canned replies or route instructions.

Inspection uses the production borderless, translucent, blurred bottom sheet, plain roster and read-only logs, including green Working dot/text. Close/Escape/background and downward pull dismiss it; short/cancelled pulls snap back, and a scrolled log keeps native scrolling. Disclosure/reading state is retained in memory per sample condition. Initial/pointer focus goes to the dialog; keyboard log navigation targets Back. If A settles while the sheet is open, Close falls back to Session details instead of a hidden launcher. All human input stays in the main conversation.

Focused browser verification (no unit/full suite):

```sh
PI_REMOTE_TEST_PORT=8815 PI_REMOTE_TEST_CHANNEL=chrome \
  VERIFY_EVIDENCE=test-results/launcher-study/evidence \
  ./node_modules/.bin/playwright test test/browser/worker-launcher-prototype.spec.mjs --trace off
```

The check is designed to cover phone A/B/C idle/working in light/dark, narrow/desktop bounds, exact composer markup, 53/44/0px geometry and the unchanged 28px strip; all illustrative unresolved conditions; menu/sheet focus, draft/attachment retention, share/reload state, sample controls, short/narrow/desktop sheets and native touch dismissal/scroll; plus bounded compatibility smoke checks for existing stacks/panes. It blocks browser storage and live capabilities. Evidence is captured only through actual navigation and UI interaction, not DOM or storage state injection. Chrome emulation is not physical Safari, OS keyboard or haptic verification.

### Verification evidence

The worker's confirmation passed interaction/safety and sheet/touch/existing-study checks. Its layout check stopped on an incorrect test assertion that expected the composer to move. Savings increase transcript height while the composer stays fixed; the final assertion checks both.

After reviewing revision `078414570e2f86b620711fcdfa532498bc531275`, the parent ran the corrected layout check on the same source. It passed all 24 A/B/C idle/working views: phone light/dark, narrow dark and desktop light. Evidence: `/tmp/pi-worker-launcher-review-iAHknK/`, including `browser.log`, `captures/geometry.json` and screenshots. The worker's 14 interaction/sheet screenshots remain under its worktree's `test-results/launcher-study/confirmation/evidence/`.

No physical Safari, OS keyboard, pinch zoom or haptics were checked.
