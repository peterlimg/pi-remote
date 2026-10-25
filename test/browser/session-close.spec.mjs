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

test('closing requires confirmation, syncs across phones and keeps history, with expiring feedback and recovery', async ({ page, browser, browserName }, testInfo) => {
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
  const saved = seed('Untitled session', 0), pinned = seed('Pinned task with a long session title that should wrap without stretching the confirmation', 1), running = seed('Running task', 2);
  for (let i = 3; i < 27; i++) seed('Recent task ' + i, i);
  writeFileSync(join(dir, 'pinned-sessions.json'), JSON.stringify([pinned.id]));
  const config = { ...loadConfig(dir), clientToken: 'browser-test-token-only-123456789012345' };
  const commands = [], frames = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push('Unexpected browser confirmation'); void dialog.dismiss(); });
  const phoneViewport = page.viewportSize();
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
    await page.clock.install();
    await page.goto(url + '/#token=' + config.clientToken);
    const recent = page.getByRole('region', { name: 'Recent', exact: true });
    await expect(recent.locator('.session')).toHaveCount(20);
    secondContext = await browser.newContext({ ...devices['iPhone 13'] });
    const other = await secondContext.newPage();
    await other.goto(url + '/#token=' + config.clientToken);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(1);
    await page.bringToFront();

    const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined;
    let touchTarget;
    const touch = async (type, points) => {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      else await touchTarget.evaluate((row, { type, points }) => {
        // WebKit automation has no constructible Touch, so simulate only the input the gesture reads.
        row.dispatchEvent(Object.assign(new Event(type.toLowerCase(), { bubbles: true, cancelable: true }), {
          touches: points.map(({ x, y }) => ({ clientX: x, clientY: y }))
        }));
      }, { type, points });
    };
    const drag = async (row, dx, dy = 0) => {
      await row.click({ trial: true }); touchTarget = row;
      const box = await row.boundingBox(), x = box.x + box.width * (dx < 0 ? .75 : .25), y = box.y + box.height / 2;
      await touch('touchStart', [{ x, y }]);
      for (const fraction of [.2, .6, 1]) await touch('touchMove', [{ x: x + dx * fraction, y: y + dy * fraction }]);
      expect(await row.evaluate(node => getComputedStyle(node, '::before').borderRadius)).toBe('0px');
    };
    const release = type => touch(type, []);
    const confirmation = page.getByRole('dialog', { name: 'Close session?', exact: true });
    const confirmClose = async (trigger, accepted = true) => {
      const count = frames.filter(frame => frame.op === 'closeSession').length;
      await trigger();
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText('History is kept. Running work continues.');
      expect(await confirmation.evaluate(node => node.matches(':modal'))).toBe(true);
      const closeButton = confirmation.getByRole('button', { name: 'Close session', exact: true });
      for (const property of ['background-color', 'color']) {
        await expect(closeButton).toHaveCSS(property, await page.locator('#pair-submit').evaluate((node, property) => getComputedStyle(node).getPropertyValue(property), property));
      }
      for (const action of await confirmation.getByRole('button').all()) {
        const box = await action.boundingBox();
        expect(box.height).toBe(44);
        expect(box.width).toBeLessThan(130);
        expect(await action.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      expect(frames.filter(frame => frame.op === 'closeSession')).toHaveLength(count);
      await confirmation.getByRole('button', { name: accepted ? 'Close session' : 'Cancel', exact: true }).click();
      await expect(confirmation).toBeHidden();
    };
    for (const [dx, dy, end] of [[-35, 0, 'touchEnd'], [-110, 0, 'touchCancel'], [0, -90, 'touchEnd']]) {
      await drag(savedRow, dx, dy); await release(end);
      await expect(page.locator('.session.dragging')).toHaveCount(0);
      expect(frames.filter(frame => frame.op === 'closeSession')).toHaveLength(0);
      await expect(savedRow).toHaveCount(1);
    }
    // A right swipe still pins, and a canceled right swipe cannot unpin.
    await drag(savedRow, 110);
    await page.screenshot({ path: testInfo.outputPath('swipe-pin-phone.png') });
    await release('touchEnd');
    await expect(savedRow.getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
    await drag(savedRow, 110); await release('touchCancel');
    await expect(page.locator('.session.dragging')).toHaveCount(0);
    expect(host.service.pins.has(saved.id)).toBe(true);
    await drag(savedRow, 110); await release('touchEnd');
    await expect(savedRow.getByRole('img', { name: 'Pinned', exact: true })).toHaveCount(0);

    await drag(savedRow, -110);
    await expect(savedRow).toHaveClass(/closing.*swipe-ready|swipe-ready.*closing/);
    await expect(savedRow).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -108, 0)');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      expect(await savedRow.evaluate(node => getComputedStyle(node, '::before').borderRadius)).toBe('0px');
      for (const property of ['background-color', 'color']) {
        const expected = await page.locator('#session-close-confirm-button').evaluate((node, property) => getComputedStyle(node).getPropertyValue(property), property);
        expect(await savedRow.evaluate((node, property) => getComputedStyle(node, '::before').getPropertyValue(property), property), `${colorScheme} close swipe ${property}`).toBe(expected);
      }
      await page.screenshot({ path: testInfo.outputPath(`swipe-close-phone-${colorScheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await confirmClose(async () => {
      await release('touchEnd');
      await expect(confirmation).toBeFocused();
      const card = confirmation.locator('.session-close-card');
      await expect(card).toHaveCSS('animation-name', 'none');
      const tops = await card.evaluate(node => new Promise(resolve => {
        const frames = [];
        const sample = () => {
          frames.push(node.getBoundingClientRect().top);
          if (frames.length === 6) resolve(frames); else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
      await expect(confirmation.locator('#session-close-name')).toHaveText('Untitled session');
      await page.screenshot({ path: testInfo.outputPath('confirm-close-phone-light.png') });
      await testInfo.attach('close-confirmation', { body: await confirmation.ariaSnapshot(), contentType: 'text/plain' });
    }, false);
    await expect(savedRow).toHaveCount(1);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(1);
    // The first action after Cancel must work without a stuck form or modal overlay.
    await page.getByRole('button', { name: 'Search sessions', exact: true }).tap({ timeout: 1000 });
    await expect(page.getByRole('searchbox', { name: 'Search sessions', exact: true })).toBeFocused({ timeout: 1000 });
    await page.getByRole('button', { name: 'Close search', exact: true }).tap();
    await drag(savedRow, -110); await release('touchEnd');
    await expect(confirmation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await drag(savedRow, -110); await release('touchEnd');
    await expect(confirmation).toBeVisible();
    await confirmation.click({ position: { x: 4, y: 4 } });
    await expect(confirmation).toBeHidden();
    await expect(savedRow).toHaveCount(1);
    expect(frames.filter(frame => frame.op === 'closeSession')).toHaveLength(0);
    await drag(savedRow, -110);
    await confirmClose(() => release('touchEnd'));
    await expect(savedRow).toHaveCount(0);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(0);
    await expect(page.locator('#app')).not.toHaveClass(/viewing/);
    await expect(recent.locator('.session')).toHaveCount(20); // The next saved row fills the page.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    expect(frames.filter(frame => frame.op === 'watch')).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('closed-session-phone.png') });
    expect(JSON.parse(readFileSync(closedFile, 'utf8'))).toEqual([saved.id]);
    expect(statSync(closedFile).mode & 0o777).toBe(0o600);
    await page.clock.fastForward(1500);
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(savedRow).toHaveCount(1);
    await expect(other.locator('#sessions .session[data-id="' + saved.id + '"]')).toHaveCount(1);
    const feedback = page.locator('#session-feedback');
    await expect(feedback).toContainText('Session reopened.');
    await page.clock.fastForward(1501);
    await expect(feedback).toBeVisible(); // Replacing a toast resets its expiry.
    await page.clock.fastForward(1500);
    await expect(feedback).toBeHidden({ timeout: 1000 });

    await page.getByRole('button', { name: 'View all pinned sessions' }).tap();
    const collection = page.getByRole('dialog', { name: 'Pinned sessions', exact: true });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await drag(collection.locator('.session'), -110);
    await confirmClose(async () => {
      await release('touchEnd');
      await expect(confirmation).toBeVisible();
      await expect(confirmation.locator('#session-close-name')).toContainText('Pinned task');
      expect((await confirmation.locator('.session-close-card').boundingBox()).height).toBeLessThan(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('confirm-close-narrow-dark.png') });
    }, false);
    await page.setViewportSize(phoneViewport);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(collection).toBeVisible();
    await expect(collection.locator('.session')).toHaveCount(1);
    await drag(collection.locator('.session'), -110);
    await confirmClose(() => release('touchEnd'));
    await expect(collection.locator('.session')).toHaveCount(0);
    await expect(collection.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await collection.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(collection.locator('.session')).toHaveCount(1);
    expect(host.service.pins.has(pinned.id)).toBe(true);
    const closesBeforeDismiss = frames.filter(frame => frame.op === 'closeSession').length;
    await collection.getByRole('button', { name: 'Dismiss', exact: true }).tap();
    await expect(feedback).toBeHidden();
    expect(frames.filter(frame => frame.op === 'closeSession')).toHaveLength(closesBeforeDismiss);
    await page.getByRole('button', { name: 'Close sessions', exact: true }).tap();
    await drag(rows.filter({ hasText: 'Running task' }), -110);
    await confirmClose(() => release('touchEnd'));
    await expect(rows.filter({ hasText: 'Running task' })).toHaveCount(0);
    expect(host.service.live.get(running.id).state.status).toBe('working');
    expect(agent.ws.readyState).toBe(1);
    expect(commands).toEqual([]); // No abort, process exit, or other Pi command.
    await drag(savedRow, -110);
    await confirmClose(() => release('touchEnd'));
    await expect(savedRow).toHaveCount(0);
    await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await page.clock.fastForward(3001);
    await expect(feedback).toBeHidden({ timeout: 1000 });
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
    const closeAction = page.getByRole('button', { name: 'Close session', exact: true });
    await expect(closeAction).toHaveCSS('color', await page.locator('#session-pin').evaluate(node => getComputedStyle(node).color));
    await closeAction.focus();
    await page.keyboard.press('Enter');
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(closeAction).toBeFocused();
    await confirmClose(async () => {
      await page.keyboard.press('Enter');
      await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('confirm-close-desktop-dark.png') });
    });
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
    await confirmClose(() => page.getByRole('button', { name: 'Close session', exact: true }).click());
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
