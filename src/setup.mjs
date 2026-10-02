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
// Resolves false when no clipboard tool exists, so the screen never claims a copy it did not make.
export function copyText(text) {
  const [command, ...args] = process.platform === 'darwin' ? ['pbcopy'] : process.env.WAYLAND_DISPLAY ? ['wl-copy'] : ['xclip', '-selection', 'clipboard'];
  return new Promise(resolve => {
    try {
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => resolve(false)).on('close', code => resolve(code === 0));
      child.stdin.on('error', () => {}); child.stdin.end(text);
    } catch { resolve(false); }
  });
}
// Break at spaces; split only words longer than the line, such as links and tokens.
const wrap = (text, width) => {
  width = Math.max(1, width);
  return text.match(new RegExp('\\S.{0,' + (width - 1) + '}(?=\\s|$)|\\S{1,' + width + '}', 'g')) || [''];
};

// Only render these credentials in a temporary terminal overlay, never in messages or logs.
// One step per screen; sign-up comes before the deploy link because Render's sign-up drops it.
export function deploymentScreen(config, tui, keys, done, open = openUrl, copy = copyText) {
  const steps = [
    { title: 'Create a free Render account', body: 'Already have one? Press Enter to skip.', link: signupUrl },
    { title: 'Open the deploy page', body: 'It deploys peterlimg/pi-remote from GitHub. No fork or local build needed.', link: deployUrl },
    { title: 'Paste the host token', body: 'In Render, paste it into PI_REMOTE_RELAY_HOST_TOKEN.', token: config.relayToken },
    { title: 'Paste the client token', body: 'Paste it into PI_REMOTE_RELAY_CLIENT_TOKEN.', token: config.clientToken },
    { title: 'Deploy', body: 'Click Deploy and wait until the service is Live. Then press Enter and paste its https://<name>.onrender.com address.' }
  ];
  let step = 0, copied; // copied: undefined until C is pressed on this step.
  return {
    render(width) {
      const rows = Math.max(2, tui.terminal.rows), current = steps[step], last = step === steps.length - 1;
      const lines = ['Deploy your relay. Step ' + (step + 1) + ' of ' + steps.length + ': ' + current.title, '', current.body];
      if (current.link) lines.push('', current.link);
      if (current.token) lines.push('', current.token, '', copied === undefined ? 'Keep it private. Do not paste it into chat.'
        : copied ? 'Copied to the clipboard.' : 'Could not copy. Select the value above.');
      const hints = [current.link && 'O: open', current.token && 'C: copy', step > 0 && 'B: back', last ? 'Enter: done' : 'Enter: next', 'Esc: cancel'];
      const footer = wrap(hints.filter(Boolean).join(' | '), width).slice(0, rows - 1);
      return [...lines.flatMap(line => wrap(line, width)).slice(0, rows - footer.length - 1), '', ...footer];
    },
    invalidate() {},
    handleInput(data) {
      const current = steps[step], key = data.toLowerCase();
      if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') { done(false); return; }
      if (keys.matches(data, 'tui.select.confirm')) {
        if (step === steps.length - 1) { done(true); return; }
        step++; copied = undefined;
      } else if (key === 'b' && step > 0) { step--; copied = undefined; }
      else if (key === 'o' && current.link) open(current.link);
      else if (key === 'c' && current.token) {
        const at = step;
        void copy(current.token).then(ok => { if (step === at) { copied = ok; tui.requestRender(); } });
      }
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
