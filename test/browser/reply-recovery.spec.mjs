import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';

// Real host, RPC child and browser sockets. Only Pi/model output is simulated.
test('failed replies, recovered workers and long model waits have honest feedback', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-reply-recovery-')), file = join(dir, 'session.jsonl');
  const timestamp = Date.now() - 100000, commands = [];
  writeFileSync(file, [
    { type: 'session', id: 'recovery', cwd: dir },
    { type: 'message', id: 'user', parentId: null, message: { role: 'user', content: 'Earlier request', timestamp } },
    { type: 'message', id: 'failed', parentId: 'user', message: { role: 'assistant', content: [], timestamp: timestamp + 1,
      stopReason: 'error', errorMessage: 'Private provider diagnostics', durationMs: 93343 } },
    { type: 'session_info', id: 'name', parentId: 'failed', name: 'Reply recovery' }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    const packet = JSON.parse(payload);
    if (packet.op === 'command') commands.push(packet.command);
  }));
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.getByRole('button', { name: /Reply recovery/ }).click();
    const failure = 'Reply failed. You can send another message.';
    await expect(page.locator('.message-error')).toHaveText(failure);
    await expect(page.locator('#transcript')).not.toContainText('Private provider diagnostics');
    await page.locator('#resume').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await page.locator('#prompt').fill('provider error');
    await page.locator('#send').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('.message-error')).toHaveText([failure, failure]);
    await expect(page.locator('#agent-activity')).toBeHidden();
    await expect(page.locator('.task-duration')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('reply-failed-mobile.png') });
    await page.reload();
    await page.getByRole('button', { name: /Reply recovery/ }).click();
    await expect(page.locator('.message-error')).toHaveText([failure, failure]);
    await page.locator('#prompt').fill('partial provider error');
    await page.locator('#send').click();
    await expect(page.locator('.message.assistant').last()).toContainText('Partial reply.');
    await expect(page.locator('.message.assistant').last().locator('.message-error')).toHaveText(failure);
    await expect(page.locator('.task-duration')).toHaveCount(0);
    await page.locator('#prompt').fill('hello after failure');
    await page.locator('#send').click();
    await expect(page.locator('#transcript')).toContainText('reply: hello after failure');
    const worker = [...host.service.live.values()][0].worker;
    worker.process.kill('SIGTERM');
    await expect(page.locator('#status')).toHaveText('saved');
    await expect(page.locator('#notice')).toContainText('Pi worker exited');
    await page.locator('#resume').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#notice')).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: /Reply recovery/ }).click();
    await expect(page.locator('#notice')).toBeHidden();
    await expect(page.locator('.message-error')).toHaveText(failure); // The failed saved turn survives worker replacement.
    await page.locator('#prompt').fill('wait for model');
    await page.locator('#send').click();
    await expect(page.locator('#status')).toHaveText('working');
    await expect(page.locator('#composer-send-status')).toBeHidden();
    await expect(page.locator('#activity-detail')).toBeHidden();
    const startedAt = [...host.service.live.values()][0].state.messages.at(-1).timestamp;
    await page.clock.install({ time: startedAt });
    await page.clock.pauseAt(startedAt);
    await page.clock.fastForward(31000);
    await expect(page.locator('#activity-label')).toHaveText('Waiting for model…');
    await expect(page.locator('#activity-time')).toHaveText(' · 31s');
    await expect(page.locator('#activity-time')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#activity-detail')).toHaveText('No reply text yet. You can stop this turn.');
    await expect(page.locator('#transcript')).not.toContainText('Private reasoning');
    await page.locator('#back').click();
    await page.getByRole('button', { name: /Reply recovery/ }).click();
    await page.clock.runFor(400); // Finish the session-entry animation before measuring or capturing it.
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    await expect(page.locator('#activity-time')).toHaveText(' · 31s');
    await page.screenshot({ path: testInfo.outputPath('slow-reply-mobile.png') });
    await page.setViewportSize({ width: 320, height: 380 });
    await page.clock.runFor(100);
    await expect(async () => {
      const activity = await page.locator('#agent-activity').boundingBox(), composer = await page.locator('#composer').boundingBox();
      expect(activity.x + activity.width).toBeLessThanOrEqual(320);
      expect(activity.y + activity.height).toBeLessThanOrEqual(composer.y);
      expect(composer.y + composer.height).toBeLessThanOrEqual(380);
    }).toPass({ timeout: 2000 });
    await page.clock.fastForward(59500);
    await expect(page.locator('#activity-time')).toHaveText(' · 1m 31s');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.clock.runFor(100);
    await page.screenshot({ path: testInfo.outputPath('slow-reply-desktop.png') });
    await page.locator('#abort').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#agent-activity')).toBeHidden();
    expect(commands.filter(command => command.text === 'wait for model')).toHaveLength(1);
    await testInfo.attach('commands', { body: JSON.stringify(commands, null, 2), contentType: 'application/json' });
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
