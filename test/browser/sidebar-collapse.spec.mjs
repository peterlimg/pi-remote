import { test, expect } from '@playwright/test';

for (const [width, colorScheme] of [[744, 'dark'], [1280, 'light']]) {
  test(`sessions sidebar collapses without leaving the conversation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    const collapse = page.getByRole('button', { name: 'Collapse sessions', exact: true });
    const show = page.getByRole('button', { name: 'Show sessions', exact: true });
    const sidebar = page.locator('#sidebar');
    await expect(collapse).toBeVisible();
    const target = await collapse.boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    const heading = await page.locator('.brand h2').boundingBox();
    expect(target.x + target.width).toBeLessThanOrEqual(heading.x);
    await collapse.focus();
    await collapse.press('Enter');
    await expect(sidebar).toBeHidden();
    await expect(sidebar).toHaveAttribute('inert', '');
    await expect(show).toHaveText('');
    await expect(show).toHaveAttribute('id', 'sidebar-toggle');
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await expect(show).toBeInViewport();
    const reopen = await show.boundingBox();
    expect(reopen.x).toBe(target.x);
    expect(reopen.y).toBe(target.y);
    expect(reopen.width).toBe(44);
    expect(reopen.height).toBe(44);
    await expect(show).toBeFocused();
    await show.press('Enter');
    await expect(collapse).toBeFocused();
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).not.toHaveAttribute('inert');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(page.locator('#title')).toHaveText('Project Alpha');
    await page.locator('#prompt').fill('Keep this draft');
    await page.screenshot({ path: testInfo.outputPath('expanded.png') });
    const history = await page.evaluate(() => window.history.state);
    await collapse.click();
    await expect(sidebar).toBeHidden();
    expect((await page.locator('main').boundingBox()).width).toBe(width);
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    await page.screenshot({ path: testInfo.outputPath('collapsed.png') });
    await show.click();
    await expect(sidebar).toBeVisible();
    await expect(show).toBeHidden();
    await expect(page.locator('#title')).toHaveText('Project Alpha');
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    expect(await page.evaluate(() => window.history.state)).toEqual(history);
    await collapse.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(collapse).toBeHidden();
    await expect(page.locator('#sidebar-toggle')).toBeHidden();
    await expect(sidebar).not.toHaveAttribute('inert');
    await expect(show).toHaveAttribute('id', 'back');
    await show.click();
    await expect(sidebar).toBeVisible();
    await page.getByRole('button', { name: /Project Beta/ }).click();
    await expect(page.locator('#title')).toHaveText('Project Beta');
    await page.setViewportSize({ width, height: 1000 });
    await expect(sidebar).toBeHidden();
    await show.click();
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  });
}

test('sidebar motion keeps its toggle and composer in place and supports reversal and reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 744, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Keep this draft');
  const toggle = page.locator('#sidebar-toggle');
  const samples = [];
  for (const expanded of [false, true]) {
    await toggle.click();
    const frames = await page.evaluate(() => new Promise(resolve => {
      const frames = [], start = performance.now();
      const sample = now => {
        const main = document.querySelector('main').getBoundingClientRect();
        const toggle = document.getElementById('sidebar-toggle').getBoundingClientRect();
        const composer = document.getElementById('composer').getBoundingClientRect();
        frames.push({ x: main.x, toggleX: toggle.x, toggleY: toggle.y, composerBottom: composer.bottom });
        if (now - start < 350) requestAnimationFrame(sample);
        else resolve(frames);
      };
      requestAnimationFrame(sample);
    }));
    samples.push(frames);
    expect(frames.some(frame => frame.x > 0 && frame.x < 320)).toBe(true);
    expect(frames.at(-1).x).toBe(expanded ? 320 : 0);
    for (const frame of frames) {
      expect(frame.toggleX).toBe(12);
      expect(frame.toggleY).toBe(12);
      expect(frame.composerBottom).toBeLessThanOrEqual(1000);
    }
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  }
  await testInfo.attach('sidebar-motion.json', { body: JSON.stringify(samples), contentType: 'application/json' });
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await page.locator('main').boundingBox()).x).toBe(320);
  await expect(page.locator('#sidebar')).not.toHaveAttribute('inert');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#app')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('#sidebar')).toHaveCSS('transition-duration', '0s');
  await toggle.click();
  await expect(page.locator('#sidebar')).toBeHidden();
  expect((await page.locator('main').boundingBox()).x).toBe(0);
  await toggle.click();
  expect((await page.locator('main').boundingBox()).x).toBe(320);
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
});
