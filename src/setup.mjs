import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { publicOrigin, parseObject, send } from './config.mjs';
import { e2eKey, sealClient } from './e2e.mjs';

const deployUrl = 'https://render.com/deploy?repo=https://github.com/peterlimg/pi-remote/tree/main';
const signupUrl = 'https://dashboard.render.com/register';
// Best effort: the link stays on screen if no browser opener exists.
export function openUrl(url) {
  try { spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* Link is shown. */ }
}
const wrap = (text, width) => text.match(new RegExp('.{1,' + Math.max(1, width) + '}', 'g')) || [''];

// Only render these credentials in a temporary terminal overlay, never in messages or logs.
export function deploymentScreen(config, tui, keys, done, open = openUrl) {
  // Render's sign-up drops the deploy link, so sign-up comes first and O reopens the link.
  const text = [
    'Deploy your relay on Render (one-time setup)', '',
    '1. No Render account? Create one first (free):', signupUrl,
    'Already have one? Skip this step.', '',
    '2. Press O to open the deploy page (press again after signing up):', deployUrl,
    'Source: peterlimg/pi-remote, branch main. No fork or local build needed.', '',
    '3. Paste these values into the matching Render fields:',
    'PI_REMOTE_RELAY_HOST_TOKEN', config.relayToken, '',
    'PI_REMOTE_RELAY_CLIENT_TOKEN', config.clientToken, '',
    'Keep these values private. Do not paste them into chat.', '',
    '4. Click Deploy and wait until the service is Live.',
    '5. Copy its HTTPS address, then return here and press Enter.', '',
    'Render handles HTTPS/WSS. The Free plan may sleep; a paid instance avoids this.',
    'Already deployed elsewhere? Configure the same tokens there, then press Enter.'
  ];
  let offset = 0, maximum = 0;
  return {
    render(width) {
      const rows = Math.max(2, tui.terminal.rows);
      const footer = wrap('O: open deploy page | Up/Down: scroll | Enter: deployed | Esc: cancel', width).slice(0, rows - 1);
      const lines = text.flatMap(line => wrap(line, width));
      const size = rows - footer.length;
      maximum = Math.max(0, lines.length - size); offset = Math.min(offset, maximum);
      return [...lines.slice(offset, offset + size), ...footer];
    },
    invalidate() {},
    handleInput(data) {
      if (keys.matches(data, 'tui.select.confirm')) { done(true); return; }
      if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') { done(false); return; }
      if (data === 'o' || data === 'O') open(deployUrl);
      if (keys.matches(data, 'tui.select.up')) offset = Math.max(0, offset - 1);
      if (keys.matches(data, 'tui.select.down')) offset = Math.min(maximum, offset + 1);
      tui.requestRender();
    }
  };
}

// Exercise the phone's authentication path. A relay /health response alone cannot
// prove that either token matches or that the computer has connected.
export function verifyRelay(config, signal = AbortSignal.timeout(90000)) {
  const origin = publicOrigin(config.publicUrl), url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  return new Promise((resolve, reject) => {
    let socket, retry, attemptTimer, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(retry); clearTimeout(attemptTimer);
      signal.removeEventListener('abort', abort);
      socket?.terminate();
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error(signal.reason?.name === 'TimeoutError'
      ? 'Timed out checking relay. Check Render is Live and both tokens match. Run /pi-remote to retry, or stop and run /pi-remote setup to correct the settings.'
      : 'Relay check cancelled'));
    const connect = () => {
      if (finished) return;
      const ws = new WebSocket(url, { origin, handshakeTimeout: 20000, maxPayload: 4 * 1024 * 1024 });
      socket = ws;
      attemptTimer = setTimeout(() => ws.terminate(), 20000);
      // A ready packet that decrypts proves the token, the key and the computer connection.
      ws.on('open', () => {
        // Once open, a connected computer answers within a second. Relay notices and close
        // frames can be lost in its proxy, so never wait out the full attempt for them.
        clearTimeout(attemptTimer); attemptTimer = setTimeout(() => ws.terminate(), 5000);
        ws.on('message', raw => {
          try { if (parseObject(raw).error === 'Computer is offline') ws.terminate(); } catch { /* Sealed frame. */ }
        });
        send(ws, { type: 'auth', token: config.clientToken, e2e: true });
        sealClient(ws, e2eKey(config), sealed => sealed.on('message', raw => {
          try { if (parseObject(raw).type === 'ready') finish(); } catch { /* Wait for a valid ready packet. */ }
        }));
      });
      ws.on('error', () => {}); // close handles retry; never expose server errors or credentials.
      ws.on('close', (code, reason) => {
        clearTimeout(attemptTimer);
        if (finished) return;
        if (code === 1008 && reason.toString() !== 'Authentication required') {
          finish(new Error('Relay rejected the client token. Stop Pi Remote and run /pi-remote setup to check the Render credentials.'));
        } else retry = setTimeout(connect, 2000);
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else connect();
  });
}

export async function checkRelay(ui, config) {
  const result = await ui.custom((_tui, _theme, keys, done) => {
    const controller = new AbortController();
    let finished = false;
    const finish = value => { if (!finished) { finished = true; done(value); } };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
    verifyRelay(config, signal).then(() => finish(true), error => finish(error.message));
    return {
      render: width => ['Checking relay and phone login...', 'A sleeping Render service can take a minute. Esc cancels.'].flatMap(line => wrap(line, width)),
      invalidate() {},
      handleInput(data) {
        if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') { finish(false); controller.abort(); }
      },
      dispose() { finished = true; controller.abort(); }
    };
  }, { overlay: true });
  if (typeof result === 'string') throw new Error(result);
  return result === true;
}
