import { test, expect } from '@playwright/test';

// Served storyboard only. Every runtime event is simulated by visible demo controls.
const route = '/session-icons-prototype.html';
const settlePlacement = mark => mark.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));

const flows = {
  run: [['accepted', 'idle'], ['working', 'working'], ['settling', 'idle'], ['ready', 'idle']],
  input: [['accepted', 'idle'], ['working', 'working'], ['waiting', 'waiting'], ['accepted', 'waiting'], ['working', 'working'], ['settling', 'idle'], ['ready', 'idle']],
  stop: [['accepted', 'idle'], ['working', 'working'], ['stopping', 'working'], ['settling', 'idle'], ['ready', 'idle']],
  unread: [['accepted', 'idle'], ['working', 'working'], ['working', 'working'], ['settling', 'idle'], ['ready', 'idle']],
  reconnect: [['accepted', 'idle'], ['working', 'working'], ['offline', 'working'], ['syncing', 'working'], ['working', 'working'], ['settling', 'idle'], ['ready', 'idle']],
};
for (const [scenario, steps] of Object.entries(flows)) {
  test(`one mark follows the ${scenario} walkthrough without inventing success`, async ({ page }, testInfo) => {
    const errors = [], sockets = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => sockets.push(socket.url()));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    await page.goto(`${route}?scenario=${scenario}`);
    const mark = page.locator('#presence-mark'), cursor = mark.locator('.presence-cursor');
    const original = await mark.elementHandle();
    await expect(page.locator('#page')).toHaveAttribute('data-phase', 'ready');
    for (const [index, [phase, runtime]] of steps.entries()) {
      let runningAnimation;
      if (scenario === 'unread' && index === 2) {
        await expect(cursor).toHaveCSS('animation-name', 'presence-work');
        runningAnimation = await cursor.evaluateHandle(node => node.getAnimations()[0]);
      }
      await page.locator('#next').click();
      await expect(page.locator('#page')).toHaveAttribute('data-phase', phase);
      await expect(page.locator('#page')).toHaveAttribute('data-runtime', runtime);
      expect(await mark.evaluate((node, first) => node === first, original)).toBe(true);
      await expect(mark).toHaveAttribute('data-identity', 'sample-a');
      const leading = runtime !== 'idle' || phase === 'settling';
      await expect(mark).toHaveCSS('width', leading ? '28px' : '20px');
      expect(await mark.evaluate(node => node.parentElement.id)).toBe(leading ? 'focus-leading' : 'focus-inline');
      if (['working', 'stopping'].includes(phase)) {
        await mark.scrollIntoViewIfNeeded();
        await expect(cursor).toHaveCSS('animation-name', 'presence-work');
      } else await expect(cursor).toHaveCSS('animation-name', 'none');
      if (runtime === 'waiting') await expect(mark.locator('.presence-wait')).toBeVisible();
      if (runningAnimation) {
        expect(await cursor.evaluate((node, animation) => node.getAnimations()[0] === animation, runningAnimation)).toBe(true);
        await expect(mark).toHaveAttribute('data-unread', 'true');
        await expect(page.locator('#focus-row')).toHaveAccessibleName(/unread reply/);
        await runningAnimation.dispose();
      }
      if (phase === 'offline') await expect(page.locator('#page')).toHaveAttribute('data-connection', 'offline');
      if (phase === 'syncing') await expect(page.locator('#page')).toHaveAttribute('data-connection', 'checking');
      await settlePlacement(mark);
      expect(await page.locator('#focus-row').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      if (phase === 'waiting' || phase === 'offline' || scenario === 'stop' && index === 3 || scenario === 'run' && index < 2) {
        await page.screenshot({ path: testInfo.outputPath(`${scenario}-${phase}.png`), fullPage: true });
      }
    }
    if (scenario === 'run' || scenario === 'stop') {
      await expect(page.locator('#page')).toHaveAttribute('data-outcome', scenario === 'stop' ? 'stopped' : 'ended');
      await page.getByText('State details', { exact: true }).click();
      await expect(page.locator('[data-field=Outcome]')).toHaveText(scenario === 'stop' ? 'Stopped; partial work unverified' : 'Run ended; result unreviewed');
      await page.getByText('State details', { exact: true }).click();
    }
    if (scenario === 'unread') {
      await expect(page.locator('#focus-dot')).toHaveAttribute('data-unread', '');
      await expect(mark).toHaveAttribute('data-unread', 'true');
      await page.locator('#focus-row').click();
      await expect(page.getByRole('region', { name: 'Sample conversation' })).toBeVisible();
      await expect(mark).toHaveAttribute('data-unread', 'false');
      await expect(page.locator('#page')).toHaveAttribute('data-runtime', 'idle');
      await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
      await expect(page.locator('#focus-row')).toBeVisible();
      await expect(page.locator('#focus-dot')).not.toHaveAttribute('data-unread');
      expect(await mark.evaluate((node, first) => node === first, original)).toBe(true);
    }
    expect(errors).toEqual([]); expect(sockets).toEqual([]);
    expect([...new Set(requests)].every(path => [route, '/session-icons-prototype.js', '/session-icons-prototype.css', '/style.css', '/icon.svg'].includes(path))).toBe(true);
  });
}

test('story controls, reduced motion and actual-size placements work on narrow and wide screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto(`${route}?scenario=reconnect&step=2`);
  const movingMark = page.locator('#presence-mark');
  await settlePlacement(movingMark);
  const before = await movingMark.boundingBox();
  // Observe the first frame without pausing, finishing or otherwise changing the animation.
  const [startY] = await Promise.all([
    movingMark.evaluate(node => new Promise(resolve => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        const first = node.getAnimations()[0]?.effect.getKeyframes()[0];
        resolve(node.getBoundingClientRect().y - new DOMMatrix(getComputedStyle(node).transform).f + new DOMMatrix(first?.transform || 'none').f);
      });
      observer.observe(node, { attributes: true, attributeFilter: ['data-phase'] });
    })),
    page.locator('#next').click(),
  ]);
  expect(startY).toBeCloseTo(before.y, 0);
  for (const [width, colorScheme] of [[320, 'light'], [390, 'dark'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    await page.goto(`${route}?scenario=run&step=2`);
    await expect(page.locator('#page')).toHaveAttribute('data-phase', 'working');
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    const mark = page.locator('#presence-mark');
    await mark.scrollIntoViewIfNeeded();
    await expect(mark.locator('.presence-cursor')).toHaveCSS('animation-name', 'presence-work');
    await settlePlacement(mark);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`working-${width}-${colorScheme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
    await expect(mark.locator('.presence-cursor')).toHaveCSS('animation-name', 'none');
    await page.locator('#next').click(); await page.locator('#next').click();
    await expect(mark).toHaveCSS('width', '20px');
    expect(await mark.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`ready-${width}-${colorScheme}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Preview light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${route}?scenario=input&step=2`);
  await expect(page.getByRole('button', { name: 'Reduce motion', exact: true })).toBeDisabled();
  await expect(page.locator('.presence-cursor')).toHaveCSS('animation-name', 'none');
  await page.locator('#previous').click();
  await expect(page.locator('#page')).toHaveAttribute('data-phase', 'accepted');
  await page.reload();
  await expect(page.locator('#page')).toHaveAttribute('data-phase', 'accepted');
  await page.getByLabel('Walkthrough').selectOption('run');
  await page.getByRole('button', { name: 'Play flow', exact: true }).click();
  await expect(page.locator('#page')).toHaveAttribute('data-phase', 'accepted');
  await page.getByRole('button', { name: 'Pause flow', exact: true }).click();
  // Waiting one event interval proves the paused walkthrough does not advance.
  await page.waitForTimeout(1900);
  await expect(page.locator('#page')).toHaveAttribute('data-phase', 'accepted');
  await page.getByLabel('Walkthrough').selectOption('run');
  await page.getByText('Try a single event', { exact: true }).click();
  await page.locator('[data-event=start]').click();
  await expect(page.getByRole('status')).toContainText('Nothing changed');
  await expect(page.locator('#page')).toHaveAttribute('data-phase', 'ready');
  await page.goto(`${route}?scenario=__proto__&step=999`);
  await expect(page.locator('#page')).toHaveAttribute('data-phase', 'ready');
  await expect(page).toHaveURL(/scenario=run&step=0$/);
});
