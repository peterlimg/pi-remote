import { test, expect } from '@playwright/test';

test('focused preview compares three 32px gestures without changing live motion', async ({ page, browserName }, testInfo) => {
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
  await expect(page.locator('#comparison .bot')).toHaveCount(9);
  await expect(page.locator('#lifecycle-study')).toBeHidden();
  const figure = (variant, kind) => page.locator(`#comparison [data-variant=${variant}] [data-kind=${kind}] .bot-figure`);
  const pose = node => getComputedStyle(node).transform;
  for (const kind of ['miso', 'luna', 'jelly']) {
    for (const variant of ['current', 'revised']) {
      const body = figure(variant, kind);
      await expect(body).toHaveCSS('animation-name', `${variant === 'current' ? 'character' : 'focus'}-${kind}`);
      await expect(body).toHaveCSS('animation-play-state', 'running');
      const initial = await body.evaluate(pose);
      await expect.poll(() => body.evaluate(pose)).not.toBe(initial);
    }
    await expect(figure('still', kind)).toHaveCSS('animation-name', 'none');
  }
  expect(await page.locator('#comparison .bot').evaluateAll(nodes => nodes.every(node => node.offsetWidth === 32 && node.offsetHeight === 32))).toBe(true);
  expect(await page.locator('#comparison [data-variant=still]').evaluateAll(nodes => nodes.every(node => node.getAnimations({ subtree: true }).length === 0))).toBe(true);
  await activate(page.getByRole('button', { name: 'Pause motion', exact: true }));
  await expect(figure('revised', 'miso')).toHaveCSS('animation-play-state', 'paused');
  const paused = await figure('revised', 'miso').evaluate(pose);
  await page.waitForTimeout(150);
  expect(await figure('revised', 'miso').evaluate(pose)).toBe(paused);
  await activate(page.getByRole('button', { name: 'Replay comparison' }));
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
  await figure('revised', 'jelly').scrollIntoViewIfNeeded();
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
