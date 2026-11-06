# Worker pane prototypes

Question: can worker inspection move into a right-side pane while keeping the main conversation and its composer in place?

These are isolated, in-memory UI studies. Live chat and worker routing are unchanged. The sample matches the supplied screenshot: Messaging has a result, Recovery is stopped, and the parent conversation remains the only input destination.

| Variant | Main conversation | Inspection |
| --- | --- | --- |
| A, Tree + drawer | Keep the current tree | Tap a worker for its sliding log |
| B, Workers drawer | One compact Workers row | Sliding roster, then log; Back returns to the roster |
| C, Pinned inspector | One compact Workers row | Last log with worker tabs; desktop reserves a right column, phone uses a drawer |

The production composer is copied byte-for-byte and uses the production stylesheet. Drafts, a local sample attachment, and the main reading position survive inspection. Logs are read-only. The prototype does not start agents, send messages, read user files, change settings, use storage, or contact session APIs. Its sample reports are not a code review.

## Open

Use the existing preview command:

```sh
npm run prototype:workers
```

Then visit `http://127.0.0.1:8815/coordinator-prototype.html?study=panes&variant=A`, or change `variant` to `B` or `C`. The original stack studies remain under `study=stacks`. The floating arrows switch variants and update the URL. `pane=messaging`, `pane=recovery`, or `pane=workers` opens a shareable inspection state. Use the options control for the theme and sample state. Arrow keys switch variants except while editing or using worker tabs.

A and B overlay the main view. C becomes a nonmodal split view at 1100px and above, so the main composer can be used while the worker stays visible. Closing a modal pane returns focus to the Workers control without opening the phone keyboard.

## Focused verification

```sh
PI_REMOTE_TEST_PORT=8814 npx playwright test test/browser/worker-pane-prototype.spec.mjs test/browser/coordinator-prototype.spec.mjs --trace off
```

Tests use Playwright's bundled Chromium by default. Set `PI_REMOTE_TEST_CHANNEL=chrome` to use an already-installed Chrome when the matching bundled browser is unavailable. Browser requests, storage, and live session APIs are blocked in the pane proof. Narrow, short, light/dark phone, and desktop views are covered; these are not physical Safari keyboard checks.

The comparison bar is study tooling, not a proposed product control. Choosing a variant requires user feedback, not a screenshot or passing browser check.
