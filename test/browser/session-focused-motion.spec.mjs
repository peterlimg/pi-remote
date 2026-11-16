import { test, expect } from '@playwright/test';

test('running preview compares four 32px loops with the unchanged Idea reference', async ({ page, browserName }, testInfo) => {
  const errors = [];
  // Local WebKit intercepts pointer clicks at <html>; verify keyboard activation there.
  const activate = async control => {
    if (browserName === 'webkit') { await control.focus(); await page.keyboard.press('Enter'); }
    else await control.click();
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto('/session-motion-prototype.html?set=focused');
  await expect(page.locator('#comparison .bot')).toHaveCount(12);
  await expect(page.locator('#comparison [data-kind=idea]')).toHaveCount(4);
  await expect(page.locator('#lifecycle-study')).toBeHidden();
  const figure = (variant, kind) => page.locator(`#comparison [data-variant=${variant}] [data-kind=${kind}] .bot-figure`);
  const pose = node => getComputedStyle(node).transform;
  for (const kind of ['miso', 'luna', 'jelly', 'orbit']) {
    await page.getByRole('region', { name: kind[0].toUpperCase() + kind.slice(1), exact: true }).scrollIntoViewIfNeeded();
    for (const variant of ['current', 'revised']) {
      const ring = variant === 'revised' && kind === 'orbit';
      const body = ring ? page.locator('#comparison [data-variant=revised] .character-planet-ring').first() : figure(variant, kind);
      await expect(body).toHaveCSS('animation-name', ring ? 'm-spin' : `${variant === 'current' ? 'character' : 'focus'}-${kind}`);
      await expect(body).toHaveCSS('animation-play-state', 'running');
      const initial = await body.evaluate(pose);
      await expect.poll(() => body.evaluate(pose)).not.toBe(initial);
    }
    if (kind !== 'orbit') {
      const range = await figure('revised', kind).evaluate(async node => {
        const values = [], start = performance.now();
        while (performance.now() - start < 1500) {
          values.push(new DOMMatrix(getComputedStyle(node).transform).a);
          await new Promise(requestAnimationFrame);
        }
        return { min: Math.min(...values), max: Math.max(...values) };
      });
      if (kind === 'luna') { expect(range.min).toBeLessThan(-.8); expect(range.max).toBeGreaterThan(.8); }
      else expect(range.max - range.min).toBeGreaterThan(.24);
    }
  }
  const idea = page.locator('#comparison [data-kind=idea]').last();
  for (const [part, name, duration] of [
    ['svg', 'character-idea-gesture', '3s'], ['.bot-figure', 'bot-bob', '0.5s'],
    ['.bot-look', 'bot-glance', '1.5s'], ['.bot-bulb', 'bot-flicker', '1s'], ['.bot-rays', 'bot-flash', '0.5s'],
  ]) {
    await expect(idea.locator(part)).toHaveCSS('animation-name', name);
    await expect(idea.locator(part)).toHaveCSS('animation-duration', duration);
  }
  await expect(idea.locator('.bot-figure')).toHaveCSS('transform-box', 'fill-box');
  const moon = page.locator('#comparison [data-variant=revised] .m-moon-x');
  await expect(moon).toBeVisible();
  const moonPose = await moon.evaluate(pose);
  await expect.poll(() => moon.evaluate(pose)).not.toBe(moonPose);
  expect(await page.locator('#comparison .bot').evaluateAll(nodes => nodes.every(node => node.offsetWidth === 32 && node.offsetHeight === 32))).toBe(true);
  await activate(page.getByRole('button', { name: 'Pause motion', exact: true }));
  await expect(figure('revised', 'miso')).toHaveCSS('animation-play-state', 'paused');
  expect(await page.locator('#comparison').evaluate(node => node.getAnimations({ subtree: true }).every(animation => animation.playState === 'paused'))).toBe(true);
  const paused = await figure('revised', 'miso').evaluate(pose);
  await page.waitForTimeout(150);
  expect(await figure('revised', 'miso').evaluate(pose)).toBe(paused);
  await activate(page.getByRole('button', { name: 'Replay comparison' }));
  await page.getByRole('region', { name: 'Miso', exact: true }).scrollIntoViewIfNeeded();
  await expect(figure('revised', 'miso')).toHaveCSS('animation-play-state', 'running');
  await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('focused-phone-light.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Preview dark theme' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('focused-phone-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('focused-desktop.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.getByRole('heading', { name: 'Working motion' }).scrollIntoViewIfNeeded();
  await expect(figure('revised', 'jelly')).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('region', { name: 'Jelly', exact: true }).scrollIntoViewIfNeeded();
  await expect(figure('revised', 'jelly')).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#comparison').evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByRole('button', { name: 'Reduced motion enabled' })).toBeDisabled();
  await activate(page.getByRole('link', { name: 'Back to B · Signature' }));
  await expect(page.locator('#page')).toHaveAttribute('data-set', 'signature');
  await expect(page.locator('#comparison')).toBeHidden();
  await expect(page.locator('#family .bot')).toHaveCount(8);
  expect(errors).toEqual([]);
});
