import { test, expect } from '@playwright/test';

for (const [width, colorScheme] of [[744, 'dark'], [1280, 'light']]) {
  test(`sessions drawer reveals and dismisses without changing the conversation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    const toggle = page.locator('#sidebar-toggle'), sidebar = page.locator('#sidebar'), main = page.locator('main');
    const position = x => expect.poll(async () => (await main.boundingBox()).x).toBe(x);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await position(320);
    expect((await main.boundingBox()).width).toBe(width);
    await expect(main).toHaveAttribute('inert', '');
    const target = await toggle.boundingBox();
    expect(target.x).toBe(332);
    expect(target.width).toBe(44);
    expect(target.height).toBe(44);
    await toggle.focus();
    await toggle.press('Enter');
    await position(0);
    await expect(sidebar).toBeHidden();
    await expect(sidebar).toHaveAttribute('inert', '');
    await expect(main).not.toHaveAttribute('inert');
    await expect(toggle).toBeFocused();
    expect((await toggle.boundingBox()).x).toBe(12);
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await position(0);
    await expect(page.locator('#title')).toHaveText('Project Alpha');
    await page.locator('#prompt').fill('Keep this draft');
    await page.screenshot({ path: testInfo.outputPath('closed.png') });
    const history = await page.evaluate(() => window.history.state);
    const scrollTop = await page.locator('#transcript').evaluate(node => node.scrollTop);
    const composer = await page.locator('#composer').boundingBox();
    await toggle.click();
    await position(320);
    await expect(main).toHaveAttribute('inert', '');
    await expect(page.locator('#sidebar-dismiss')).toHaveCSS('opacity', '1');
    await expect(main).toHaveCSS('border-top-left-radius', '28px');
    const shifted = await page.locator('#composer').boundingBox();
    expect(shifted.width).toBe(composer.width);
    expect(shifted.height).toBe(composer.height);
    expect(shifted.x - composer.x).toBe(320);
    expect(shifted.y).toBe(composer.y);
    await page.screenshot({ path: testInfo.outputPath('open.png') });
    await page.getByRole('button', { name: 'Close sessions list', exact: true }).click({ position: { x: 40, y: 180 } });
    await position(0);
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    expect(await page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(scrollTop);
    expect(await page.evaluate(() => window.history.state)).toEqual(history);
    await toggle.click();
    await position(320);
    await page.keyboard.press('Escape');
    await position(0);
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.getByRole('button', { name: /Project Beta/ }).click();
    await position(0);
    await expect(page.locator('#title')).toHaveText('Project Beta');
    await toggle.click();
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await position(0);
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toBeHidden();
    await expect(page.locator('#sidebar-dismiss')).toBeHidden();
    await expect(main).not.toHaveAttribute('inert');
    await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).not.toHaveAttribute('inert');
    await page.setViewportSize({ width, height: 1000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await position(0);
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  });
}

test('landscape drawer toggle stays close to the panel while preserving closed notch clearance', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.route('**/style.css', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('env(safe-area-inset-left)', '47px');
    await route.fulfill({ response, body });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  const toggle = page.locator('#sidebar-toggle');
  await expect.poll(async () => (await toggle.boundingBox()).x).toBe(332);
  expect((await toggle.boundingBox()).width).toBe(44);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect.poll(async () => (await toggle.boundingBox()).x).toBe(47);
  await toggle.click();
  await expect.poll(async () => (await toggle.boundingBox()).x).toBe(332);
  expect((await page.locator('main').boundingBox()).x).toBe(320);
  await page.screenshot({ path: testInfo.outputPath('landscape-drawer.png') });
});

test('drawer motion translates the whole conversation without reflow and supports reversal and reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 744, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const main = page.locator('main'), toggle = page.locator('#sidebar-toggle');
  await expect.poll(async () => (await main.boundingBox()).x).toBe(0);
  await page.locator('#prompt').fill('Keep this draft');
  const composer = await page.locator('#composer').boundingBox();
  const samples = [];
  for (const expanded of [true, false]) {
    await toggle.click();
    const frames = await page.evaluate(() => new Promise(resolve => {
      const frames = [], start = performance.now();
      const sample = now => {
        const main = document.querySelector('main').getBoundingClientRect();
        const toggle = document.getElementById('sidebar-toggle').getBoundingClientRect();
        const composer = document.getElementById('composer').getBoundingClientRect();
        frames.push({ x: main.x, width: main.width, toggleX: toggle.x, composerX: composer.x, composerY: composer.y, composerWidth: composer.width, composerHeight: composer.height });
        if (now - start < 380) requestAnimationFrame(sample);
        else resolve(frames);
      };
      requestAnimationFrame(sample);
    }));
    samples.push(frames);
    expect(frames.some(frame => frame.x > 0 && frame.x < 320)).toBe(true);
    expect(frames.at(-1).x).toBe(expanded ? 320 : 0);
    for (const frame of frames) {
      expect(frame.width).toBeCloseTo(744, 1);
      expect(Math.abs(frame.toggleX - frame.x - 12)).toBeLessThan(1);
      expect(Math.abs(frame.composerX - frame.x - composer.x)).toBeLessThan(1);
      expect(frame.composerY).toBeCloseTo(composer.y, 1);
      expect(frame.composerWidth).toBeCloseTo(composer.width, 1);
      expect(frame.composerHeight).toBeCloseTo(composer.height, 1);
    }
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  }
  await testInfo.attach('drawer-motion.json', { body: JSON.stringify(samples), contentType: 'application/json' });
  await toggle.press('Enter');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await main.boundingBox()).x).toBe(0);
  await expect(main).not.toHaveAttribute('inert');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(main).toHaveCSS('transition-duration', '0s');
  await toggle.click();
  expect((await main.boundingBox()).x).toBe(320);
  await toggle.click();
  expect((await main.boundingBox()).x).toBe(0);
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
});
