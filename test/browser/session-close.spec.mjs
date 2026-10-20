import { test, expect, devices } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession } from '../../src/catalog.mjs';
import { socket, until } from '../helpers.mjs';

test('swipe closes sessions across phones without deleting history or stopping work, with undo and search recovery', async ({ page, browser }, testInfo) => {
  test.setTimeout(60000);
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-close-')), root = join(dir, 'sessions');
  mkdirSync(root);
  const originals = new Map(), now = Date.now();
  const seed = (title, index) => {
    const file = join(root, `${index}.jsonl`), timestamp = now - index * 60000;
    const text = [
      { type: 'session', version: 3, id: randomUUID(), cwd: '/projects/pi-remote', timestamp: new Date(timestamp).toISOString() },
      { type: 'session_info', id: 'name', parentId: null, name: title },
      { type: 'message', id: 'user', parentId: 'name', message: { role: 'user', content: title, timestamp } },
      { type: 'message', id: 'reply', parentId: 'user', message: { role: 'assistant', content: 'History is still here.', timestamp: timestamp + 1000 } }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n';
    writeFileSync(file, text); originals.set(file, text);
    return { file, id: sessionKey(file) };
  };
  const saved = seed('Untitled session', 0), pinned = seed('Pinned task', 1), running = seed('Running task', 2);
  for (let i = 3; i < 27; i++) seed('Recent task ' + i, i);
  writeFileSync(join(dir, 'pinned-sessions.json'), JSON.stringify([pinned.id]));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const commands = [], frames = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framesent', frame => frames.push(JSON.parse(frame.payload))));
  let host, agent, lock, secondContext, peer;
  const launch = async () => {
    host = await startHost({ dir, config, port: 0, roots: [root], relayUrl: '' });
    return `http://127.0.0.1:${host.http.address().port}`;
  };
  const rows = page.locator('#sessions .session');
  const savedRow = rows.filter({ hasText: 'Untitled session' });
  const closedFile = join(dir, 'closed-sessions.json');
  try {
    let url = await launch();
    const state = { ...readSession(running.file), status: 'working', instanceId: randomUUID() };
    lock = acquireLock(join(dir, 'locks'), state.id, { file: running.file, instanceId: state.instanceId });
    agent = await socket(url.replace('http:', 'ws:') + '/bridge', config.bridgeToken);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.type === 'command') commands.push(packet);
    });
    await until(() => host.service.live.has(state.id));
    peer = await socket(url.replace('http:', 'ws:') + '/ws', config.clientToken, url);
    for (const values of [{ sessionId: '../bad', closed: true }, { sessionId: saved.id, closed: 'yes' }, { sessionId: '0'.repeat(64), closed: true }]) {
      expect((await peer.request('closeSession', values)).ok).toBe(false);
    }
    await page.goto(url + '/#token=' + config.clientToken);
    const recent = page.getByRole('region', { name: 'Recent', exact: true });
    await expect(recent.locator('.session')).toHaveCount(20);
    secondContext = await browser.newContext({ ...devices['iPhone 13'] });
    const other = await secondContext.newPage();
    await other.goto(url + '/#token=' + config.clientToken);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(1);

    const cdp = await page.context().newCDPSession(page);
    const drag = async (row, dx, dy = 0) => {
      await row.click({ trial: true });
      const box = await row.boundingBox(), x = box.x + box.width * (dx < 0 ? .75 : .25), y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (const fraction of [.2, .6, 1]) await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + dx * fraction, y: y + dy * fraction }]
      });
    };
    const release = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
    for (const [dx, dy, end] of [[-35, 0, 'touchEnd'], [-110, 0, 'touchCancel'], [0, -90, 'touchEnd']]) {
      await drag(savedRow, dx, dy); await release(end);
      await expect(page.locator('.session.dragging')).toHaveCount(0);
      expect(frames.filter(frame => frame.op === 'closeSession')).toHaveLength(0);
      await expect(savedRow).toHaveCount(1);
    }
    // A right swipe still pins, and a canceled right swipe cannot unpin.
    await drag(savedRow, 110); await release('touchEnd');
    await expect(savedRow.getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
    await drag(savedRow, 110); await release('touchCancel');
    await expect(page.locator('.session.dragging')).toHaveCount(0);
    expect(host.service.pins.has(saved.id)).toBe(true);
    await drag(savedRow, 110); await release('touchEnd');
    await expect(savedRow.getByRole('img', { name: 'Pinned', exact: true })).toHaveCount(0);

    await drag(savedRow, -110);
    await expect(savedRow).toHaveClass(/closing.*swipe-ready|swipe-ready.*closing/);
    await expect(savedRow).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -108, 0)');
    await page.screenshot({ path: testInfo.outputPath('swipe-close-phone.png') });
    await release('touchEnd');
    await expect(savedRow).toHaveCount(0);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(0);
    await expect(page.locator('#app')).not.toHaveClass(/viewing/);
    await expect(recent.locator('.session')).toHaveCount(20); // The next saved row fills the page.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    expect(frames.filter(frame => frame.op === 'watch')).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('closed-session-phone.png') });
    expect(JSON.parse(readFileSync(closedFile, 'utf8'))).toEqual([saved.id]);
    expect(statSync(closedFile).mode & 0o777).toBe(0o600);
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(savedRow).toHaveCount(1);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'View all pinned sessions' }).tap();
    const collection = page.getByRole('dialog', { name: 'Pinned sessions', exact: true });
    await drag(collection.locator('.session'), -110); await release('touchEnd');
    await expect(collection.locator('.session')).toHaveCount(0);
    await expect(collection.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await collection.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(collection.locator('.session')).toHaveCount(1);
    expect(host.service.pins.has(pinned.id)).toBe(true);
    await page.getByRole('button', { name: 'Close sessions', exact: true }).tap();
    await drag(rows.filter({ hasText: 'Running task' }), -110); await release('touchEnd');
    await expect(rows.filter({ hasText: 'Running task' })).toHaveCount(0);
    expect(host.service.live.get(running.id).state.status).toBe('working');
    expect(agent.ws.readyState).toBe(1);
    expect(commands).toEqual([]); // No abort, process exit, or other Pi command.
    await drag(savedRow, -110); await release('touchEnd');
    await expect(savedRow).toHaveCount(0);
    host.service.scan();
    await page.reload();
    await expect(savedRow).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Pinned task' })).toHaveCount(1);

    agent.ws.terminate(); lock.release(); peer.ws.terminate();
    await secondContext.close(); secondContext = undefined;
    await host.close();
    url = await launch();
    await page.goto(url + '/#token=' + config.clientToken);
    await expect(recent.locator('.session')).toHaveCount(20);
    await expect(savedRow).toHaveCount(0);
    await page.getByRole('button', { name: 'Search sessions', exact: true }).tap();
    await page.getByRole('searchbox', { name: 'Search sessions', exact: true }).fill('Untitled session');
    await expect(savedRow.locator('.session-closed')).toHaveText('Closed');
    await savedRow.tap();
    await expect(page.locator('#title')).toHaveText('Untitled session');
    await expect(page.locator('#transcript')).toContainText('History is still here.');
    await expect.poll(() => host.service.closedSessions.has(saved.id)).toBe(false);
    await page.locator('#prompt').fill('Draft survives closing');
    await page.getByRole('button', { name: 'Show sessions', exact: true }).tap();
    await page.getByRole('button', { name: 'Close search', exact: true }).tap();
    await expect(savedRow).toHaveCount(1);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await savedRow.click();
    await page.getByLabel('Session details', { exact: true }).click();
    await page.getByRole('button', { name: 'Close session', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(savedRow).toHaveCount(0);
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#composer')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('closed-session-desktop-dark.png') });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(savedRow).toHaveCount(1);
    await savedRow.click();
    await expect(page.locator('#prompt')).toHaveValue('Draft survives closing');
    await expect(page.locator('#transcript')).toContainText('History is still here.');

    // A failed disk write leaves the row and history untouched and reports a safe error.
    mkdirSync(closedFile + '.tmp');
    await page.getByLabel('Session details', { exact: true }).click();
    await page.getByRole('button', { name: 'Close session', exact: true }).click();
    await expect(page.locator('#notice')).toHaveText('Could not save closed sessions. Try again.');
    await expect(savedRow).toHaveCount(1);
    expect(host.service.closedSessions.has(saved.id)).toBe(false);
    rmSync(closedFile + '.tmp', { recursive: true });
    for (const [file, text] of originals) expect(readFileSync(file, 'utf8')).toBe(text);
    expect(errors).toEqual([]);
    await testInfo.attach('session-close', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    await testInfo.attach('session-close-frames', { body: JSON.stringify(frames), contentType: 'application/json' });
  } finally {
    await secondContext?.close(); await page.close();
    agent?.ws.terminate(); peer?.ws.terminate(); lock?.release();
    await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
