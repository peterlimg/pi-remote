# Coordinator interaction studies

Questions: how should named worker sessions form a stacked list above the composer, and can a working answer make coordination clearer than a growing chat transcript? No worker cards or cramped horizontal strips.

Open `/coordinator-prototype.html?variant=A` and use the prototype arrows to compare:

| Variant | Structure | Main action |
| --- | --- | --- |
| A · Plain list | One full-width row per worker | Inspect a read-only worker log |
| B · Inline details | Stable worker list plus a question/result area | Inspect status, answer in the main conversation |
| C · Session tree | Main conversation and indented worker logs | Inspect activity without changing the input recipient |
| D · Working answer | Versioned findings, cited source logs, and an inline decision | Steer the answer and review new evidence without losing earlier versions |

All human input goes to the coordinator. It presents the worker question in the main conversation, relays the answer, and records which worker received it. Worker logs show coordinator-originated assignments and instructions. They are read-only, without a composer or direct Stop. Returning to the main conversation restores its draft and attachments.

All variants keep the production composer unchanged when the main conversation is open. The three labeled sample instructions, Browser reload first, Host restart first, and Stop Messaging, demonstrate coordinator receipts and worker-log updates. Typed versions also work, ignoring case and trailing sentence punctuation. Other text is acknowledged in the main conversation without inferring a worker action. This is canned prototype behavior, not natural-language routing. Tap the Workers row to collapse or expand any stack. The collapsed row keeps working, question, and result counts visible. Collapse does not stop workers, change the viewed log, or discard the coordinator draft and attachments. The choice lasts while switching variants or sessions, and resets on reload.

## Working answer

Open `/coordinator-prototype.html?variant=D`. D has its own in-memory source fixtures so the earlier studies remain comparable.

- Choose Keep on phone or Across devices. The coordinator records the choice and instructs Recovery.
- Type `Ignore desktop. Focus on Safari.`. The answer marks earlier delivery evidence for rechecking and shows the changed scope. Repeating the instruction does not invalidate already matching evidence.
- In About this design study, choose Receive sample finding. The coordinator's sample review makes a revision available, but the visible answer and reading position stay unchanged. Review new findings explicitly to reveal it. This is display control, not a requirement for users to approve every worker report.
- Open Changes to read previous answers and instructions. Those snapshots are not rewritten.
- Tap a source citation for a read-only log. Return to recover the coordinator draft, attachments, and reading position.
- Change scope while a finding is queued to discard obsolete evidence. A stopped Messaging source cannot produce another sample report.

All of these are deterministic sample events, not model intelligence. D also recognizes `Focus on Safari` and `Stop Messaging`. Other instructions are preserved in history without inferring a worker action. There is no persistence across reloads.

The bottom switcher changes the URL and supports arrow keys outside input fields and open popovers. The header menu explains the study and exposes the sample state.

This route has no storage, transport, model calls, real uploads, or real Stop. Sample actions do not prove orchestration behavior. Production worker input and routing are unchanged by this prototype. No variant is an accepted design.

Run `npm run prototype:workers`, then open `http://127.0.0.1:8815/coordinator-prototype.html?variant=A`. This uses the existing isolated browser fixture, not the user's Pi data. Stop the fixture when finished; do not reuse an occupied port.

The previous worker-window workspace study is preserved at commit `6f3d0ee` and in its research notes.
