import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { publicOrigin, parseObject, send } from './config.mjs';
import { e2eKey, sealClient } from './e2e.mjs';

const deployUrl = 'https://render.com/deploy?repo=https://github.com/peterlimg/pi-remote/tree/main';
const signupUrl = 'https://dashboard.render.com/register', dashboardUrl = 'https://dashboard.render.com';
// Best effort: the link stays on screen if no browser opener exists. BROWSER overrides the
// opener, as in many CLIs, for SSH sessions and tests.
export function openUrl(url) {
  try { spawn(process.env.BROWSER || (process.platform === 'darwin' ? 'open' : 'xdg-open'), [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* Link is shown. */ }
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

const plain = { fg: (_color, text) => text, bold: text => text };

// Only render these credentials in a temporary terminal overlay, never in messages or logs.
// One step per screen. A new relay starts with sign-up because Render's sign-up drops the deploy
// link; an existing relay only needs this computer's tokens, not a second deployment.
export function deploymentScreen(config, tui, keys, done, { open = openUrl, copy = copyText, theme = plain } = {}) {
  const live = 'wait until the service is Live. Then press Enter and paste its https://<name>.onrender.com address.';
  const paths = {
    n: ['Deploy a new relay', [
      { title: 'Create a free Render account', body: 'Already have one? Press Enter to skip.', link: signupUrl },
      { title: 'Open the deploy page', body: 'It deploys peterlimg/pi-remote from GitHub. No fork or local build needed.', link: deployUrl, openOnEnter: true },
      { title: 'Paste the host token', body: 'In Render, paste it into PI_REMOTE_RELAY_HOST_TOKEN.', token: config.relayToken },
      { title: 'Paste the client token', body: 'Paste it into PI_REMOTE_RELAY_CLIENT_TOKEN.', token: config.clientToken },
      { title: 'Deploy', body: 'Click Deploy and ' + live }
    ]],
    y: ['Use your relay', [
      { title: 'Open your relay in Render', body: 'Click your relay\'s name in the service list, such as pi-remote-relay. On the service page that opens, choose Environment in the left menu.', link: dashboardUrl, openOnEnter: true },
      { title: 'Set the host token', body: 'Set PI_REMOTE_RELAY_HOST_TOKEN to it. If it already matches, press Enter.', token: config.relayToken },
      { title: 'Set the client token', body: 'Set PI_REMOTE_RELAY_CLIENT_TOKEN to it. If it already matches, press Enter.', token: config.clientToken },
      { title: 'Save', body: 'Save the changes if you made any, and ' + live }
    ]]
  };
  let path, step = 0, copied; // path: undefined while asking; copied: undefined until C is pressed on this step.
  const muted = text => theme.fg('muted', text), accent = text => theme.fg('accent', text);
  return {
    render(width) {
      const rows = Math.max(2, tui.terminal.rows), [name, steps] = paths[path] || [], current = steps?.[step];
      const content = [], add = (text, style = text => text) => content.push(...wrap(text, width).map(style));
      let hints;
      if (!current) {
        add('Set up your relay', muted);
        add('Do you already have a Pi Remote relay on Render?', theme.bold);
        content.push(''); add('It forwards your phone to this computer. Each computer needs its own.');
        hints = [['N', 'No, deploy one'], ['Y', 'Yes, use it'], ['Esc', 'Cancel']];
      } else {
        add('Step ' + (step + 1) + ' of ' + steps.length + ' · ' + name, muted);
        add(current.title, theme.bold);
        content.push(''); add(current.body);
        if (current.link) { content.push(''); add(current.link, accent); }
        if (current.token) {
          content.push(''); add(current.token, accent); content.push('');
          if (copied === undefined) add('Keep it private. Do not paste it into chat.', muted);
          else if (copied) add('Copied to the clipboard.', text => theme.fg('success', text));
          else add('Could not copy. Select the value above.', text => theme.fg('warning', text));
        }
        // A required page opens on Enter; an optional one, such as sign-up, only on O.
        hints = [current.link && !current.openOnEnter && ['O', 'Open in browser'], current.token && ['C', 'Copy'], ['B', 'Back'],
          ['Enter', current.openOnEnter ? 'Open in browser' : step === steps.length - 1 ? 'Done' : 'Next'], ['Esc', 'Cancel']].filter(Boolean);
      }
      // Keys sit right under the step, not at the bottom of a tall terminal.
      const styled = ([key, label]) => theme.bold(accent(key)) + ' ' + muted(label), text = ([key, label]) => key + ' ' + label;
      const packed = []; // Pack hints onto as few lines as fit, so a short terminal keeps the token visible.
      for (const hint of hints) {
        const line = packed.at(-1);
        if (line && line.width + 3 + text(hint).length <= width) { line.width += 3 + text(hint).length; line.text += '   ' + styled(hint); }
        else packed.push({ width: text(hint).length, text: styled(hint) });
      }
      const keyLines = packed.map(line => line.text);
      const lines = [...content.slice(0, Math.max(0, rows - keyLines.length - 1)), '', ...keyLines].slice(-rows);
      // Fill the terminal so Pi's startup output never shows around a short step.
      return [...lines, ...Array(rows - lines.length).fill('')];
    },
    invalidate() {},
    handleInput(data) {
      const steps = paths[path]?.[1], current = steps?.[step], key = data.toLowerCase();
      if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') { done(false); return; }
      if (!current) { if (paths[key]) path = key; }
      else if (keys.matches(data, 'tui.select.confirm')) {
        if (step === steps.length - 1) { done(true); return; }
        if (current.openOnEnter) open(current.link);
        step++; copied = undefined;
      } else if (key === 'b') { if (step > 0) step--; else path = undefined; copied = undefined; }
      else if (key === 'o' && current.link) open(current.link);
      else if (key === 'c' && current.token) {
        const at = current;
        void copy(current.token).then(ok => { if (paths[path]?.[1][step] === at) { copied = ok; tui.requestRender(); } });
      }
      tui.requestRender();
    }
  };
}

// A relay always answers /health with 'ok'. Any other definite answer, such as Render's 404 for a
// deleted service, means the saved address is not a relay. Network errors, timeouts (a sleeping
// service) and 5xx (a restarting one) may be temporary, so they never count.
export async function relayGone(origin, signal = AbortSignal.timeout(5000)) {
  try {
    const res = await fetch(new URL('/health', origin), { signal });
    return res.status < 500 && (await res.text()) !== 'ok';
  } catch { return false; }
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
