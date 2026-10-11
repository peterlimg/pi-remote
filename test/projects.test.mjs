import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from '../src/service.mjs';

test('projects rank the full catalog by session count, then activity, without double-counting live sessions', () => {
  const states = Array.from({ length: 30 }, (_, i) => ({ id: String(i), cwd: '/projects/popular', updatedAt: i, status: 'saved' }));
  states.push({ id: 'recent', cwd: '/projects/recent', updatedAt: 100, status: 'saved' },
    { id: 'older', cwd: '/projects/older', updatedAt: 50, status: 'saved' });
  const service = Object.assign(Object.create(SessionService.prototype), {
    catalog: new Map(states.map(state => [state.id, state])),
    live: new Map([['0', { state: { ...states[0], status: 'idle', updatedAt: 200 }, socket: {} }]]),
    allowResume: true
  });
  assert.deepEqual(service.projects(), [
    { cwd: '/projects/popular', sessionId: '0', count: 30, updatedAt: 200 },
    { cwd: '/projects/recent', sessionId: 'recent', count: 1, updatedAt: 100 },
    { cwd: '/projects/older', sessionId: 'older', count: 1, updatedAt: 50 }
  ]);
  service.allowResume = false;
  assert.deepEqual(service.projects(), [{ cwd: '/projects/popular', sessionId: '0', count: 1, updatedAt: 200 }]);
  service.live.clear();
  assert.deepEqual(service.projects(), []);
});
