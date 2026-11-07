---
name: verify-pi-remote-coordinator
description: Verify implicit worker coordination in ordinary Pi Remote sessions through the phone web UI, real Pi RPC processes, durable task files, scoped replies and Stop, investigation permissions, coding worktrees, reviewed integration, and host restart recovery. Use after coordinator or task-routing changes.
---

# Verify Pi Remote coordinators

Read [features/README.md](features/README.md), then the feature being checked. Run from the repository root. This skill proves the coordinator workflow rather than the visual prototype.

## Launch

Requires Node.js 22.19 or newer, Pi 1.4 or newer on PATH, installed project dependencies, and Playwright Chromium. Use the existing package commands if dependencies are missing. The dedicated proof needs no model credentials.

```sh
PI_REMOTE_COORDINATOR_TEST_PORT=8813 npm run test:coordinator
```

This command refuses an occupied port, launches `test/coordinator-server.mjs`, runs Doctor, drives the phone UI, restarts its own host process, and cleans up. It prints an absolute `pi-coordinator-proof-*` evidence directory. A passing run ends with `PASS` and exit code 0.

The host and Pi RPC processes are real. Only the model provider is deterministic, supplied by `test/fixtures/coordinator-provider.mjs` through Pi's provider extension interface. It attempts allowed reads and forbidden operations, asks a question, returns a report, and holds another worker until Stop. A later coding scenario uses native edit/write/bash tools in real Git worktrees and integrates a reviewed patch. It makes no paid model requests.

The fixture creates three pinned source sessions, **Coordinator verification project**, **Other verification project**, and **Terminal verification project**, in temporary projects. The first is an ordinary host-managed session; a separate real Pi process owns the terminal bridge. The first project contains `alpha.txt`, `beta.txt`, and an escaping symlink. Private fixture data and session files are outside that project. It never uses the real Pi Remote data directory or relay.

For a manual drive of one feature:

```sh
export VERIFY_EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/pi-coordinator-manual-XXXXXX")"
mkdir "$VERIFY_EVIDENCE/scratch"
# If anything owns this port, stop here. Never kill or reuse its instance.
if lsof -nP -iTCP:8813 -sTCP:LISTEN; then echo 'Port occupied'; exit 1; fi
env -u PI_REMOTE_HOME -u PI_REMOTE_PORT -u PI_REMOTE_PUBLIC_URL -u PI_REMOTE_RELAY_URL \
  TMPDIR="$VERIFY_EVIDENCE/scratch" TMP="$VERIFY_EVIDENCE/scratch" TEMP="$VERIFY_EVIDENCE/scratch" \
  PI_REMOTE_COORDINATOR_TEST_PORT=8813 node test/coordinator-server.mjs >"$VERIFY_EVIDENCE/server.log" 2>&1 &
export VERIFY_PID=$!
```

Read `server.log` for the fixture's JSON readiness line, root, PID, and URL. The root can be passed as `PI_COORDINATOR_FIXTURE_ROOT` to the same launcher when explicitly testing a restart. Never supply an unrelated directory. Run Cleanup after a failed manual launch too.

## Doctor

Use only a PID from your own launch:

```sh
node test/coordinator-e2e.mjs doctor "$VERIFY_PID" http://127.0.0.1:8813
```

Doctor checks the process exists, the authenticated control endpoint identifies that exact PID, the served HTML/JS/CSS match this checkout, client authentication works, coordinator capability is advertised, and the seed project exists. It does not send a prompt or create a worker. A successful HTTP health check alone is not sufficient.

## Drive

Set `PI_REMOTE_TEST_CHANNEL=chrome` to use installed Chrome instead of bundled Chromium. The full proof uses `@playwright/test` Chromium with the iPhone 13 profile at 390 × 844. The stable user path is:

1. **Paste a private link instead**, fill **Private login link** with `browser-test-token-only-123456789012345`, then **Connect to computer**.
2. Open **Coordinator verification project**.
3. Require the original title and existing conversation note, no coordinator setup button, and no Workers tree. Send `Read alpha before delegating.` and require an ordinary read with no coordinator membership or workers.
4. Send `Investigate both fixture files.` using the normal Message field and Send message control. Require the same parent ID, file, history prefix, model, and full ordinary tools. No separate coordinator file may appear.
5. Open the compact **Workers** row immediately above the composer. In its translucent bottom sheet, **First inspection** needs an answer while **Second inspection** remains working. The main conversation presents the question. Neither worker appears in global session sections, even if pinned; explicit search still finds them.
6. Send `Keep the original identifier.` in the coordinator. Require a task-addressed reply and a returned report. Send `Review and accept the first result.` in the same conversation.
7. Inspect First inspection's read-only log in the sheet. Require no inputs inside it, and preserve the selected parent, composer, draft, attachment, and main reading position behind it. Send the task reply from another parent tab and require both parent and worker streams to update. Send `Stop Second inspection.` there, return to the roster, and require its stopped state. **Close workers** dismisses without switching sessions. The compact header keeps Back, title/status, and Close in one bar; there is no footer.
8. Use **Task details** inside a worker log for read-only assignments and reports. **Session details → Background tasks** opens the same roster. Require bounded phone/narrow/short/desktop geometry, translucent material with opaque content, upward entry without overlay scroll, short/cancelled pull snap-back, deliberate pull-down dismissal, and native log scrolling. Reload to inspect persisted accepted and stopped states; an open sheet must also reconnect across the fixture host restart.

The proof also creates an ordinary fresh session through **/new**, asks `Start independent inspection.`, and requires separate ownership despite sharing the first session's project. It repeats that prompt in **Terminal verification project** and requires the worker question to arrive through the real terminal bridge. The feature map contains the restart and permission cases. Inspect `test/coordinator-e2e.mjs` before narrowing its proof claims. Its secondary HTTP checks exercise the production scoped extension interface, not test-only mutation endpoints.

## Evidence

The full proof retains Doctor results, root-only list checks, phone/narrow/short/desktop worker navigation captures, action records, screenshots and ARIA snapshots, browser WebSocket frames, native provider/tool audit, public task results, host logs, the verdict, and cleanup confirmation outside the disposable scratch directory.

Exercise visible controls. Never populate internal application state, storage, or task records to make an assertion pass. Verify mutations with a second user-facing read and the persisted task record. The fixture's seed files and deterministic model are setup at existing external seams, not substitutes for the host or Pi tool runtime.

For investigation workers, require unchanged project file hashes and directory contents, blocked outside reads and symlinks, and unavailable write/bash. For coding workers, require real native edits/checks in distinct worktrees, unchanged parent files until reviewed integration, rejected stale/conflicting revisions, unchanged parent staged index/drafts, blocked outside file-tool writes, and code-workspace recovery without replay. In both cases require that private capability tokens never enter browser state, main-session replies and Stop reach only their addressed task, and an actual host process restart does not repeat a task prompt or notification. Notification acknowledgement is not proof that the human read a summary.

The proof records actions, protocol frames, screenshots, and native tool results instead of a trace ZIP. Do not infer physical iPhone keyboard or Safari behavior from Chromium. Do not infer real-model planning quality from the deterministic provider. Coding shells are trusted-host execution, not an OS sandbox. Read features/coding.md for the coding sequence; it follows the unchanged investigation proof.

## Cleanup

The full proof closes Chromium, stops only its own server, checks all fixture Pi PIDs exited, removes its scratch state, and confirms proof artifacts remain.

For the manual launch:

```sh
kill -TERM "$VERIFY_PID"
wait "$VERIFY_PID" || true
rm -rf "$VERIFY_EVIDENCE/scratch"
test -f "$VERIFY_EVIDENCE/server.log"
```

Keep the evidence directory. Never kill by process name or delete other `pi-*` directories. If an interrupted run leaves processes, match them against that run's readiness PID and private fixture ownership records before acting.

## Helpers

- `npm run test:coordinator` runs the complete proof in `test/coordinator-e2e.mjs`.
- `node test/coordinator-e2e.mjs doctor PID URL` runs the read-only instance check.
- `node test/coordinator-server.mjs` launches the isolated fixture for manual drives.
- `npx playwright test test/browser/worker-sheet.spec.mjs --trace off` checks paged worker history, scoped image loading, disclosure preservation, and the live parent through the browser WebSocket seam. This UI-only fixture does not replace the native proof's authorization and process checks.

Use `/maintain-verification-skill` to keep this map aligned with future coordinator changes.
