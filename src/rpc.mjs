import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { modelList } from './commands.mjs';
import { RpcEvents } from './rpc-events.mjs';

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
    const parser = new RpcEvents(value => {
      if (value.type === 'response' && this.pending.has(value.id)) {
        const item = this.pending.get(value.id); this.pending.delete(value.id); clearTimeout(item.timer);
        if (value.success) item.resolve(value.data); else item.reject(new Error(value.error || 'Pi command failed'));
      } else if (this.captureUsage && value.type === 'extension_ui_request' && value.method === 'select' && value.title?.split(/\r?\n/)[0] === 'Provider usage') {
        const answer = this.captureUsage(value);
        this.process.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: value.id, ...answer }) + '\n');
      } else this.emit('event', this.expandMessageEvent(value));
    });
    const stop = error => {
      if (this.failure) return;
      this.failure = error; this.fail(error); void this.close();
    };
    this.process.stdout.on('data', chunk => { if (!this.failure) try { parser.push(chunk); } catch (error) { stop(error); } });
    this.process.stdout.on('end', () => { if (!this.failure) try { parser.end(); } catch (error) { stop(error); } });
    this.process.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-2000); });
    this.process.on('error', stop);
    this.process.on('close', (code, signal) => {
      this.closed = true;
      if (!this.failure) this.fail(new Error(`Pi worker exited (${signal || 'code ' + code})` + (this.stderr ? ': ' + this.stderr : '')));
      this.emit('exit');
    });
  }
  // Pi's RPC wire updates are delta-only; state consumers expect cumulative messages.
  expandMessageEvent(event) {
    if (event.type === 'message_start' && event.message?.role === 'assistant') this.streamingMessage = structuredClone(event.message);
    if ((event.type === 'message_end' && event.message?.role === 'assistant') || event.type === 'agent_end') this.streamingMessage = undefined;
    if (event.type !== 'message_update') return event;
    if (event.message) { this.streamingMessage = event.message; return event; }
    const message = this.streamingMessage, delta = event.assistantMessageEvent;
    if (!message || !delta || typeof delta.type !== 'string' || !Array.isArray(message.content)) return event;
    const index = delta.contentIndex;
    // Do not let malformed indexes allocate a sparse array.
    if (!Number.isSafeInteger(index) || index < 0 || index > message.content.length) return event;
    const block = message.content[index];
    if (delta.type === 'text_start') message.content[index] = { type: 'text', text: '' };
    else if (delta.type === 'text_delta' && block?.type === 'text' && typeof delta.delta === 'string') block.text += delta.delta;
    else if (delta.type === 'text_end' && typeof delta.content === 'string') message.content[index] = { type: 'text', text: delta.content };
    else if (delta.type.startsWith('thinking_')) message.content[index] ??= { type: 'thinking', thinking: '' };
    else if (delta.type === 'toolcall_start') message.content[index] = { type: 'toolCall', id: delta.id, name: delta.toolName, arguments: {}, partialJson: '' };
    else if (delta.type === 'toolcall_delta' && block?.type === 'toolCall' && typeof delta.delta === 'string') {
      // Bound argument previews like cleanMessage; toolcall_end supplies the authoritative arguments.
      block.partialJson = ((block.partialJson || '') + delta.delta).slice(0, 24001);
      try { block.arguments = JSON.parse(block.partialJson); } catch { /* Incomplete arguments are expected. */ }
    } else if (delta.type === 'toolcall_end' && delta.toolCall) message.content[index] = delta.toolCall;
    if (event.usage) message.usage = event.usage;
    return { ...event, message };
  }
  fail(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.emit('fault', error);
  }
  request(type, data = {}, { background = false } = {}) {
    if (this.closed) return Promise.reject(new Error('Pi worker is closed'));
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = background ? undefined : setTimeout(() => { this.pending.delete(id); reject(new Error('Pi response timed out; delivery may have occurred')); }, 30000);
      this.pending.set(id, { timer, resolve, reject: background ? error => this.emit('fault', error) : reject });
      this.process.stdin.write(JSON.stringify({ ...data, id, type }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
        else if (background) resolve();
      });
    });
  }
  async providerUsage(command) {
    if (this.usageQuery) return this.usageQuery;
    this.usageQuery = (async () => {
      let report, refreshed = false;
      this.captureUsage = value => {
        if (!refreshed && value.options?.includes('Refresh current usage')) {
          refreshed = true;
          return { value: 'Refresh current usage' };
        }
        report = { title: value.title, message: value.message };
        return value.options?.includes('Close') ? { value: 'Close' } : { cancelled: true };
      };
      try {
        await this.request('prompt', { message: '/' + command, streamingBehavior: 'steer' });
        if (!report) throw new Error('The usage extension returned no report. Try /usage in Pi.');
        return report;
      } finally { this.captureUsage = undefined; }
    })();
    try { return await this.usageQuery; } finally { this.usageQuery = undefined; }
  }
  async command(command) {
    if (command.type === 'getUsage') {
      const { contextUsage } = await this.request('get_session_stats');
      if (!command.includeProvider) return { contextUsage };
      const { commands } = await this.request('get_commands'), { model } = await this.request('get_state');
      const name = model?.provider === 'claude-sdk' ? 'claude-usage' : 'usage';
      // Never submit the command to the model when no extension owns it.
      if (!commands.some(item => item.name === name && item.source === 'extension')) {
        return { contextUsage, providerMessage: 'No provider usage extension is installed in this session.' };
      }
      try { return { contextUsage, providerUsage: await this.providerUsage(name) }; }
      catch (error) { return { contextUsage, providerMessage: error.message }; }
    }
    if (command.type === 'getCommands') return this.request('get_commands');
    if (command.type === 'getModels') {
      const { models } = await this.request('get_available_models');
      const state = await this.request('get_state');
      return { models: modelList(models), current: state.model ? `${state.model.provider}/${state.model.id}` : undefined };
    }
    if (command.type === 'setModel') {
      await this.request('set_model', { provider: command.provider, modelId: command.modelId });
      const state = await this.request('get_state');
      return { model: `${state.model.provider}/${state.model.id}`, modelName: state.model.name, thinkingLevel: state.thinkingLevel };
    }
    if (command.type === 'setThinkingLevel') {
      await this.request('set_thinking_level', { level: command.level });
      const state = await this.request('get_state');
      return { thinkingLevel: state.thinkingLevel };
    }
    if (command.type === 'compact') {
      await this.request('compact', { customInstructions: command.customInstructions }, { background: true });
      return { accepted: true };
    }
    if (command.type === 'abort') {
      await this.request('clear_queue');
      await this.request('abort');
    } else if (command.type === 'prompt' || command.text.startsWith('/')) {
      // Extension handlers can wait indefinitely for dialog input. Acknowledge dispatch,
      // not handler completion; keep tracking the RPC response for execution errors.
      let background = false;
      if (command.text.startsWith('/')) {
        const { commands } = await this.request('get_commands');
        background = commands.some(item => item.source === 'extension' && item.name === command.text.slice(1).split(' ', 1)[0]);
      }
      // Extension commands must use prompt, even when submitted with Alt+Enter.
      await this.request('prompt', { message: command.text, ...(command.images ? { images: command.images } : {}), streamingBehavior: command.type === 'followUp' ? 'followUp' : 'steer' }, { background });
    } else {
      await this.request(command.type === 'followUp' ? 'follow_up' : 'steer', { message: command.text, ...(command.images ? { images: command.images } : {}) });
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
