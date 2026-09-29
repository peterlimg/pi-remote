#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, expect } from '@playwright/test';
import { socket, until } from '../../../test/helpers.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const url = 'http://127.0.0.1:8799';
const token = 'browser-test-token-only-123456789012345';
process.chdir(root);

async function doctor(pid) {
  assert(Number.isInteger(pid) && pid > 0, 'Supply the PID of the fixture you started');
  process.kill(pid, 0);
  const owners = execFileSync('lsof', ['-nP', '-iTCP:8799', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/);
  assert.deepEqual([...new Set(owners)], [String(pid)], 'Port 8799 belongs to another process');
  const health = await fetch(url + '/health', { signal: AbortSignal.timeout(3000) });
  assert.equal(health.status, 200);
  const app = await fetch(url + '/app.js', { signal: AbortSignal.timeout(3000) });
  assert.equal(await app.text(), readFileSync('web/app.js', 'utf8'), 'Server is not serving this checkout');
  const client = await socket(url.replace('http:', 'ws:') + '/ws', token, url);
  try {
    await until(() => client.messages.some(packet => packet.type === 'ready'));
    const result = await client.request('list');
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.sessions.map(session => session.title).sort(), ['Project Alpha', 'Project Beta']);
  } finally { client.ws.terminate(); }
  return { pid, url, health: 200, auth: 'accepted', sessions: ['Project Alpha', 'Project Beta'] };
}

if (process.argv[2] === 'doctor') {
  console.log(JSON.stringify(await doctor(Number(process.argv[3])), null, 2));
} else {
  assert.equal(process.argv.length, 2, 'Usage: verify.mjs [doctor PID]');
  // The existing fixture uses a fixed port. Refuse sharing rather than double-driving it.
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(8799, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
  const evidence = mkdtempSync(join(tmpdir(), 'pi-remote-proof-'));
  const scratch = join(evidence, 'scratch'); mkdirSync(scratch);
  console.log('Evidence: ' + evidence);
  const env = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
  for (const key of Object.keys(env)) if (key.startsWith('PI_REMOTE_')) delete env[key];
  const log = openSync(join(evidence, 'server.log'), 'w');
  const server = spawn(process.execPath, ['test/browser-server.mjs'], { env, stdio: ['ignore', log, log] });
  closeSync(log);
  const stopped = once(server, 'exit');
  const save = (name, value) => writeFileSync(join(evidence, name), value);
  save('run.json', JSON.stringify({ feature: 'access', entry: 'manual login', pid: server.pid, url,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }) }, null, 2));
  let browser, context, tracing = false;
  // Let finally clean up browser and fixture on an interrupted drive too.
  const interrupt = () => { process.exitCode = 130; void browser?.close(); server.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    await until(async () => {
      assert.equal(server.exitCode, null, 'Fixture exited; read server.log');
      try { return (await fetch(url + '/health', { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    }, 10000);
    save('doctor.json', JSON.stringify(await doctor(server.pid), null, 2));
    browser = await chromium.launch();
    context = await browser.newContext({ ...devices['iPhone 13'] });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true }); tracing = true;
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Device access token').fill(token);
    await page.getByRole('button', { name: 'Connect to computer' }).click();
    await expect(page.locator('#connection')).toHaveText('Computer connected');
    await expect(page.locator('#sessions .session')).toHaveCount(2);
    await page.screenshot({ path: join(evidence, 'connected.png'), fullPage: true });
    save('connected.aria.txt', await page.locator('body').ariaSnapshot());
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.evaluate(() => localStorage.getItem('pi-remote-token')), token);
    await page.close();
    const reopened = await context.newPage(); await reopened.goto(url);
    await expect(reopened.locator('#connection')).toHaveText('Computer connected');
    const other = await context.newPage(); await other.goto(url);
    await expect(other.locator('#connection')).toHaveText('Computer connected');
    await reopened.getByRole('button', { name: 'Sign out' }).click();
    await expect(other.locator('#login')).toBeVisible();
    assert.equal(await other.evaluate(() => localStorage.getItem('pi-remote-token')), null);
    await reopened.reload(); await expect(reopened.locator('#login')).toBeVisible();
    await reopened.screenshot({ path: join(evidence, 'signed-out.png'), fullPage: true });
    save('signed-out.aria.txt', await reopened.locator('body').ariaSnapshot());
    assert.deepEqual(errors, []);
    save('result.json', JSON.stringify({ passed: true, feature: 'access', entry: 'manual login',
      checks: ['authenticated sessions', 'token persisted', 'reopened without token', 'sign out across tabs', 'token removed', 'reload requires login'],
      excluded: ['QR entry', 'legacy tab entry', 'Render relay', 'real Pi execution'] }, null, 2));
  } catch (error) {
    save('failure.txt', error.stack || String(error)); throw error;
  } finally {
    try { if (tracing) await context.tracing.stop({ path: join(evidence, 'trace.zip') }); }
    finally {
      try { await browser?.close(); }
      finally {
        if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
        const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
        await stopped; clearTimeout(timer);
        rmSync(scratch, { recursive: true, force: true });
        save('cleanup.json', JSON.stringify({ pid: server.pid, exitCode: server.exitCode, signal: server.signalCode, scratchRemoved: !existsSync(scratch) }, null, 2));
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      }
    }
  }
  for (const name of ['doctor.json', 'trace.zip', 'connected.png', 'signed-out.png', 'result.json', 'cleanup.json']) assert(existsSync(join(evidence, name)), 'Missing evidence: ' + name);
  console.log('PASS: manual login, reopen, cross-tab sign out; fixture stopped, evidence retained.');
}
