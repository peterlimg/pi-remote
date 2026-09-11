# Pi Remote

Control Pi coding-agent sessions from a mobile browser. Open one session while the others keep working.

This is an initial implementation. Development and Render deployments use the `main` branch.

## What it does

- Lists live sessions across Pi terminals and saved sessions across project directories.
- Streams Markdown conversation and compact tool updates. Tool rows show file paths with line ranges or shell commands; shell output previews the last five available lines. Expand a row for full inputs and available output. Raw HTML and remote images are disabled.
- Sends prompts, steering messages and follow-ups to the selected live session.
- Keeps independent message drafts while navigating between sessions.
- Browses saved session history and optionally resumes a session in a Pi RPC worker.
- Handles standard confirmation/input/selection dialogs from RPC workers.
- Reconnects automatically and fetches a fresh snapshot. Uncertain commands are never automatically replayed.
- Supports a local HTTPS tunnel or a self-hosted relay with an outbound computer connection.

## Quick start on your computer

Requires Node.js 22.19+ and a working Pi installation with your existing model credentials.

```sh
git clone --branch main https://github.com/peterlimg/pi-remote.git
cd pi-remote
npm install
pi install .
npm link
pi-remote serve
```

Keep the service running. In each existing Pi terminal run `/reload` once to load the installed extension. New Pi terminals load it automatically.

In another terminal:

```sh
pi-remote pair
```

Open the printed private link in a browser on the computer to check the session list. The default localhost URL only works on that computer; use one of the remote-access setups below for your phone.

The extension registers on session start, including sessions whose file has not been flushed to disk yet. Completely ephemeral `--no-session` sessions are not exposed.

### Use your phone through an HTTPS tunnel

Point your preferred HTTPS tunnel/reverse proxy at `http://127.0.0.1:8787` with WebSocket forwarding enabled. Set its exact public origin when starting the service:

```sh
export PI_REMOTE_PUBLIC_URL=https://your-remote-domain.example
pi-remote serve
```

Then, in another terminal with the same variable:

```sh
PI_REMOTE_PUBLIC_URL=https://your-remote-domain.example pi-remote pair
```

Open that link on the phone. You can add it to the home screen. The tunnel must remain active and the computer must stay awake.

### Or run the included relay

The relay is a separate Node service on a server you control. A TLS reverse proxy provides HTTPS/WSS. The relay supports **one computer and up to 16 simultaneous browser connections**, with any number of Pi sessions on that computer.

1. On your computer, run `pi-remote relay-env`. This intentionally prints the relay's two credentials. Transfer them privately to the relay server's environment.
2. Install this repository and its dependencies on the relay server.
3. Run the relay behind HTTPS:
```sh
# On the relay server, set the two values printed by relay-env:
export PI_REMOTE_RELAY_HOST_TOKEN='...'
export PI_REMOTE_RELAY_CLIENT_TOKEN='...'
export PI_REMOTE_PUBLIC_URL=https://your-remote-domain.example
pi-remote relay
```

The relay listens on `127.0.0.1:8788`. Forward HTTPS requests and WebSocket upgrades to it. For example, with Caddy:

```caddyfile
your-remote-domain.example {
    reverse_proxy 127.0.0.1:8788
}
```

4. On your computer:
```sh
export PI_REMOTE_RELAY_URL=wss://your-remote-domain.example
export PI_REMOTE_PUBLIC_URL=https://your-remote-domain.example
pi-remote serve
```

5. Run `pi-remote pair` with that public URL and open the link on your phone.

The computer makes an outbound WSS connection; no inbound port is needed on the computer. The relay can read transmitted content. This version does **not** implement end-to-end encryption or one-time QR pairing.

### Deploy the relay on Render

The included `render.yaml` runs only the relay and mobile web app. Pi, model credentials, session files and RPC workers stay on your computer. No database or persistent disk is needed on Render.

1. On your computer, run `node bin/pi-remote.mjs relay-env`. Keep both printed values private; they must match the computer's config, not newly generated Render secrets.
2. In the [Render dashboard](https://dashboard.render.com/), select **New > Blueprint**, connect `peterlimg/pi-remote`, and select branch `main`.
3. Use `render.yaml`, enter the two token values when prompted, and deploy. The Blueprint uses the Free plan and automatically deploys pushes after CI passes. Free services can sleep after 15 minutes without inbound traffic and take about a minute to wake. Use a paid instance if you need to avoid idle spin-down.
4. Copy the service's actual `https://…onrender.com` URL. Verify the relay is up:
```sh
curl --fail https://YOUR-SERVICE.onrender.com/health
# Expected: ok
```
5. On your computer, start the host with the matching Render URL:
```sh
export PI_REMOTE_PUBLIC_URL=https://YOUR-SERVICE.onrender.com
export PI_REMOTE_RELAY_URL=wss://YOUR-SERVICE.onrender.com
node bin/pi-remote.mjs serve
```
6. In another terminal, create the phone link:
```sh
PI_REMOTE_PUBLIC_URL=https://YOUR-SERVICE.onrender.com node bin/pi-remote.mjs pair
```

Install the extension and reload your Pi terminals as described in Quick start. Open the private link on your phone, check that sessions appear, and send a test prompt. `/health` confirms only the relay is running, not that your computer is connected.

To update, push to the linked branch and wait for CI and the Render deploy to pass. Then run `npm ci --ignore-scripts` locally, restart the local host, run `/reload` in your Pi terminals, and refresh the phone page.

Render terminates TLS and forwards WebSockets. The start command maps Render's `PORT` and `RENDER_EXTERNAL_URL` to the relay settings; the bind address is `0.0.0.0`. Keep exactly one service instance because host/client routing lives in memory. Deploys disconnect sockets; clients reconnect without replaying uncertain commands. If adding a custom domain, update the start command's public URL and your computer's public/relay URLs to match it.

## Navigating sessions

Selecting a session changes only the browser subscription. It never sends `/resume` to another terminal or stops another session's work.

Send uses Pi's default behavior: start a message when idle or steer while working, without a mode selector. On desktop, Enter sends, Shift+Enter inserts a newline, and Alt+Enter queues a follow-up. On touch devices, Enter inserts a newline; use Send to submit. Expand a tool row to inspect its input and output. Project paths are under Details, and scan warnings are under the connection status in the session list.

| Status | Meaning |
|---|---|
| working | Pi is running |
| waiting | Pi needs input |
| idle | Connected and ready for another instruction |
| saved | History is on disk; a worker can be started if enabled |
| disconnected | A terminal connection was lost or remote access was disabled |
| starting | A saved-session worker is starting |

Saved history follows the last persisted branch. A live extension reports Pi's actual current branch. Mobile history is limited to the latest 100 messages; each message is limited to 24,000 characters, and tool output to 12,000 characters. The UI marks shortened history/output.

### Saved-session resume and ownership

After loading the extension in **every** running Pi instance, start the service with:

```sh
pi-remote serve --allow-resume
```

The Resume button can then start a saved session in its original project directory. A currently connected session attaches to its existing process.

Locks are cooperative: Pi processes without this extension do not participate. Do not open the same saved file in an uninstrumented Pi process while the service manages it. Enabling resume is a local assertion that this condition is met.

- Each terminal and each RPC worker owns an exclusive session lock.
- A disconnected terminal keeps its lock. Lost heartbeats never authorize takeover.
- Normal shutdown releases ownership.
- After a crash, recovery is explicit:
```sh
pi-remote unlock /absolute/path/to/session.jsonl
# If the service itself crashed:
pi-remote unlock service
```

Recovery refuses while the recorded owner or RPC worker PID still exists. If an RPC spawn crashed before its worker PID was recorded, inspect processes locally before manually repairing the lock; automatic takeover stays blocked.

### Terminal controls

- `/remote`: show pairing instructions.
- `/remote off`: disable this terminal's remote channel while retaining its ownership lock.
- `/remote on`: reconnect.
- `/reload`: reload the extension after an update.

**Abort turn differs by runtime:** RPC workers clear queued messages and abort. The terminal extension can only invoke Pi's exposed `ctx.abort()`; queued messages may still run. It does not pretend to provide “stop everything.”

Arbitrary terminal dialogs from other extensions cannot be answered from the phone. Standard RPC worker dialogs can. Expired dialog responses remain subject to Pi's own timeout handling.

## Configuration

| Variable | Default / purpose |
|---|---|
| `PI_REMOTE_HOME` | `~/.pi/remote`; use the same value in Pi terminals and the service |
| `PI_REMOTE_PORT` | Local service port, default 8787; same value in the service and extensions |
| `PI_REMOTE_SESSION_DIRS` | Session roots, separated by `:` on macOS/Linux (`;` on Windows); default `~/.pi/agent/sessions` |
| `PI_REMOTE_PI_BIN` | Pi executable for RPC workers, default `pi` |
| `PI_REMOTE_PUBLIC_URL` | Exact public HTTPS origin for browser origin checks and pairing links |
| `PI_REMOTE_RELAY_URL` | Optional outbound WSS relay URL |
| `PI_REMOTE_RELAY_PORT` | Relay port, default 8788 |
| `PI_REMOTE_RELAY_BIND` | Relay bind address, default 127.0.0.1 |

Keep API/model credentials in your existing Pi configuration. They are not sent to the relay. Conversation/tool text can of course contain secrets, so treat the relay and paired browsers as trusted.

## Access and persistence

The private pairing link grants access to all exposed sessions. Its token is taken from the URL fragment, removed from browser history, and stored in sessionStorage. This version has a shared client token, not individual device identities. Sign out clears the token and drafts from that tab.

To revoke all phone access, stop the host/relay, replace `clientToken` in `~/.pi/remote/config.json` with a fresh 32-byte random value, update the relay client token if used, and restart. Rotate `relayToken` separately if the relay host credential was exposed.

Command journals are stored in `~/.pi/remote/commands` and `extension-commands`. They contain prompt text and results, protected by local directory/file permissions. They are not automatically pruned in this version. A request ID is never reused with different content. Interrupted requests remain unknown and require inspection rather than automatic replay.

## Verification

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

CI checks Node 22 and 24, session ownership, restart deduplication, Unicode-safe RPC framing, the actual extension with a mocked Pi API, real WebSocket routing, saved RPC workers with a fake Pi process, relay connections, and mobile browser navigation. A separate smoke job loads the extension in Pi 0.85.1 and exercises registration and remote on/off without a model call.

A real model/tool smoke test on your Mac is still needed. CI does not validate your provider credentials, your other extensions, Safari-specific behaviour, your tunnel or a deployed relay.

## Scope of this version

- macOS/Linux host use is the primary target; no automatic launch-at-login installer.
- One computer per relay; no accounts or multi-user permissions.
- Shared revocable tokens; no one-time pairing codes or per-device revocation.
- No push notifications, image uploads, syntax highlighting or dedicated diff viewer.
- No remote creation of brand-new sessions; start one in Pi, then control it from mobile.
- Session browsing uses Pi's JSONL format; the full Pi session tree remains available in the terminal.
- Sessions larger than 32 MiB are excluded from saved browsing; scans cap at 5,000 files.
- The UI is a mobile web app with a home-screen manifest. It has no offline worker or native iOS app.
