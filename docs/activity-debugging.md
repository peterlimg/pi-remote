# Working-icon diagnostics

The phone records animation metadata while a working conversation is open, at most once every five seconds unless its session, connection, visibility or reduced-motion setting changes. It also records backgrounding and disconnects. Logging does not restart, pause or change the animation.

Records travel through the existing authenticated browser WebSocket, including its encryption on phone connections, to `activity-debug.jsonl` in the host's data directory, normally `~/.pi/remote/`. The file rotates at 1 MiB to `activity-debug.jsonl.1`, keeping only those two files with private permissions. The browser queues up to 30 unsent records in memory during an outage and retries after reconnecting. Closing the page can lose unsent records. Signing out clears the queue. Older hosts without diagnostic support receive no diagnostic requests.

When the icon freezes, note the time and conversation, then inspect both log files on the computer. Each page load has a random `page` ID. `session` is an opaque session ID, never a title or path. Records include browser user agent, standalone mode, reduced motion, visibility, connection state, viewport size, transcript render count, animation start/current time, play state, computed transform, and a single animation-frame probe per sample. The host allowlists fields and rate-limits ingestion. Prompts, replies, tool output, URLs, tokens and encryption keys are not collected.

- Increasing `startTime` during streaming suggests repeated animation restarts.
- `animationName: none` with `reducedMotion: true` means the accessibility setting disabled animation intentionally.
- A paused play state or unchanged current time with a visible, rendered indicator suggests an animation-timeline problem.
- Growing `frameAgeMs` with `framePending: true` suggests animation-frame callbacks stopped. Gaps following backgrounding are expected on phones.
- If a visible icon has CSS animations defined but none running or paused, the app rebuilds it on the next one-second check. This handles a WebKit stall after switching sessions.
- The count covers CSS animations inside the session icon. Timing and transform describe the first animation, logged as `animationName: other`. Orbit also moves its moons outside CSS. Advancing time does **not** prove Safari painted a frame. Compare the timestamps with a screen recording to identify a possible compositor-only freeze.

Verify logging with `npm run test:browser -- test/browser/activity-debug.spec.mjs`, then repeat with `--browser=webkit`. These tests use real isolated hosts and encrypted browser channels with simulated Pi bridges, including a deliberately paused CSS animation. They do not reproduce the original physical-iPhone freeze.
