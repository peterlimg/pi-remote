import { expect } from '@playwright/test';

export async function filterRecentSessions(page, availability) {
  await page.getByRole('button', { name: 'Filter recent sessions', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Filter recent sessions', exact: true });
  await menu.getByRole('checkbox', { name: 'Online', exact: true }).setChecked(availability === 'online' || availability === 'all');
  await menu.getByRole('checkbox', { name: 'Offline', exact: true }).setChecked(availability === 'offline' || availability === 'all');
  await expect(page.locator('#sessions')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}
