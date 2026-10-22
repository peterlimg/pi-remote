import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { sessionKey } from '../../src/locks.mjs';

test('context ring opens a read-only usage pane without losing the draft or blocking the agent', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-meter-')), file = join(dir, 'usage.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'usage', cwd: dir }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const meter = page.locator('#usage-meter'), pane = page.getByRole('region', { name: 'Usage', exact: true });
    await expect(meter).toHaveAccessibleName('Usage: 32% of context used');
    await expect(page.locator('#usage-arc')).toHaveAttribute('stroke-dasharray', '32 100');
    await page.locator('#prompt').fill('Keep this draft');
    await meter.tap();
    await expect(pane).toContainText('64,000 / 200,000 tokens');
    await expect(pane.getByRole('progressbar', { name: 'Current context usage', exact: true })).toHaveAttribute('value', '32');
    await expect(pane.getByRole('progressbar', { name: '5-hour limit', exact: true })).toHaveAttribute('value', '25');
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '2');
    await expect(pane).toContainText('resets in 2h');
    await expect(pane).toContainText('resets tomorrow');
    await expect(page.getByRole('button', { name: 'Refresh usage', exact: true })).toHaveCount(0);
    await expect(page.locator('#dialog')).toBeHidden();
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    await expect(page.getByRole('article', { name: 'Provider usage' })).toHaveCount(0);
    expect(host.service.read(id).messages).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('usage-mobile.png') });
    await page.getByRole('button', { name: 'Close usage', exact: true }).tap();
    await meter.tap();
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '4');
    await page.keyboard.press('Escape');
    await expect(pane).toBeHidden();
    await expect(meter).toBeFocused();
    await expect(meter).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#prompt').fill('/usage-working');
    await page.locator('#send').click();
    await expect(page.locator('#status')).toHaveText('working');
    await page.locator('#prompt').fill('Still a draft');
    await meter.click();
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '7');
    await expect(page.locator('#status')).toHaveText('working');
    await expect(page.locator('#abort')).toBeVisible();
    await expect(page.locator('#prompt')).toHaveValue('Still a draft');
    await page.locator('#title').click();
    await expect(pane).toBeHidden();
    await page.locator('#model').click();
    await page.getByRole('button', { name: 'Second', exact: true }).click();
    await expect(page.locator('#model-name')).toHaveText('Second');
    expect(host.service.read(id).model).toBe('test/org/second');
    await meter.click();
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '9');
    await expect(pane).not.toContainText('5-hour limit');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: testInfo.outputPath('usage-desktop-dark.png') });
    await page.locator('#picker-cancel').click();
    await page.locator('#prompt').fill('compact context');
    await page.locator('#send').click();
    await expect(page.locator('#status')).toHaveText('idle');
    await meter.click();
    await expect(pane).toContainText('Waiting for the next model response after compaction.');
    await expect(meter).toHaveAccessibleName('Usage: Context usage unavailable');
    await expect(pane.getByRole('progressbar', { name: 'Current context usage', exact: true })).toHaveCount(0);
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '11');
    await page.reload();
    await page.locator('#sessions button.session').click();
    await expect(meter).toHaveAccessibleName('Usage: Context usage unavailable');
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('reopening usage refreshes a cached provider failure', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-usage-retry-')), file = join(dir, 'usage.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'usage', cwd: dir }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url)), '--usage-fails-until-refresh'] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const meter = page.locator('#usage-meter'), pane = page.getByRole('region', { name: 'Usage', exact: true });
    await page.locator('#prompt').fill('Keep this draft');
    await meter.tap();
    await expect(pane).toContainText('Query failed: fetch failed');
    await page.getByRole('button', { name: 'Close usage', exact: true }).tap();
    await meter.tap();
    await expect(pane.getByRole('progressbar', { name: '5-hour limit', exact: true })).toHaveAttribute('value', '25');
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '4');
    await expect(pane).not.toContainText('Query failed');
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    await expect(page.locator('#status')).toHaveText('idle');
    await expect(page.locator('#dialog')).toBeHidden();
    expect(host.service.read(id).messages).toHaveLength(0);
    await page.getByRole('button', { name: 'Close usage', exact: true }).tap();
    await meter.tap();
    await expect(pane.getByRole('progressbar', { name: '5-hour limit', exact: true })).toHaveAttribute('value', '25');
    await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '6');
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('usage follows session snapshots and never invents missing account limits', async ({ page }, testInfo) => {
  const states = [
    { id: 'alpha', title: 'Alpha', cwd: '/project', status: 'idle', contextUsage: { tokens: 0, contextWindow: 200000, percent: 0 }, messages: [] },
    { id: 'beta', title: 'Beta', cwd: '/project', status: 'idle', model: 'test/second', contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95 }, messages: [],
      providerUsage: { title: 'Provider usage\n5-hour limit: [░░░░] 100% left (resets in 4h)\nWeekly limit: [████] 0% left (resets tomorrow)\nMonthly limit: [█░░░] 87.5% left\nOther limits are unavailable.' } }
  ];
  let client, selected, version = 0, fail = false;
  const snapshot = state => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw), reply = value => ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value }));
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsUsage: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: states }));
      } else if (p.op === 'watch') { selected = states.find(s => s.id === p.sessionId); snapshot(selected); reply({}); }
      else if (p.op === 'commands' || p.op === 'projects') reply([]);
      else if (p.op === 'ping') reply({ pong: true });
      else if (p.op === 'usage') {
        if (fail) ws.send(JSON.stringify({ type: 'response', id: p.id, ok: false, error: 'Usage temporarily unavailable. Try again.' }));
        else reply({ model: selected.model, contextUsage: selected.contextUsage,
          ...(selected.providerUsage ? { providerUsage: selected.providerUsage } : { providerMessage: 'No provider usage extension is installed in this session.' }) });
      } else throw new Error('Usage must not send a model prompt');
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Alpha/ }).click();
  const meter = page.locator('#usage-meter'), pane = page.getByRole('region', { name: 'Usage', exact: true });
  await expect(meter).toHaveAccessibleName('Usage: 0% of context used');
  await meter.click();
  await expect(pane).toContainText('0 / 200,000 tokens');
  await expect(pane).toContainText('No provider usage extension');
  await expect(pane.getByRole('progressbar')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close usage', exact: true }).tap();
  await expect(pane).toBeHidden();
  await expect(meter).toHaveAttribute('aria-expanded', 'false');
  await expect(meter).toHaveCSS('outline-style', 'none');
  await page.screenshot({ path: testInfo.outputPath('usage-after-touch-close-mobile.png') });
  await meter.tap();
  await expect(pane).toBeVisible();
  await meter.tap();
  await expect(pane).toBeHidden();
  await expect(meter).toHaveCSS('outline-style', 'none');
  await meter.press('Enter');
  await page.keyboard.press('Escape');
  await expect(pane).toBeHidden();
  await expect(meter).toBeFocused();
  await expect(meter).toHaveCSS('outline-style', 'solid');
  await meter.press('Enter');
  await page.getByRole('button', { name: 'Close usage', exact: true }).press('Enter');
  await expect(pane).toBeHidden();
  await expect(meter).toBeFocused();
  await expect(meter).toHaveCSS('outline-style', 'solid');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('usage-after-keyboard-close-desktop-dark.png') });
  await page.setViewportSize({ width: 390, height: 664 });
  fail = true;
  await meter.tap();
  await expect(pane).toContainText('Usage temporarily unavailable. Try again.');
  fail = false;
  await page.getByRole('button', { name: 'Close usage', exact: true }).tap();
  await meter.tap();
  await expect(pane).not.toContainText('Usage temporarily unavailable');
  await page.getByRole('button', { name: 'Show sessions' }).click();
  await expect(pane).toBeHidden();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(meter).toHaveAccessibleName('Usage: 95% of context used');
  await expect(meter).toHaveAttribute('data-level', 'error');
  await meter.click();
  await expect(pane).toContainText('190,000 / 200,000 tokens');
  await expect(pane.getByRole('progressbar', { name: '5-hour limit', exact: true })).toHaveAttribute('value', '0');
  await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('value', '100');
  await expect(pane.getByRole('progressbar', { name: 'Weekly limit', exact: true })).toHaveAttribute('max', '100');
  await expect(pane.getByRole('progressbar', { name: 'Monthly limit', exact: true })).toHaveAttribute('value', '12.5');
  await expect(pane).toContainText('Other limits are unavailable.');
  await expect(pane.getByRole('progressbar')).toHaveCount(4);
  states[1].contextUsage = { tokens: 150000, contextWindow: 200000, percent: 75 }; snapshot(states[1]);
  await expect(meter).toHaveAccessibleName('Usage: 75% of context used');
  await expect(meter).toHaveAttribute('data-level', 'warning');
  states[1].status = 'saved'; snapshot(states[1]);
  await expect(pane).toContainText('Resume this session');
  await page.setViewportSize({ width: 320, height: 350 });
  expect((await meter.boundingBox()).x).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => (await pane.boundingBox()).y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(meter).toBeFocused();
});

test('inline usage automatically releases the extension and preserves actual agent activity', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-usage-')), file = join(dir, 'usage.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', id: 'usage', cwd: dir }) + '\n');
  const config = loadConfig(dir), id = sessionKey(file);
  const host = await startHost({ dir, config, port: 0, roots: [dir], allowResume: true, relayUrl: '',
    workerOptions: { bin: process.execPath, prefix: [fileURLToPath(new URL('../fixtures/fake-pi.mjs', import.meta.url))] } });
  try {
    expect((await host.service.resume(id, randomUUID())).ok).toBe(true);
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.locator('#sessions button.session').click();
    const summary = page.getByRole('article', { name: 'Provider usage' });
    for (const [index, [command, expected]] of [
      ['/usage', 'idle'],
      ['/usage', 'idle'],
      ['/usage-settled', 'idle'],
      ['/usage-working', 'working']
    ].entries()) {
      await page.locator('#prompt').fill(command);
      await page.locator('#send').click();
      await expect(summary).toHaveText(`5-hour limit: 25% used · resets in 2hWeekly limit: ${index + 1}% used · resets tomorrow`);
      await expect(page.locator('#dialog')).toBeHidden();
      await expect(page.locator('#composer-send-status')).toBeHidden({ timeout: 1500 });
      await expect(page.locator('#status')).toHaveText(expected, { timeout: 1500 });
      if (expected === 'idle') {
        await expect(page.locator('#agent-activity')).toBeHidden();
        await expect(page.locator('#abort')).toBeHidden();
        await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Type / for commands');
      } else {
        await expect(page.locator('#agent-activity')).toBeVisible();
        await expect(page.locator('#abort')).toBeVisible();
      }
    }
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});
