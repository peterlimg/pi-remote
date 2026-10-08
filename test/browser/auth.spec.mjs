import { test, expect } from '@playwright/test';

const token = 'browser-test-token-only-123456789012345';
const key = 'pi-remote-token';

test('manual login survives reopening and sign out clears it across tabs', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#token').fill(token);
  await page.locator('#login-form button').click();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  expect(new URL(page.url()).hash).toBe('');
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('#connection')).toBeVisible({ timeout: 2000 });
  await expect(reopened.locator('#connection')).toHaveText('Computer connected');
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

test('a new QR replaces stale credentials and rejected credentials are cleared', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => {
    localStorage.setItem(key, 'stale-token');
    sessionStorage.setItem(key, 'old-tab-token');
  }, key);
  await page.goto('/#token=' + token);
  await page.reload(); // A fragment-only navigation does not reload the app.
  await expect(page.locator('#connection')).toHaveText('Computer connected');
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(token);
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
  await page.goto('/#token=invalid-token');
  await page.reload();
  await expect(page.locator('#login-error')).toHaveText('Authentication failed');
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
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
