import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe';
const MAX_AUDIO = 2 * 1024 * 1024, MAX_TEXT = 16000;
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

async function boundedText(response, max) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw failure('ChatGPT returned an invalid transcription. Try again.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function recordingFile(recording) {
  if (!recording || !['audio/mp4', 'audio/webm'].includes(recording.type) || typeof recording.data !== 'string' ||
    recording.data.length > Math.ceil(MAX_AUDIO / 3) * 4 || recording.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(recording.data)) {
    throw failure('Invalid voice recording.');
  }
  const audio = Buffer.from(recording.data, 'base64');
  const valid = recording.type === 'audio/mp4' ? audio.toString('ascii', 4, 8) === 'ftyp' : audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!valid || audio.length < 12 || audio.length > MAX_AUDIO || audio.toString('base64') !== recording.data) throw failure('Invalid voice recording.');
  return new Blob([audio], { type: recording.type });
}

// One bounded recording per authenticated phone connection; uploads are never written to disk.
export class VoiceSession {
  constructor({ emit, readAuth = readVoiceAuth, fetchImpl = fetch }) {
    Object.assign(this, { emit, readAuth, fetchImpl });
  }
  get active() { return this.call; }
  cancel(id) {
    const call = this.call;
    if (!call || id !== undefined && call.id !== id) return;
    this.call = undefined; activeCalls--;
    clearTimeout(call.deadline); clearTimeout(call.requestTimer);
    call.controller.abort();
  }
  async start({ id, sessionId, model, format }) {
    if (format !== 'recording' || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw failure('Refresh Pi Remote to use dictation.');
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
      call.auth = await this.readAuth();
      if (this.call !== call) throw failure('Dictation cancelled.');
      return {};
    } catch (error) {
      if (this.call === call) this.cancel(id);
      throw error.public ? error : failure('Could not start ChatGPT dictation. Try again.');
    }
  }
  async finish(id, recording) {
    const call = this.call;
    if (!call || call.id !== id) throw failure('Dictation is no longer active.');
    if (call.finishing) throw failure('Dictation is already finishing.');
    if (!call.auth) throw failure('Dictation is not ready.');
    call.finishing = true;
    try {
      const file = recordingFile(recording), form = new FormData();
      form.append('file', file, recording.type === 'audio/mp4' ? 'audio.m4a' : 'audio.webm');
      call.requestTimer = setTimeout(() => call.controller.abort(), 20000);
      const response = await this.fetchImpl(TRANSCRIBE_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${call.auth.token}`, 'ChatGPT-Account-Id': call.auth.account, 'User-Agent': 'pi-remote/0.1' },
        body: form, signal: call.controller.signal, redirect: 'error'
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw failure(response.status === 401 ? 'Your Codex ChatGPT login expired. Sign in again on your computer.' :
          response.status === 403 ? 'This ChatGPT account cannot use dictation.' :
          response.status === 429 ? 'ChatGPT voice quota is unavailable. Try later; no paid API fallback was used.' : 'ChatGPT dictation is unavailable. Try again.');
      }
      const result = JSON.parse(await boundedText(response, 128 * 1024));
      if (this.call !== call) throw failure('Dictation cancelled.');
      if (typeof result?.text !== 'string' || result.text.length > MAX_TEXT) throw failure('ChatGPT returned an invalid transcription. Try again.');
      return { text: result.text.trim() };
    } catch (error) {
      throw error.public ? error : failure(call.controller.signal.aborted ? 'Dictation was cancelled or timed out. Try again.' : 'Could not transcribe the recording. Try again.');
    } finally { if (this.call === call) this.cancel(id); }
  }
}
