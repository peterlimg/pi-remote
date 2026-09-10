import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until } from './helpers.mjs';
const dir = mkdtempSync(join(tmpdir(), 'pi-remote-browser-'));
const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
const host = await startHost({ dir, config, port: 8799, roots: [] });
const agents = [], locks = [];
for (const title of ['Project Alpha', 'Project Beta']) {
  const file = join(dir, title + '.jsonl'); writeFileSync(file, '');
  const id = sessionKey(file), instanceId = randomUUID();
  const lock = acquireLock(join(dir, 'locks'), id, { file, instanceId }); locks.push(lock);
  const agent = await socket('ws://127.0.0.1:8799/bridge', config.bridgeToken);
  const state = { id, file, instanceId, cwd: '/projects/' + title, title, status: 'working',
    messages: [{ id: 'initial', role: 'assistant', text: 'Working on ' + title + '\n<script>window.injected=true</script>' }], tools: [], revision: 0, updatedAt: Date.now() };
  agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
  agent.ws.on('message', raw => {
    const packet = JSON.parse(raw.toString());
    if (packet.type !== 'command') return;
    state.messages.push({ id: randomUUID(), role: 'user', text: packet.command.text || 'aborted' });
    state.revision++; state.updatedAt = Date.now();
    agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { accepted: true } }));
  });
  agents.push(agent);
}
await until(() => host.service.live.size === 2);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  agents.forEach(x => x.ws.terminate()); locks.forEach(x => x.release()); await host.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0);
});
