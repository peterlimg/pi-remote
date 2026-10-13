import { StringDecoder } from 'node:string_decoder';
import { jsonParser } from 'stream-json/core/parser.js';
import { ignore } from 'stream-json/core/filters/ignore.js';
import { stringer } from 'stream-json/core/stringer.js';
import { none, isMany, getManyValues } from 'stream-chain/core';

const tokens = value => value === none ? [] : isMany(value) ? getManyValues(value) : [value];
const aggregateEvents = { messages: 'agent_end', toolResults: 'turn_end' };

// Completion arrays repeat message_end records. Validate them without retaining them;
// keep individual messages, RPC responses, and lifecycle metadata unchanged.
export class RpcEvents {
  constructor(onValue, max = 8 * 1024 * 1024) {
    this.onValue = onValue; this.max = max; this.decoder = new StringDecoder('utf8');
    this.parse = undefined;
  }
  start() {
    this.buffer = ''; this.bytes = 0; this.depth = 0; this.keyLength = undefined;
    this.omitted = new Set();
    this.parse = jsonParser({ packStrings: false, packNumbers: false });
    this.filter = ignore({ filter: (path, token) => {
      if (path.length !== 1 || !Object.hasOwn(aggregateEvents, path[0]) || token.name !== 'startArray') return false;
      this.omitted.add(path[0]); return true;
    } });
    this.stringify = stringer({ useKeyValues: true });
  }
  consume(text) {
    const parsed = tokens(this.parse(text));
    if (text === none) parsed.push(none); // Flush the filter's pending closing containers too.
    for (const token of parsed) {
      if (token.name === 'startObject' || token.name === 'startArray') {
        if (++this.depth > 128) throw new Error('RPC record nesting too deep');
      } else if (token.name === 'endObject' || token.name === 'endArray') this.depth--;
      if (token.name === 'startKey') this.keyLength = 0;
      if (token.name === 'stringChunk' && this.keyLength !== undefined) {
        this.keyLength += token.value.length;
        if (this.keyLength > 65536) throw new Error('RPC key too large');
      }
      if (token.name === 'endKey') this.keyLength = undefined;
      for (const kept of tokens(this.filter(token))) {
        const part = this.stringify(kept);
        if (part === none) continue;
        this.bytes += Buffer.byteLength(part);
        if (this.bytes > this.max) throw new Error('RPC record too large');
        this.buffer += part;
      }
    }
  }
  finish() {
    if (!this.parse) return;
    this.consume(none);
    const value = JSON.parse(this.buffer);
    if (!value || Array.isArray(value) || typeof value.type !== 'string') throw new Error('Invalid RPC event');
    for (const field of this.omitted) {
      if (value.type !== aggregateEvents[field]) throw new Error('Unexpected RPC aggregate: ' + field);
    }
    this.parse = undefined; this.buffer = '';
    this.onValue(value);
  }
  push(chunk) {
    // Bound tokenizer scratch space even if a caller delivers a whole large record.
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      const text = this.decoder.write(chunk.subarray(offset, offset + 65536));
      let start = 0;
      while (start < text.length) {
        const end = text.indexOf('\n', start);
        const part = text.slice(start, end < 0 ? text.length : end);
        if (!this.parse && part.trim()) this.start();
        if (this.parse) this.consume(part);
        if (end < 0) break;
        this.finish(); start = end + 1;
      }
    }
  }
  end() {
    if (this.parse || this.decoder.end()) throw new Error('Incomplete RPC record');
  }
}
