import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

test('recent saved sessions stay above older restored workers through paging and host restart', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-recency-')), root = join(dir, 'sessions');
  mkdirSync(root);
  const now = Date.now(), files = [], recent = Array.from({ length: 21 }, (_, i) => `Recent task ${i + 1}`);
  const titles = [...recent, 'Older restored task 1', 'Older restored task 2'];
  for (const [i, title] of titles.entries()) {
    const file = join(root, `${i}.jsonl`);
    writeFileSync(file, [
      { type: 'session', version: 3, id: `session-${i}`, cwd: dir },
      { type: 'session_info', id: 'name', parentId: null, name: title }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    utimesSync(file, now / 1000, (now - i * 3600000) / 1000);
    files.push(file);
  }
  const saved = files.map(file => readFileSync(file, 'utf8'));
  writeFileSync(join(dir, 'resume-sessions.json'), JSON.stringify(files.slice(-2).map(sessionKey)));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const options = { dir, config, roots: [root], relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } };
  let host;
  try {
    host = await startHost({ ...options, port: 0 });
    const port = host.http.address().port, url = `http://127.0.0.1:${port}`;
    const restored = async () => {
      await expect.poll(() => host.service.live.size).toBe(2);
      await expect.poll(() => host.service.busyWorkers).toBe(0);
      for (const [i, file] of files.entries()) {
        expect(host.service.read(sessionKey(file)).updatedAt).toBeCloseTo(now - i * 3600000, 0);
      }
    };
    await restored();
    await page.goto(url + '/#token=' + config.clientToken);
    const rows = page.locator('#sessions .session strong');
    await expect(rows).toHaveText(recent.slice(0, 20));
    await expect(page.locator('#sessions .session').first()).toHaveAccessibleName(/^Saved Recent task 1 /);
    await page.locator('#sessions .session').last().scrollIntoViewIfNeeded();
    await expect(rows).toHaveText(titles);
    await expect(page.locator('#sessions .session').last()).toHaveAccessibleName(/^Ready Older restored task 2 /);

    await host.close();
    await expect(page.locator('#connection')).not.toHaveText('Computer connected');
    host = await startHost({ ...options, port });
    await restored();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await expect(rows).toHaveText(titles);
    await page.reload();
    await expect(rows).toHaveText(recent.slice(0, 20));
    await page.screenshot({ path: testInfo.outputPath('recent-sessions-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(rows).toHaveText(recent.slice(0, 20));
    await page.screenshot({ path: testInfo.outputPath('recent-sessions-desktop.png') });
    await testInfo.attach('recent-sessions', { body: await page.locator('#sessions').ariaSnapshot(), contentType: 'text/plain' });
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(saved);
  } finally {
    await host?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
