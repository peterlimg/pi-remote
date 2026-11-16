import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const CALL_URL = 'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas';
let activeCalls = 0;
const failure = message => Object.assign(new Error(message), { public: true });

export async function readVoiceAuth() {
  // shortcut: Codex owns login/refresh; ask for a fresh login when its saved token expires.
  try {
    const auth = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'));
    const token = auth.tokens?.access_token;
    if (auth.auth_mode !== 'chatgpt' || typeof token !== 'string') throw new Error();
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const account = auth.tokens.account_id || claims['https://api.openai.com/auth']?.chatgpt_account_id;
    if (typeof account !== 'string' || !account || !(claims.exp * 1000 > Date.now() + 30000)) throw new Error();
    return { token, account };
  } catch { throw failure('Sign in to Codex with ChatGPT on your computer, then try dictation again.'); }
}

async function readAnswer(response) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 256 * 1024) throw failure('ChatGPT returned an invalid voice connection. Try again.');
    chunks.push(chunk);
  }
  const sdp = Buffer.concat(chunks).toString('utf8');
  if (!sdp.startsWith('v=0') || !/^m=audio /m.test(sdp) || !/^m=application /m.test(sdp)) throw failure('ChatGPT returned an invalid voice connection. Try again.');
  return sdp;
}

// Authorize SDP only. Audio and transcripts use the browser's direct WebRTC connection, never a host sideband.
export class VoiceSession {
  constructor({ emit, readAuth = readVoiceAuth, fetchImpl = fetch }) {
    Object.assign(this, { emit, readAuth, fetchImpl });
  }
  get active() { return this.call; }
  cancel(id) {
    const call = this.call;
    if (!call || id !== undefined && call.id !== id) return;
    this.call = undefined; activeCalls--;
    clearTimeout(call.deadline); call.controller.abort();
  }
  async start({ id, sessionId, model, format, sdp }) {
    if (format !== 'webrtc-direct' || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw failure('Refresh Pi Remote to use dictation.');
    if (typeof sdp !== 'string' || sdp.length > 128 * 1024 || !sdp.startsWith('v=0') ||
      (sdp.match(/^m=audio /gm) || []).length !== 1 || (sdp.match(/^m=application /gm) || []).length !== 1 ||
      /^m=(?!audio |application )/m.test(sdp)) throw failure('Invalid voice connection.');
    if (this.call) throw failure('Finish or cancel the current dictation first.');
    if (activeCalls >= 4 || Date.now() - (this.lastStart || 0) < 3000) throw failure('Please wait a moment before recording again.');
    this.lastStart = Date.now(); activeCalls++;
    const call = this.call = { id, sessionId, model, controller: new AbortController() };
    call.deadline = setTimeout(() => {
      this.emit({ id, sessionId, error: 'Dictation reached its time limit. Try recording again.' });
      this.cancel(id);
    }, 150000);
    call.deadline.unref();
    try {
      const { token, account } = await this.readAuth();
      if (this.call !== call) throw failure('Dictation cancelled.');
      const response = await this.fetchImpl(CALL_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'chatgpt-account-id': account,
          'OpenAI-Alpha': 'quicksilver=v2', 'User-Agent': 'pi-remote/0.1', 'Content-Type': 'application/json',
          'session-id': randomUUID(), 'thread-id': randomUUID(), 'x-session-id': randomUUID() },
        body: JSON.stringify({ sdp, session: { model: 'gpt-live-1-codex',
          instructions: 'Transcribe the user speech accurately. Do not answer the user, speak, or call tools.',
          audio: { output: { voice: 'cove' } }, delegation: { type: 'client', ack_filler: false } } }),
        signal: AbortSignal.any([call.controller.signal, AbortSignal.timeout(15000)]), redirect: 'error'
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw failure(response.status === 401 ? 'Your Codex ChatGPT login expired. Sign in again on your computer.' :
          response.status === 403 ? 'This ChatGPT account cannot use dictation.' :
          response.status === 429 ? 'ChatGPT voice quota is unavailable. Try later; no paid API fallback was used.' : 'ChatGPT dictation is unavailable. Try again.');
      }
      const answer = await readAnswer(response);
      if (this.call !== call) throw failure('Dictation cancelled.');
      return { sdp: answer };
    } catch (error) {
      if (this.call === call) this.cancel(id);
      throw error.public ? error : failure('Could not start ChatGPT dictation. Try again.');
    }
  }
}
