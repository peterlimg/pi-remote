import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { modelList } from './commands.mjs';

export class JsonLines {
  constructor(onValue, max = 8 * 1024 * 1024) { this.decoder = new StringDecoder('utf8'); this.buffer = ''; this.onValue = onValue; this.max = max; }
  push(chunk) {
    this.buffer += this.decoder.write(chunk);
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > this.max) throw new Error('RPC record too large');
      if (line.trim()) this.onValue(JSON.parse(line));
    }
    if (this.buffer.length > this.max) throw new Error('RPC record too large');
  }
}
export class RpcWorker extends EventEmitter {
  constructor(file, cwd, options = {}) {
    super(); this.pending = new Map(); this.stderr = '';
    this.process = spawn(options.bin || process.env.PI_REMOTE_PI_BIN || 'pi', [...(options.prefix || []), '--mode', 'rpc', ...(file ? ['--session', file] : ['--session-dir', options.sessionDir])],
      { cwd, env: { ...process.env, PI_REMOTE_WORKER: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.exited = new Promise(resolve => this.process.once('close', resolve));
    this.process.stdin.on('error', () => {});
    const parser = new JsonLines(value => {
      if (value.type === 'response' && this.pending.has(value.id)) {
        const item = this.pending.get(value.id); this.pending.delete(value.id); clearTimeout(item.timer);
        if (value.success) item.resolve(value.data); else item.reject(new Error(value.error || 'Pi command failed'));
      } else this.emit('event', value);
    });
    this.process.stdout.on('data', chunk => { try { parser.push(chunk); } catch (e) { this.fail(e); this.process.kill(); } });
    this.process.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-2000); });
    this.process.on('error', error => this.fail(error));
    this.process.on('close', () => {
      this.closed = true;
      this.fail(new Error('Pi worker exited' + (this.stderr ? ': ' + this.stderr : '')));
      this.emit('exit');
    });
  }
  fail(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.emit('fault', error);
  }
  request(type, data = {}) {
    if (this.closed) return Promise.reject(new Error('Pi worker is closed'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Pi response timed out; delivery may have occurred')); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ ...data, id, type }) + '\n');
    });
  }
  async command(command) {
    if (command.type === 'getCommands') return this.request('get_commands');
    if (command.type === 'getModels') {
      const { models } = await this.request('get_available_models');
      const state = await this.request('get_state');
      return { models: modelList(models), current: state.model ? `${state.model.provider}/${state.model.id}` : undefined };
    }
    if (command.type === 'setModel') {
      await this.request('set_model', { provider: command.provider, modelId: command.modelId });
      const state = await this.request('get_state');
      return { model: `${state.model.provider}/${state.model.id}`, thinkingLevel: state.thinkingLevel };
    }
    if (command.type === 'abort') {
      await this.request('clear_queue');
      await this.request('abort');
    } else if (command.type === 'prompt' || command.text.startsWith('/')) {
      // Extension commands must use prompt, even when submitted with Alt+Enter.
      await this.request('prompt', { message: command.text, streamingBehavior: command.type === 'followUp' ? 'followUp' : 'steer' });
    } else {
      await this.request(command.type === 'followUp' ? 'follow_up' : 'steer', { message: command.text });
    }
    return { accepted: true };
  }
  async close() {
    if (this.closed) return;
    this.process.kill('SIGTERM');
    const timer = setTimeout(() => this.process.kill('SIGKILL'), 4000);
    await this.exited; clearTimeout(timer);
  }
}
