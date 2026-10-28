import { test, expect } from '@playwright/test';

const storageKey = 'pi-remote-todo-v1';

test('tasks can be added, completed, filtered and deleted, with changes surviving reload', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  expect((await page.goto('/todo.html')).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Room for your first task' })).toBeVisible();
  const input = page.getByLabel('What needs doing?');
  const add = async text => {
    await input.fill(text);
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
  };
  await add('   ');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(input).toHaveJSProperty('validationMessage', 'Enter a task first.');
  for (const text of ['Plan the week', 'Pick up groceries', 'Read for 20 minutes']) await add(text);
  await expect(page.getByRole('status')).toHaveText('3 tasks left');
  await expect(input).toBeFocused();
  await page.getByRole('checkbox', { name: 'Plan the week', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Plan the week', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Plan the week', exact: true })).toBeChecked();
  await expect(page.getByRole('status')).toHaveText('2 tasks left');
  await page.getByRole('button', { name: 'To do', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Plan the week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No completed tasks yet' })).toBeVisible();
  await add('  Walk after lunch  ');
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'Walk after lunch', exact: true })).toBeVisible();
  const unsafe = '<img src=x onerror="window.injected=true">';
  await add(unsafe);
  await expect(page.getByRole('checkbox', { name: unsafe, exact: true })).toBeVisible();
  await expect(page.locator('#task-list img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByRole('button', { name: 'Delete ' + unsafe, exact: true }).click();
  await page.getByRole('button', { name: 'Delete Walk after lunch', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Plan the week', exact: true }).check();
  await input.blur();
  for (const view of [
    { name: 'phone', width: 390, height: 844, scheme: 'light' },
    { name: 'desktop', width: 1440, height: 960, scheme: 'light' },
    { name: 'narrow-dark', width: 320, height: 740, scheme: 'dark' }
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.emulateMedia({ colorScheme: view.scheme, reducedMotion: 'reduce' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`todo-${view.name}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Delete Pick up groceries', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Read for 20 minutes', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Pick up groceries', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('1 task left');
  await page.getByRole('button', { name: 'Delete Read for 20 minutes', exact: true }).click();
  await page.getByRole('button', { name: 'To do', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nothing left to do' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Plan the week', exact: true }).click();
  await expect(input).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Room for your first task' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('failed storage writes leave tasks usable and clearly marked as unsaved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  });
  await page.goto('/todo.html');
  await page.getByLabel('What needs doing?').fill('Keep this tab open');
  await page.getByLabel('What needs doing?').press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Keep this tab open', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await expect(page.locator('#save-note')).toHaveText('Changes are only kept in this tab.');
  await page.getByRole('checkbox', { name: 'Keep this tab open', exact: true }).check();
  await expect(page.getByRole('status')).toHaveText('0 tasks left');
});

test('unreadable saved tasks are not overwritten', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{invalid json'), storageKey);
  await page.goto('/todo.html');
  await expect(page.getByRole('alert')).toContainText('Existing saved data will not be overwritten');
  await page.getByLabel('What needs doing?').fill('Temporary task');
  await page.getByLabel('What needs doing?').press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Temporary task', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('{invalid json');
});
