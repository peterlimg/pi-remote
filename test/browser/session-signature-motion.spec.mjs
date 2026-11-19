import { test, expect } from '@playwright/test';

test('Signature motion matches the approved prototype in real session rows', async ({ page, context }, testInfo) => {
  const parts = {
    luna: ['.bot-figure', '.bot-look', '.character-moon-mote'],
    miso: ['.bot-figure', '.bot-eyes', '.character-cat-ear', '.character-cat-ear-right', '.character-cat-tail'],
    jelly: ['.bot-figure', '.character-tentacle', '.character-tentacle-middle', '.character-tentacle-right'],
    sol: ['.bot-figure', '.character-sun-rays'],
    moss: ['.bot-figure', '.character-frog-foot', '.character-frog-foot-right'],
    orbit: [],
    comet: ['.bot-figure', '.character-comet-tail', '.character-speed'],
    nim: ['.bot-figure', '.character-wing', '.character-wing-right'],
  };
  const states = Object.keys(parts).map((id, index) => ({ id, title: `Signature ${id}`, status: 'working', cwd: '/projects/demo', updatedAt: Date.now() - index * 1000, messages: [] }));
  await page.setViewportSize({ width: 390, height: 1100 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.addInitScript(kinds => localStorage.setItem('pi-remote-session-icons', JSON.stringify(kinds.map(type => [type, { type }]))), Object.keys(parts));
  let client;
  const publish = () => client.send(JSON.stringify({ type: 'sessions', sessions: states }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); publish(); }
      else if (packet.id) {
        if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(state => state.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('#sessions .session')).toHaveCount(8);
  const preview = await context.newPage();
  await preview.setViewportSize({ width: 390, height: 1100 });
  await preview.emulateMedia({ reducedMotion: 'no-preference' });
  await preview.goto('/session-motion-prototype.html?set=signature');
  await preview.getByRole('button', { name: 'Working', exact: true }).focus();
  await preview.keyboard.press('Enter');
  await expect(preview.locator('#family .m-bot').first()).toHaveAttribute('data-state', 'working');
  const motion = node => {
    const animation = node.getAnimations()[0], style = getComputedStyle(node);
    const { duration, easing, iterations, direction } = animation.effect.getTiming();
    return { duration, easing, iterations: String(iterations), direction, origin: style.transformOrigin, box: style.transformBox, frames: animation.effect.getKeyframes() };
  };
  for (const [kind, selectors] of Object.entries(parts)) {
    for (const selector of selectors) {
      const actual = page.locator(`#sessions [data-id=${kind}] ${selector}`).first();
      const referenceSelector = selector.replace('.character-moon-x', '.m-moon-x').replace('.character-moon-y', '.m-moon-y').replace('.character-speed', '.m-speed');
      const reference = preview.locator(`#family [data-kind=${kind}] ${referenceSelector}`).first();
      expect(await actual.evaluate(motion), `${kind} ${selector}`).toEqual(await reference.evaluate(motion));
    }
  }
  await preview.goto('/session-motion-prototype.html?study=orbit-c');
  const orbit = page.locator('#sessions [data-id=orbit] .bot');
  expect(await orbit.locator('.orbit-disc').evaluateAll(paths => paths.map(p => p.getAttribute('d')))).toEqual(
    await preview.getByRole('img', { name: 'Orbit C, working' }).locator('.ring-design-disc').evaluateAll(paths => paths.map(p => p.getAttribute('d'))));
  await preview.close();
  await page.bringToFront();
  const luna = page.locator('#sessions [data-id=luna] .bot-figure');
  await expect(luna).toHaveCSS('animation-play-state', 'running');
  const pose = await luna.evaluate(node => getComputedStyle(node).transform);
  await expect.poll(() => luna.evaluate(node => getComputedStyle(node).transform)).not.toBe(pose);
  // Cross the old six-second clock wrap, which breaks the new 2.4-second loop.
  const timing = node => ({ progress: node.getAnimations()[0].effect.getComputedTiming().progress, now: performance.now() });
  const before = await luna.evaluate(timing);
  await page.waitForTimeout(6100);
  states[0].title = 'Signature luna renamed'; publish();
  await expect(page.locator('#sessions [data-id=luna] strong')).toHaveText(states[0].title);
  const after = await luna.evaluate(timing);
  const distance = Math.abs(after.progress - (before.progress + (after.now - before.now) / 2400) % 1);
  expect(Math.min(distance, 1 - distance), 'List updates preserve Signature phase').toBeLessThan(.12);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: testInfo.outputPath(`signature-${theme}.png`) });
  }
  await page.locator('#sessions [data-id=orbit]').focus();
  await page.keyboard.press('Enter');
  const moon = page.locator('#title-kind .orbit-moon').first();
  const cx = await moon.getAttribute('cx');
  await expect.poll(() => moon.getAttribute('cx')).not.toBe(cx);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => Number(await moon.getAttribute('cx'))).toBeCloseTo(16 + 13.4 * Math.cos(.05 * Math.PI * 2), 4);
  const still = await moon.getAttribute('cx');
  await page.waitForTimeout(160);
  expect(await moon.getAttribute('cx')).toBe(still);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByLabel('Session details', { exact: true }).press('Enter');
  await page.getByRole('button', { name: /^Session icon / }).press('Enter');
  const choice = page.getByRole('dialog').getByRole('button', { name: 'Orbit', exact: true });
  await choice.scrollIntoViewIfNeeded();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  const pickerMoon = choice.locator('.orbit-moon').first(), pickerX = await pickerMoon.getAttribute('cx');
  await expect.poll(() => pickerMoon.getAttribute('cx')).not.toBe(pickerX);
  await page.getByRole('button', { name: 'Done', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Show sessions', exact: true }).focus();
  await page.keyboard.press('Enter');
  states.find(state => state.id === 'orbit').status = 'waiting'; publish();
  await expect(page.locator('#sessions [data-id=orbit] .bot')).toHaveAttribute('data-mood', 'waiting');
  await expect(orbit.locator('.orbit-moon')).toHaveCount(0);
  await expect(page.locator('#sessions [data-id=orbit] .bot-badge')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 400 });
  const nim = page.locator('#sessions [data-id=nim] .bot-figure');
  await expect(nim).toHaveCSS('animation-play-state', 'paused');
  await nim.scrollIntoViewIfNeeded();
  await expect(nim).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#sessions .bot *').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
  expect(await page.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('pi-remote-session-icons')).map(([id, choice]) => [id, choice.type])))).toEqual(Object.fromEntries(Object.keys(parts).map(kind => [kind, kind])));
});
