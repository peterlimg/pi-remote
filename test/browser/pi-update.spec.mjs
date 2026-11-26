import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.mjs';
import { ensureHost, hostStatus, stopHost } from '../../src/control.mjs';

test('a confirmed Pi update replaces the idle host and the phone reconnects', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-update-')), bin = join(dir, 'pi'), preload = join(dir, 'registry.mjs');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const config = { ...loadConfig(dir), port, publicUrl: 'http://127.0.0.1:' + port, relayUrl: '' };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  writeFileSync(preload, `const original = globalThis.fetch; globalThis.fetch = (url, ...args) => url === 'https://pi.dev/api/latest-version' ? Promise.resolve(Response.json({version:'2.0.0'})) : original(url,...args);`);
  writeFileSync(join(dir, 'version'), '1.9.0');
  writeFileSync(bin, '#!/bin/sh\ncase "$*" in\n--version) cat version;;\n"update --self --no-approve") echo 2.0.0 > version;;\n*) exit 1;;\nesac\n', { mode: 0o700 });
  const env = { NODE_OPTIONS: '--import=' + preload, PI_REMOTE_PI_BIN: bin, PI_REMOTE_SESSION_DIRS: dir, PI_REMOTE_HOME: dir, PI_OFFLINE: '', PI_SKIP_VERSION_CHECK: '' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const before = await ensureHost(config, dir);
    await page.setViewportSize({ width: 744, height: 1133 });
    await page.goto(config.publicUrl + '/#token=' + config.clientToken);
    const action = page.getByRole('button', { name: 'Update and restart' });
    await expect(page.getByRole('status').filter({ hasText: 'Pi 2.0.0 is available.' })).toBeVisible();
    page.once('dialog', dialog => dialog.dismiss());
    await action.click();
    expect(readFileSync(join(dir, 'version'), 'utf8')).toBe('1.9.0');
    page.once('dialog', dialog => dialog.accept());
    await action.click();
    const restarting = page.getByRole('status').filter({ hasText: 'Restarting after update…' });
    await expect(restarting).toBeVisible();
    const header = await page.locator('.brand').boundingBox();
    expect((await restarting.boundingBox()).y).toBeGreaterThanOrEqual(header.y + header.height);
    await expect.poll(async () => { const now = await hostStatus(config); return !!now && now.pid !== before.pid; }, { timeout: 15000 }).toBe(true);
    expect(readFileSync(join(dir, 'version'), 'utf8').trim()).toBe('2.0.0');
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await expect(page.locator('#pi-update')).toBeHidden();
    await expect(page.locator('#connection')).toBeHidden();
  } finally {
    await stopHost(config, { idleOnly: true });
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(dir, { recursive: true, force: true });
  }
});
