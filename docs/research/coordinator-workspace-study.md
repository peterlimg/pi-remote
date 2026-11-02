# Worker workspace study

Open `/coordinator-prototype.html?study=workspace` on the normal Pi Remote host.

The study separates worker sessions from the coordinator's conversation. Navigation is working, Login copy has a question, and Checks has returned a sample report. All data and actions are simulated; nothing reaches a real agent.

Inspect the question and Returned tabs, enter a worker, then return using the header's back control. Drafts and sample attachments stay with their selected sessions. The production composer markup and stylesheet remain unchanged.

On phones, worker focus keeps a compact three-worker overview above the conversation. A short, keyboard-sized viewport also compacts the work area. The desktop keeps the work area beside the conversation.

The visual direction comes from [the reference board](coordinator-visual-directions.md). The development contract lives at [the surface brief](../../.impeccable/surfaces/web-coordinator-prototype-html.md). Browser checks verify layout and isolation only; they do not establish design approval or physical iPhone behavior.

## Local verification

Four focused E2E checks pass in `test/browser/coordinator-prototype.spec.mjs`. They cover worker ownership and return paths, session-specific drafts and sample attachments, scoped sample Stop, safe message rendering, and composer controls. The composer check compares its exact source markup and computed appearance with the production page.

The capture matrix covers 390 × 844, 320 × 740, a 390 × 510 keyboard-sized viewport, and 1440 × 900 in light and dark themes. A keyboard-sized Chromium viewport is not a physical iPhone keyboard test. The final screenshot review includes the coordinator, a worker question, and the returned report.

The mechanical design detector returned no findings in degraded regex mode because its parser modules were unavailable. It did not evaluate computed contrast or selector matching. No real agents, persistent storage, or external commands are involved in the study. The full suite and physical Safari remain unchecked.
