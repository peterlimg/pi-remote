import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/host.mjs';
import { loadConfig } from '../src/config.mjs';
import { acquireLock, sessionKey } from '../src/locks.mjs';
import { socket, until } from './helpers.mjs';
import { cleanMessage } from '../src/catalog.mjs';
const dir = mkdtempSync(join(tmpdir(), 'pi-remote-browser-'));
const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
const scanRoot = join(dir, 'saved'); mkdirSync(scanRoot);
for (let i = 0; i < 20; i++) writeFileSync(join(scanRoot, `damaged-${i}.jsonl`), 'invalid JSON\n');
const host = await startHost({ dir, config, port: 8799, roots: [scanRoot] });
const agents = [], locks = [];
for (const title of ['Project Alpha', 'Project Beta']) {
  const file = join(dir, title + '.jsonl'); writeFileSync(file, '');
  const id = sessionKey(file), instanceId = randomUUID();
  const lock = acquireLock(join(dir, 'locks'), id, { file, instanceId }); locks.push(lock);
  const agent = await socket('ws://127.0.0.1:8799/bridge', config.bridgeToken);
  const state = { id, file, instanceId, cwd: '/projects/' + title, title, status: 'working',
    messages: [
      cleanMessage({ role: 'user', content: 'Check the relay config and tell me what to run.' }, 'user-1'),
      cleanMessage({ role: 'assistant', content: [
        { type: 'text', text: 'Working on ' + title },
        { type: 'toolCall', id: 'read-config', name: 'read', arguments: { path: '/projects/' + title + '/render.yaml', offset: 10, limit: 20 } }
      ] }, 'initial'),
      cleanMessage({ role: 'toolResult', toolCallId: 'read-config', toolName: 'read', content: 'Relay configuration output\n' + 'Internal detail\n'.repeat(60) }, 'result'),
      cleanMessage({ role: 'assistant', content: '**The relay is ready.**\n\nRun the checks before deploying:\n\n```sh\nnpm test\n```\n\n- Restart the host.\n- Refresh your phone.\n\n[Render docs](https://render.com/docs)' + (title === 'Project Alpha' ? '\n\n<script>window.injected=true</script>\n[unsafe](javascript:window.injected=true)\n![remote image](https://example.com/tracker.png)' : '') }, 'reply')
    ], tools: [
      { id: 'read-config', name: 'read', status: 'done', text: 'Relay configuration output' },
      { id: 'older-tool', name: 'bash', status: 'done', text: 'Old output outside the current history' }
    ], revision: 0, updatedAt: Date.now() };
  if (title === 'Project Beta') state.messages.push(
    cleanMessage({ role: 'assistant', content: [
      { type: 'toolCall', id: 'run-checks', name: 'bash', arguments: { command: 'npm run check && npm test', timeout: 120 } }
    ] }, 'checks'),
    cleanMessage({ role: 'toolResult', toolCallId: 'run-checks', toolName: 'bash', content:
      Array.from({ length: 44 }, (_, i) => `check ${i + 1}: passed`).join('\n') + '\n108 tests passed\n0 failed\nTypeScript passed\nLint passed\nWorking tree clean\n' }, 'checks-result'),
    cleanMessage({ role: 'assistant', content: [
      { type: 'toolCall', id: 'read-source', name: 'read', arguments: { path: '/projects/Project Beta/src/server/api/routers/history/bets.ts', offset: 270, limit: 117 } },
      { type: 'toolCall', id: 'read-store', name: 'read', arguments: { path: 'src/store/betslip/index.ts', offset: 60, limit: 26 } }
    ] }, 'source'),
    ...['read-source', 'read-store'].map(id => cleanMessage({ role: 'toolResult', toolCallId: id, toolName: 'read', content: 'Source code\n'.repeat(80) }, id + '-result'))
  );
  agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
  agent.ws.on('message', raw => {
    const packet = JSON.parse(raw.toString());
    if (packet.type !== 'command') return;
    state.messages.push({ id: randomUUID(), role: 'user', text: packet.command.text || 'aborted' });
    state.revision++; state.updatedAt = Date.now(); state.status = 'idle';
    rmSync(scanRoot, { recursive: true, force: true }); host.service.scan();
    agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { accepted: true } }));
  });
  agents.push(agent);
}
await until(() => host.service.live.size === 2);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  agents.forEach(x => x.ws.terminate()); locks.forEach(x => x.release()); await host.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0);
});
