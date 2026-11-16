import { test, expect } from '@playwright/test';

test('character study coordinates four 32px avatars without changing live artwork', async ({ page }, info) => {
  test.setTimeout(60000);
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  // Keyboard activation also avoids the local WebKit pointer interception issue.
  const activate = async control => { await control.focus(); await page.keyboard.press('Enter'); };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto('/session-motion-prototype.html?set=focused');
  const list = page.locator('#presence-sessions');
  const working = list.locator('.presence-bot[data-state=working]');
  const idle = list.locator('.presence-bot[data-state=ready]');
  await expect(working).toHaveCount(4);
  await expect(list.locator('.session')).toHaveCount(6);
  await expect(page.locator('#comparison [data-kind=jelly]')).toHaveCount(0);
  await expect(page.locator('#lifecycle-study')).toBeHidden();
  await expect(working.first()).toHaveClass(/in-view/);
  const pose = node => node.innerHTML;
  const idlePose = await idle.evaluate(pose);
  for (const node of await working.all()) {
    const initial = await node.evaluate(pose);
    await expect.poll(() => node.evaluate(pose)).not.toBe(initial);
    expect(await node.evaluate(node => [node.offsetWidth, node.offsetHeight])).toEqual([32, 32]);
  }
  // Sample the rendered SVG, not the animation implementation: faces pass behind
  // bodies, the ring moon changes depth, and appendages move separately.
  const samples = await list.evaluate(async list => {
    const miso = list.querySelector('[data-kind=miso] .presence-bot');
    const orbit = list.querySelector('[data-kind=orbit] .presence-bot');
    const states = { hiddenEyes: false, visibleEyes: false, front: false, back: false, tails: new Set(), rings: new Set(), motes: new Set(), streaks: new Set() };
    const start = performance.now();
    while (performance.now() - start < 6100) {
      const eyes = [...miso.querySelectorAll('.presence-eye')];
      states.hiddenEyes ||= eyes.every(eye => eye.getAttribute('opacity') === '0');
      states.visibleEyes ||= eyes.every(eye => eye.getAttribute('opacity') === '1');
      states.front ||= orbit.querySelector('.presence-moon-front').getAttribute('opacity') === '1';
      states.back ||= orbit.querySelector('.presence-moon-back').getAttribute('opacity') === '1';
      states.tails.add(list.querySelector('.character-comet-tail').getAttribute('transform'));
      states.rings.add(orbit.querySelector('.presence-ring-front').getAttribute('transform'));
      states.motes.add(list.querySelector('.character-moon-mote').getAttribute('transform'));
      states.streaks.add(list.querySelector('.m-speed').getAttribute('opacity'));
      await new Promise(requestAnimationFrame);
    }
    return { ...states, tails: states.tails.size, rings: states.rings.size, motes: states.motes.size, streaks: states.streaks.size };
  });
  expect(samples).toMatchObject({ hiddenEyes: true, visibleEyes: true, front: true, back: true });
  for (const key of ['tails', 'rings', 'motes', 'streaks']) expect(samples[key]).toBeGreaterThan(10);
  expect(await idle.evaluate(pose)).toBe(idlePose);
  const idea = list.locator('[data-kind=idea]');
  await expect(idea.locator('.bot-figure')).toHaveCSS('animation-name', 'bot-bob');
  await expect(idea.locator('.bot-bulb')).toHaveCSS('animation-name', 'bot-flicker');
  await activate(page.getByRole('button', { name: 'Pause motion', exact: true }));
  await page.waitForTimeout(80);
  const frozen = await list.evaluate(pose);
  await page.waitForTimeout(200);
  expect(await list.evaluate(pose)).toBe(frozen);
  expect(await list.evaluate(node => node.getAnimations({ subtree: true }).every(animation => animation.playState === 'paused'))).toBe(true);
  await page.screenshot({ path: info.outputPath('presence-phone-light.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Preview dark theme' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('presence-phone-dark.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Replay comparison' }));
  await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const replayed = await working.first().evaluate(pose);
  await expect.poll(() => working.first().evaluate(pose)).not.toBe(replayed);
  await activate(page.locator('.presence-comparisons summary'));
  await expect(page.locator('.motion-comparison')).toHaveCount(4);
  for (const kind of ['miso', 'luna', 'orbit', 'comet']) {
    const section = page.getByRole('region', { name: kind[0].toUpperCase() + kind.slice(1), exact: true });
    await section.scrollIntoViewIfNeeded();
    const before = section.locator('[data-variant=current] .bot-figure > .bot-body');
    const after = section.locator('[data-variant=revised] .bot-figure > .bot-body');
    if (kind === 'orbit') expect(await after.innerHTML()).not.toBe(await before.innerHTML());
    else expect(await after.innerHTML()).toBe(await before.innerHTML());
    await expect(section.locator('[data-variant=current] .bot-figure')).toHaveCSS('animation-name', `character-${kind}`);
    const rest = section.locator('[data-variant=rest] .presence-bot');
    const resting = await rest.evaluate(pose);
    await page.waitForTimeout(80);
    expect(await rest.evaluate(pose)).toBe(resting);
  }
  await expect(working.first()).not.toHaveClass(/in-view/);
  const offscreen = await working.first().evaluate(pose);
  await page.waitForTimeout(150);
  expect(await working.first().evaluate(pose)).toBe(offscreen);
  await page.getByRole('heading', { name: 'Working motion', exact: true }).scrollIntoViewIfNeeded();
  await expect(working.first()).toHaveClass(/in-view/);
  await expect.poll(() => working.first().evaluate(pose)).not.toBe(offscreen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion enabled' })).toBeDisabled();
  await page.waitForTimeout(100);
  const reduced = await page.locator('#comparison').evaluate(pose);
  await page.waitForTimeout(150);
  expect(await page.locator('#comparison').evaluate(pose)).toBe(reduced);
  expect(await page.locator('#comparison').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(list.getByText('Miso · Working · pi-remote', { exact: true })).toBeVisible();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('presence-desktop.png'), fullPage: true });
  await activate(page.getByRole('link', { name: 'Back to B · Signature' }));
  await expect(page.locator('#page')).toHaveAttribute('data-set', 'signature');
  await expect(page.locator('#comparison')).toBeHidden();
  await expect(page.locator('#family .bot')).toHaveCount(8);
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
});
