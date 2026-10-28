import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const enums = {
  reason: ['sample', 'visibility', 'disconnect', 'pagehide'],
  status: ['working', 'waiting', 'idle', 'starting', 'saved', 'disconnected', 'error', 'none'],
  animationName: ['connection-spin', 'none', 'other'],
  playState: ['running', 'paused', 'finished', 'idle', 'none'],
  cssPlayState: ['running', 'paused', 'none']
};
const numbers = ['at', 'elapsedMs', 'sampleGapMs', 'revision', 'renders', 'updateAgeMs', 'animationCount',
  'currentTime', 'startTime', 'durationMs', 'frameDelayMs', 'frameAgeMs', 'width', 'height', 'viewportWidth', 'viewportHeight'];
const booleans = ['connected', 'visible', 'viewing', 'reducedMotion', 'standalone', 'rendered', 'inViewport', 'framePending', 'animationPending'];

export function writeActivityDebug(dir, records) {
  const invalid = () => { throw new Error('Invalid activity diagnostics'); };
  if (!Array.isArray(records) || !records.length || records.length > 20) invalid();
  const receivedAt = new Date().toISOString();
  const rows = records.map(record => {
    if (!record || typeof record !== 'object' || typeof record.page !== 'string' || !/^[a-f0-9-]{36}$/.test(record.page) ||
      record.session !== null && (typeof record.session !== 'string' || !/^[a-f0-9]{64}$/.test(record.session)) || !enums.reason.includes(record.reason)) invalid();
    // Only animation metadata reaches disk, never arbitrary client fields or error messages.
    const row = { tag: 'activity-debug-v1', receivedAt, page: record.page, session: record.session };
    for (const [key, values] of Object.entries(enums)) if (Object.hasOwn(record, key)) {
      if (!values.includes(record[key])) invalid();
      row[key] = record[key];
    }
    for (const key of numbers) if (Object.hasOwn(record, key)) {
      const value = record[key];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) invalid();
      row[key] = value;
    }
    for (const key of booleans) if (Object.hasOwn(record, key)) {
      if (typeof record[key] !== 'boolean') invalid();
      row[key] = record[key];
    }
    if (Object.hasOwn(record, 'transform')) {
      if (typeof record.transform !== 'string' || record.transform.length > 256 || !/^(none|matrix(3d)?\([\d.,+e -]+\))$/.test(record.transform)) invalid();
      row.transform = record.transform;
    }
    if (Object.hasOwn(record, 'userAgent')) {
      if (typeof record.userAgent !== 'string' || record.userAgent.length > 256) invalid();
      row.userAgent = record.userAgent.replace(/[\r\n]/g, ' ');
    }
    return JSON.stringify(row) + '\n';
  }).join('');
  const path = join(dir, 'activity-debug.jsonl');
  try {
    const size = statSync(path, { throwIfNoEntry: false })?.size || 0;
    if (size && size + Buffer.byteLength(rows) > 1024 * 1024) renameSync(path, path + '.1');
    appendFileSync(path, rows, { mode: 0o600 });
  } catch (error) {
    console.warn('[activity-debug-v1] Could not write diagnostics:', error.message);
    throw new Error('Could not save activity diagnostics');
  }
  return { recorded: records.length };
}
