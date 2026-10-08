import { spawn, execFile } from 'node:child_process';
import { hostname } from 'node:os';
import WebSocket from 'ws';
import { publicOrigin, parseObject, send } from './config.mjs';
import { e2eKey, sealClient } from './e2e.mjs';
import { mobileUrl } from './pairing.mjs';

const deployUrl = 'https://render.com/deploy?repo=https://github.com/peterlimg/pi-remote/tree/main';
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

const install = 'npm install -g opentunnel';
// First setup screen: a tunnel from this computer, or the Render relay guide. `installed` tells
// whether Enter uses opentunnel or installs it first. Resolves 'opentunnel', 'render', or false.
export function connectionScreen(tui, keys, done, { theme = plain, installed = true } = {}) {
  const muted = text => theme.fg('muted', text), accent = text => theme.fg('accent', text);
  return {
    render(width) {
      const rows = Math.max(2, tui.terminal.rows), lines = [];
      const add = (text, style = text => text) => lines.push(...wrap(text, width).map(style));
      add('Connect your phone', theme.bold);
      lines.push(''); add('opentunnel gives this computer a fixed https address with no account. HTTPS ends on this computer, so the tunnel cannot read your traffic.');
      if (!installed) { lines.push(''); add('opentunnel is not installed. Enter installs it with:', muted); add(install, accent); }
      lines.push('');
      for (const [key, label] of [['Enter', installed ? 'Use opentunnel' : 'Install and use opentunnel'], ['R', 'Deploy a Render relay instead'], ['Esc', 'Cancel']]) add(theme.bold(accent(key)) + ' ' + muted(label));
      return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill('')];
    },
    invalidate() {},
    handleInput(data) {
      if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') done(false);
      else if (keys.matches(data, 'tui.select.confirm')) done('opentunnel');
      else if (data.toLowerCase() === 'r') done('render');
    }
  };
}

const runFile = (run, file, args, options) => new Promise(resolve =>
  run(file, args, options, (error, stdout = '', stderr = '') => resolve({ error, stdout: String(stdout), stderr: String(stderr) })));
const lastLine = text => text.trim().split('\n').at(-1);

export async function opentunnelInstalled(run = execFile) {
  return !(await runFile(run, 'opentunnel', ['--version'], { timeout: 10000 })).error;
}

// Global npm installs can need permissions or a PATH entry this process lacks; say what to run.
export async function installOpentunnel(signal, run = execFile) {
  const { error, stderr } = await runFile(run, 'npm', ['install', '-g', 'opentunnel'], { signal, timeout: 300000 });
  if (error) throw new Error('Could not install opentunnel' + (lastLine(stderr) ? ': ' + lastLine(stderr) : '') + '. Run ' + install + ' yourself, then /pi-remote again.');
  if (!await opentunnelInstalled(run)) throw new Error('opentunnel was installed but is not on PATH. Add npm\'s global bin folder to PATH, restart Pi, and run /pi-remote again.');
}

// Route the host's port through opentunnel and return the phone address. `route add` creates the
// tunnel on first use (certificate issuance can take minutes), is idempotent, and prints the URL last.
export function openTunnel(port, signal, run = execFile) {
  return new Promise((resolve, reject) => {
    run('opentunnel', ['route', 'add', 'pi-remote', String(port)], { signal, timeout: 600000 }, (error, stdout = '', stderr = '') => {
      if (error?.code === 'ENOENT') { reject(new Error('opentunnel is not installed. Run ' + install + ', then /pi-remote again.')); return; }
      if (error) { reject(new Error('opentunnel failed: ' + (lastLine(String(stderr)) || error.message))); return; }
      const url = String(stdout).match(/https:\/\/pi-remote\.\S+/)?.[0];
      try { if (url && mobileUrl(url)) { resolve(publicOrigin(url)); return; } } catch { /* Reported below. */ }
      reject(new Error('opentunnel did not print an https address. Check opentunnel status.'));
    });
  });
}

// Only render these credentials in a temporary terminal overlay, never in messages or logs.
// One step per screen. The deploy page asks new users to sign up, but Render's sign-up drops the
// deploy link, so the next step offers to reopen it.
export function deploymentScreen(config, tui, keys, done, { open = openUrl, copy = copyText, theme = plain } = {}) {
  // Render's deploy link cannot prefill the Blueprint name, which must be unique in the workspace.
  const name = 'pi-remote-' + (hostname().split('.')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'relay');
  const steps = [
    { title: 'Open the Render deploy page', body: 'Render\'s free plan is a good choice for hosting the relay. Already have an account? Sign in and deploy directly. No account yet? Render asks you to sign up, which takes a few clicks.', link: deployUrl },
    { title: 'Paste the tokens', body: 'In Render, name the Blueprint ' + name + ', then paste each token into the field with its name.',
      tokens: [['PI_REMOTE_RELAY_HOST_TOKEN', config.relayToken], ['PI_REMOTE_RELAY_CLIENT_TOKEN', config.clientToken]], reopen: deployUrl },
    { title: 'Deploy and paste the address', body: 'Click Deploy and wait until the service is Live. Then paste its https://<name>.onrender.com address here.', address: true }
  ];
  let step = 0, copied, address = '', invalid = false; // copied: { field, ok } once 1 or 2 is pressed on this step.
  const muted = text => theme.fg('muted', text), accent = text => theme.fg('accent', text);
  return {
    render(width) {
      const rows = Math.max(2, tui.terminal.rows), current = steps[step];
      const content = [], add = (text, style = text => text) => content.push(...wrap(text, width).map(style));
      add('Step ' + (step + 1) + ' of ' + steps.length + ' · Deploy your relay', muted);
      add(current.title, theme.bold);
      content.push(''); add(current.body);
      if (current.link) { content.push(''); add(current.link, accent); }
      if (current.tokens) {
        for (const [field, token] of current.tokens) { content.push(''); add(field); add(token, accent); }
        content.push('');
        if (!copied) add('Keep them private. Do not paste them into chat.', muted);
        else if (copied.ok) add('Copied ' + copied.field + '.', text => theme.fg('success', text));
        else add('Could not copy. Select the value above.', text => theme.fg('warning', text));
      }
      if (current.address) {
        content.push(''); add('> ' + address + '_', accent);
        if (invalid) add('Use the https:// address from the Render service page.', text => theme.fg('warning', text));
      }
      // Enter always does the step's action: open its page, or finish it.
      // Letters type into the address, so its step goes back with Backspace on an empty field.
      const hints = [['Enter', current.link ? 'Open in browser' : current.address ? 'Done' : 'Next'],
        current.tokens && ['1', 'Copy host'], current.tokens && ['2', 'Copy client'], current.address ? !address && ['Backspace', 'Back'] : step > 0 && ['B', 'Back'],
        current.reopen && ['O', 'Reopen deploy page'], ['Esc', 'Cancel']].filter(Boolean);
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
      const current = steps[step], key = data.toLowerCase();
      if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') { done(false); return; }
      if (keys.matches(data, 'tui.select.confirm')) {
        if (current.address) {
          let origin;
          try { origin = publicOrigin(address.trim()); } catch { /* Shown as invalid. */ }
          if (origin && mobileUrl(origin)) { done(origin); return; }
          invalid = true;
        } else {
          if (current.link) open(current.link);
          step++; copied = undefined;
        }
      } else if (current.address) {
        // Bracketed paste arrives wrapped in markers; other escape sequences are cursor keys.
        const text = data.replace(/\x1b\[20[01]~/g, '');
        if (data === '\x7f' || data === '\b') { if (address) address = address.slice(0, -1); else step--; }
        else if (!text.startsWith('\x1b')) address += text.replace(/[\x00-\x1f\x7f]/g, '');
        invalid = false;
      } else if (key === 'o' && current.reopen) open(current.reopen);
      else if (key === 'b' && step > 0) { step--; copied = undefined; }
      else if (current.tokens?.[data - 1]) {
        const at = step, [field, token] = current.tokens[data - 1];
        void copy(token).then(ok => { if (step === at) { copied = { field, ok }; tui.requestRender(); } });
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
      ? 'Timed out checking phone login. Check that the relay or tunnel is up and both tokens match. Run /pi-remote to retry, or stop and run /pi-remote setup to correct the settings.'
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

// Pi's default overlay is a box over the middle of the conversation; cover the whole terminal instead.
export const fullScreen = { overlay: true, overlayOptions: { width: '100%', maxHeight: '100%', margin: 0 } };

// Run a slow task on a full-screen progress view, so the conversation never shows a stalled line.
// True when the task finishes, false when Esc cancels it; the task's error is rethrown.
export async function progress(ui, title, task, hint = 'A sleeping Render service can take a minute.') {
  const result = await ui.custom((tui, theme = plain, keys, done) => {
    const controller = new AbortController();
    let finished = false;
    const finish = value => { if (!finished) { finished = true; done(value); } };
    task(controller.signal).then(() => finish({}), error => finish({ error }));
    return {
      render: width => {
        const rows = Math.max(2, tui.terminal.rows), lines = [...wrap(title, width).map(theme.bold),
          ...wrap(hint + ' Esc cancels.', width).map(text => theme.fg('muted', text))].slice(0, rows);
        return [...lines, ...Array(rows - lines.length).fill('')];
      },
      invalidate() {},
      handleInput(data) {
        if (keys.matches(data, 'tui.select.cancel') || data === '\u0003') { finish(false); controller.abort(); }
      },
      dispose() { finished = true; controller.abort(); }
    };
  }, fullScreen);
  if (result?.error) throw result.error;
  return !!result;
}

export const checkRelay = (ui, config) => progress(ui, 'Checking phone login...',
  signal => verifyRelay(config, AbortSignal.any([signal, AbortSignal.timeout(90000)])));
