---
name: verify-pi-remote-coordinator
description: Verify Pi Remote project coordinators through the phone web UI, real Pi RPC processes, durable task files, scoped replies and Stop, read-only permissions, and host restart recovery. Use after coordinator or task-routing changes.
---

# Verify Pi Remote coordinators

Read [features/README.md](features/README.md), then the feature being checked. Run from the repository root. This skill proves the coordinator workflow rather than the visual prototype.

## Launch

Requires Node.js 22.19 or newer, Pi 1.4 or newer on PATH, installed project dependencies, and Playwright Chromium. Use the existing package commands if dependencies are missing. The dedicated proof needs no model credentials.

```sh
PI_REMOTE_COORDINATOR_TEST_PORT=8813 npm run test:coordinator
```

This command refuses an occupied port, launches `test/coordinator-server.mjs`, runs Doctor, drives the phone UI, restarts its own host process, and cleans up. It prints an absolute `pi-coordinator-proof-*` evidence directory. A passing run ends with `PASS` and exit code 0.

The host and Pi RPC processes are real. Only the model provider is deterministic, supplied by `test/fixtures/coordinator-provider.mjs` through Pi's provider extension interface. It attempts allowed reads and forbidden operations, asks a question, returns a report, and holds another worker until Stop. It makes no paid model requests.

The fixture creates two pinned source sessions, **Coordinator verification project** and **Other verification project**, in temporary projects. The first project contains `alpha.txt`, `beta.txt`, and an escaping symlink. Private fixture data and session files are outside that project. It never uses the real Pi Remote data directory or relay.

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

The full proof uses `@playwright/test` Chromium with the iPhone 13 profile at 390 × 844. The stable user path is:

1. **Paste a private link instead**, fill **Private login link** with `browser-test-token-only-123456789012345`, then **Connect to computer**.
2. Open **Coordinator verification project**.
3. Open **Session details → Start read-only coordinator**.
4. Send `Investigate both fixture files.` using the normal Message field and Send message control.
5. Open **Background tasks**. **First inspection** asks a question while **Second inspection** remains working.
6. **Reply in worker**, send `Keep the original identifier.`, then **Return to coordinator**.
7. Inspect and **Accept result** for First inspection. **Stop task** for Second inspection.
8. Reload and reselect the coordinator to read the persisted result.

The feature map contains the restart and permission cases. Inspect `test/coordinator-e2e.mjs` before narrowing its proof claims. Its secondary HTTP checks exercise the production scoped extension interface, not test-only mutation endpoints.

## Evidence

The full proof retains Doctor results, action records, screenshots and ARIA snapshots, browser WebSocket frames, native provider/tool audit, public task results, host logs, the verdict, and cleanup confirmation outside the disposable scratch directory.

Exercise visible controls. Never populate internal application state, storage, or task records to make an assertion pass. Verify mutations with a second user-facing read and the persisted task record. The fixture's seed files and deterministic model are setup at existing external seams, not substitutes for the host or Pi tool runtime.

Require evidence that project file hashes and directory contents are unchanged, outside reads and symlinks are blocked, write/bash are unavailable, private capability tokens never enter browser state, replies and Stop reach only their addressed task, and an actual host process restart does not repeat a task prompt or notification. Notification acknowledgement is not proof that the human read a summary.

The proof records actions, protocol frames, screenshots, and native tool results instead of a trace ZIP. Do not infer physical iPhone keyboard or Safari behavior from Chromium. Do not infer real-model planning quality from the deterministic provider.

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

Use `/maintain-verification-skill` to keep this map aligned with future coordinator changes.
