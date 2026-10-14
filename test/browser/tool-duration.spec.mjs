import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { initialState, applyEvent } from '../../src/state.mjs';
import { socket, until } from '../helpers.mjs';

test('completed tools show Pi execution times live and from saved history, never while running', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-tool-duration-'));
  const config = loadConfig(dir), file = join(dir, 'timings.jsonl');
  const options = { dir, config, port: 0, roots: [dir], publicUrl: 'http://127.0.0.1:8787', relayUrl: '' };
  let host, agent, lock, parentId = null, timestamp = Date.now();
  const append = fields => {
    const entry = { id: randomUUID(), parentId, timestamp: new Date().toISOString(), ...fields };
    appendFileSync(file, JSON.stringify(entry) + '\n'); parentId = entry.id;
  };
  const cases = [
    ['zero', 0, false, '0ms'], ['quick', 37, false, '37ms'], ['seconds', 1250, false, '1.3s'],
    ['failed', 61000, true, 'error · 1m 1s'], ['rounded', 119999, false, '2m 0s'],
    ['legacy', undefined, false, ''], ['invalid', -1, false, '']
  ];
  const command = 'printf "%s" "a deliberately long shell command that must leave room for its elapsed time"';
  try {
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), cwd: dir }) + '\n');
    append({ type: 'session_info', name: 'Tool timings' });
    append({ type: 'message', message: { role: 'assistant', timestamp: ++timestamp, content: [
      ...cases.map(([id]) => ({ type: 'toolCall', id, name: 'read', arguments: { path: '/project/long/path/to/source.js' } })),
      { type: 'toolCall', id: 'live', name: 'bash', arguments: { command } }
    ] } });
    for (const [toolCallId, durationMs, isError] of cases) append({ type: 'message', message: {
      role: 'toolResult', toolCallId, toolName: 'read', content: [{ type: 'text', text: 'Recorded output' }],
      durationMs, isError, timestamp: ++timestamp
    } });
    host = await startHost(options);
    const port = host.http.address().port, origin = `http://127.0.0.1:${port}`;
    const id = sessionKey(file), instanceId = randomUUID();
    lock = acquireLock(join(dir, 'locks'), id, { file, instanceId });
    const saved = readSession(file), state = initialState({ ...saved, instanceId }, saved.messages);
    agent = await socket(`ws://127.0.0.1:${port}/bridge`, config.bridgeToken);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    // Only Pi is simulated. The host, session files, authentication and browser WebSocket are real.
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.type !== 'command') return;
      if (packet.command.type === 'getCommands') {
        agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { commands: [] } }));
        return;
      }
      const message = { role: 'user', content: packet.command.text, timestamp: ++timestamp };
      append({ type: 'message', message }); applyEvent(state, { type: 'message_end', message });
      if (packet.command.text === 'Start tool') {
        applyEvent(state, { type: 'agent_start' });
        applyEvent(state, { type: 'tool_execution_start', toolCallId: 'live', toolName: 'bash' });
        applyEvent(state, { type: 'tool_execution_update', toolCallId: 'live', toolName: 'bash',
          partialResult: { content: [{ type: 'text', text: 'Running output' }] } });
      } else if (packet.command.text === 'Finish tool') {
        applyEvent(state, { type: 'tool_execution_end', toolCallId: 'live', toolName: 'bash', durationMs: 1500,
          result: { content: [{ type: 'text', text: 'Finished output' }] }, isError: false });
      } else {
        const result = { role: 'toolResult', toolCallId: 'live', toolName: 'bash', durationMs: 1500,
          content: [{ type: 'text', text: 'Finished output' }], isError: false, timestamp: ++timestamp };
        append({ type: 'message', message: result }); applyEvent(state, { type: 'message_end', message: result });
        applyEvent(state, { type: 'agent_end' });
      }
      agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
      agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { accepted: true } }));
    });
    await until(() => host.service.live.has(id));
    await page.goto(origin + '/#token=' + config.clientToken);
    await page.getByRole('button', { name: 'Tool timings', exact: false }).click();
    await page.locator('.tool-activity > summary').click();
    const live = page.locator('[data-tool-id="live"]'), status = live.locator('.tool-status');
    await expect(status).toHaveText('pending');
    for (const [id, , , text] of cases) {
      const label = page.locator(`[data-tool-id="${id}"] .tool-status`);
      if (text) await expect(label).toHaveText(text);
      else await expect(label).toBeHidden();
    }
    const send = async text => { await page.locator('#prompt').fill(text); await page.locator('#send').click(); };
    await send('Start tool');
    await expect(status).toHaveText('working');
    await expect(status).not.toHaveAttribute('title');
    await send('Finish tool');
    await expect(status).toHaveText('1.5s');
    await expect(status).toHaveAccessibleName('Execution time: 1.5s');
    await expect(status).toHaveAttribute('title', 'Execution time: 1500 ms');
    await send('Record result');
    await expect(page.locator('#status')).toHaveText('idle');
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: width === 320 ? 'light' : 'dark' });
      await live.scrollIntoViewIfNeeded();
      const heading = await live.locator('.tool-heading').boundingBox(), timing = await status.boundingBox();
      expect(timing.x + timing.width).toBeLessThanOrEqual(heading.x + heading.width + 1);
      expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`tool-duration-${width}.png`) });
      writeFileSync(testInfo.outputPath(`tool-duration-${width}.aria.txt`), await live.ariaSnapshot());
    }
    agent.ws.terminate(); lock.release(); lock = undefined;
    await host.close();
    host = await startHost({ ...options, port });
    await page.reload();
    await page.getByRole('button', { name: 'Tool timings', exact: false }).click();
    await page.locator('.tool-activity > summary').click();
    await expect(status).toHaveText('1.5s');
    await expect(status).toBeVisible();
    await expect(page.locator('[data-tool-id="failed"] .tool-status')).toHaveText('error · 1m 1s');
  } finally {
    agent?.ws.terminate(); lock?.release(); await host?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
