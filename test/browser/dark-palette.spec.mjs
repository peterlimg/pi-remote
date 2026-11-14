import { test, expect } from '@playwright/test';

const contrast = (foreground, background) => {
  const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

test('Duet dark colors cover login, sessions, chat and menus without changing light mode', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(16, 13, 16)');
  await expect(page.locator('#pair-submit')).toHaveCSS('background-color', 'rgb(239, 237, 239)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#100d10');
  await page.locator('#pair-submit').focus();
  await expect(page.locator('#pair-submit')).toHaveCSS('outline-color', 'rgb(239, 237, 239)');
  await page.screenshot({ path: testInfo.outputPath('login-dark.png') });
  await page.getByText('Paste a private link instead', { exact: true }).click();
  await page.getByLabel('Private login link').fill('browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: 'Connect to computer' }).click();

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('#sidebar')).toHaveCSS('background-color', 'rgb(16, 13, 16)');
    await expect(page.locator('#new-session')).toHaveCSS('background-color', 'rgb(239, 237, 239)');
    await page.screenshot({ path: testInfo.outputPath(`sessions-dark-${width}.png`) });
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    await expect(page.locator('#composer')).toHaveCSS('background-color', 'rgba(40, 37, 40, 0.45)');
    await expect(page.locator('.message.user .message-text').first()).toHaveCSS('background-color', 'rgb(34, 31, 34)');
    await expect(page.locator('.code-block').first()).toHaveCSS('background-color', 'rgb(27, 24, 27)');
    await page.locator('#transcript').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`chat-dark-${width}.png`) });
    await page.locator('.tool-activity > summary').first().click();
    await page.locator('details.tool summary').first().click();
    await expect(page.locator('.tool-output').first()).toBeVisible();
    await expect(page.locator('details.tool').first()).toHaveCSS('background-color', 'rgb(27, 24, 27)');
    await page.locator('.session-info summary').click();
    await expect(page.locator('.session-details')).toHaveCSS('background-color', 'rgba(40, 37, 40, 0.72)');
    await page.locator('.session-info summary').click();
    await page.locator('#prompt').fill('/');
    await expect(page.locator('#command-menu')).toHaveCSS('background-color', 'rgba(40, 37, 40, 0.72)');
    await expect(page.locator('.command-option[aria-selected=true]')).toBeVisible();
    const pairs = await page.evaluate(() => {
      // Glass is translucent: measure against its layers painted over the page, ignoring the blur.
      const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
      const seen = node => {
        const layers = [];
        for (let item = node; item; item = item.parentElement) layers.unshift(getComputedStyle(item).backgroundColor);
        for (const color of layers) { context.fillStyle = color; context.fillRect(0, 0, 1, 1); }
        return `rgb(${[...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(', ')})`;
      };
      const pairs = ['html', '#sidebar', '#composer', '.message.user .message-text', '.tool',
        '.command-option[aria-selected=true]', '#pair-submit'].map(selector => {
        const node = document.querySelector(selector);
        return [getComputedStyle(node).color, seen(node)];
      });
      pairs.push([getComputedStyle(document.querySelector('#prompt'), '::placeholder').color, seen(document.querySelector('#composer'))]);
      return pairs;
    });
    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: testInfo.outputPath(`commands-dark-${width}.png`) });
    await page.locator('#prompt').fill('');
    await page.locator('details.tool summary').first().click();
    await page.locator('.tool-activity > summary').first().click();
    await page.emulateMedia({ colorScheme: 'light' });
    for (const [selector, color] of [['html', 'rgb(250, 250, 248)'], ['#sidebar', 'rgb(242, 243, 240)'],
      ['#composer', 'rgba(255, 255, 255, 0.5)'], ['.message.user .message-text', 'rgb(237, 240, 235)']]) {
      await expect(page.locator(selector).first()).toHaveCSS('background-color', color);
    }
    await page.screenshot({ path: testInfo.outputPath(`chat-light-${width}.png`) });
    if (width < 700) await page.getByRole('button', { name: 'Show sessions' }).click();
  }
});
