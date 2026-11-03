# Worker stack comparisons

Question: how should named worker sessions form a stacked list above the composer without cards or a cramped horizontal strip?

Open `/coordinator-prototype.html?variant=A` and use the prototype arrows to compare:

| Variant | Structure | Main action |
| --- | --- | --- |
| A · Plain list | One full-width row per worker | Open the worker conversation |
| B · Inline details | Stable worker list plus a question/result area | Inspect first, then enter the worker |
| C · Session tree | Coordinator parent and indented worker children | Switch recipients without losing ownership |

All variants keep the production composer unchanged, use the same sample conversations and states, and preserve session-specific drafts and sample attachments. Tap the Workers row to collapse or expand any stack. The collapsed row keeps working, question, and result counts visible. Collapse does not stop workers, change recipients, or discard drafts and attachments. The choice lasts while switching variants or sessions, and resets on reload.

The bottom switcher changes the URL and supports arrow keys outside input fields. The header menu explains the study and exposes the sample state.

This route has no storage, transport, model calls, real uploads, or real Stop. Sample actions do not prove orchestration behavior. The live UI is unchanged by the study, and no variant is an accepted design.

Run `npm run prototype:workers`, then open `http://127.0.0.1:8815/coordinator-prototype.html?variant=A`. This uses the existing isolated browser fixture, not the user's Pi data. Stop the fixture when finished; do not reuse an occupied port.

The previous worker-window workspace study is preserved at commit `6f3d0ee` and in its research notes.
