import { test, expect } from '@playwright/test';

const token = 'browser-test-token-only-123456789012345';
const key = 'pi-remote-token';

test('collapsed link fallback supports keyboard login, reopening and cross-tab sign out', async ({ page, context }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#pair-hint')).toContainText('single-use code');
  await expect(page.getByLabel('Pairing code', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeVisible();
  await expect(page.getByLabel('Private login link')).toBeHidden();
  const viewport = page.viewportSize();
  for (const [name, size, colorScheme] of [
    ['mobile', viewport, 'light'], ['mobile-dark', viewport, 'dark'],
    ['small-phone', { width: 320, height: 568 }, 'light'], ['desktop', { width: 1280, height: 900 }, 'light']
  ]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme });
    await expect(page.getByRole('button', { name: 'Pair with computer' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeInViewport({ ratio: 1 });
    expect((await page.locator('#pair-code').boundingBox()).height).toBeGreaterThanOrEqual(64);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`login-collapsed-${name}.png`), fullPage: true });
  }
  await page.setViewportSize(viewport);
  const fallback = page.getByText('Paste a private link instead', { exact: true });
  expect((await fallback.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await fallback.focus();
  await fallback.press('Enter');
  await expect(page.getByLabel('Private login link')).toBeVisible();
  await fallback.press('Space');
  await expect(page.getByLabel('Private login link')).toBeHidden();
  await fallback.press('Enter');
  await expect(page.getByLabel('Private login link')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('login-expanded-mobile.png'), fullPage: true });
  await fallback.press('Tab');
  await expect(page.getByLabel('Private login link')).toBeFocused();
  await page.getByLabel('Private login link').fill(new URL('/#token=' + token, page.url()).href);
  await page.locator('#login-form button').click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  expect(new URL(page.url()).hash).toBe('');
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('#connection')).toHaveText('Computer connected', { timeout: 2000 });
  await expect(reopened.locator('#connection')).toBeHidden();
  expect(await reopened.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('#connection')).toHaveText('Computer connected');
  await reopened.locator('#logout').click();
  await expect(other.locator('#login')).toBeVisible();
  expect(await reopened.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await reopened.reload();
  await expect(reopened.locator('#login')).toBeVisible();
});

test('an existing tab login migrates to persistent storage', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(({ key, token }) => sessionStorage.setItem(key, token), { key, token });
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(token);
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
});

test('a new QR replaces stale credentials and rejected credentials stay saved until sign out', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => {
    localStorage.setItem(key, 'stale-token');
    sessionStorage.setItem(key, 'old-tab-token');
  }, key);
  await page.goto('/#token=' + token);
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(token);
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
  await page.goto('/#token=invalid-token');
  await expect(page.locator('#access-message')).toHaveText('This login is no longer valid. Login expired, pair again');
  await expect(page.locator('#login')).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('invalid-token');
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
  await page.getByRole('button', { name: 'Pair again', exact: true }).click();
  await expect(page.getByLabel('Pairing code', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('invalid-token');
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await expect(page.getByRole('button', { name: 'Back to saved login' })).toBeHidden();
});

test('a real server authentication timeout retries without deleting the token or draft', async ({ page }) => {
  await page.goto('/#token=' + token);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Keep this draft');
  await page.evaluate(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      // Drop just the next auth frame to trigger the server's five-second deadline.
      if (JSON.parse(data).type === 'auth') {
        WebSocket.prototype.send = send;
        return;
      }
      send.call(this, data);
    };
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('#connection')).toHaveText('Connecting…');
  await expect(page.locator('#connection')).toHaveText('Computer connected', { timeout: 12000 });
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  await expect(page.locator('#send')).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(token);
});

test('a QR login goes straight from connecting to the session list', async ({ page }) => {
  await page.addInitScript(() => {
    // Record every painted frame: the login form or an empty app must never flash.
    window.flashes = [];
    const check = () => {
      const shown = id => document.getElementById(id) && !document.getElementById(id).hidden;
      if (shown('login')) window.flashes.push('login');
      if (shown('app') && !document.querySelector('#sessions button')) window.flashes.push('empty app');
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.goto('/#token=' + token);
  await expect(page.getByRole('button', { name: /Project Alpha/ })).toBeVisible();
  expect(await page.evaluate(() => [...new Set(window.flashes)])).toEqual([]);
});
