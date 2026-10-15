import { Worker } from 'node:worker_threads';

// File indexing and JSON parsing never share the host's event loop with prompts and aborts.
export class HistoryReader {
  constructor() { this.pending = new Map(); this.nextId = 0; }
  request(op, args) {
    if (this.closed) return Promise.reject(new Error('History reader is closed'));
    if (!this.worker) {
      const worker = this.worker = new Worker(new URL('./history-worker.mjs', import.meta.url));
      worker.on('message', ({ id, value, error }) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (error) pending.reject(new Error(error)); else pending.resolve(value);
      });
      const failed = error => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      };
      worker.on('error', failed);
      worker.on('exit', () => failed(new Error('History reader stopped. Try again.')));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, ...args });
    });
  }
  async close() {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error('History reader is closed'));
    this.pending.clear();
    await this.worker?.terminate();
  }
}
