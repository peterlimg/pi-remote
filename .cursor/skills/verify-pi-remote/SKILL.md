---
name: verify-pi-remote
description: Drive Pi Remote's mobile web UI with Playwright to verify login, session navigation, conversations, messages, and slash commands. Use for behavior checks and evidence capture after browser or host changes, with an isolated local host and simulated Pi bridge agents.
---

# Verify Pi Remote

Read [features/README.md](features/README.md), then the feature being checked. Run commands from the repository root. The primary user interface is the phone browser. The Pi extension commands and `bin/pi-remote.mjs` are secondary interfaces; this skill does not verify their setup flow.

## Launch

Requires Node.js 22.19+ and `lsof` on macOS/Linux. Install the existing dependencies and browser if missing:

```sh
npm ci --ignore-scripts
npx playwright install chromium
```

On a Linux machine missing browser libraries, use `npx playwright install --with-deps chromium`. Neither command starts Pi or requires model credentials.

Run the complete, self-cleaning manual-login proof:

```sh
.cursor/skills/verify-pi-remote/verify.mjs
```

It launches `node test/browser-server.mjs`, waits for `http://127.0.0.1:8799/health`, runs Doctor, drives Chromium with the iPhone 13 profile, and tears down. It prints the absolute evidence directory before launching. A successful run ends with `PASS` and exit code 0.

The fixture uses a real host, HTTP server, browser WebSocket, authentication, and bridge protocol. It seeds `Project Alpha` and `Project Beta` with conversations and tool output. The agents on `/bridge` are simulated. They acknowledge messages and publish them back; they do not run Pi tools, call models, or persist a real Pi conversation. Twenty deliberately malformed session files produce scan warnings until the first command clears them.

Port 8799 is fixed in the existing fixture and specs. Only one run may use it. Stop and report an occupied port, never kill its owner or reuse someone else's instance. Each launch gets its own temporary data, locks, browser context, and scan root. Do not run the smoke helper and `npm run test:browser` concurrently.

For a custom Playwright drive, start a fixture explicitly in a shell you keep open:

```sh
export VERIFY_EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/pi-remote-proof-XXXXXX")"
export VERIFY_SCRATCH="$VERIFY_EVIDENCE/scratch"
mkdir "$VERIFY_SCRATCH"
# Refuse an occupied port before launching.
if lsof -nP -iTCP:8799 -sTCP:LISTEN; then echo 'Port 8799 occupied; stop here'; exit 1; fi
env -u PI_REMOTE_HOME -u PI_REMOTE_PORT -u PI_REMOTE_PUBLIC_URL -u PI_REMOTE_RELAY_URL \
  TMPDIR="$VERIFY_SCRATCH" TMP="$VERIFY_SCRATCH" TEMP="$VERIFY_SCRATCH" \
  node test/browser-server.mjs >"$VERIFY_EVIDENCE/server.log" 2>&1 &
export VERIFY_PID=$!
printf '%s\n' "$VERIFY_PID" >"$VERIFY_EVIDENCE/server.pid"
cleanup_verify() {
  kill -TERM "$VERIFY_PID" 2>/dev/null || true
  wait "$VERIFY_PID" || true
  rm -rf "$VERIFY_SCRATCH"
}
trap cleanup_verify EXIT
for attempt in $(seq 1 50); do
  kill -0 "$VERIFY_PID" 2>/dev/null || break
  curl -fsS http://127.0.0.1:8799/health >/dev/null && break
  sleep 0.2
done
.cursor/skills/verify-pi-remote/verify.mjs doctor "$VERIFY_PID" >"$VERIFY_EVIDENCE/doctor.json"
```

If Doctor fails, run Cleanup immediately. Do not drive the browser. These environment overrides prevent connecting the fixture to a configured remote relay. Never point this fixture's known token at a real deployment.

## Doctor

Run this read-only check whenever an instance looks wrong, using only a PID from your own launch:

```sh
.cursor/skills/verify-pi-remote/verify.mjs doctor "$VERIFY_PID"
```

It checks the process exists, is the sole listener on 8799, serves this checkout's `web/app.js`, returns HTTP 200 from `/health`, accepts the fixture token over the real browser WebSocket, and lists both seeded projects. It does not send a prompt or change a session. The automatic proof saves these results in `doctor.json` and records the Git revision and dirty paths in `run.json`. `/health` alone does not prove authentication or host connectivity.

## Drive

The executable helper proves `access` via manual login, reopening a tab, and cross-tab sign out. It uses visible controls, not storage injection. Feature files contain additional Playwright actions. For a custom drive, use this setup in a repository-local `.mjs` file so Node resolves installed dependencies:

```js
import { chromium, devices, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const evidence = process.env.VERIFY_EVIDENCE;
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'] });
try {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8799/');
  await page.getByLabel('Device access token').fill('browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Connect to computer' }).click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#title')).toHaveText('Project Alpha');
  await page.screenshot({ path: join(evidence, 'feature.png'), fullPage: true });
  writeFileSync(join(evidence, 'feature.aria.txt'), await page.locator('body').ariaSnapshot());
} finally {
  try { await context.tracing.stop({ path: join(evidence, 'trace.zip') }); }
  finally { await browser.close(); }
}
```

This custom drive opens Alpha. Extend it with the mapped feature's actions and assertions. Use the feature ID and entry point in artifact names when checking more than one path. After a custom drive, run Cleanup even if it failed.

Existing regression specs run their own fixture. Stop a manual fixture first, then use `npm run test:browser -- test/browser/auth.spec.mjs --trace on` or the command in the feature map. Inspect specs before citing their result: some intercept `/ws` and prove only the UI contract, not the real host. Copy `test-results/` to the evidence directory before another Playwright invocation, which clears its output directory.

## Evidence

The automatic helper writes an absolute, unique `pi-remote-proof-*` directory under the OS temporary directory, outside `test-results/`. It contains the build identity, Doctor result, server log, `trace.zip`, connected and signed-out screenshots and ARIA snapshots, `result.json`, and `cleanup.json`. Failures save `failure.txt`; partial traces survive ordinary failures. Temporary directories survive this cleanup but not necessarily an OS purge. Copy the directory to long-term storage if needed.

```sh
npx playwright show-trace "$VERIFY_EVIDENCE/trace.zip"
```

`VERIFY_EVIDENCE` for an automatic run is the path printed by the helper; assign it before using this command. Traces show the action and its result, not merely the final screenshot. Storage reads in the login proof confirm the token was saved and removed. Reopening the page independently confirms those effects.

For mutations, require a second user-facing read of the result, such as reselecting a conversation, and inspect the matching command/result frames. Do not equate clearing the composer with acknowledgement. Never manufacture success by changing DOM, storage, or application state. Read-only inspection is fine. Mock only at an existing external boundary, and name which side was simulated. The fixture's Pi bridge is one such boundary; client-side WebSocket routing in existing specs is narrower UI-only evidence.

The fixture is not a production dry-run mode. It writes temporary config, session files, locks, and command journal data and opens local sockets. The helper disables `PI_REMOTE_*` overrides, scans only its scratch root, and removes that root afterward. No real Pi/model or Render relay is launched. Capture network frames and before/after state for any new drive that claims to skip external work. Do not assume `/new`, Resume session, model selection, or abort execution is proven by this fixture's generic acknowledgement.

Never put production access tokens or real conversations in shared artifacts. The helper uses only the public fixture token.

## Cleanup

The automatic helper closes Chromium, sends SIGTERM to its own child PID, waits for exit, and removes only its scratch directory. After five seconds it may SIGKILL that same child. It then checks proof files still exist. No host-side production code changed merely by adding this skill; do not restart the user's host for a documentation/helper-only change.

For a manual launch in the same shell:

```sh
cleanup_verify
trap - EXIT
test ! -d "$VERIFY_SCRATCH"
! kill -0 "$VERIFY_PID" 2>/dev/null
ls -l "$VERIFY_EVIDENCE"
```

Remove only the temporary custom drive script you created. Keep screenshots, traces, logs, and results. Never use `pkill`, `killall`, or delete all `pi-remote-*` directories. After an uncatchable termination, check `server.pid` or `run.json` against the listener and process start time before terminating it, since PIDs can be reused.

## Helpers

`verify.mjs` is executable and has two invocations:

- `.cursor/skills/verify-pi-remote/verify.mjs` runs launch, Doctor, the manual-login proof, evidence capture, and cleanup.
- `.cursor/skills/verify-pi-remote/verify.mjs doctor "$VERIFY_PID"` checks an already-owned fixture without mutating sessions.

Use `/maintain-verification-skill` when the UI, launch recipe, or fixture behavior changes.
